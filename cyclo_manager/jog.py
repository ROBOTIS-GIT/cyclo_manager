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
Each trajectory ends at zero velocity; its duration respects the nominal joint
speed. No absolute pose commands are accepted. Runtime URDF limits are required.
"""

from dataclasses import asdict, dataclass
import math
import re
import time
from typing import Literal
import xml.etree.ElementTree as ET

from pydantic import BaseModel, ConfigDict, Field

FEEDBACK_MAX_AGE = 0.5
TRAJECTORY_SECONDS = 0.25
BASE_MODELS = {'sg2', 'sh5', 'f2', 'mobile'}


class JogInput(BaseModel):
    """Bounded operator intent, without arbitrary topics or absolute poses."""

    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    kind: Literal['idle', 'stop', 'base', 'joint'] = 'idle'
    x: float = Field(0, ge=-0.3, le=0.3)
    y: float = Field(0, ge=-0.3, le=0.3)
    yaw: float = Field(0, ge=-0.6, le=0.6)
    joint: str = Field('', max_length=100)
    direction: Literal[-1, 1] = 1
    mode: Literal['hold', 'step'] = 'hold'
    resolution: Literal['normal', 'fine', 'coarse'] = 'normal'


@dataclass(frozen=True)
class JogJoint:
    """A supported joint with limits from the active robot description."""

    name: str
    group: str
    topic: str
    unit: str
    lower: float
    upper: float
    speed: float


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
        result.append(JogJoint(name, *group, 'm' if linear else 'rad', lower, upper,
                               min(velocity, 0.01 if linear else 0.15)))
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
        self.step_until = 0.0
        self.active_increment: tuple[str, int, str] | None = None

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

    def trajectory(self, joint: JogJoint, target: float, duration=TRAJECTORY_SECONDS):
        """Send a bounded single-joint trajectory ending at zero velocity."""
        nanoseconds = round(duration * 1e9)
        # All supported controllers allow partial joints; lift has only one joint.
        self.publish(joint.topic, 'trajectory_msgs/msg/JointTrajectory', {
            'joint_names': [joint.name],
            'points': [{
                'positions': [target], 'velocities': [0.0],
                'time_from_start': {
                    'sec': nanoseconds // 1_000_000_000,
                    'nanosec': nanoseconds % 1_000_000_000,
                },
            }],
        })
        self.targets[joint.name] = target

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
            # Never send an old pose to stop. The last bounded trajectory ends
            # with zero velocity even when no fresh feedback remains.
            if joint and age is not None and age <= FEEDBACK_MAX_AGE and joint.name in positions:
                try:
                    position = positions[joint.name]
                    if joint.lower <= position <= joint.upper:
                        self.trajectory(joint, position)
                except ValueError as exc:
                    errors.append(str(exc))
            if not errors:
                self.active_joint = None
        self.step_until = 0.0
        self.active_increment = None
        self.last_joint_sample = None
        if errors:
            raise ValueError('; '.join(errors))

    def _target_reached(self, joint: JogJoint, position: float) -> bool:
        """Check measured completion without replacing the controller's goal."""
        tolerance = 0.0001 if joint.unit == 'm' else math.radians(0.01)
        target = self.targets.get(joint.name)
        return target is not None and abs(position - target) <= tolerance

    def apply(self, command: JogInput):
        """Apply one validated input, using measured position for joint goals."""
        now = time.monotonic()
        dt = min(max(now - self.last_tick, 0.01), 0.1)
        self.last_tick = now
        if command.kind == 'stop':
            self.stop()
            return
        if command.kind == 'idle':
            if any(self.base):
                self.stop()
            elif self.active_joint and now >= self.step_until:
                # A single step remains the controller's goal even if tracking
                # lags behind its nominal duration. Retain stop/timeout handling
                # until fresh feedback confirms completion; do not publish here.
                positions, age, _ = self.feedback()
                joint = next((j for j in self.joints if j.name == self.active_joint), None)
                if (joint and age is not None and age <= FEEDBACK_MAX_AGE
                        and joint.name in positions
                        and self._target_reached(joint, positions[joint.name])):
                    self.active_joint = None
                    self.active_increment = None
                    self.step_until = 0.0
                    self.last_joint_sample = None
            return
        if command.kind == 'base':
            if self.robot_type not in BASE_MODELS:
                raise ValueError('This robot does not support swerve jog.')
            if self.active_joint:
                self.stop()
            desired = [command.x, command.y, command.yaw]
            norm = math.hypot(*desired[:2])
            if norm > 0.3:
                desired[:2] = [v * 0.3 / norm for v in desired[:2]]
            # Slew limits for normal joystick changes. Explicit stop sends zero.
            values = [prev + max(-limit * dt, min(limit * dt, value - prev))
                      for prev, value, limit in zip(self.base, desired, [0.3, 0.3, 0.6])]
            self.base = values  # Track attempted motion so failures also trigger stop.
            self.publish_base(values)
            return
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
        if self.active_increment == increment:
            # Heartbeats refresh intent, not the trajectory. Replacing a long
            # lift move every 100 ms prevents distinct selected-size steps.
            reached = self._target_reached(joint, current)
            if now < self.step_until or not reached:
                return
        delta = 0.01 if joint.unit == 'm' else math.radians(1)
        delta *= {'fine': 0.1, 'normal': 1, 'coarse': 2}[command.resolution]
        target = max(joint.lower, min(joint.upper, current + command.direction * delta))
        # Preserve the requested increment instead of clipping it to a speed
        # budget. A zero-end-velocity cubic has nominal peak speed 1.5*d/T.
        duration = max(TRAJECTORY_SECONDS, 1.5 * abs(target - current) / joint.speed)
        self.step_until = now + duration
        self.active_increment = increment
        self.active_joint = joint.name
        self.trajectory(joint, target, duration)
