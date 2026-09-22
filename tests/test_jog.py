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

"""Run with python -m unittest discover -s tests. No ROS or hardware required."""

import math
import time
import unittest
from unittest.mock import patch

from cyclo_manager.jog import JogInput, JogSession
from pydantic import ValidationError

URDF = '''<robot name="fixture">
  <joint name="head_joint1" type="revolute"><limit lower="-0.3" upper="0.7" velocity="2"/></joint>
  <joint name="head_joint2" type="revolute"><limit lower="-0.4" upper="0.4" velocity="2"/></joint>
  <joint name="lift_joint" type="prismatic"><limit lower="-0.5" upper="0" velocity="0.5"/></joint>
  <joint name="left_wheel_steer" type="revolute"><limit lower="-6" upper="6" velocity="2"/></joint>
  <joint name="arm_l_joint1" type="revolute"><limit lower="-2" upper="2" velocity="1"/></joint>
  <joint name="arm_l_joint2" type="revolute">
    <limit lower="-2" upper="2" velocity="1"/><mimic joint="arm_l_joint1"/>
  </joint>
  <joint name="arm_r_joint1" type="revolute"><limit lower="nan" upper="2" velocity="1"/></joint>
  <ros2_control name="fixture" type="system">
    <joint name="head_joint1"><command_interface name="position"/></joint>
    <joint name="head_joint2"><command_interface name="position"/></joint>
    <joint name="lift_joint"><command_interface name="position"/></joint>
    <joint name="arm_l_joint1"><command_interface name="position"/></joint>
    <joint name="arm_l_joint2"><command_interface name="position"/></joint>
    <joint name="arm_r_joint1"><command_interface name="position"/></joint>
  </ros2_control>
</robot>'''


class FakeBridge:
    def __init__(self):
        self.subscription_users = {}
        self.published = []
        self.fail = False
        self.cache = {'/robot_description': {'data': {'data': URDF}, 'received_at': time.time()}}
        self.feedback()

    def acquire_subscription(self, topic, msg_type, owner_id, qos=None):
        self.subscription_users.setdefault(topic, set()).add(owner_id)
        return True

    def release_subscriptions(self, owner_id):
        for topic in list(self.subscription_users):
            self.subscription_users[topic].discard(owner_id)
            if not self.subscription_users[topic]:
                del self.subscription_users[topic]
        return True

    def feedback(self, position=0.2, age=0):
        self.cache['/joint_states'] = {'data': {
            'name': ['head_joint1', 'head_joint2', 'lift_joint', 'arm_l_joint1'],
            'position': [position, 0.1, -0.2, 0.1],
        }, 'received_at': time.time() - age}

    def motion_graph(self):
        from cyclo_manager.robot.joints import parse_joints
        from cyclo_manager.robot.catalog import TRAJECTORY_TYPE, STATE_TYPE
        from cyclo_manager.robot.profiles import GROUPS
        import xml.etree.ElementTree as ET
        xml = self.cache.get('/robot_description', {}).get('data', {}).get('data', '')
        try:
            joints = parse_joints(xml) if xml else []
        except ET.ParseError:
            joints = []
        groups = {}
        for joint in joints:
            n = joint.name
            group = ('head' if n.startswith('head') else 'lift' if n == 'lift_joint'
                     else 'arm_l' if n.startswith(('arm_l_', 'gripper_l_'))
                     else 'arm_r' if n.startswith(('arm_r_', 'gripper_r_')) else 'arm')
            groups.setdefault(group, []).append(n)
        result = {}
        for topic, (alias, _) in GROUPS.items():
            if alias not in groups:
                continue
            node = '/test_' + alias
            result[topic] = {'type': TRAJECTORY_TYPE, 'subscribers': [node], 'publishers': ['/leader']}
            state = node + '/controller_state'
            result[state] = {'type': STATE_TYPE, 'publishers': [node], 'subscribers': []}
            self.cache[state] = {'data': {'joint_names': groups[alias]}, 'received_at': time.time()}
        if getattr(self, 'base_available', True):
            result['/cmd_vel'] = {'type': 'geometry_msgs/msg/Twist', 'publishers': [], 'subscribers': ['/base']}
        return result

    def prepare_jog_publishers(self, topics):
        return True

    def get_topic_data(self, topic):
        return self.cache.get(topic)

    def publish_jog(self, topic, msg_type, data):
        self.published.append((topic, msg_type, data))
        return not self.fail


