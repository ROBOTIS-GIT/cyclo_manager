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

import math
import time
import xml.etree.ElementTree as ET

from cyclo_manager.robot.joints import parse_joints, RobotJoint

FEEDBACK_MAX_AGE = 0.5
TRAJECTORY_TYPE = 'trajectory_msgs/msg/JointTrajectory'


class RobotInterface:
    """Share the bridge while each consumer explicitly owns its subscriptions."""

    def __init__(self, bridge):
        """Keep local model state without subscribing or sending commands."""
        self.bridge = bridge
        self.description = None
        self.joints: list[RobotJoint] = []

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

    def require_feedback(self):
        """Require fresh measured positions and usable robot limits."""
        positions, age, _ = self.feedback()
        if age is None or age > FEEDBACK_MAX_AGE or not self.joints:
            raise ValueError('Fresh joint feedback and robot description are required.')
        return positions

    def publish(self, topic, msg_type, data):
        """Send through the bridge's expiring command queue."""
        if not self.bridge.publish_jog(topic, msg_type, data):
            raise ValueError(
                'ROS command failed: controller subscriber unavailable or publish timed out.')


def position_message(values):
    """Build an immediate position-only trajectory point in joint order."""
    return {'joint_names': list(values), 'points': [{'positions': list(values.values()),
            'time_from_start': {'sec': 0, 'nanosec': 0}}]}
