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


class JogBridgeTests(unittest.TestCase):
    def setUp(self):
        directory = Path(__file__).parents[1] / 'cyclo_manager/ros2_node'
        package = ModuleType('cyclo_manager.ros2_node')
        package.__path__ = [str(directory)]
        stubs = {'cyclo_manager.ros2_node': package, 'rclpy': MagicMock()}
        for name in ('executors', 'node', 'publisher', 'subscription', 'qos'):
            stubs[f'rclpy.{name}'] = MagicMock()
        spec = importlib.util.spec_from_file_location('isolated_bridge', directory / 'bridge.py')
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, stubs):
            spec.loader.exec_module(self.module)
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


if __name__ == '__main__':
    unittest.main()
