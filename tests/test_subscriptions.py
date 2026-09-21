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

"""Exercise real bridge ownership and ASGI WebSocket cleanup without ROS hardware."""

import importlib.util
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from cyclo_manager.motion_guard import motion_lock
from cyclo_manager.record_play.service import RecordPlayService
from cyclo_manager.subscriptions import SubscriptionOwner
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ws_helpers import receive_data
from test_jog import FakeBridge
from test_jog_bridge import load_bridge_module
from test_record_play import MemoryStore, TOPIC, trajectory


class SubscriptionTests(unittest.TestCase):
    def setUp(self):
        module = load_bridge_module()
        self.bridge = module.Ros2Bridge()
        self.bridge._is_running = True
        self.bridge._rclpy_node = MagicMock()
        self.bridge._create_sub = MagicMock(side_effect=lambda *args: object())
        self.bridge._handle_get_publisher_qos = lambda _: {}
        module.message_to_dict = lambda raw, _: raw
        self.source = FakeBridge()
        self.feed = False
        self.published = []
        self.bridge.prepare_jog_publishers = lambda _: True
        self.bridge.jog_publishers_ready = lambda _: True
        self.bridge.publish_jog = self.publish
        self.done = threading.Event()
        self.spin = threading.Thread(target=self.spin_loop)
        self.spin.start()
        self.tmp = tempfile.TemporaryDirectory()
        self.store = MemoryStore(self.tmp.name)
        self.manager = RecordPlayService(self.bridge, self.tmp.name, self.store)
        self.fake_state = SimpleNamespace(
            get_ros2_bridge_or_none=lambda: self.bridge, record_play=self.manager)
        self.app = FastAPI()
        for name in ('websocket_ros2', 'websocket_jog', 'record_play', 'ros2'):
            path = Path(__file__).parents[1] / f'cyclo_manager/routers/{name}.py'
            spec = importlib.util.spec_from_file_location(f'isolated_{name}', path)
            router = importlib.util.module_from_spec(spec)
            with patch.dict(sys.modules, {
                'cyclo_manager.state': SimpleNamespace(
                    app_state=self.fake_state, get_agent_client=MagicMock()),
                'cyclo_manager.ros2_node': SimpleNamespace(Ros2Bridge=module.Ros2Bridge),
            }):
                spec.loader.exec_module(router)
            self.app.include_router(router.router)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.manager.close()
        self.client.close()
        self.done.set()
        self.spin.join(timeout=2)
        self.tmp.cleanup()

    def spin_loop(self):
        while not self.done.wait(.002):
            self.bridge._process_request()
            if self.feed:
                with self.bridge._lock:
                    for topic in self.bridge._subs:
                        if topic in self.source.cache:
                            self.bridge._msg_cache[topic] = {
                                'raw_message': self.source.cache[topic]['data'],
                                'received_at': time.time(),
                            }

    def publish(self, topic, msg_type, data):
        self.published.append(data)
        measured = self.source.cache['/joint_states']['data']
        for name, value in zip(data['joint_names'], data['points'][-1]['positions']):
            measured['position'][measured['name'].index(name)] = value
        return True

    def wait(self, predicate):
        deadline = time.monotonic() + 3
        while not predicate():
            if time.monotonic() > deadline:
                self.fail(f'Timed out: {self.bridge._subscription_users}')
            time.sleep(.01)

    def users(self, topic='/joint_states'):
        with self.bridge._lock:
            return set(self.bridge._subscription_users.get(topic, set()))

    def test_two_silent_viewers_close_independently_and_last_close_removes_cache(self):
        url = '/ws/ros2/topics//joint_states'
        with self.client.websocket_connect(url) as first:
            self.assertFalse(receive_data(first)['data']['available'])
            with self.client.websocket_connect(url) as second:
                self.assertFalse(receive_data(second)['data']['available'])
                self.assertEqual(len(self.users()), 2)
                first.close()
                self.wait(lambda: len(self.users()) == 1)
                with self.bridge._lock:
                    self.bridge._msg_cache['/joint_states'] = {
                        'raw_message': {'name': ['joint'], 'position': [1]},
                        'received_at': time.time(),
                    }
                self.assertEqual(receive_data(second)['data']['data']['position'], [1])
            self.wait(lambda: not self.users())
        self.assertNotIn('/joint_states', self.bridge._msg_cache)
        self.bridge._create_sub.assert_called_once()

    def test_unknown_topic_sends_initial_state_before_discovery_then_streams(self):
        topic = '/not_discovered_yet'
        resume = threading.Event()

        def discover():
            if not resume.wait(timeout=3):
                return False
            with self.bridge._lock:
                self.bridge._discovered_topics[topic] = ['sensor_msgs/msg/JointState']
            return True

        with patch.object(self.bridge, 'run_discovery', side_effect=discover):
            try:
                with self.client.websocket_connect(f'/ws/ros2/topics/{topic}') as ws:
                    initial = receive_data(ws)
                    self.assertEqual(initial['type'], 'data')
                    self.assertEqual(initial['data'], {
                        'topic': topic, 'msg_type': '', 'data': None,
                        'available': False, 'domain_id': self.bridge.domain_id,
                    })
                    self.assertFalse(self.users(topic))
                    resume.set()
                    ready = receive_data(ws)['data']
                    self.assertEqual(ready['msg_type'], 'sensor_msgs/msg/JointState')
                    self.assertEqual(len(self.users(topic)), 1)
                    with self.bridge._lock:
                        self.bridge._msg_cache[topic] = {
                            'raw_message': {'name': ['joint'], 'position': [1]},
                            'received_at': time.time(),
                        }
                    self.assertEqual(receive_data(ws)['data']['data']['position'], [1])
            finally:
                resume.set()
        self.wait(lambda: not self.users(topic))

    def test_unknown_topic_disconnect_stops_discovery_without_subscription(self):
        topic = '/never_discovered'
        with patch.object(self.bridge, 'run_discovery', return_value=True) as discover:
            with self.client.websocket_connect(f'/ws/ros2/topics/{topic}') as ws:
                self.assertFalse(receive_data(ws)['data']['available'])
                self.wait(lambda: discover.call_count > 0)
            calls = discover.call_count
            time.sleep(1.1)
            self.assertEqual(discover.call_count, calls)
        self.assertFalse(self.users(topic))
        self.bridge._create_sub.assert_not_called()

    def test_explicit_message_type_skips_discovery(self):
        topic = '/explicit_type'
        with patch.object(self.bridge, 'run_discovery') as discover:
            with self.client.websocket_connect(
                    f'/ws/ros2/topics/{topic}?msg_type=sensor_msgs/msg/JointState') as ws:
                data = receive_data(ws)['data']
                self.assertEqual(data['msg_type'], 'sensor_msgs/msg/JointState')
                self.assertEqual(len(self.users(topic)), 1)
            discover.assert_not_called()
        self.wait(lambda: not self.users(topic))

    def test_subscription_ready_is_sent_without_topic_messages(self):
        with self.client.websocket_connect('/ws/ros2/topics//joint_states') as ws:
            self.assertEqual(ws.receive_json(), {'type': 'ready'})
            self.assertFalse(ws.receive_json()['data']['available'])

    def test_type_conflict_is_terminal_and_preserves_existing_owner(self):
        with SubscriptionOwner(self.bridge) as owner:
            owner.subscribe('/joint_states', 'sensor_msgs/msg/JointState')
            with self.client.websocket_connect(
                    '/ws/ros2/topics//joint_states?msg_type=std_msgs/msg/String') as ws:
                error = ws.receive_json()
                self.assertEqual(error['code'], 'type_conflict')
                self.assertFalse(error['retryable'])
                self.assertEqual(ws.receive()['code'], 1008)
            self.assertEqual(self.users(), {owner.owner_id})

    def test_unavailable_bridge_is_retryable(self):
        self.fake_state.get_ros2_bridge_or_none = lambda: None
        with self.client.websocket_connect('/ws/ros2/topics//joint_states') as ws:
            error = ws.receive_json()
            self.assertEqual(error['code'], 'bridge_unavailable')
            self.assertTrue(error['retryable'])
            self.assertEqual(ws.receive()['code'], 1013)

    def test_invalid_topic_is_terminal_without_registration(self):
        with self.client.websocket_connect('/ws/ros2/topics//bad//topic') as ws:
            error = ws.receive_json()
            self.assertEqual(error['code'], 'invalid_topic')
            self.assertFalse(error['retryable'])
            self.assertEqual(ws.receive()['code'], 1008)
        self.assertFalse(self.bridge._subs)

    def test_failed_subscription_is_retryable_and_does_not_send_ready(self):
        self.bridge._create_sub.side_effect = lambda *args: None
        with self.client.websocket_connect('/ws/ros2/topics//joint_states') as ws:
            error = ws.receive_json()
            self.assertEqual(error['code'], 'subscription_unavailable')
            self.assertTrue(error['retryable'])
            self.assertEqual(ws.receive()['code'], 1013)

    def test_static_topic_disconnect_is_detected_without_new_messages(self):
        self.feed = True
        with self.client.websocket_connect('/ws/ros2/topics//robot_description') as ws:
            while not receive_data(ws)['data']['available']:
                pass
            self.assertEqual(len(self.users('/robot_description')), 1)
        self.wait(lambda: not self.users('/robot_description'))
        self.assertNotIn('/robot_description', self.bridge._msg_cache)

    def test_metadata_monitor_keeps_large_payloads_off_websocket(self):
        self.feed = True
        with self.client.websocket_connect(
                '/ws/ros2/topics//joint_states?metadata_only=true') as ws:
            while True:
                data = receive_data(ws)['data']
                self.assertIsNone(data['data'])
                if data['available']:
                    break
        self.wait(lambda: not self.users())

    def test_old_connection_close_does_not_remove_reconnected_owner(self):
        url = '/ws/ros2/topics//joint_states'
        with self.client.websocket_connect(url) as old:
            receive_data(old)
            old_owners = self.users()
            with self.client.websocket_connect(url) as new:
                receive_data(new)
                new_owners = self.users() - old_owners
                self.assertEqual(len(new_owners), 1)
                old.close()
                self.wait(lambda: self.users() == new_owners)
        self.wait(lambda: not self.users())

    def test_partial_registration_failure_releases_already_registered_topics(self):
        original = self.bridge._create_sub
        self.bridge._create_sub = lambda topic, *args: (
            None if topic == '/robot_description' else original(topic, *args))
        with self.assertRaises(ValueError):
            with SubscriptionOwner(self.bridge) as owner:
                owner.subscribe('/joint_states', 'sensor_msgs/msg/JointState')
                owner.subscribe('/robot_description', 'std_msgs/msg/String')
        self.assertFalse(self.users())
        self.assertFalse(self.bridge._subs)

    def test_closing_owner_during_pending_registration_cannot_leak_a_subscription(self):
        owner = SubscriptionOwner(self.bridge)
        entered, resume = threading.Event(), threading.Event()
        original = self.bridge._create_sub

        def delayed(*args):
            entered.set()
            resume.wait(timeout=2)
            return original(*args)

        self.bridge._create_sub = delayed
        acquire = threading.Thread(target=owner.subscribe,
                                   args=('/joint_states', 'sensor_msgs/msg/JointState'))
        acquire.start()
        self.assertTrue(entered.wait(timeout=2))
        release = threading.Thread(target=owner.close)
        release.start()
        resume.set()
        acquire.join(timeout=2)
        release.join(timeout=2)
        self.assertFalse(acquire.is_alive())
        self.assertFalse(release.is_alive())
        self.assertFalse(self.users())
        with self.assertRaisesRegex(ValueError, 'closed'):
            owner.subscribe('/joint_states', 'sensor_msgs/msg/JointState')

    def test_read_only_http_does_not_leave_subscriptions(self):
        self.assertEqual(self.client.get('/ros2/topics//joint_states').status_code, 200)
        self.assertFalse(self.users())
        for action in ('subscribe', 'unsubscribe'):
            self.assertEqual(self.client.post(f'/ros2/topics//joint_states/{action}').status_code,
                             405)
        self.assertFalse(self.bridge._subs)

    def test_catalog_viewer_closes_while_background_playback_keeps_feedback(self):
        self.feed = True
        recording_id, _ = self.store.create()
        self.store.messages[recording_id] = [
            (TOPIC, trajectory(.2), 1000000000), (TOPIC, trajectory(.3), 3000000000)]
        self.store.save(recording_id, {
            'id': recording_id, 'robot': 'f2', 'duration': 2,
            'groups': ['head'], 'topics': [TOPIC], 'messages': 2})
        with self.client.websocket_connect('/record-play/watch/f2'):
            self.wait(lambda: TOPIC in self.bridge._subs)
            with self.client.websocket_connect('/ws/ros2/topics//joint_states') as viewer:
                receive_data(viewer)
                self.manager.set_bringup(True)
                self.manager.motion(recording_id, 'f2', 'browser')
                self.wait(lambda: bool(self.published))
                self.assertEqual(len(self.users()), 3)
            self.wait(lambda: len(self.users()) == 2)
        self.wait(lambda: len(self.users()) == 1)
        self.assertTrue(self.manager.status()['active'])
        self.assertIsNone(self.manager.status()['error'])
        self.manager.stop()
        self.assertEqual(self.manager.status()['phase'], 'idle')
        self.assertIsNone(self.manager.status()['error'])
        self.wait(lambda: not self.users())
        self.assertFalse(self.bridge._subs)

    def test_jog_and_viewer_release_only_their_own_feedback(self):
        self.feed = True
        with self.client.websocket_connect('/ws/jog/f2') as jog:
            jog.send_json({'kind': 'idle'})
            receive_data(jog)
            with self.client.websocket_connect('/ws/ros2/topics//joint_states') as viewer:
                receive_data(viewer)
                self.assertEqual(len(self.users()), 2)
                jog.close()
                self.wait(lambda: len(self.users()) == 1)
        self.wait(lambda: not self.bridge._subs)
        self.assertEqual(self.published, [])

    def test_active_jog_disconnect_finishes_hold_before_releasing_feedback(self):
        self.feed = True
        publish = self.publish
        holds = []

        def checked_publish(*args):
            self.assertTrue(self.users())
            self.assertTrue(self.users('/robot_description'))
            holds.append(args)
            return publish(*args)

        self.bridge.publish_jog = checked_publish
        with self.client.websocket_connect('/ws/jog/f2') as jog:
            self.wait(lambda: self.bridge.get_topic_data('/joint_states') is not None)
            jog.send_json({'kind': 'joint', 'joint': 'head_joint1', 'mode': 'hold'})
            self.assertIsNone(receive_data(jog)['error'])
        self.wait(lambda: not self.bridge._subs)
        self.assertEqual(len(holds), 2)
        self.assertFalse(motion_lock.locked())

    def test_recording_keeps_input_subscription_after_catalog_closes(self):
        self.feed = True
        with self.client.websocket_connect('/record-play/watch/f2'):
            self.wait(lambda: TOPIC in self.bridge._subs)
            self.manager.record('recording', 'f2', ['head'], 'browser')
            self.wait(lambda: TOPIC in self.bridge._message_listeners)
            self.assertEqual(len(self.users(TOPIC)), 2)
        self.wait(lambda: len(self.users(TOPIC)) == 1)
        for listener in tuple(self.bridge._message_listeners[TOPIC]):
            listener(TOPIC, trajectory(.2), time.time_ns())
        self.manager.stop()
        self.assertEqual(self.manager.status()['phase'], 'idle')
        self.assertEqual(self.store.list()[0]['messages'], 1)
        self.wait(lambda: not self.bridge._subs)
        self.assertFalse(self.bridge._message_listeners)

    def test_catalog_only_observer_releases_every_subscription_when_closed(self):
        self.feed = True
        with self.client.websocket_connect('/record-play/watch/f2'):
            self.wait(lambda: TOPIC in self.bridge._subs)
        self.wait(lambda: not self.bridge._subs)
        self.assertFalse(self.bridge._msg_cache)


if __name__ == '__main__':
    unittest.main()
