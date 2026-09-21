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

"""Queue deadlines must prevent delayed motion after a stop/disconnect."""

import importlib.util
from pathlib import Path
import queue
import sys
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


def load_bridge_module():
    directory = Path(__file__).parents[1] / 'cyclo_manager/ros2_node'
    package = ModuleType('cyclo_manager.ros2_node')
    package.__path__ = [str(directory)]
    stubs = {'cyclo_manager.ros2_node': package, 'rclpy': MagicMock()}
    for name in ('executors', 'node', 'publisher', 'subscription', 'qos'):
        stubs[f'rclpy.{name}'] = MagicMock()
    spec = importlib.util.spec_from_file_location('isolated_bridge', directory / 'bridge.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, stubs):
        spec.loader.exec_module(module)
    return module


class JogBridgeTests(unittest.TestCase):
    def setUp(self):
        self.module = load_bridge_module()
        self.bridge = self.module.Ros2Bridge()

    def dispatch(self, payload):
        response = queue.Queue()
        self.bridge._request_queue.put(
            (self.module.RequestKind.PUBLISH_TOPIC, (payload, response)))
        self.bridge._process_request()
        return response.get_nowait()

    def test_expired_motion_is_discarded_without_publishing(self):
        self.bridge._handle_publish_topic = MagicMock(return_value=True)
        result = self.dispatch(('/cmd_vel', 'geometry_msgs/msg/Twist', {}, time.monotonic() - 1))
        self.assertFalse(result)
        self.bridge._handle_publish_topic.assert_not_called()

    def test_fresh_command_requires_subscriber(self):
        self.bridge._handle_publish_topic = MagicMock(return_value=True)
        self.assertTrue(self.dispatch(
            ('/cmd_vel', 'geometry_msgs/msg/Twist', {}, time.monotonic() + 1)))
        self.bridge._handle_publish_topic.assert_called_once_with(
            '/cmd_vel', 'geometry_msgs/msg/Twist', {}, require_subscriber=True)

    def test_unmatched_publisher_rejects_jog(self):
        publisher = MagicMock()
        publisher.get_subscription_count.return_value = 0
        self.bridge._rclpy_node = MagicMock()
        self.bridge._rclpy_node.create_publisher.return_value = publisher
        with patch.object(self.module, 'get_message_class', return_value=SimpleNamespace):
            result = self.bridge._handle_publish_topic(
                '/cmd_vel', 'geometry_msgs/msg/Twist', {}, True)
        self.assertFalse(result)
        publisher.publish.assert_not_called()

    def test_legacy_publish_still_works_without_deadline(self):
        self.bridge._handle_publish_topic = MagicMock(return_value=True)
        self.assertTrue(self.dispatch(('/cmd_vel', 'geometry_msgs/msg/Twist', {})))
        self.bridge._handle_publish_topic.assert_called_once_with(
            '/cmd_vel', 'geometry_msgs/msg/Twist', {}, require_subscriber=False)

    def test_recorder_observes_every_message_without_replacing_cache(self):
        self.bridge._rclpy_node = MagicMock()
        listener = MagicMock()
        self.bridge.add_message_listener('/trajectory', listener)
        with patch.object(self.module, 'get_message_class', return_value=SimpleNamespace):
            with patch.object(self.module, 'parse_qos_profile', return_value=MagicMock()):
                self.bridge._handle_acquire_subscription(
                    '/trajectory', 'trajectory_msgs/msg/JointTrajectory', 'recorder', {})
        callback = self.bridge._rclpy_node.create_subscription.call_args.args[2]
        first, second = object(), object()
        callback(first)
        callback(second)
        self.assertEqual(listener.call_count, 2)
        self.assertIs(listener.call_args_list[0].args[1], first)
        self.assertIs(self.bridge._msg_cache['/trajectory']['raw_message'], second)

    def test_unsupported_subscription_type_has_terminal_error(self):
        self.bridge._rclpy_node = MagicMock()
        with patch.object(self.module, 'get_message_class', return_value=None):
            with self.assertRaises(self.module.SubscriptionError) as caught:
                self.bridge._create_sub('/unknown', 'missing/msg/Unknown', {})
        self.assertEqual(caught.exception.code, 'invalid_message_type')
        self.assertFalse(caught.exception.retryable)

    def test_two_viewers_share_one_subscription_until_last_owner_leaves(self):
        self.bridge._rclpy_node = MagicMock()
        self.bridge._create_sub = MagicMock(return_value=object())
        topic = '/joint_states'
        cached = {'raw_message': object(), 'received_at': time.time()}
        for owner in ('viewer-A', 'viewer-A', 'viewer-B', 'playback'):
            self.assertTrue(self.bridge._handle_acquire_subscription(topic, 'JointState', owner))
        self.bridge._create_sub.assert_called_once()
        self.bridge._msg_cache[topic] = cached
        for owner in ('viewer-A', 'viewer-A', 'unknown', 'viewer-B'):
            self.assertTrue(self.bridge._handle_release_subscriptions(owner))
            self.assertIs(self.bridge._msg_cache[topic], cached)
        self.bridge._rclpy_node.destroy_subscription.assert_not_called()
        self.bridge._handle_release_subscriptions('playback')
        self.bridge._rclpy_node.destroy_subscription.assert_called_once()
        self.assertNotIn(topic, self.bridge._msg_cache)
        self.assertFalse(self.bridge._subscription_users)

    def test_delayed_old_connection_release_preserves_reconnected_viewer(self):
        self.bridge._create_sub = MagicMock(return_value=object())
        for owner in ('old', 'new'):
            self.bridge._handle_acquire_subscription('/joint_states', 'JointState', owner)
        self.bridge._handle_release_subscriptions('old')
        self.assertEqual(self.bridge._subscription_users['/joint_states'], {'new'})

    def test_conflicting_type_cannot_replace_another_owners_subscription(self):
        self.bridge._create_sub = MagicMock(return_value=object())
        self.bridge._handle_acquire_subscription('/joint_states', 'JointState', 'one')
        with self.assertRaises(self.module.SubscriptionError):
            self.bridge._handle_acquire_subscription('/joint_states', 'String', 'two')
        self.assertEqual(self.bridge._subscription_users['/joint_states'], {'one'})

    def test_expired_acquire_does_not_create_or_register_a_subscription(self):
        self.bridge._create_sub = MagicMock()
        response = queue.Queue()
        self.bridge._request_queue.put((self.module.RequestKind.ACQUIRE_SUBSCRIPTION, (
            ('/joint_states', 'JointState', 'old', None, time.monotonic() - 1), response)))
        self.bridge._process_request()
        self.assertFalse(response.get_nowait())
        self.bridge._create_sub.assert_not_called()

    def test_own_recording_subscription_does_not_count_as_a_controller(self):
        node = self.bridge._rclpy_node = MagicMock()
        node.get_name.return_value = 'cyclo_manager'
        node.get_namespace.return_value = '/'
        own = SimpleNamespace(node_name='cyclo_manager', node_namespace='/')
        follower = SimpleNamespace(node_name='arm_controller', node_namespace='/follower')
        publisher = MagicMock()
        publisher.get_subscription_count.return_value = 1
        node.get_subscriptions_info_by_topic.return_value = [own]
        self.assertFalse(self.bridge._has_external_subscriber('/trajectory', publisher))
        node.get_subscriptions_info_by_topic.return_value = [own, follower]
        self.assertTrue(self.bridge._has_external_subscriber('/trajectory', publisher))

    def test_destroyed_subscription_callback_cannot_overwrite_replacement_cache(self):
        node = self.bridge._rclpy_node = MagicMock()
        node.create_subscription.side_effect = [object(), object()]
        with patch.object(self.module, 'get_message_class', return_value=SimpleNamespace):
            with patch.object(self.module, 'parse_qos_profile', return_value=MagicMock()):
                self.bridge._handle_acquire_subscription('/joint_states', 'JointState', 'old')
                old_callback = node.create_subscription.call_args.args[2]
                self.bridge._handle_release_subscriptions('old')
                old_callback(object())
                self.assertNotIn('/joint_states', self.bridge._msg_cache)
                self.bridge._handle_acquire_subscription('/joint_states', 'JointState', 'new')
                new_callback = node.create_subscription.call_args.args[2]
        current = object()
        new_callback(current)
        old_callback(object())
        self.assertIs(self.bridge._msg_cache['/joint_states']['raw_message'], current)

    def test_joint_feedback_uses_canonical_qos_regardless_of_first_owner(self):
        self.bridge._create_sub = MagicMock(return_value=object())
        self.bridge._handle_acquire_subscription(
            '/joint_states', 'JointState', 'viewer', {'reliability': 'reliable'})
        profile = self.bridge._create_sub.call_args.args[2]
        self.assertEqual(profile['reliability'], 'best_effort')
        self.bridge._handle_acquire_subscription('/joint_states', 'JointState', 'jog')
        self.bridge._create_sub.assert_called_once()


if __name__ == '__main__':
    unittest.main()
