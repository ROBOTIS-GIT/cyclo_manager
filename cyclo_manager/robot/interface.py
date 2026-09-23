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

"""Cached robot feedback and publishing without owning subscriptions or motion."""

from dataclasses import replace
import math
import time
import xml.etree.ElementTree as ET

from cyclo_manager.robot.catalog import catalog
from cyclo_manager.robot.joints import parse_joints, RobotJoint

FEEDBACK_MAX_AGE = 0.5
TRAJECTORY_TYPE = 'trajectory_msgs/msg/JointTrajectory'


class RobotInterface:
    """Share the bridge while each consumer explicitly owns its subscriptions."""

    def __init__(self, bridge, robot_type='ros', command_topic=None, *, command_topics=None, guard=None):
        """Keep local model state without subscribing or sending commands."""
        self.bridge = bridge
        self.guard = guard
        self.robot_type = robot_type
        self.command_topics = (frozenset(command_topics) if command_topics is not None
                               else frozenset([command_topic]) if command_topic else None)
        self.description = None
        self.unbound_joints = []
        self.controllers = []
        self.expected_bindings = None
        self.joints: list[RobotJoint] = []
        self.feedback_received_at: float | None = None

    def feedback(self):
        """Read finite positions, sample age and runtime joint limits."""
        description = self.bridge.get_topic_data('/robot_description')
        xml = (description or {}).get('data', {}).get('data', '')
        if xml != self.description:
            self.description = xml
            try:
                self.unbound_joints = parse_joints(xml) if xml else []
            except ET.ParseError:
                self.unbound_joints = []
        self.controllers = catalog(self.bridge)
        self.joints = []
        valid_names = {j.name for j in self.unbound_joints}
        for joint in self.unbound_joints:
            matches = [c for c in self.controllers if joint.name in c['joints']
                       and set(c['joints']).issubset(valid_names)
                       and (self.command_topics is None or c['topic'] in self.command_topics)]
            self.joints.append(replace(joint, group=matches[0]['topic'], topic=matches[0]['topic'])
                               if len(matches) == 1 else joint)
        cached = self.bridge.get_topic_data('/joint_states')
        age = max(0, time.time() - cached['received_at']) if cached else None
        data = cached['data'] if cached else {}
        positions = {
            name: float(value)
            for name, value in zip(data.get('name', []), data.get('position', []))
            if isinstance(value, (float, int)) and math.isfinite(value)
        }
        return positions, age, cached['received_at'] if cached else None

    def require_feedback(self):
        """Require fresh measured positions and usable robot limits."""
        positions, age, received_at = self.feedback()
        if age is None or age > FEEDBACK_MAX_AGE or not any(j.topic for j in self.joints):
            raise ValueError('Fresh joint feedback and robot description are required.')
        if self.command_topics is not None and not self.command_topics.issubset(
                {j.topic for j in self.joints if j.topic}):
            raise ValueError('Selected command topics are unavailable or ambiguous.')
        if self.expected_bindings is not None:
            topics = set(self.expected_bindings.values())
            current = {j.name: j.topic for j in self.joints if j.topic in topics}
            if current != self.expected_bindings or self.description != self.expected_description:
                raise ValueError('Controller mapping changed during playback.')
        self.feedback_received_at = received_at
        return positions

    def pin_topics(self, topics):
        """Freeze the resolved command routes for one playback job."""
        self.expected_bindings = {j.name: j.topic for j in self.joints if j.topic in topics}
        self.expected_description = self.description

    def publish(self, topic, msg_type, data):
        """Send through the bridge's expiring command queue."""
        if self.guard is not None:
            self.guard()
        if not self.bridge.publish_jog(topic, msg_type, data):
            raise ValueError(
                'ROS command failed: controller subscriber unavailable or publish timed out.')


def position_message(values):
    """Build an immediate position-only trajectory point in joint order."""
    return {'joint_names': list(values), 'points': [{'positions': list(values.values()),
            'time_from_start': {'sec': 0, 'nanosec': 0}}]}
