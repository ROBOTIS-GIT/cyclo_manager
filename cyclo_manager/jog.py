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

from dataclasses import asdict
import math
import time
from typing import Literal

from cyclo_manager.robot.interface import (
    FEEDBACK_MAX_AGE, position_message, RobotInterface, TRAJECTORY_TYPE,
)
from cyclo_manager.robot.joints import joint_group, RobotJoint
from cyclo_manager.subscriptions import subscribe_joint_feedback, SubscriptionOwner
from pydantic import BaseModel, ConfigDict, Field

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


class JogSession(RobotInterface):
    """Track only this connection's jog commands and stop them on release."""

    def __init__(self, bridge, robot_type: str):
        """Initialize an idle session without publishing any commands."""
        super().__init__(bridge)
        self.subscriptions = SubscriptionOwner(bridge)
        self.robot_type = robot_type
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
                topics.append((group[1], TRAJECTORY_TYPE))
        if not self.bridge.prepare_jog_publishers(topics):
            raise ValueError('Cannot prepare ROS jog publishers')
        subscribe_joint_feedback(self.subscriptions)

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

    def publish_base(self, values):
        """Publish forward, lateral and yaw velocity."""
        self.publish('/cmd_vel', 'geometry_msgs/msg/Twist', {
            'linear': dict(x=values[0], y=values[1], z=0.0),
            'angular': dict(x=0.0, y=0.0, z=values[2]),
        })

    def trajectory(self, joint: RobotJoint, target: float):
        """Send one immediate position target, without timed interpolation."""
        goals = {joint.name: target}
        if self.held_gripper and self.held_gripper[0] == joint.name:
            _, gripper, position = self.held_gripper
            goals[gripper] = position
        self.publish(joint.topic, TRAJECTORY_TYPE, position_message(goals))
        self.targets.update(goals)

    def retain_gripper(self, joint: RobotJoint, positions: dict[str, float], mode: str):
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

    def _target_reached(self, joint: RobotJoint, position: float) -> bool:
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
