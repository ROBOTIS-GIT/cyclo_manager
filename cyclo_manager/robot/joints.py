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

"""Commanded joint definitions and controller topics from the active URDF."""

from dataclasses import dataclass
import math
import re
import xml.etree.ElementTree as ET


@dataclass(frozen=True)
class RobotJoint:
    """A supported joint with limits from the active robot description."""

    name: str
    group: str
    topic: str
    unit: str
    lower: float
    upper: float


def joint_group(name: str) -> tuple[str, str] | None:
    """Resolve the existing follower controller input for a known joint."""
    if re.fullmatch(r'head_joint[12]', name):
        return 'head', '/leader/joystick_controller_left/joint_trajectory'
    if name == 'lift_joint':
        return 'lift', '/leader/joystick_controller_right/joint_trajectory'
    for side, label in [('l', 'left'), ('r', 'right')]:
        if re.fullmatch(rf'(arm_{side}_joint[1-7]|gripper_{side}_joint1)', name):
            topic = f'/leader/joint_trajectory_command_broadcaster_{label}/joint_trajectory'
            return f'arm_{side}', topic
        if re.fullmatch(rf'finger_{side}_joint\d+', name):
            topic = f'/leader/joint_trajectory_command_broadcaster_{label}_hand/joint_trajectory'
            return f'hand_{side}', topic
    return None


def parse_joints(description: str) -> list[RobotJoint]:
    """Extract bounded, non-mimic position joints from expanded URDF."""
    root = ET.fromstring(description)
    commanded = {
        j.attrib.get('name') for j in root.findall('./ros2_control/joint')
        if j.find("command_interface[@name='position']") is not None
    }
    result = []
    for joint in root.findall('./joint'):
        name = joint.attrib.get('name', '')
        group = joint_group(name)
        limit = joint.find('limit')
        if (not group or name not in commanded or limit is None
                or joint.find('mimic') is not None
                or joint.attrib.get('type') not in ('revolute', 'prismatic')):
            continue
        try:
            lower, upper, velocity = (float(limit.attrib[k])
                                      for k in ('lower', 'upper', 'velocity'))
        except (KeyError, ValueError):
            continue
        if (not all(math.isfinite(v) for v in (lower, upper, velocity))
                or lower >= upper or velocity <= 0):
            continue
        linear = joint.attrib['type'] == 'prismatic'
        result.append(RobotJoint(name, *group, 'm' if linear else 'rad', lower, upper))
    return result

