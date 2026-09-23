#!/usr/bin/env python3
# Copyright 2026 ROBOTIS CO., LTD.
# Licensed under the Apache License, Version 2.0.
# Author: Hyungyu Kim

"""Session-owned Jog cadence, independent of browser and WebSocket send timing."""

import asyncio
import logging

from anyio import CancelScope
from cyclo_manager.jog import JogInput, JogSession
from cyclo_manager.motion_guard import motion_lock
from cyclo_manager.robot.profiles import PROFILES
from cyclo_manager.routers.websocket_utils import release_subscription_owner

logger = logging.getLogger(__name__)
PUBLISH_INTERVAL = 0.05
STATUS_INTERVAL = 0.1
INPUT_TIMEOUT = 0.4
MOTION_KINDS = ('base', 'joint')


async def finish_call(function, *args):
    """Join an in-flight thread before cancellation can start session cleanup."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        with CancelScope(shield=True):
            await task
        raise


class JogController:
    """Coalesce held inputs while preserving release/stop between gestures."""

    def __init__(self, bridge, runtime):
        self.bridge = bridge
        self.runtime = runtime
        self.robot = runtime.snapshot()
        self.session = self.new_session()
        self.command = JogInput()
        self.pending_end = None
        self.last_input = asyncio.get_running_loop().time()
        self.changed = asyncio.Event()
        self.states = asyncio.Queue(maxsize=1)
        self.owns_motion = False

    def new_session(self):
        profile = PROFILES.get(self.robot['model']) if self.robot['ready'] else None
        generation = self.robot['generation']

        def guard():
            self.runtime.require(generation)
            error = self.feedback_conflict()
            if error:
                raise ValueError(error)
        return JogSession(
            self.bridge, profile.model if profile else 'ros',
            base_topic=profile.base_topic if profile else None,
            command_topics=profile.topics if profile else (),
            guard=guard)

    def feedback_conflict(self):
        """Selecting a Docker container does not isolate the shared ROS namespace."""
        graph = self.bridge.motion_graph()
        for topic in ('/robot_description', '/joint_states'):
            if len(graph.get(topic, {}).get('publishers', [])) > 1:
                return f'Multiple publishers on {topic}. Use one robot on this ROS connection.'
        return None

    def robot_status(self):
        state = self.runtime.snapshot()
        error = self.feedback_conflict()
        if error:
            state.update(ready=False, reason=error)
        return state

    def update(self, command):
        """Receive intent only; heartbeats never directly publish ROS commands."""
        self.last_input = asyncio.get_running_loop().time()
        if command.kind in MOTION_KINDS:
            self.command = command
        else:
            self.command = JogInput()
            priority = {'idle': 0, 'release': 1, 'stop': 2}
            if (self.pending_end is None
                    or priority[command.kind] > priority[self.pending_end.kind]):
                self.pending_end = command
        self.changed.set()

    def release_motion(self):
        if self.owns_motion and not any(self.session.base) and self.session.active_joint is None:
            motion_lock.release()
            self.owns_motion = False

    async def refresh_runtime(self):
        current = self.runtime.snapshot()
        if current['generation'] == self.robot['generation']:
            return
        if self.command.kind in MOTION_KINDS or self.owns_motion:
            raise ValueError('Robot bringup changed. Reconnect and enable Jog again.')
        await finish_call(self.session.stop)
        await release_subscription_owner(self.session.subscriptions)
        self.robot = current
        self.session = self.new_session()
        await finish_call(self.session.setup)

    async def run(self):
        """Serialize all session access; never overlap a publish and a stop."""
        loop = asyncio.get_running_loop()
        next_publish = next_status = loop.time()
        try:
            await finish_call(self.session.setup)
            while True:
                self.changed.clear()
                await self.refresh_runtime()

                if self.pending_end is not None:
                    command, self.pending_end = self.pending_end, None
                    await finish_call(self.session.apply, command)
                    self.release_motion()
                    next_publish = loop.time()
                    next_status = 0
                    # A new release/stop received during the call takes priority.
                    if self.pending_end is not None:
                        continue

                now = loop.time()
                if self.command.kind in MOTION_KINDS:
                    if now - self.last_input >= INPUT_TIMEOUT:
                        raise ValueError('Jog input timed out')
                    if now >= next_publish:
                        if not self.owns_motion:
                            if not motion_lock.acquire(blocking=False):
                                raise ValueError('Another manager motion is active. Stop it before Jog.')
                            self.owns_motion = True
                        await finish_call(self.session.apply, self.command)
                        self.release_motion()
                        next_publish += PUBLISH_INTERVAL
                        # Skip missed ticks instead of replaying a burst of old work.
                        if next_publish <= loop.time():
                            next_publish = loop.time() + PUBLISH_INTERVAL
                        if self.pending_end is not None:
                            continue

                if loop.time() >= next_status:
                    state = await finish_call(self.session.snapshot)
                    state['robot'] = await finish_call(self.robot_status)
                    if self.states.full():
                        self.states.get_nowait()
                    self.states.put_nowait({'state': state, 'error': None})
                    next_status = loop.time() + STATUS_INTERVAL

                deadline = next_status
                if self.command.kind in MOTION_KINDS:
                    deadline = min(deadline, next_publish, self.last_input + INPUT_TIMEOUT)
                try:
                    await asyncio.wait_for(self.changed.wait(), max(0, deadline - loop.time()))
                except asyncio.TimeoutError:
                    pass
        finally:
            with CancelScope(shield=True):
                try:
                    await finish_call(self.session.stop)
                except Exception:
                    logger.exception('Could not send final jog stop; last joint targets remain; base timeout applies')
                finally:
                    try:
                        await release_subscription_owner(self.session.subscriptions)
                    finally:
                        if self.owns_motion:
                            motion_lock.release()
                            self.owns_motion = False
