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

"""Command routes for supported bringups; joint membership always comes from ROS."""

from dataclasses import dataclass

GROUPS = {
    '/leader/joystick_controller_left/joint_trajectory': ('head', 'Neck'),
    '/leader/joystick_controller_right/joint_trajectory': ('lift', 'Lift'),
    '/leader/joint_trajectory_command_broadcaster_left/joint_trajectory': ('arm_l', 'Left arm + gripper'),
    '/leader/joint_trajectory_command_broadcaster_right/joint_trajectory': ('arm_r', 'Right arm + gripper'),
    '/leader/joint_trajectory_command_broadcaster_left_hand/joint_trajectory': ('hand_l', 'Left hand'),
    '/leader/joint_trajectory_command_broadcaster_right_hand/joint_trajectory': ('hand_r', 'Right hand'),
    '/leader/joint_trajectory': ('arm', 'Arm + gripper'),
}


@dataclass(frozen=True)
class RobotProfile:
    """Only stable routing/capabilities, never joint names, counts or limits."""

    model: str
    service: str
    topics: tuple[str, ...]
    base_topic: str | None = None
    hidden_jog_joint_suffixes: tuple[str, ...] = ()


PROFILES = {
    model: RobotProfile(
        model, 'ai_worker_bringup',
        () if model == 'mobile' else tuple(GROUPS)[:6 if model in ('sh5', 'bh5') else 4],
        '/cmd_vel' if model in ('sg2', 'sh5', 'f2', 'mobile') else None,
        hidden_jog_joint_suffixes=('_wheel_steer',))
    for model in ('sg2', 'bg2', 'sh5', 'bh5', 'f1', 'f2', 'mobile')
}
PROFILES.update({
    model: RobotProfile(model, 'open_manipulator_bringup', ('/leader/joint_trajectory',))
    for model in ('omy', 'omx')
})
