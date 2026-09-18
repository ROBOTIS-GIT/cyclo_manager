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

from cyclo_manager.jog import JogInput, JogSession, parse_joints
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
        self.published = []
        self.fail = False
        self.cache = {'/robot_description': {'data': {'data': URDF}, 'received_at': time.time()}}
        self.feedback()

    def feedback(self, position=0.2, age=0):
        self.cache['/joint_states'] = {'data': {
            'name': ['head_joint1', 'head_joint2', 'lift_joint', 'arm_l_joint1'],
            'position': [position, 0.1, -0.2, 0.1],
        }, 'received_at': time.time() - age}

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
        return self.bridge.published[-1][2]['points'][0]['positions'][0]

    def test_only_commanded_non_mimic_joints_with_finite_limits(self):
        self.assertEqual({j.name for j in parse_joints(URDF)}, {
            'head_joint1', 'head_joint2', 'lift_joint', 'arm_l_joint1'})

    def test_mobile_rejects_joint_jog_even_with_full_robot_feedback(self):
        self.session = JogSession(self.bridge, 'mobile')
        state = self.session.snapshot()
        self.assertTrue(state['base_supported'])
        self.assertTrue(state['joints'])
        self.assertFalse(any(j['available'] for j in state['joints']))
        for mode in ('step', 'hold'):
            with self.assertRaisesRegex(ValueError, 'base jog only'):
                self.joint(mode=mode)
        self.assertEqual(self.bridge.published, [])
        self.session.apply(JogInput(kind='base', x=0.1))
        self.assertEqual(self.bridge.published[-1][0], '/cmd_vel')

    def test_target_tracks_feedback_not_previous_command(self):
        self.joint()
        self.assertAlmostEqual(self.target(), 0.2 + math.radians(1))
        self.session.stop()
        self.bridge.feedback(0.1)
        self.joint()
        self.assertAlmostEqual(self.target(), 0.1 + math.radians(1))
        self.assertEqual(self.bridge.published[-1][2]['points'][0]['velocities'], [0.0])

    def test_hold_waits_for_full_lift_step_and_feedback_before_repeating(self):
        start = 100.0
        command = JogInput(kind='joint', joint='lift_joint', mode='step')
        with patch('cyclo_manager.jog.time.monotonic', return_value=start):
            self.session.apply(command)
        self.assertAlmostEqual(self.target(), -0.19)
        # Press becomes a hold at 350 ms, while the 1.5-second lift step is active.
        command = command.model_copy(update={'mode': 'hold'})
        for elapsed, position in [(0.35, -0.198), (0.6, -0.196), (1.0, -0.193),
                                  (1.4, -0.19), (1.6, -0.192)]:
            self.bridge.cache['/joint_states']['data']['position'][2] = position
            self.bridge.cache['/joint_states']['received_at'] = time.time() + elapsed / 1000
            with patch('cyclo_manager.jog.time.monotonic', return_value=start + elapsed):
                self.session.apply(command)
        self.assertEqual(len(self.bridge.published), 1)
        self.bridge.cache['/joint_states']['data']['position'][2] = -0.19
        self.bridge.cache['/joint_states']['received_at'] = time.time() + 0.01
        with patch('cyclo_manager.jog.time.monotonic', return_value=start + 1.7):
            self.session.apply(command)
        self.assertEqual(len(self.bridge.published), 2)
        self.assertAlmostEqual(self.target(), -0.18)

    def test_hold_repeats_selected_rotation_increment_after_completion(self):
        for resolution, delta in [('normal', math.radians(1)), ('fine', math.radians(0.1)),
                                  ('coarse', math.radians(2))]:
            with self.subTest(resolution=resolution):
                self.bridge = FakeBridge()
                self.session = JogSession(self.bridge, 'sg2')
                command = JogInput(kind='joint', joint='head_joint1',
                                   mode='hold', resolution=resolution)
                with patch('cyclo_manager.jog.time.monotonic', return_value=100):
                    self.session.apply(command)
                self.bridge.feedback(0.2 + delta)
                with patch('cyclo_manager.jog.time.monotonic',
                           return_value=self.session.step_until + 0.01):
                    self.session.apply(command)
                self.assertEqual(len(self.bridge.published), 2)
                self.assertAlmostEqual(self.target(), 0.2 + 2 * delta)

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
        self.assertEqual(self.target(), 0.203)
        self.assertIsNone(self.session.active_joint)

    def test_stale_stop_does_not_send_old_position(self):
        self.joint()
        self.bridge.feedback(0.1, age=2)
        self.session.stop()
        self.assertEqual(len(self.bridge.published), 1)
        self.assertEqual(self.bridge.published[0][2]['points']
                         [0]['time_from_start']['nanosec'], 250000000)

    def test_step_is_not_cancelled_by_idle_heartbeat(self):
        self.joint(mode='step')
        before = len(self.bridge.published)
        target = self.target()
        self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), before)
        with patch('cyclo_manager.jog.time.monotonic', return_value=self.session.step_until + 0.1):
            self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), before)
        self.assertEqual(self.target(), target)
        self.assertEqual(self.session.active_joint, 'head_joint1')

    def test_completed_step_clears_tracking_without_publishing_hold(self):
        self.joint(mode='step')
        target = self.target()
        self.bridge.feedback(target)
        with patch('cyclo_manager.jog.time.monotonic', return_value=self.session.step_until + 0.1):
            self.session.apply(JogInput())
            self.session.apply(JogInput())
        self.assertIsNone(self.session.active_joint)
        self.assertEqual(len(self.bridge.published), 1)
        self.assertEqual(self.target(), target)

    def test_lagging_lift_keeps_original_target_after_duration(self):
        self.session.apply(JogInput(kind='joint', joint='lift_joint', mode='step'))
        deadline = self.session.step_until
        # Only 8 of the requested 10 mm have been travelled when time expires.
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

    def test_explicit_stop_interrupts_lagging_step_after_duration(self):
        self.joint(mode='step')
        self.bridge.feedback(0.205)
        with patch('cyclo_manager.jog.time.monotonic', return_value=self.session.step_until + 0.1):
            self.session.apply(JogInput())
            self.session.apply(JogInput(kind='stop'))
        self.assertEqual(len(self.bridge.published), 2)
        self.assertEqual(self.target(), 0.205)
        self.assertIsNone(self.session.active_joint)

    def test_stale_feedback_cannot_mark_step_complete(self):
        self.joint(mode='step')
        self.bridge.feedback(self.target(), age=2)
        with patch('cyclo_manager.jog.time.monotonic', return_value=self.session.step_until + 0.1):
            self.session.apply(JogInput())
        self.assertEqual(self.session.active_joint, 'head_joint1')
        self.assertEqual(len(self.bridge.published), 1)

    def test_lift_normal_step_preserves_ten_mm_and_extends_duration(self):
        self.session.apply(JogInput(kind='joint', joint='lift_joint', mode='step'))
        self.assertAlmostEqual(self.target(), -0.19)
        point = self.bridge.published[-1][2]['points'][0]
        self.assertEqual(point['time_from_start'], {'sec': 1, 'nanosec': 500000000})
        count = len(self.bridge.published)
        with patch('cyclo_manager.jog.time.monotonic', return_value=self.session.step_until - 0.5):
            self.session.apply(JogInput())
        self.assertEqual(len(self.bridge.published), count)
        self.assertEqual(self.bridge.published[-1][0],
                         '/leader/joystick_controller_right/joint_trajectory')

    def test_exact_increments_for_all_resolutions_and_gestures(self):
        for name, current, unit in [('head_joint1', 0.2, math.radians(1)),
                                    ('lift_joint', -0.2, 0.01)]:
            for resolution, factor in [('normal', 1), ('fine', 0.1), ('coarse', 2)]:
                for mode in ('step', 'hold'):
                    for direction in (-1, 1):
                        with self.subTest(joint=name, resolution=resolution,
                                          mode=mode, direction=direction):
                            self.session = JogSession(self.bridge, 'sg2')
                            self.session.apply(JogInput(
                                kind='joint', joint=name, resolution=resolution,
                                mode=mode, direction=direction))
                            self.assertAlmostEqual(
                                self.target(), current + direction * unit * factor)

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


if __name__ == '__main__':
    unittest.main()
