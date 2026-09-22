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

"""Check bounded observations and telemetry without robot or network access."""

import asyncio
import importlib.util
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from cyclo_manager.subscriptions import SubscriptionOwner
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from ws_helpers import receive_data
from test_jog_bridge import load_bridge_module


class ObservationTests(unittest.TestCase):
    def setUp(self):
        module = load_bridge_module()
        module.message_to_dict = lambda raw, _: raw
        self.bridge = module.Ros2Bridge()
        self.bridge._is_running = True
        self.bridge._rclpy_node = MagicMock()
        self.bridge._rclpy_node.count_publishers.side_effect = lambda topic: int(topic == '/camera')
        self.bridge._create_sub = MagicMock(side_effect=lambda *args: object())
        self.bridge._handle_get_publisher_qos = lambda _: {}
        self.feed = {}
        self.done = threading.Event()
        self.spin = threading.Thread(target=self.spin_loop)
        self.spin.start()
        path = Path(__file__).parents[1] / 'cyclo_manager/routers/ros2_observation.py'
        spec = importlib.util.spec_from_file_location('isolated_observation', path)
        self.router = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'cyclo_manager.state': SimpleNamespace(
                app_state=SimpleNamespace(get_ros2_bridge_or_none=lambda: self.bridge))}):
            spec.loader.exec_module(self.router)
        self.router.DESCRIPTION_TIMEOUT = .15
        self.router.STATUS_INTERVAL = .05
        app = FastAPI()
        app.include_router(self.router.router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.done.set()
        self.spin.join(timeout=2)

    def spin_loop(self):
        while not self.done.wait(.002):
            self.bridge._process_request()
            with self.bridge._lock:
                for topic in self.bridge._subs:
                    if topic in self.feed:
                        self.bridge._msg_cache[topic] = {
                            'raw_message': self.feed[topic], 'received_at': time.time()}

    def wait(self, condition):
        deadline = time.monotonic() + 2
        while not condition():
            if time.monotonic() > deadline:
                self.fail('Timed out waiting for cleanup')
            time.sleep(.005)

    def test_description_receipt_releases_subscription_and_uses_transient_local(self):
        self.feed['/robot_description'] = {'data': '<robot name="fixture" />'}
        response = self.client.get('/ros2/robot-description')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], self.feed['/robot_description'])
        self.assertFalse(self.bridge._subs)
        qos = self.bridge._create_sub.call_args.args[2]
        self.assertEqual(qos['durability'], 'transient_local')

    def test_description_timeout_releases_subscription(self):
        response = self.client.get('/ros2/robot-description')
        self.assertEqual(response.status_code, 504)
        self.assertFalse(self.bridge._subs)

    def test_description_request_preserves_other_owner_and_cache(self):
        with SubscriptionOwner(self.bridge) as other:
            other.subscribe('/robot_description', 'std_msgs/msg/String')
            self.feed['/robot_description'] = {'data': '<robot />'}
            response = self.client.get('/ros2/robot-description')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                self.bridge._subscription_users['/robot_description'], {other.owner_id})
            self.assertIn('/robot_description', self.bridge._msg_cache)
        self.assertFalse(self.bridge._subs)

    def test_http_disconnect_and_task_cancellation_release_temporary_owner(self):
        async def scenario():
            request = SimpleNamespace(is_disconnected=AsyncMock(return_value=True))
            with self.assertRaises(HTTPException) as exc:
                await self.router.read_once(request, self.bridge, '/robot_description',
                                            'std_msgs/msg/String', 1)
            self.assertEqual(exc.exception.status_code, 499)
            self.assertFalse(self.bridge._subs)
            request.is_disconnected.return_value = False
            task = asyncio.create_task(self.router.read_once(
                request, self.bridge, '/robot_description', 'std_msgs/msg/String', 5))
            for _ in range(100):
                if '/robot_description' in self.bridge._subs:
                    break
                await asyncio.sleep(.005)
            self.assertIn('/robot_description', self.bridge._subs)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertFalse(self.bridge._subs)
        asyncio.run(scenario())

    def test_invalid_http_topics_are_bad_requests_without_subscriptions(self):
        description = self.client.get('/ros2/robot-description', params={'topic': '/bad//topic'})
        self.assertEqual(description.status_code, 400)
        self.assertFalse(self.bridge._subscription_users)
        self.bridge._create_sub.assert_not_called()

    def test_http_type_conflicts_are_bad_requests_and_preserve_other_owner(self):
        topic = '/robot_description'
        with SubscriptionOwner(self.bridge) as owner:
            owner.subscribe(topic, 'sensor_msgs/msg/JointState')
            response = self.client.get('/ros2/robot-description')
            self.assertEqual(response.status_code, 400)
            self.assertIn('Conflicting message type', response.json()['detail'])
            self.assertEqual(self.bridge._subscription_users[topic], {owner.owner_id})
        self.assertFalse(self.bridge._subs)

    def test_subscription_failure_releases_owner(self):
        self.bridge._create_sub.return_value = None
        self.bridge._create_sub.side_effect = None
        response = self.client.get('/ros2/robot-description')
        self.assertEqual(response.status_code, 503)
        self.assertFalse(self.bridge._subscription_users)

    def test_status_only_subscribes_to_batteries_and_checks_camera_graph(self):
        battery = '/battery'
        self.feed[battery] = {'percentage': .72}
        with self.client.websocket_connect(
                '/ws/ros2/system-status?battery=/battery&camera=/camera&camera=/missing') as ws:
            data = receive_data(ws)['data']
            self.assertEqual(data['cameras'], {'/camera': True, '/missing': False})
            self.assertEqual(set(self.bridge._subs), {battery})
            while data['batteries'][battery] is None:
                data = receive_data(ws)['data']
            self.assertEqual(data['batteries'][battery], 72)
            self.feed.clear()
            with self.bridge._lock:
                self.bridge._msg_cache[battery]['received_at'] = time.time() - 100
            while data['batteries'][battery] is not None:
                data = receive_data(ws)['data']
            self.assertIsNone(data['batteries'][battery])
        self.wait(lambda: not self.bridge._subs)

    def test_two_status_clients_release_only_their_own_battery_subscription(self):
        url = '/ws/ros2/system-status?battery=/battery&camera=/camera'
        with self.client.websocket_connect(url) as first:
            receive_data(first)
            with self.client.websocket_connect(url) as second:
                receive_data(second)
                self.assertEqual(len(self.bridge._subscription_users['/battery']), 2)
                first.close()
                self.wait(lambda: len(self.bridge._subscription_users['/battery']) == 1)
                self.assertIn('batteries', receive_data(second)['data'])
        self.wait(lambda: not self.bridge._subs)

    def test_system_ready_without_battery_messages_and_terminal_type_conflict(self):
        with self.client.websocket_connect('/ws/ros2/system-status?battery=/battery') as ws:
            self.assertEqual(ws.receive_json(), {'type': 'ready'})
            self.assertIsNone(ws.receive_json()['data']['batteries']['/battery'])
        self.wait(lambda: not self.bridge._subs)
        with SubscriptionOwner(self.bridge) as other:
            other.subscribe('/battery', 'std_msgs/msg/String')
            with self.client.websocket_connect('/ws/ros2/system-status?battery=/battery') as ws:
                error = ws.receive_json()
                self.assertEqual(error['code'], 'type_conflict')
                self.assertFalse(error['retryable'])
                self.assertEqual(ws.receive()['code'], 1008)
            self.assertEqual(self.bridge._subscription_users['/battery'], {other.owner_id})

    def test_camera_only_status_does_not_create_any_ros_subscription(self):
        with self.client.websocket_connect('/ws/ros2/system-status?camera=/camera') as ws:
            self.assertTrue(receive_data(ws)['data']['cameras']['/camera'])
            self.bridge._create_sub.assert_not_called()


if __name__ == '__main__':
    unittest.main()
