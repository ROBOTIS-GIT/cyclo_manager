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

from cyclo_manager.robot.catalog import catalog
from cyclo_manager.motion_guard import motion_lock
from cyclo_manager.record_play.bags import BagStore
from cyclo_manager.record_play.motion import (
    arrival_errors, arrived, interpolate, MotionPlan, return_duration,
)
from cyclo_manager.robot.interface import position_message, RobotInterface, TRAJECTORY_TYPE
from cyclo_manager.subscriptions import subscribe_joint_feedback, SubscriptionOwner

logger = logging.getLogger(__name__)
ARRIVAL_TIMEOUT = 10.0
ARRIVAL_STABLE_TIME = 0.3
IDLE_STATE = {'phase': 'idle', 'active': False, 'error': None, 'owner': None,
              'recording_id': None, 'robot': None, 'cycle': 0, 'repeats': 1,
              'elapsed': 0.0, 'duration': 0.0, 'return_duration': 0.0,
              'messages': 0, 'rate': 1.0, 'arrival_tolerance_deg': 0.5}


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
        self._state = dict(IDLE_STATE)

    def update(self, **values):
        """Publish an atomic state update to HTTP readers."""
        with self._lock:
            self._state.update(values)

    def status(self):
        """Return a consistent snapshot of the server job."""
        with self._lock:
            return dict(self._state)

    def _connection(self, robot, subscriptions=None, command_topics=None):
        if subscriptions is not None:
            subscribe_joint_feedback(subscriptions)
        catalog(self.bridge, subscriptions)
        connection = RobotInterface(
            self.bridge, robot, command_topics=command_topics)
        connection.feedback()
        return connection

    def _wait_for_feedback(self, connection):
        # A job may start with no page/viewer holding these subscriptions open.
        deadline = time.monotonic() + 2
        while True:
            self._check()
            try:
                connection.require_feedback()
                return
            except ValueError:
                if time.monotonic() >= deadline:
                    raise
            self._cancel.wait(.05)

    def catalog(self, robot, subscriptions=None):
        """Read cached groups; only a connected observer registers subscriptions."""
        if subscriptions is not None:
            subscribe_joint_feedback(subscriptions)
        groups = catalog(self.bridge, subscriptions)
        return groups

    def _check(self):
        if self._cancel.is_set():
            raise Cancelled()

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
        with self._commands:
            available = self.catalog(robot)
            choices = {g['id']: g['topic'] for g in available}
            # Keep previously shipped group identifiers accepted by existing clients.
            choices.update({g['alias']: g['topic'] for g in available if g['alias']})
            if not groups or set(groups) - choices.keys():
                raise ValueError('Choose discovered JointTrajectory topics.')
            group_topics = {group: choices[group] for group in groups}
            self._start('recording', robot, owner,
                        lambda: self._record(name, robot, group_topics),
                        recording_id=None, repeats=1, duration=0.0, rate=1.0,
                        arrival_tolerance_deg=0.5)

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

    def motion(self, recording_id, robot, owner, rate=1.0, repeats=1,
               arrival_tolerance_deg=0.5):
        """Move to the start pose and replay as one interruptible server job."""
        with self._commands:
            metadata = self.store.get(recording_id)
            self._start('loading', robot, owner,
                        lambda: self._motion(recording_id, robot, rate, repeats,
                                             arrival_tolerance_deg),
                        recording_id=recording_id, repeats=repeats,
                        duration=metadata['duration'], rate=rate,
                        arrival_tolerance_deg=arrival_tolerance_deg)

    def _motion(self, recording_id, robot, rate, repeats, arrival_tolerance_deg):
        if not motion_lock.acquire(blocking=False):
            raise ValueError('Jog is moving. Stop Jog before playback.')
        try:
            with SubscriptionOwner(self.bridge) as subscriptions:
                self._run_motion(recording_id, robot, rate, repeats, subscriptions,
                                 arrival_tolerance_deg)
        finally:
            motion_lock.release()

    def _run_motion(self, recording_id, robot, rate, repeats, subscriptions,
                    arrival_tolerance_deg):
        recorded_topics = self.store.get(recording_id)['topics']
        connection = self._connection(robot, subscriptions, command_topics=recorded_topics)
        plan = None
        attempted = False
        try:
            self._check()
            self._wait_for_feedback(connection)
            plan = MotionPlan(self.store, recording_id, connection.joints, self._check)
            connection.pin_topics(plan.first)
            plan.latch(connection.require_feedback())
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
            connection.require_feedback()
            self.update(duration=plan.duration / rate)
            attempted = True
            self._return(connection, plan, 'preparing', arrival_tolerance_deg)
            cycle = 0
            while repeats == 0 or cycle < repeats:
                self._check()
                cycle += 1
                self.update(phase='playing', cycle=cycle, elapsed=0.0)
                start = time.monotonic()
                for topic, data, timestamp in self.store.read(recording_id):
                    offset = (timestamp - plan.first_timestamp) / 1e9 / rate
                    self._wait_until(start + offset, connection)
                    if time.monotonic() - start - offset > 0.5:
                        raise ValueError(
                            'Playback fell behind; stopped instead of bursting commands.')
                    connection.publish(topic, TRAJECTORY_TYPE, plan.message(topic, data, rate))
                    self.update(elapsed=offset)
                self._wait_until(start + plan.duration / rate, connection)
                self.update(phase='settling', elapsed=plan.duration / rate)
                self._arrive(connection, plan, plan.goals(end=True), arrival_tolerance_deg)
                if repeats == 0 or cycle < repeats:
                    self._return(connection, plan, 'returning', arrival_tolerance_deg)
            self.update(phase='completed')
        finally:
            # EOF is not a stop. On cancellation/failure replace any pending timed goal.
            if attempted and plan and self.status()['phase'] != 'completed':
                try:
                    positions = connection.require_feedback()
                    goals, missing = {}, []
                    for topic, values in plan.goals().items():
                        if any(name not in positions for name in values):
                            missing.append(topic)
                        else:
                            goals[topic] = {name: positions[name] for name in values}
                    self._publish_positions(connection, goals, check=False)
                    if missing:
                        raise ValueError(f'Missing stop feedback for: {", ".join(missing)}')
                except Exception as exc:
                    raise ValueError(f'Could not hold current pose after stop: {exc}') from exc

    def _publish_positions(self, connection, goals, check=True):
        errors = []
        for topic, values in goals.items():
            if check:
                self._check()
            try:
                connection.publish(topic, TRAJECTORY_TYPE, position_message(values))
            except ValueError as exc:
                errors.append(str(exc))
        if errors:
            raise ValueError('; '.join(errors))

    def _wait_until(self, deadline, connection):
        while True:
            self._check()
            connection.require_feedback()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            self._cancel.wait(min(0.05, remaining))

    def _arrive(self, connection, plan, goals, arrival_tolerance_deg):
        deadline = time.monotonic() + ARRIVAL_TIMEOUT
        stable_since = None
        stable_sample_since = None
        last_errors = []
        while True:
            self._check()
            errors = arrival_errors(goals, connection.require_feedback(), plan.joints,
                                    arrival_tolerance_deg)
            now = time.monotonic()
            sample_at = connection.feedback_received_at
            if errors:
                stable_since = None
                stable_sample_since = None
                last_errors = errors
            else:
                if stable_since is None or sample_at < stable_sample_since:
                    stable_since = now
                    stable_sample_since = sample_at
                # A cached sample remains fresh for 0.5 s. It must not alone
                # establish a 0.3 s stable arrival when feedback stops arriving.
                if (now - stable_since >= ARRIVAL_STABLE_TIME
                        and sample_at - stable_sample_since >= ARRIVAL_STABLE_TIME):
                    return
            if now > deadline:
                detail = '; '.join(errors)
                if not errors:
                    detail = (f'Targets are within tolerance now, but did not remain within '
                              f'tolerance for {ARRIVAL_STABLE_TIME:.1f} s continuously.')
                    if last_errors:
                        detail += ' Last outside tolerance: ' + '; '.join(last_errors)
                raise ValueError('Joint target arrival timed out; playback stopped. ' + detail)
            self._cancel.wait(0.1)

    def _return(self, connection, plan, phase, arrival_tolerance_deg):
        self._check()
        positions = connection.require_feedback()
        goals = plan.goals()
        self.update(phase=phase, return_duration=0.0)
        if arrived(goals, positions, plan.joints, arrival_tolerance_deg):
            self._arrive(connection, plan, goals, arrival_tolerance_deg)
            return
        duration = return_duration(goals, positions, plan.joints, connection.description)
        self.update(phase=phase, return_duration=duration)
        start = time.monotonic()
        while True:
            self._check()
            connection.require_feedback()
            fraction = min(1.0, (time.monotonic() - start) / duration)
            self._publish_positions(connection, interpolate(goals, positions, fraction))
            if fraction >= 1:
                break
            self._cancel.wait(0.1)
        self._arrive(connection, plan, goals, arrival_tolerance_deg)

    def delete(self, recording_id):
        """Delete a saved bag only while recording and playback are fully idle."""
        with self._commands:
            state = self.status()
            if state['active'] or (self._thread and self._thread.is_alive()):
                raise ValueError('Cannot delete recordings while recording or playback is active. '
                                 'Stop it first.')
            self.store.delete(recording_id)
            if state['recording_id'] == recording_id:
                self.update(**IDLE_STATE)
            return self.status()

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