class JogTests(unittest.TestCase):
    def setUp(self):
        self.bridge = FakeBridge()
        self.session = JogSession(self.bridge, 'sg2')
        self.session.last_tick = time.monotonic() - 0.1

    def joint(self, **kwargs):
        self.session.apply(JogInput(kind='joint', joint='head_joint1', **kwargs))

    def target(self):
        return self.bridge.published[-1][2]['points'][-1]['positions'][0]

    def test_base_capability_comes_from_graph_not_model_name(self):
        self.session = JogSession(self.bridge, 'arbitrary-model')
        self.assertTrue(self.session.snapshot()['base_supported'])
        self.bridge.base_available = False
        self.assertFalse(self.session.snapshot()['base_supported'])
        with self.assertRaisesRegex(ValueError, 'swerve'):
            self.session.apply(JogInput(kind='base', x=.1))

    def test_target_tracks_feedback_not_previous_command(self):
        self.joint()
        self.assertAlmostEqual(self.target(), 0.2 + math.radians(1))
        self.session.stop()
        self.bridge.feedback(0.1)
        self.joint()
        self.assertAlmostEqual(self.target(), 0.1 + math.radians(1))
        self.assertNotIn('velocities', self.bridge.published[-1][2]['points'][0])

    def test_hold_replaces_unfinished_lift_step_from_measured_position(self):
        command = JogInput(kind='joint', joint='lift_joint', mode='step')
        with patch('cyclo_manager.jog.time.monotonic', return_value=100):
            self.session.apply(command)
        self.assertAlmostEqual(self.target(), -0.19)
        command = command.model_copy(update={'mode': 'hold'})
        for tick, position in enumerate([-0.198, -0.197, -0.196], start=1):
            self.bridge.cache['/joint_states']['data']['position'][2] = position
            self.bridge.cache['/joint_states']['received_at'] = time.time() + tick / 1000
            with patch('cyclo_manager.jog.time.monotonic', return_value=100.25 + tick * 0.1):
                self.session.apply(command)
            self.assertEqual(len(self.bridge.published), tick + 1)
            self.assertAlmostEqual(self.target(), position + 0.01)

    def test_hold_keeps_refreshing_without_accumulating_stalled_targets(self):
        self.joint(mode='hold')
        original = self.target()
        for tick in range(1, 4):
            self.bridge.feedback(0.2)  # Fresh sample, but the robot has not moved.
            with patch('cyclo_manager.jog.time.monotonic',
                       return_value=time.monotonic() + 0.1):
                self.joint(mode='hold')
            self.assertEqual(len(self.bridge.published), tick + 1)
            self.assertAlmostEqual(self.target(), original)

    def test_hold_reverses_direction_before_previous_goal_is_reached(self):
        self.joint(mode='hold', direction=1)
        self.bridge.feedback(0.203)
        with patch('cyclo_manager.jog.time.monotonic',
                   return_value=time.monotonic() + 0.1):
            self.joint(mode='hold', direction=-1)
        self.assertEqual(len(self.bridge.published), 2)
        self.assertAlmostEqual(self.target(), 0.203 - math.radians(1))

    def test_position_only_goal_has_no_manager_duration_even_with_low_urdf_speed(self):
        self.bridge.cache['/robot_description']['data']['data'] = URDF.replace(
            'velocity="2"', 'velocity="0.03"')
        self.joint(mode='hold', resolution='coarse')
        self.assertAlmostEqual(self.target(), 0.2 + math.radians(3))
        points = self.bridge.published[-1][2]['points']
        self.assertEqual(points, [{
            'positions': [self.target(), .1],
            'time_from_start': {'sec': 0, 'nanosec': 0},
        }])

    def test_releasing_hold_interrupts_pending_step(self):
        self.session.apply(JogInput(kind='joint', joint='lift_joint', mode='hold'))
        self.bridge.cache['/joint_states']['data']['position'][2] = -0.198
        self.session.stop()
        self.assertAlmostEqual(self.target(), -0.198)
        self.assertIsNone(self.session.active_increment)
        count = len(self.bridge.published)
        self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), count)

    def test_no_repeated_motion_from_same_sample(self):
        self.joint()
        self.joint()
        self.assertEqual(len(self.bridge.published), 1)

    def test_joint_limit_clamp(self):
        self.bridge.feedback(0.69999)
        self.joint()
        self.assertEqual(self.target(), 0.7)

    def test_stale_missing_and_out_of_range_feedback_reject_motion(self):
        for position, age in [(0.2, 1), (float('nan'), 0), (1, 0)]:
            with self.subTest(position=position, age=age):
                self.bridge.feedback(position, age)
                with self.assertRaises(ValueError):
                    self.joint()
        self.assertEqual(self.bridge.published, [])

    def test_no_urdf_no_joint_command(self):
        del self.bridge.cache['/robot_description']
        with self.assertRaises(ValueError):
            self.joint()
        self.assertEqual(self.bridge.published, [])

    def test_release_holds_fresh_position(self):
        self.joint()
        self.bridge.feedback(0.203)
        self.session.stop()
        self.assertAlmostEqual(self.target(), 0.203, places=6)
        self.assertIsNone(self.session.active_joint)

    def test_stale_stop_does_not_send_old_position(self):
        self.joint()
        self.bridge.feedback(0.1, age=2)
        self.session.stop()
        self.assertEqual(len(self.bridge.published), 1)
        points = self.bridge.published[0][2]['points']
        self.assertNotIn('velocities', points[0])
        self.assertAlmostEqual(points[-1]['positions'][0], 0.2 + math.radians(1))

    def test_step_is_not_cancelled_by_idle_heartbeat(self):
        self.joint(mode='step')
        before = len(self.bridge.published)
        target = self.target()
        self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), before)
        with patch('cyclo_manager.jog.time.monotonic', return_value=time.monotonic() + 10):
            self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), before)
        self.assertEqual(self.target(), target)
        self.assertEqual(self.session.active_joint, 'head_joint1')

    def test_completed_step_clears_tracking_without_publishing_hold(self):
        self.joint(mode='step')
        target = self.target()
        self.bridge.feedback(target)
        with patch('cyclo_manager.jog.time.monotonic', return_value=time.monotonic() + 10):
            self.session.apply(JogInput())
            self.session.apply(JogInput())
        self.assertIsNone(self.session.active_joint)
        self.assertEqual(len(self.bridge.published), 1)
        self.assertEqual(self.target(), target)

    def test_lagging_lift_keeps_original_target_until_measured_completion(self):
        self.session.apply(JogInput(kind='joint', joint='lift_joint', mode='step'))
        deadline = time.monotonic() + 10
        # Only 8 of the requested 10 mm have been travelled despite elapsed time.
        self.bridge.cache['/joint_states']['data']['position'][2] = -0.192
        with patch('cyclo_manager.jog.time.monotonic', return_value=deadline + 0.1):
            self.session.apply(JogInput())
            self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), 1)
        self.assertAlmostEqual(self.target(), -0.19)
        self.assertEqual(self.session.active_joint, 'lift_joint')
        # Completion updates only local bookkeeping, not the ROS trajectory.
        self.bridge.cache['/joint_states']['data']['position'][2] = -0.19
        with patch('cyclo_manager.jog.time.monotonic', return_value=deadline + 0.2):
            self.session.apply(JogInput())
        self.assertIsNone(self.session.active_joint)
        self.assertEqual(len(self.bridge.published), 1)

    def test_explicit_stop_interrupts_lagging_step(self):
        self.joint(mode='step')
        self.bridge.feedback(0.205)
        with patch('cyclo_manager.jog.time.monotonic', return_value=time.monotonic() + 10):
            self.session.apply(JogInput())
            self.session.apply(JogInput(kind='stop'))
        self.assertEqual(len(self.bridge.published), 2)
        self.assertEqual(self.target(), 0.205)
        self.assertIsNone(self.session.active_joint)

    def test_stale_feedback_cannot_mark_step_complete(self):
        self.joint(mode='step')
        self.bridge.feedback(self.target(), age=2)
        with patch('cyclo_manager.jog.time.monotonic', return_value=time.monotonic() + 10):
            self.session.apply(JogInput())
        self.assertEqual(self.session.active_joint, 'head_joint1')
        self.assertEqual(len(self.bridge.published), 1)

    def test_lift_normal_step_preserves_ten_mm_with_immediate_target(self):
        self.session.apply(JogInput(kind='joint', joint='lift_joint', mode='step'))
        self.assertAlmostEqual(self.target(), -0.19)
        point = self.bridge.published[-1][2]['points'][-1]
        self.assertEqual(point['time_from_start'], {'sec': 0, 'nanosec': 0})
        count = len(self.bridge.published)
        with patch('cyclo_manager.jog.time.monotonic', return_value=time.monotonic() + 0.1):
            self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), count)
        self.assertEqual(self.bridge.published[-1][0],
                         '/leader/joystick_controller_right/joint_trajectory')

    def test_selected_increments_and_immediate_point_for_taps_and_holds(self):
        for name, current in [('head_joint1', 0.2), ('lift_joint', -0.2)]:
            for resolution, mm, degrees in [('fine', 1, 0.1), ('normal', 10, 1),
                                            ('coarse', 15, 3), ('large', 20, 5)]:
                for mode in ('step', 'hold'):
                    for direction in (-1, 1):
                        with self.subTest(joint=name, resolution=resolution,
                                          mode=mode, direction=direction):
                            self.session = JogSession(self.bridge, 'sg2')
                            self.session.apply(JogInput(
                                kind='joint', joint=name, resolution=resolution,
                                mode=mode, direction=direction))
                            expected_delta = (mm / 1000 if name == 'lift_joint'
                                              else math.radians(degrees))
                            self.assertAlmostEqual(
                                self.target(), current + direction * expected_delta)
                            message = self.bridge.published[-1][2]
                            self.assertEqual(message['points'], [{
                                'positions': message['points'][0]['positions'],
                                'time_from_start': {'sec': 0, 'nanosec': 0},
                            }])

    def test_hold_targets_remain_bounded_through_repeated_feedback_updates(self):
        for name, initial in [('head_joint1', 0.2), ('lift_joint', -0.2)]:
            for resolution, mm, degrees in [('fine', 1, 0.1), ('normal', 10, 1),
                                            ('coarse', 15, 3), ('large', 20, 5)]:
                for direction in (-1, 1):
                    with self.subTest(joint=name, resolution=resolution, direction=direction):
                        self.setUp()
                        delta = mm / 1000 if name == 'lift_joint' else math.radians(degrees)
                        command = JogInput(kind='joint', joint=name, mode='hold',
                                           resolution=resolution, direction=direction)
                        for tick in range(30):
                            # Include stalled samples, gradual motion and tracking changes.
                            current = initial + direction * delta * (tick % 4) / 4
                            self.bridge.feedback(current if name == 'head_joint1' else 0.2)
                            if name == 'lift_joint':
                                self.bridge.cache['/joint_states']['data']['position'][2] = current
                            self.session.apply(command)
                            self.assertAlmostEqual(self.target(), current + direction * delta)
                            self.assertLessEqual(abs(self.target() - current), delta + 1e-12)
                        self.assertEqual(len(self.bridge.published), 30)

    def test_hold_clamps_both_urdf_boundaries_for_all_resolutions(self):
        for name, lower, upper in [('head_joint1', -0.3, 0.7), ('lift_joint', -0.5, 0)]:
            for resolution in ('fine', 'normal', 'coarse', 'large'):
                for direction, boundary in [(-1, lower), (1, upper)]:
                    with self.subTest(joint=name, resolution=resolution, direction=direction):
                        self.setUp()
                        current = boundary - direction * 0.00001
                        self.bridge.feedback(current if name == 'head_joint1' else 0.2)
                        if name == 'lift_joint':
                            self.bridge.cache['/joint_states']['data']['position'][2] = current
                        self.session.apply(JogInput(kind='joint', joint=name, mode='hold',
                                                    resolution=resolution, direction=direction))
                        self.assertEqual(self.target(), boundary)

    def test_base_strafe_diagonal_limit_and_stop(self):
        for _ in range(20):
            self.session.last_tick = time.monotonic() - 0.1
            self.session.apply(JogInput(kind='base', x=0.3, y=0.3))
        data = self.bridge.published[-1][2]
        self.assertGreater(data['linear']['y'], 0)
        self.assertLessEqual(math.hypot(data['linear']['x'], data['linear']['y']), 0.300001)
        self.session.stop()
        self.assertEqual(self.bridge.published[-1][2]['linear'], dict(x=0.0, y=0.0, z=0.0))

    def test_idle_page_does_not_publish_stop_to_robot(self):
        self.session.apply(JogInput())
        self.session.stop()
        self.assertEqual(self.bridge.published, [])

    def test_invalid_numbers_and_large_commands_rejected(self):
        for command in [dict(x=float('nan')), dict(y=10), dict(resolution='fast'),
                        dict(direction=0), dict(kind='trajectory'), dict(topic='/other')]:
            with self.subTest(command=command), self.assertRaises(ValidationError):
                JogInput(**command)

    def test_failed_publish_is_reported_and_stop_retried(self):
        self.bridge.fail = True
        with self.assertRaises(ValueError):
            self.session.apply(JogInput(kind='base', x=0.1))
        self.bridge.fail = False
        self.session.stop()
        self.assertEqual(self.bridge.published[-1][2]['linear']['x'], 0)


