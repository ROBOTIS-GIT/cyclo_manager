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

"""Check shared robot feedback boundaries without ROS or motion ownership."""

import time
import unittest

from cyclo_manager.robot.interface import RobotInterface
from cyclo_manager.robot.joints import parse_joints
from test_jog import FakeBridge, URDF


class RobotInterfaceTests(unittest.TestCase):
    def setUp(self):
        self.bridge = FakeBridge()
        self.robot = RobotInterface(self.bridge)

    def test_only_commanded_non_mimic_joints_with_finite_limits(self):
        self.assertEqual({j.name for j in parse_joints(URDF)}, {
            'head_joint1', 'head_joint2', 'lift_joint', 'arm_l_joint1'})

    def test_feedback_reads_finite_values_without_owning_subscriptions_or_commands(self):
        self.bridge.cache['/joint_states'] = {'data': {
            'name': ['head_joint1', 'head_joint2', 'lift_joint', 'arm_l_joint1'],
            'position': [0.2, float('nan'), float('inf'), '0.1'],
        }, 'received_at': time.time()}
        positions, age, sample = self.robot.feedback()
        self.assertEqual(positions, {'head_joint1': 0.2})
        self.assertLess(age, 0.5)
        self.assertEqual(sample, self.bridge.cache['/joint_states']['received_at'])
        self.assertEqual(self.bridge.subscription_users, {})
        self.assertEqual(self.bridge.published, [])

    def test_description_change_clears_old_limits_and_recovers(self):
        self.robot.require_feedback()
        description = self.bridge.cache['/robot_description']['data']
        for invalid in ('', '<robot>'):
            with self.subTest(description=invalid):
                description['data'] = invalid
                with self.assertRaisesRegex(ValueError, 'robot description'):
                    self.robot.require_feedback()
                self.assertEqual(self.robot.joints, [])
        description['data'] = URDF.replace('upper="0.7"', 'upper="0.5"')
        self.robot.require_feedback()
        joint = next(j for j in self.robot.joints if j.name == 'head_joint1')
        self.assertEqual(joint.upper, 0.5)

    def test_fresh_feedback_requirement_rejects_stale_or_missing_samples(self):
        self.bridge.feedback(age=2)
        with self.assertRaisesRegex(ValueError, 'Fresh joint feedback'):
            self.robot.require_feedback()
        del self.bridge.cache['/joint_states']
        with self.assertRaisesRegex(ValueError, 'Fresh joint feedback'):
            self.robot.require_feedback()
        self.bridge.feedback(position=0.3)
        self.assertEqual(self.robot.require_feedback()['head_joint1'], 0.3)

    def test_failed_publish_preserves_the_shared_command_error(self):
        self.bridge.fail = True
        with self.assertRaisesRegex(ValueError, 'controller subscriber unavailable'):
            self.robot.publish('/test', 'example/Type', {'value': 1})
        self.assertEqual(self.bridge.published, [('/test', 'example/Type', {'value': 1})])


if __name__ == '__main__':
    unittest.main()
