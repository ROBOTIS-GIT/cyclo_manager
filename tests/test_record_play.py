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

"""Exercise recording, timed playback and loop return without ROS or hardware."""

from copy import deepcopy
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from cyclo_manager.motion_guard import motion_lock
from cyclo_manager.record_play.bags import BagStore
from cyclo_manager.record_play.motion import (
    interpolate, MotionPlan, return_duration, validate_message,
)
from cyclo_manager.record_play.service import RecordPlayService
from cyclo_manager.robot.interface import RobotInterface
from cyclo_manager.subscriptions import subscribe_joint_feedback, SubscriptionOwner
from test_jog import FakeBridge

TOPIC = '/leader/joystick_controller_left/joint_trajectory'


def trajectory(value, duration=0):
    return {'header': {'stamp': {'sec': 123, 'nanosec': 0}},
            'joint_names': ['head_joint1'], 'points': [
                {'positions': [value], 'time_from_start': {'sec': duration, 'nanosec': 0}}]}


class TrackingBridge(FakeBridge):
    def __init__(self):
        super().__init__()
        self.listeners = {}
        self.follow = True
        self.fresh = True

    def prepare_jog_publishers(self, *args):
        return True

    def jog_publishers_ready(self, *args):
        return True

    def add_message_listener(self, topic, callback):
        self.listeners[topic] = callback

    def remove_message_listener(self, topic, callback):
        self.listeners.pop(topic, None)

    def get_topic_data(self, topic):
        if topic == '/joint_states' and self.fresh:
            self.cache[topic]['received_at'] = time.time()
        return super().get_topic_data(topic)

    def publish_jog(self, topic, msg_type, data):
        result = super().publish_jog(topic, msg_type, data)
        if self.follow and not self.fail:
            measured = self.cache['/joint_states']['data']
            for name, value in zip(data['joint_names'], data['points'][-1]['positions']):
                measured['position'][measured['name'].index(name)] = value
        return result


class MemoryStore(BagStore):
    def __init__(self, root):
        super().__init__(root)
        self.messages = {}

    def writer(self, recording_id, topics):
        store = self
        store.messages[recording_id] = []

        class Writer:
            def write(self, topic, message, timestamp):
                store.messages[recording_id].append((topic, deepcopy(message), timestamp))

            def close(self):
                pass
        return Writer()

    def read(self, recording_id):
        yield from deepcopy(self.messages[recording_id])


class RecordPlayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.bridge = TrackingBridge()
        self.store = MemoryStore(self.tmp.name)
        self.service = RecordPlayService(self.bridge, self.tmp.name, self.store)
        self.addCleanup(self.service.close)
        self.recording_id, _ = self.store.create()
        self.store.messages[self.recording_id] = [
            (TOPIC, trajectory(.2), 1000000000), (TOPIC, trajectory(.3), 1050000000)]
        self.store.save(self.recording_id, {
            'id': self.recording_id, 'name': 'test', 'robot': 'f2', 'duration': .05,
            'groups': ['head'], 'topics': [TOPIC], 'messages': 2, 'created_at': '2026-09-21'})

    def wait(self, predicate, timeout=3):
        start = time.monotonic()
        while not predicate():
            if time.monotonic() - start > timeout:
                self.fail(f'Job did not reach expected state: {self.service.status()}')
            time.sleep(.01)

    def finish(self):
        self.wait(lambda: not self.service.status()['active'])
        # Worker clears active in its finally just before thread exit.
        self.service._thread.join(timeout=1)

    def plan(self):
        session = RobotInterface(self.bridge)
        positions, _, _ = session.feedback()
        plan = MotionPlan(self.store, self.recording_id, session.joints)
        plan.latch(positions)
        return plan, session

    def test_store_rejects_traversal_and_skips_incomplete_recordings(self):
        with self.assertRaises(ValueError):
            self.store.get('../escape')
        self.store.create()
        self.assertEqual(len(self.store.list()), 1)
        persisted = BagStore(self.tmp.name)
        self.assertEqual(persisted.get(self.recording_id)['name'], 'test')

    def test_record_captures_every_callback_and_persists_on_stop(self):
        self.service.record('new', 'f2', ['head'], 'owner')
        self.wait(lambda: TOPIC in self.bridge.listeners)
        for index in range(10):
            self.bridge.listeners[TOPIC](TOPIC, trajectory(index / 100), time.time_ns())
        self.service.stop()
        self.finish()
        metadata = self.store.get(self.service.status()['recording_id'])
        self.assertEqual(metadata['messages'], 10)
        self.assertEqual(len(self.store.messages[metadata['id']]), 10)
        self.assertFalse(self.bridge.listeners)
        self.assertEqual(self.bridge.published, [])

    def test_empty_recording_is_not_listed_as_playable(self):
        self.service.record('empty', 'f2', ['head'], 'owner')
        self.wait(lambda: TOPIC in self.bridge.listeners)
        with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
            self.service.stop()
        self.finish()
        self.assertEqual(self.service.status()['phase'], 'error')
        self.assertEqual(len(self.store.list()), 1)

    def test_missing_topic_does_not_block_saving_received_groups(self):
        lift_topic = '/leader/joystick_controller_right/joint_trajectory'
        self.service.record('partial', 'f2', ['head', 'lift'], 'owner')
        self.wait(lambda: lift_topic in self.bridge.listeners)
        for value in (.2, .3):
            self.bridge.listeners[TOPIC](TOPIC, trajectory(value), time.time_ns())
        self.service.stop()
        self.finish()
        self.assertEqual(self.service.status()['phase'], 'idle')
        self.assertIsNone(self.service.status()['error'])
        recording_id = self.service.status()['recording_id']
        metadata = self.store.get(recording_id)
        self.assertEqual(metadata['groups'], ['head'])
        self.assertEqual(metadata['topics'], [TOPIC])
        self.assertEqual(metadata['omitted_groups'], ['lift'])
        self.assertEqual(metadata['messages'], 2)
        self.assertEqual(len(self.store.list()), 2)
        session = RobotInterface(self.bridge)
        session.feedback()
        plan = MotionPlan(self.store, recording_id, session.joints)
        self.assertEqual(set(plan.first), {TOPIC})
        self.assertEqual(set(plan.last), {TOPIC})

    def test_another_client_cannot_start_a_second_job(self):
        self.service.record('first', 'f2', ['head'], 'one')
        with self.assertRaisesRegex(ValueError, 'already active'):
            self.service.motion(self.recording_id, 'f2', 'two')
        self.wait(lambda: TOPIC in self.bridge.listeners)
        self.bridge.listeners[TOPIC](TOPIC, trajectory(.2), time.time_ns())
        self.service.stop()

    def test_full_validation_happens_before_any_publish(self):
        self.store.messages[self.recording_id].append((TOPIC, trajectory(100), 1100000000))
        with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
            self.service.motion(self.recording_id, 'f2', 'owner')
            self.finish()
        self.assertEqual(self.bridge.published, [])
        self.assertEqual(self.service.status()['phase'], 'error')

    def test_mixed_joint_membership_is_rejected(self):
        self.store.messages[self.recording_id][1][1]['joint_names'] = ['head_joint2']
        with self.assertRaisesRegex(ValueError, 'membership'):
            self.plan()

    def test_schema_validation_rejects_invalid_commands(self):
        plan, _ = self.plan()
        for bad in (float('nan'), float('inf'), 5):
            with self.assertRaises(ValueError):
                validate_message(TOPIC, trajectory(bad), plan.joints)
        bad = trajectory(.2)
        bad['points'][0]['velocities'] = [1, 2]
        with self.assertRaises(ValueError):
            validate_message(TOPIC, bad, plan.joints)

    def test_rate_rebases_header_and_scales_duration_and_derivatives(self):
        plan, _ = self.plan()
        data = trajectory(.2, 1)
        data['points'][0].update(velocities=[2], accelerations=[4])
        output = plan.message(TOPIC, data, .5)
        self.assertEqual(output['header']['stamp']['sec'], 0)
        self.assertEqual(output['points'][0]['time_from_start']['sec'], 2)
        self.assertEqual(output['points'][0]['velocities'], [1, 0])
        self.assertEqual(output['points'][0]['accelerations'], [1, 0])
        self.assertEqual(data['header']['stamp']['sec'], 123)

    def test_unrecorded_joint_is_explicitly_held(self):
        plan, _ = self.plan()
        output = plan.message(TOPIC, trajectory(.3), 1)
        self.assertEqual(output['joint_names'], ['head_joint1', 'head_joint2'])
        self.assertEqual(output['points'][0]['positions'], [.3, .1])

    def test_return_respects_quintic_peak_speed_and_endpoints(self):
        plan, session = self.plan()
        positions = {'head_joint1': -.2, 'head_joint2': .1}
        duration = return_duration(plan.goals(), positions, plan.joints, session.description)
        self.assertGreaterEqual(duration, 1.875 * .4 / (.1745329252))
        self.assertAlmostEqual(interpolate(plan.goals(), positions, 0)[TOPIC]['head_joint1'], -.2)
        self.assertAlmostEqual(interpolate(plan.goals(), positions, 1)[TOPIC]['head_joint1'], .2)

    def test_play_moves_to_start_pose_before_streaming_recorded_commands(self):
        self.bridge.feedback(position=-.2)
        with patch('cyclo_manager.record_play.service.return_duration', return_value=.01):
            self.service.motion(self.recording_id, 'f2', 'owner')
            self.finish()
        self.assertEqual(self.service.status()['phase'], 'completed')
        values = [data['points'][0]['positions'][0] for _, _, data in self.bridge.published]
        self.assertAlmostEqual(values[0], -.2, delta=.001)
        self.assertEqual(values[-2:], [.2, .3])
        self.assertIn(.2, values[:-2])

    def test_stop_during_start_pose_never_starts_bag_playback(self):
        self.bridge.feedback(position=-.2)
        with patch('cyclo_manager.record_play.service.return_duration', return_value=2):
            with patch.object(self.store, 'read', wraps=self.store.read) as read:
                self.service.motion(self.recording_id, 'f2', 'owner')
                self.wait(lambda: self.service.status()['phase'] == 'preparing')
                self.service.stop()
                self.finish()
                self.assertEqual(read.call_count, 1)  # Validation only, no playback pass.
        self.assertEqual(self.service.status()['phase'], 'idle')
        self.assertEqual(self.service.status()['cycle'], 0)
        self.assertFalse(motion_lock.locked())
        self.assertFalse(self.bridge.subscription_users)

    def test_failed_start_pose_arrival_never_starts_bag_playback(self):
        self.bridge.feedback(position=-.2)
        self.bridge.follow = False
        with patch('cyclo_manager.record_play.service.return_duration', return_value=.01):
            with patch('cyclo_manager.record_play.service.ARRIVAL_TIMEOUT', .02):
                with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
                    with patch.object(self.store, 'read', wraps=self.store.read) as read:
                        self.service.motion(self.recording_id, 'f2', 'owner')
                        self.finish()
                        self.assertEqual(read.call_count, 1)
        self.assertIn('arrival timed out', self.service.status()['error'])
        self.assertEqual(self.service.status()['cycle'], 0)
        self.assertFalse(motion_lock.locked())

    def test_loop_returns_before_second_cycle_and_keeps_duration_zero(self):
        with patch('cyclo_manager.record_play.service.return_duration', return_value=.01):
            self.service.motion(self.recording_id, 'f2', 'owner', repeats=2)
            self.finish()
        self.assertEqual(self.service.status()['phase'], 'completed')
        self.assertEqual(self.service.status()['cycle'], 2)
        values = [data['points'][0]['positions'][0] for _, _, data in self.bridge.published]
        self.assertEqual(values[0], .2)
        self.assertEqual(values[1], .3)
        self.assertEqual(values[-2:], [.2, .3])
        self.assertIn(.2, values[2:-2])
        for _, _, data in self.bridge.published:
            self.assertEqual(data['points'][0]['time_from_start']['sec'], 0)

    def test_stop_infinite_loop_sends_hold_and_ends_worker(self):
        with patch('cyclo_manager.record_play.service.return_duration', return_value=.01):
            self.service.motion(self.recording_id, 'f2', 'owner', repeats=0)
            self.wait(lambda: self.service.status()['cycle'] >= 2)
            self.service.stop()
            self.finish()
        self.assertEqual(self.service.status()['phase'], 'idle')
        self.assertFalse(motion_lock.locked())
        count = len(self.bridge.published)
        time.sleep(.15)
        self.assertEqual(len(self.bridge.published), count)

    def test_playback_continues_without_browser_requests(self):
        self.store.messages[self.recording_id][1] = (TOPIC, trajectory(.3), 4200000000)
        self.service.motion(self.recording_id, 'f2', 'closed-browser')
        self.wait(lambda: not self.service.status()['active'], timeout=5)
        self.service._thread.join(timeout=1)
        self.assertEqual(self.service.status()['phase'], 'completed')
        self.assertIsNone(self.service.status()['error'])
        self.assertFalse(motion_lock.locked())

    def test_page_unsubscribe_cannot_remove_playback_feedback_even_during_stop(self):
        self.store.messages[self.recording_id][1] = (TOPIC, trajectory(.3), 3000000000)
        self.service.motion(self.recording_id, 'f2', 'owner')
        self.wait(lambda: len(self.bridge.published) > 0)
        with SubscriptionOwner(self.bridge) as viewer:
            subscribe_joint_feedback(viewer)
        for topic in ('/joint_states', '/robot_description'):
            self.assertEqual(len(self.bridge.subscription_users[topic]), 1)
        time.sleep(.1)
        self.assertTrue(self.service.status()['active'])
        publish = self.bridge.publish_jog

        def publish_hold(*args):
            with SubscriptionOwner(self.bridge) as viewer:
                subscribe_joint_feedback(viewer)
            for topic in ('/joint_states', '/robot_description'):
                self.assertEqual(len(self.bridge.subscription_users[topic]), 1)
            return publish(*args)

        with patch.object(self.bridge, 'publish_jog', side_effect=publish_hold) as held:
            self.service.stop()
            held.assert_called_once()
        self.finish()
        self.assertEqual(self.service.status()['phase'], 'idle')
        self.assertIsNone(self.service.status()['error'])
        self.assertFalse(self.bridge.subscription_users)

    def test_preparation_protects_feedback_and_releases_it_on_success(self):
        self.bridge.feedback(position=.1)
        publish = self.bridge.publish_jog

        def publish_preparation(*args):
            with SubscriptionOwner(self.bridge) as viewer:
                subscribe_joint_feedback(viewer)
            for topic in ('/joint_states', '/robot_description'):
                self.assertEqual(len(self.bridge.subscription_users[topic]), 1)
            return publish(*args)

        with patch.object(self.bridge, 'publish_jog', side_effect=publish_preparation):
            with patch('cyclo_manager.record_play.service.return_duration', return_value=.01):
                self.service.motion(self.recording_id, 'f2', 'owner')
                self.finish()
        self.assertEqual(self.service.status()['phase'], 'completed')
        self.assertFalse(self.bridge.subscription_users)

    def test_feedback_loss_stops_background_playback(self):
        self.store.messages[self.recording_id][1] = (TOPIC, trajectory(.3), 5000000000)
        with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
            self.service.motion(self.recording_id, 'f2', 'owner')
            self.wait(lambda: len(self.bridge.published) > 0)
            self.bridge.fresh = False
            self.bridge.feedback(age=2)
            self.finish()
        self.assertIn('feedback', self.service.status()['error'])
        self.assertFalse(motion_lock.locked())

    def test_stale_feedback_cannot_move(self):
        self.bridge.fresh = False
        self.bridge.feedback(age=2)
        with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
            self.service.motion(self.recording_id, 'f2', 'owner')
            self.finish()
        self.assertEqual(self.bridge.published, [])
        self.assertFalse(self.bridge.subscription_users)


    def test_jog_motion_blocks_playback(self):
        motion_lock.acquire()
        try:
            with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
                self.service.motion(self.recording_id, 'f2', 'owner')
                self.finish()
        finally:
            motion_lock.release()
        self.assertEqual(self.bridge.published, [])
        self.assertIn('Jog', self.service.status()['error'])

    def test_joint_not_reaching_target_aborts_without_starting_next_cycle(self):
        self.bridge.follow = False
        with patch('cyclo_manager.record_play.service.ARRIVAL_TIMEOUT', .02):
            with self.assertLogs('cyclo_manager.record_play.service', level='ERROR'):
                self.service.motion(self.recording_id, 'f2', 'owner', repeats=2)
                self.finish()
        self.assertIn('arrival timed out', self.service.status()['error'])
        self.assertEqual(self.service.status()['cycle'], 1)
        self.assertEqual(self.bridge.published[-1][2]['points'][0]['positions'][0], .2)

    def test_late_page_cleanup_cannot_stop_another_clients_job(self):
        self.service.record('first', 'f2', ['head'], 'new-owner')
        self.wait(lambda: TOPIC in self.bridge.listeners)
        self.service.stop(owner='old-owner')
        self.assertTrue(self.service.status()['active'])
        self.bridge.listeners[TOPIC](TOPIC, trajectory(.2), time.time_ns())
        self.service.stop(owner='new-owner')
        self.finish()


if __name__ == '__main__':
    unittest.main()
