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

"""Small, feedback-relative jog commands. The leader must not run concurrently.

This module deliberately has no leader arbitration or robot ownership logic.
Commands contain one immediate position target bounded by measured feedback.
No absolute pose commands are accepted. Runtime URDF limits are required;
actual motion speed is controlled by the robot, not a manager trajectory duration.
"""

from dataclasses import asdict, dataclass
import math
import re
import time
from typing import Literal
import xml.etree.ElementTree as ET

from pydantic import BaseModel, ConfigDict, Field

FEEDBACK_MAX_AGE = 0.5
BASE_MODELS = {'sg2', 'sh5', 'f2', 'mobile'}
BASE_LINEAR_MAX = 0.3  # m/s
BASE_ANGULAR_MAX = 0.6  # rad/s
BASE_LINEAR_ACCELERATION = 0.3  # m/s²
BASE_ANGULAR_ACCELERATION = 0.6  # rad/s²
BASE_TICK_MIN = 0.01  # seconds
BASE_TICK_MAX = 0.1  # seconds
JOINT_INCREMENTS = {  # millimetres, degrees
    'fine': (1, 0.1), 'normal': (10, 1), 'coarse': (15, 3), 'large': (20, 5),
}
POSITION_TOLERANCE = {'m': 0.0001, 'rad': math.radians(0.01)}


class JogInput(BaseModel):
    """Bounded operator intent, without arbitrary topics or absolute poses."""

    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    kind: Literal['idle', 'stop', 'base', 'joint'] = 'idle'
    x: float = Field(0, ge=-BASE_LINEAR_MAX, le=BASE_LINEAR_MAX)
    y: float = Field(0, ge=-BASE_LINEAR_MAX, le=BASE_LINEAR_MAX)
    yaw: float = Field(0, ge=-BASE_ANGULAR_MAX, le=BASE_ANGULAR_MAX)
    joint: str = Field('', max_length=100)
    direction: Literal[-1, 1] = 1
    mode: Literal['hold', 'step'] = 'hold'
    resolution: Literal['normal', 'fine', 'coarse', 'large'] = 'normal'


@dataclass(frozen=True)
class JogJoint:
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


def parse_joints(description: str) -> list[JogJoint]:
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
        result.append(JogJoint(name, *group, 'm' if linear else 'rad', lower, upper))
    return result


