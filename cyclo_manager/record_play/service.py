#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Author: Hyungyu Kim

"""One server-owned recording/playback job with interruptible return transitions."""

from datetime import datetime, timezone
import logging
import queue
import shutil
import threading
import time

from cyclo_manager.jog import JogSession
from cyclo_manager.motion_guard import motion_lock
from cyclo_manager.record_play.bags import BagStore, TRAJECTORY_TYPE
from cyclo_manager.record_play.motion import (
    arrived, feedback, interpolate, MotionPlan, position_message, return_duration,
)
from cyclo_manager.subscriptions import subscribe_joint_feedback, SubscriptionOwner

logger = logging.getLogger(__name__)
GROUP_LABELS = {'arm_l': 'Left arm + gripper', 'arm_r': 'Right arm + gripper',
                'head': 'Neck', 'lift': 'Lift', 'hand_l': 'Left hand', 'hand_r': 'Right hand'}
ROBOT_TYPES = {'sg2', 'bg2', 'sh5', 'bh5', 'f1', 'f2', 'mobile'}
BRINGUP_MAX_AGE = 3.0
ARRIVAL_TIMEOUT = 10.0


class Cancelled(Exception):
    """The operator stopped the current job."""


class RecordPlayService:
    """Serialize jobs across clients; keep bag I/O away from HTTP and ROS threads."""

    def __init__(self, bridge, root, store=None):
        """Initialize job state without subscribing or publishing motion."""
        self.bridge = bridge
        self.store = store or BagStore(root)
        self._lock = threading.RLock()
        self._commands = threading.Lock()
        self._thread = None
        self._cancel = threading.Event()
        self._bringup = False
        self._bringup_at = 0.0
        self._state = {'phase': 'idle', 'active': False, 'error': None, 'owner': None,
                       'recording_id': None, 'robot': None, 'cycle': 0, 'repeats': 1,
                       'elapsed': 0.0, 'duration': 0.0, 'return_duration': 0.0,
                       'messages': 0, 'rate': 1.0}

    def update(self, **values):
        """Publish an atomic state update to HTTP readers."""
        with self._lock:
            self._state.update(values)

    def status(self):
        """Return a consistent snapshot of the server job."""
        with self._lock:
            return dict(self._state)

    def set_bringup(self, running):
        """Refresh independently monitored robot bringup health."""
        with self._lock:
            self._bringup, self._bringup_at = bool(running), time.monotonic()

    def _session(self, robot, subscriptions=None):
        if robot not in ROBOT_TYPES or robot == 'mobile':
            raise ValueError('This robot does not support joint recording/playback.')
        if subscriptions is not None:
            subscribe_joint_feedback(subscriptions)
        session = JogSession(self.bridge, robot)
        session.feedback()
        return session

    def _wait_for_feedback(self, session, description_only=False):
        # A job may start with no page/viewer holding these subscriptions open.
        deadline = time.monotonic() + 2
        while True:
            if not description_only:
                self._check()
            session.feedback()
            try:
                if description_only:
                    if not session.joints:
                        raise ValueError('Robot description is unavailable.')
                else:
                    feedback(session)
                return
            except ValueError:
                if time.monotonic() >= deadline:
                    raise
            time.sleep(.05)

    def catalog(self, robot, subscriptions=None):
        """Read cached groups; only a connected observer registers subscriptions."""
        if robot == 'mobile':
            return []
        session = self._session(robot, subscriptions)
        groups = {}
        for joint in session.joints:
            if joint.group not in groups:
                if subscriptions is not None:
                    subscriptions.subscribe(joint.topic, TRAJECTORY_TYPE,
                                            {'reliability': 'best_effort',
                                             'durability': 'volatile', 'depth': 100})
                cached = self.bridge.get_topic_data(joint.topic)
                groups[joint.group] = {
                    'id': joint.group, 'label': GROUP_LABELS[joint.group],
                    'topic': joint.topic,
                    'receiving': bool(cached and time.time() - cached['received_at'] < 1),
                }
        return list(groups.values())

    def _check(self, motion=True):
        if self._cancel.is_set():
            raise Cancelled()
        if motion:
            with self._lock:
                now = time.monotonic()
                if not self._bringup or now - self._bringup_at > BRINGUP_MAX_AGE:
                    raise ValueError('Robot bringup is stopped or unavailable.')

    def _start(self, phase, robot, owner, work, **state):
        if self._thread and self._thread.is_alive():
            raise ValueError('A recording or playback job is already active.')
        self._cancel = threading.Event()
        self.update(phase=phase, active=True, error=None, owner=owner, robot=robot,
                    cycle=0, elapsed=0.0, return_duration=0.0, messages=0, **state)

        def run():
            try:
                work()
            except Cancelled:
                self.update(phase='idle')
            except Exception as exc:
                logger.exception('Record & Play job failed')
                self.update(phase='error', error=str(exc))
            finally:
                self.update(active=False)

        self._thread = threading.Thread(target=run, name='record-play', daemon=True)
        self._thread.start()

    def record(self, name, robot, groups, owner):
        """Start receiving selected groups in a background recorder."""
        with self._commands, SubscriptionOwner(self.bridge) as subscriptions:
            session = self._session(robot, subscriptions)
            self._wait_for_feedback(session, description_only=True)
            available = {joint.group: joint.topic for joint in session.joints}
            if not groups or set(groups) - available.keys():
                raise ValueError('Choose available joint groups.')
            group_topics = {group: available[group] for group in groups}
            self._start('recording', robot, owner,
                        lambda: self._record(name, robot, group_topics),
                        recording_id=None, repeats=1, duration=0.0, rate=1.0)

    def _record(self, name, robot, group_topics):
        with SubscriptionOwner(self.bridge) as subscriptions:
            self._capture(name, robot, group_topics, subscriptions)

    def _capture(self, name, robot, group_topics, subscriptions):
        topics = sorted(set(group_topics.values()))
        recording_id, path = self.store.create()
        self.update(recording_id=recording_id)
        writer = self.store.writer(recording_id, topics)
        pending = queue.Queue(maxsize=2000)
        overflow = threading.Event()
        gate = threading.Lock()
        accepting = True
        start = time.monotonic_ns()
        wall = time.time_ns()
        count, first, last = 0, None, None
        per_topic = dict.fromkeys(topics, 0)

        def receive(topic, message, timestamp):
            with gate:
                if not accepting or self._cancel.is_set():
                    return
                try:
                    # Monotonic intervals survive host clock corrections while recording.
                    pending.put_nowait((topic, message, wall + time.monotonic_ns() - start))
                except queue.Full:
                    overflow.set()

        try:
            for topic in topics:
                self.bridge.add_message_listener(topic, receive)
                subscriptions.subscribe(topic, TRAJECTORY_TYPE,
                                        {'reliability': 'best_effort', 'durability': 'volatile',
                                         'depth': 100})
            while True:
                with gate:
                    if self._cancel.is_set() and pending.empty():
                        break
                if overflow.is_set():
                    raise ValueError('Recording queue overflowed; incomplete bag was not saved.')
                if count % 100 == 0 and shutil.disk_usage(path).free < 256 * 1024**2:
                    raise ValueError('Recording stopped: less than 256 MiB free disk space.')
                try:
                    topic, message, timestamp = pending.get(timeout=0.1)
                except queue.Empty:
                    self.update(elapsed=(time.monotonic_ns() - start) / 1e9)
                    continue
                writer.write(topic, message, timestamp)
                first = timestamp if first is None else first
                last = timestamp
                count += 1
                per_topic[topic] += 1
                self.update(messages=count, elapsed=(time.monotonic_ns() - start) / 1e9)
        finally:
            with gate:
                accepting = False
            for topic in topics:
                self.bridge.remove_message_listener(topic, receive)
            writer.close()
        if not count:
            raise ValueError('No messages received on any selected topic. '
                             'Empty bag retained on disk, excluded from playback.')
        groups = [group for group, topic in group_topics.items() if per_topic[topic]]
        recorded_topics = [topic for topic in topics if per_topic[topic]]
        omitted_groups = [group for group, topic in group_topics.items() if not per_topic[topic]]
        metadata = {'id': recording_id, 'name': name, 'robot': robot, 'groups': groups,
                    'topics': recorded_topics, 'omitted_groups': omitted_groups,
                    'messages': count, 'duration': (last - first) / 1e9,
                    'created_at': datetime.now(timezone.utc).isoformat()}
        self.store.save(recording_id, metadata)
        self.update(phase='idle', duration=metadata['duration'])

    def motion(self, recording_id, robot, owner, rate=1.0, repeats=1):
        """Move to the start pose and replay as one interruptible server job."""
        with self._commands:
            metadata = self.store.get(recording_id)
            if metadata['robot'] != robot:
                raise ValueError('Recording robot does not match the selected robot.')
            self._start('loading', robot, owner,
                        lambda: self._motion(recording_id, robot, rate, repeats),
                        recording_id=recording_id, repeats=repeats,
                        duration=metadata['duration'], rate=rate)

    def _motion(self, recording_id, robot, rate, repeats):
        if not motion_lock.acquire(blocking=False):
            raise ValueError('Jog is moving. Stop Jog before playback.')
        try:
            with SubscriptionOwner(self.bridge) as subscriptions:
                self._run_motion(recording_id, robot, rate, repeats, subscriptions)
        finally:
            motion_lock.release()

    def _run_motion(self, recording_id, robot, rate, repeats, subscriptions):
        session = self._session(robot, subscriptions)
        plan = None
        attempted = False
        try:
            self._check()
            self._wait_for_feedback(session)
            plan = MotionPlan(self.store, recording_id, session, self._check)
            plan.latch(feedback(session))
            topics = [(topic, TRAJECTORY_TYPE) for topic in plan.first]
            if not self.bridge.prepare_jog_publishers(topics):
                raise ValueError('Cannot prepare trajectory publishers.')
            deadline = time.monotonic() + 2
            while not self.bridge.jog_publishers_ready(topics):
                self._check()
                if time.monotonic() >= deadline:
                    raise ValueError('One or more trajectory controllers have no subscriber.')
                self._cancel.wait(0.1)
            self._check()
            feedback(session)
            self.update(duration=plan.duration / rate)
            attempted = True
            self._return(session, plan, 'preparing')
            cycle = 0
            while repeats == 0 or cycle < repeats:
                self._check()
                cycle += 1
                self.update(phase='playing', cycle=cycle, elapsed=0.0)
                attempted = True
                start = time.monotonic()
                for topic, data, timestamp in self.store.read(recording_id):
                    offset = (timestamp - plan.first_timestamp) / 1e9 / rate
                    self._wait_until(start + offset, session)
                    if time.monotonic() - start - offset > 0.5:
                        raise ValueError(
                            'Playback fell behind; stopped instead of bursting commands.')
                    session.publish(topic, TRAJECTORY_TYPE, plan.message(topic, data, rate))
                    self.update(elapsed=offset)
                self._wait_until(start + plan.duration / rate, session)
                self.update(phase='settling', elapsed=plan.duration / rate)
                self._arrive(session, plan, plan.goals(end=True))
                if repeats == 0 or cycle < repeats:
                    self._return(session, plan, 'returning')
            self.update(phase='completed')
        finally:
            # EOF is not a stop. On cancellation/failure replace any pending timed goal.
            if attempted and plan and self.status()['phase'] != 'completed':
                try:
                    positions = feedback(session)
                    goals, missing = {}, []
                    for topic, values in plan.goals().items():
                        if any(name not in positions for name in values):
                            missing.append(topic)
                        else:
                            goals[topic] = {name: positions[name] for name in values}
                    self._publish_positions(session, goals, check=False)
                    if missing:
                        raise ValueError(f'Missing stop feedback for: {", ".join(missing)}')
                except Exception as exc:
                    raise ValueError(f'Could not hold current pose after stop: {exc}') from exc

    def _publish_positions(self, session, goals, check=True):
        errors = []
        for topic, values in goals.items():
            if check:
                self._check()
            try:
                session.publish(topic, TRAJECTORY_TYPE, position_message(values))
            except ValueError as exc:
                errors.append(str(exc))
        if errors:
            raise ValueError('; '.join(errors))

    def _wait_until(self, deadline, session):
        while True:
            self._check()
            feedback(session)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            self._cancel.wait(min(0.05, remaining))

    def _arrive(self, session, plan, goals):
        deadline = time.monotonic() + ARRIVAL_TIMEOUT
        while True:
            self._check()
            if arrived(goals, feedback(session), plan.joints):
                return
            if time.monotonic() > deadline:
                raise ValueError('Joint target arrival timed out; playback stopped.')
            self._cancel.wait(0.1)

    def _return(self, session, plan, phase):
        self._check()
        positions = feedback(session)
        goals = plan.goals()
        if arrived(goals, positions, plan.joints):
            return
        duration = return_duration(goals, positions, plan.joints, session.description)
        self.update(phase=phase, return_duration=duration)
        start = time.monotonic()
        while True:
            self._check()
            feedback(session)
            fraction = min(1.0, (time.monotonic() - start) / duration)
            self._publish_positions(session, interpolate(goals, positions, fraction))
            if fraction >= 1:
                break
            self._cancel.wait(0.1)
        self._arrive(session, plan, goals)

    def stop(self, owner=None):
        """Cancel motion or finalize recording, optionally scoped to its originating page."""
        with self._commands:
            if owner is not None and owner != self.status()['owner']:
                return self.status()
            if self._thread and self._thread.is_alive():
                self._cancel.set()
                self._thread.join(timeout=5)
            return self.status()

    def close(self):
        """Stop the active job before the ROS bridge shuts down."""
        self.stop()