class ArmGripperJogTests(unittest.TestCase):
    def setUp(self):
        self.bridge = FakeBridge()
        names = [f'arm_{side}_joint{i}' for side in ('l', 'r') for i in range(1, 8)]
        names += ['gripper_l_joint1', 'gripper_r_joint1']
        self.names = names
        joints = ''.join(
            f'<joint name="{name}" type="revolute">'
            '<limit lower="-2" upper="2" velocity="1"/></joint>' for name in names)
        interfaces = ''.join(f'<joint name="{name}"><command_interface name="position"/>'
                             '</joint>' for name in names)
        self.bridge.cache['/robot_description']['data']['data'] = (
            f'<robot name="arms">{joints}<ros2_control>{interfaces}</ros2_control></robot>')
        self.values = dict.fromkeys(names, 0.1)
        self.values.update(gripper_l_joint1=0.4, gripper_r_joint1=0.7)
        self.feedback()
        self.session = JogSession(self.bridge, 'sg2')

    def feedback(self, **changes):
        self.values.update(changes)
        self.bridge.cache['/joint_states'] = {'data': {
            'name': self.names, 'position': [self.values[n] for n in self.names],
        }, 'received_at': time.time()}

    def goals(self):
        message = self.bridge.published[-1][2]
        point = message['points'][-1]
        self.assertEqual(len(message['points']), 1)
        self.assertEqual(len(point['positions']), len(message['joint_names']))
        self.assertNotIn('velocities', point)
        self.assertNotIn('accelerations', point)
        return dict(zip(message['joint_names'], point['positions']))

    def test_step_hold_and_release_keep_one_explicit_gripper_goal(self):
        for side, gripper_position in [('l', 0.4), ('r', 0.7)]:
            with self.subTest(side=side):
                self.setUp()
                arm, gripper = f'arm_{side}_joint3', f'gripper_{side}_joint1'
                self.session.apply(JogInput(kind='joint', joint=arm, mode='step'))
                self.assertIn(arm, self.goals())
                self.assertIn(gripper, self.goals())
                self.assertEqual(self.goals()[gripper], gripper_position)
                for tick in range(1, 11):
                    self.feedback(**{arm: 0.1 + tick * 0.001,
                                     gripper: gripper_position + (-1) ** tick * 0.02})
                    self.session.apply(JogInput(kind='joint', joint=arm, mode='hold'))
                    self.assertEqual(self.goals()[gripper], gripper_position)
                    self.assertGreater(self.goals()[arm], self.values[arm])
                    message = self.bridge.published[-1][2]
                    index = message['joint_names'].index(gripper)
                    self.assertEqual(message['points'][0]['time_from_start'],
                                     {'sec': 0, 'nanosec': 0})
                    # Repeated feedback jitter must not change the latched target.
                    for point in message['points']:
                        self.assertEqual(point['positions'][index], gripper_position)
                self.session.stop()
                self.assertEqual(self.goals()[gripper], gripper_position)
                self.assertAlmostEqual(self.goals()[arm], self.values[arm], places=6)
                self.assertEqual(self.session.held_positions, {})

    def test_step_completion_before_hold_does_not_recapture_gripper(self):
        arm = 'arm_l_joint1'
        self.session.apply(JogInput(kind='joint', joint=arm, mode='step'))
        self.feedback(arm_l_joint1=self.goals()[arm], gripper_l_joint1=0.42)
        with patch('cyclo_manager.jog.time.monotonic',
                   return_value=time.monotonic() + 0.01):
            self.session.apply(JogInput())
        self.assertIsNone(self.session.active_joint)
        self.feedback(gripper_l_joint1=0.38)
        self.session.apply(JogInput(kind='joint', joint=arm, mode='hold'))
        self.assertEqual(self.goals()['gripper_l_joint1'], 0.4)

    def test_new_press_captures_new_gripper_position(self):
        command = JogInput(kind='joint', joint='arm_l_joint1', mode='step')
        self.session.apply(command)
        self.session.stop()
        self.feedback(gripper_l_joint1=0.6)
        self.session.apply(command)
        self.assertEqual(self.goals()['gripper_l_joint1'], 0.6)

    def test_gripper_can_still_be_jogged_directly(self):
        self.session.apply(JogInput(kind='joint', joint='arm_l_joint1', mode='hold'))
        self.feedback()
        self.session.apply(JogInput(kind='joint', joint='gripper_l_joint1', mode='hold'))
        self.assertIn('gripper_l_joint1', self.goals())
        self.assertGreater(self.goals()['gripper_l_joint1'], 0.4)
        self.assertTrue(self.session.held_positions)

    def test_invalid_gripper_feedback_blocks_initial_arm_command(self):
        for value in (float('nan'), 3):
            with self.subTest(value=value):
                self.feedback(gripper_l_joint1=value)
                with self.assertRaisesRegex(ValueError, 'Joint feedback'):
                    self.session.apply(JogInput(kind='joint', joint='arm_l_joint1'))
        self.assertEqual(self.bridge.published, [])

    def test_failed_arm_publish_stop_retains_same_gripper_goal(self):
        self.bridge.fail = True
        with self.assertRaises(ValueError):
            self.session.apply(JogInput(kind='joint', joint='arm_l_joint1'))
        self.bridge.fail = False
        self.feedback(gripper_l_joint1=0.5)
        self.session.stop()
        self.assertEqual(self.goals()['gripper_l_joint1'], 0.4)
        self.assertAlmostEqual(self.goals()['arm_l_joint1'], 0.1, places=6)


if __name__ == '__main__':
    unittest.main()