class JogSession:
    """Track only this connection's jog commands and stop them on release."""

    def __init__(self, bridge, robot_type: str):
        """Initialize an idle session without publishing any commands."""
        self.bridge = bridge
        self.robot_type = robot_type
        self.description = None
        self.joints: list[JogJoint] = []
        self.targets: dict[str, float] = {}
        self.active_joint: str | None = None
        self.base = [0.0, 0.0, 0.0]
        self.last_tick = time.monotonic()
        self.last_joint_sample: float | None = None
        self.active_increment: tuple[str, int, str] | None = None
        self.held_gripper: tuple[str, str, float] | None = None
        self.holding = False

    def setup(self):
        """Prepare topic connections without sending motion."""
        topics = [('/cmd_vel', 'geometry_msgs/msg/Twist')]
        for name in ('head_joint1', 'lift_joint', 'arm_l_joint1', 'arm_r_joint1',
                     'finger_l_joint1', 'finger_r_joint1'):
            group = joint_group(name)
            if group:
                topics.append((group[1], 'trajectory_msgs/msg/JointTrajectory'))
        if not self.bridge.prepare_jog_publishers(topics):
            raise ValueError('Cannot prepare ROS jog publishers')
        for topic, msg_type, qos in [
            ('/joint_states', 'sensor_msgs/msg/JointState',
             {'reliability': 'best_effort', 'durability': 'volatile', 'depth': 1}),
            ('/robot_description', 'std_msgs/msg/String',
             {'reliability': 'reliable', 'durability': 'transient_local', 'depth': 1}),
        ]:
            if not self.bridge.add_topic_subscription(topic, msg_type, qos):
                raise ValueError(f'Cannot subscribe to {topic}')

    def feedback(self):
        """Read finite positions, sample age and runtime joint limits."""
        description = self.bridge.get_topic_data('/robot_description')
        xml = (description or {}).get('data', {}).get('data', '')
        if xml != self.description:
            self.description = xml
            try:
                self.joints = parse_joints(xml) if xml else []
            except ET.ParseError:
                self.joints = []
        cached = self.bridge.get_topic_data('/joint_states')
        age = max(0, time.time() - cached['received_at']) if cached else None
        data = cached['data'] if cached else {}
        positions = {
            name: float(value)
            for name, value in zip(data.get('name', []), data.get('position', []))
            if isinstance(value, (float, int)) and math.isfinite(value)
        }
        return positions, age, cached['received_at'] if cached else None

    def snapshot(self):
        """Return display state without sending robot commands."""
        positions, age, _ = self.feedback()
        fresh = age is not None and age <= FEEDBACK_MAX_AGE
        return {
            'robot_type': self.robot_type,
            'base_supported': self.robot_type in BASE_MODELS,
            'feedback_fresh': fresh,
            'feedback_age': age,
            'description_available': bool(self.joints),
            'base': self.base,
            'joints': [dict(asdict(j), position=positions.get(j.name),
                            target=self.targets.get(j.name),
                            available=self.robot_type != 'mobile' and fresh
                            and j.name in positions)
                       for j in self.joints],
            'wheels': {name: pos for name, pos in positions.items() if 'wheel_steer' in name},
        }

    def publish(self, topic, msg_type, data):
        """Send through the bridge's expiring command queue."""
        if not self.bridge.publish_jog(topic, msg_type, data):
            raise ValueError(
                'ROS command failed: controller subscriber unavailable or publish timed out.')

    def publish_base(self, values):
        """Publish forward, lateral and yaw velocity."""
        self.publish('/cmd_vel', 'geometry_msgs/msg/Twist', {
            'linear': dict(x=values[0], y=values[1], z=0.0),
            'angular': dict(x=0.0, y=0.0, z=values[2]),
        })

    def trajectory(self, joint: JogJoint, target: float):
        """Send one immediate position target, without timed interpolation."""
        names = [joint.name]
        positions = [target]
        if self.held_gripper and self.held_gripper[0] == joint.name:
            _, gripper, position = self.held_gripper
            names.append(gripper)
            positions.append(position)
        self.publish(joint.topic, 'trajectory_msgs/msg/JointTrajectory', {
            'joint_names': names,
            'points': [{
                'positions': positions,
                'time_from_start': {'sec': 0, 'nanosec': 0},
            }],
        })
        self.targets.update(zip(names, positions))

    def retain_gripper(self, joint: JogJoint, positions: dict[str, float], mode: str):
        """Latch measured gripper position once per arm press, not per update."""
        if not joint.name.startswith('arm_'):
            self.held_gripper = None
            return
        gripper = next((j for j in self.joints if j.topic == joint.topic
                        and j.name.startswith('gripper_')), None)
        if gripper is None:  # Hand-equipped models have a separate controller.
            self.held_gripper = None
            return
        if (mode == 'hold' and self.held_gripper
                and self.held_gripper[:2] == (joint.name, gripper.name)):
            position = self.held_gripper[2]
        else:
            position = positions.get(gripper.name)
        if position is None or not gripper.lower <= position <= gripper.upper:
            raise ValueError(
                'Gripper position is unavailable or outside URDF limits. Jog stopped.')
        self.held_gripper = (joint.name, gripper.name, position)

    def stop(self):
        """Stop this session's motion without reusing stale joint positions."""
        errors = []
        if any(self.base):
            try:
                self.publish_base([0.0, 0.0, 0.0])
                self.base = [0.0, 0.0, 0.0]
            except ValueError as exc:
                errors.append(str(exc))
        if self.active_joint:
            positions, age, _ = self.feedback()
            joint = next((j for j in self.joints if j.name == self.active_joint), None)
            # Never send an old pose to stop. Without fresh feedback, leave
            # the last bounded position target in place.
            if joint and age is not None and age <= FEEDBACK_MAX_AGE and joint.name in positions:
                try:
                    position = positions[joint.name]
                    if joint.lower <= position <= joint.upper:
                        self.trajectory(joint, position)
                except ValueError as exc:
                    errors.append(str(exc))
            if not errors:
                self.active_joint = None
        self.active_increment = None
        self.last_joint_sample = None
        if errors:
            raise ValueError('; '.join(errors))
        self.held_gripper = None
        self.holding = False

    def _target_reached(self, joint: JogJoint, position: float) -> bool:
        """Check measured completion without replacing the controller's goal."""
        target = self.targets.get(joint.name)
        return target is not None and abs(position - target) <= POSITION_TOLERANCE[joint.unit]

    def apply(self, command: JogInput):
        """Apply one validated input, using measured position for joint goals."""
        now = time.monotonic()
        dt = min(max(now - self.last_tick, BASE_TICK_MIN), BASE_TICK_MAX)
        self.last_tick = now
        if command.kind == 'stop':
            self.stop()
        elif command.kind == 'idle':
            self._handle_idle()
        elif command.kind == 'base':
            self._apply_base(command, dt)
        else:
            self._apply_joint(command)

    def _handle_idle(self):
        """Finish a measured step or stop released continuous movement."""
        if any(self.base) or self.holding:
            self.stop()
        elif self.active_joint:
            # A single step remains the controller's goal even if tracking
            # lags. Retain stop/timeout handling
            # until fresh feedback confirms completion; do not publish here.
            positions, age, _ = self.feedback()
            joint = next((j for j in self.joints if j.name == self.active_joint), None)
            if (joint and age is not None and age <= FEEDBACK_MAX_AGE
                    and joint.name in positions
                    and self._target_reached(joint, positions[joint.name])):
                self.active_joint = None
                self.active_increment = None
                self.last_joint_sample = None

    def _apply_base(self, command: JogInput, dt: float):
        """Apply bounded base velocity with the existing slew limit."""
        if self.robot_type not in BASE_MODELS:
            raise ValueError('This robot does not support swerve jog.')
        if self.active_joint:
            self.stop()
        desired = [command.x, command.y, command.yaw]
        norm = math.hypot(*desired[:2])
        if norm > BASE_LINEAR_MAX:
            desired[:2] = [v * BASE_LINEAR_MAX / norm for v in desired[:2]]
        # Slew limits for normal joystick changes. Explicit stop sends zero.
        accelerations = [BASE_LINEAR_ACCELERATION] * 2 + [BASE_ANGULAR_ACCELERATION]
        values = [prev + max(-limit * dt, min(limit * dt, value - prev))
                  for prev, value, limit in zip(self.base, desired, accelerations)]
        self.base = values  # Track attempted motion so failures also trigger stop.
        self.publish_base(values)

    def _apply_joint(self, command: JogInput):
        """Publish a selected-size offset from fresh measured joint position."""
        if self.robot_type == 'mobile':
            raise ValueError('Mobile bringup supports base jog only.')
        if any(self.base) or (self.active_joint and self.active_joint != command.joint):
            self.stop()
        positions, age, sample = self.feedback()
        if age is None or age > FEEDBACK_MAX_AGE:
            raise ValueError('Joint feedback is stale. Jog stopped.')
        joint = next((j for j in self.joints if j.name == command.joint), None)
        if joint is None or joint.name not in positions:
            raise ValueError('Joint or URDF limits are unavailable.')
        current = positions[joint.name]
        if not joint.lower <= current <= joint.upper:
            raise ValueError('Joint feedback is outside URDF limits.')
        if sample == self.last_joint_sample:
            return  # Do not repeatedly command from the same feedback sample.
        self.last_joint_sample = sample
        increment = (joint.name, command.direction, command.resolution)
        if command.mode == 'step' and self.active_increment == increment:
            # A tap completes its full increment. Holds instead replace the
            # target on each fresh feedback sample, even before arrival.
            reached = self._target_reached(joint, current)
            if not reached:
                return
        self.retain_gripper(joint, positions, command.mode)
        millimetres, degrees = JOINT_INCREMENTS[command.resolution]
        delta = millimetres / 1000 if joint.unit == 'm' else math.radians(degrees)
        target = max(joint.lower, min(joint.upper, current + command.direction * delta))
        # Recompute from measured position, never by accumulating prior goals.
        # Track attempted motion before publishing so a failed send also stops.
        self.active_increment = increment
        self.active_joint = joint.name
        self.holding = command.mode == 'hold'
        self.trajectory(joint, target)
