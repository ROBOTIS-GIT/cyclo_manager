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

"""Generic ROS motion discovery and recording without container/model assumptions."""
import tempfile
import time
import unittest
from unittest.mock import MagicMock

from cyclo_manager.jog import JogInput, JogSession
from cyclo_manager.robot.catalog import catalog, STATE_TYPE, TRAJECTORY_TYPE
from cyclo_manager.robot.interface import RobotInterface
from cyclo_manager.record_play.service import RecordPlayService
from test_jog import FakeBridge
from test_record_play import MemoryStore

COMMAND = '/workcell/custom_input'
STATE = '/workcell/controller_state'
NAMES = ['shoulder', 'tool_claw']


class DiscoveredBridge(FakeBridge):
    def __init__(self):
        super().__init__()
        self.listeners = {}
        self.graph = {
            COMMAND: {'type': TRAJECTORY_TYPE, 'subscribers': ['/workcell/controller'], 'publishers': []},
            STATE: {'type': STATE_TYPE, 'publishers': ['/workcell/controller'], 'subscribers': []},
        }
        xml = '<robot>' + ''.join(
            f'<joint name="{n}" type="revolute"><limit lower="-2" upper="2" velocity="1"/></joint>'
            for n in NAMES)
        xml += '<ros2_control>' + ''.join(
            f'<joint name="{n}"><command_interface name="position"/></joint>' for n in NAMES)
        xml += '</ros2_control></robot>'
        self.cache['/robot_description']['data']['data'] = xml
        self.cache[STATE] = {'data': {'joint_names': NAMES}, 'received_at': time.time()}
        self.cache['/joint_states'] = {'data': {'name': NAMES, 'position': [.2, .4]}, 'received_at': time.time()}

    def motion_graph(self):
        return self.graph

    def add_message_listener(self, topic, listener):
        self.listeners[topic] = listener

    def remove_message_listener(self, topic, listener):
        self.listeners.pop(topic, None)


class MotionDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.bridge = DiscoveredBridge()

    def test_remapped_topic_resolves_by_endpoint_not_topic_name(self):
        robot = RobotInterface(self.bridge)
        robot.require_feedback()
        self.assertEqual({j.name for j in robot.joints}, set(NAMES))
        self.assertEqual({j.topic for j in robot.joints}, {COMMAND})
        self.assertFalse(catalog(self.bridge)[0]['recommended'])

    def test_ambiguous_command_route_requires_explicit_topic(self):
        self.bridge.graph['/other_input'] = self.bridge.graph[COMMAND]
        robot = RobotInterface(self.bridge)
        robot.feedback()
        self.assertTrue(all(not j.topic for j in robot.joints))
        chosen = RobotInterface(self.bridge, command_topic=COMMAND)
        chosen.require_feedback()
        self.assertTrue(all(j.topic == COMMAND for j in chosen.joints))

    def test_playback_uses_recorded_topic_when_an_alternative_route_exists(self):
        self.bridge.graph['/other_input'] = self.bridge.graph[COMMAND]
        self.bridge.jog_publishers_ready = lambda topics: True
        with tempfile.TemporaryDirectory() as root:
            store = MemoryStore(root)
            recording_id, _ = store.create()
            store.messages[recording_id] = [(COMMAND, {
                'joint_names': NAMES, 'points': [{'positions': [.2, .4]}]}, 1)]
            store.save(recording_id, {'id': recording_id, 'name': 'selected route',
                       'robot': 'ros', 'duration': 0, 'topics': [COMMAND], 'groups': [COMMAND]})
            manager = RecordPlayService(self.bridge, root, store)
            try:
                manager.motion(recording_id, 'ros', 'test')
                manager._thread.join(timeout=3)
                self.assertFalse(manager.status()['active'])
                self.assertEqual(manager.status()['phase'], 'completed', manager.status())
                self.assertEqual([t for t, _, _ in self.bridge.published], [COMMAND])
                self.assertFalse(self.bridge.subscription_users)
            finally:
                manager.close()

    def test_selected_topics_can_cover_multiple_controllers(self):
        bridge = FakeBridge()
        topics = {'/leader/joystick_controller_left/joint_trajectory',
                  '/leader/joystick_controller_right/joint_trajectory'}
        robot = RobotInterface(bridge, command_topics=topics)
        robot.require_feedback()
        self.assertEqual({j.topic for j in robot.joints if j.topic}, topics)
        self.assertTrue(all(not j.topic for j in robot.joints if j.name.startswith('arm_')))

    def test_selected_topics_do_not_resolve_conflicting_or_missing_routes(self):
        self.bridge.graph['/other_input'] = self.bridge.graph[COMMAND]
        for topics in ([COMMAND, '/other_input'], [COMMAND, '/missing'], []):
            with self.subTest(topics=topics):
                robot = RobotInterface(self.bridge, command_topics=topics)
                with self.assertRaises(ValueError):
                    robot.require_feedback()
        self.assertEqual(self.bridge.published, [])

    def test_completed_step_can_switch_controller_without_explicit_stop(self):
        bridge = FakeBridge()
        jog = JogSession(bridge)
        jog.apply(JogInput(kind='joint', joint='head_joint1', mode='step'))
        bridge.feedback(position=jog.targets['head_joint1'])
        jog.apply(JogInput(kind='idle'))
        self.assertIsNone(jog.active_joint)
        before = len(bridge.published)
        jog.apply(JogInput(kind='joint', joint='lift_joint', mode='step'))
        self.assertEqual(len(bridge.published), before + 1)
        self.assertEqual(bridge.published[-1][0],
                         '/leader/joystick_controller_right/joint_trajectory')
        self.assertEqual(bridge.published[-1][2]['joint_names'], ['lift_joint'])
        self.assertEqual(jog.active_joint, 'lift_joint')
        self.assertEqual(jog.held_positions, {})

    def test_unknown_controller_or_stale_state_does_not_guess(self):
        self.bridge.graph[COMMAND]['subscribers'] = ['/different_node']
        robot = RobotInterface(self.bridge)
        with self.assertRaises(ValueError):
            robot.require_feedback()
        self.bridge.graph[COMMAND]['subscribers'] = ['/workcell/controller']
        self.bridge.cache[STATE]['received_at'] -= 3
        with self.assertRaises(ValueError):
            robot.require_feedback()

    def test_controller_with_joint_missing_from_urdf_is_not_partially_enabled(self):
        self.bridge.cache[STATE]['data']['joint_names'] = NAMES + ['missing']
        robot = RobotInterface(self.bridge)
        robot.feedback()
        self.assertTrue(all(not j.topic for j in robot.joints))

    def test_generic_gripper_stays_latched_during_hold(self):
        jog = JogSession(self.bridge)
        jog.setup()
        for measured in (.4, .42, .38):
            self.bridge.cache['/joint_states']['received_at'] = time.time()
            self.bridge.cache['/joint_states']['data']['position'][1] = measured
            jog.apply(JogInput(kind='joint', joint='shoulder', mode='hold'))
            _, _, message = self.bridge.published[-1]
            values = dict(zip(message['joint_names'], message['points'][0]['positions']))
            self.assertEqual(values['tool_claw'], .4)
            self.assertEqual(set(values), set(NAMES))
        self.assertFalse(jog.snapshot()['base_supported'])
        jog.subscriptions.close()
        self.assertFalse(self.bridge.subscription_users)

    def test_mapping_change_cannot_redirect_active_jog(self):
        jog = JogSession(self.bridge)
        jog.apply(JogInput(kind='joint', joint='shoulder', mode='hold'))
        self.bridge.graph['/new_input'] = self.bridge.graph.pop(COMMAND)
        self.bridge.cache['/joint_states']['received_at'] = time.time()
        with self.assertRaisesRegex(ValueError, 'mapping changed'):
            jog.apply(JogInput(kind='joint', joint='shoulder', mode='hold'))
        self.assertEqual(len(self.bridge.published), 1)

    def test_record_unknown_topic_without_urdf_or_controller_feedback(self):
        self.bridge.cache.clear()
        self.bridge.graph.pop(STATE)
        with tempfile.TemporaryDirectory() as root:
            store = MemoryStore(root)
            manager = RecordPlayService(self.bridge, root, store)
            try:
                manager.record('custom', 'ros', [COMMAND], 'test')
                deadline = time.monotonic() + 2
                while COMMAND not in self.bridge.listeners and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertIn(COMMAND, self.bridge.listeners)
                self.bridge.listeners[COMMAND](COMMAND, {'joint_names': NAMES,
                    'points': [{'positions': [.2, .4]}]}, time.time_ns())
                manager.stop()
                self.assertEqual(store.list()[0]['topics'], [COMMAND])
                self.assertFalse(self.bridge.subscription_users)
            finally:
                manager.close()

    def test_graph_uses_external_endpoints_and_keeps_remappings(self):
        from types import SimpleNamespace
        from test_jog_bridge import load_bridge_module
        bridge = load_bridge_module().Ros2Bridge()
        node = MagicMock()
        bridge._rclpy_node = node
        node.get_topic_names_and_types.return_value = [(COMMAND, [TRAJECTORY_TYPE])]
        node.get_publishers_info_by_topic.return_value = [SimpleNamespace(node_name='cyclo_manager', node_namespace='/')]
        node.get_subscriptions_info_by_topic.return_value = [SimpleNamespace(node_name='controller', node_namespace='/workcell')]
        result = bridge._inspect_motion_graph()[COMMAND]
        self.assertEqual(result['publishers'], [])
        self.assertEqual(result['subscribers'], ['/workcell/controller'])
