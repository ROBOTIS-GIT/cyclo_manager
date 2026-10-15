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

"""Validate recorded commands and generate measured, bounded return trajectories."""

import math
import xml.etree.ElementTree as ET

from cyclo_manager.robot_interface.command_profiles import ARRIVAL_CHECKS

RETURN_SPEED = {'rad': math.radians(10), 'm': 0.01}
RETURN_ACCELERATION = {'rad': math.radians(20), 'm': 0.02}


def duration_seconds(point):
    """Read a validated nonnegative ROS duration."""
    duration = point.get('time_from_start', {})
    sec, nano = duration.get('sec', 0), duration.get('nanosec', 0)
    if not isinstance(sec, int) or not isinstance(nano, int) or sec < 0 or not 0 <= nano < 1e9:
        raise ValueError('Invalid trajectory duration.')
    return sec + nano / 1e9


def validate_message(data, joints=None):
    """Validate trajectory data and, for direct commands, usable joint limits."""
    names, points = data.get('joint_names', []), data.get('points', [])
    if not names or len(set(names)) != len(names) or not points:
        raise ValueError('Trajectory has empty or duplicate joint names/points.')
    unknown = [name for name in names if joints is not None and name not in joints]
    if unknown:
        raise ValueError(f'Recording joints lack usable URDF limits: {", ".join(unknown)}')
    previous = -1
    for point in points:
        positions = point.get('positions', [])
        if len(positions) != len(names):
            raise ValueError('Position count does not match joint names.')
        for value in positions:
            if not isinstance(value, (float, int)) or not math.isfinite(value):
                raise ValueError('Non-finite joint goal.')
        for field in ('velocities', 'accelerations'):
            values = point.get(field, [])
            if values and (len(values) != len(names) or any(
                    not isinstance(v, (float, int)) or not math.isfinite(v) for v in values)):
                raise ValueError(f'Invalid trajectory {field}.')
        if point.get('effort'):
            raise ValueError('Effort trajectories are not supported.')
        seconds = duration_seconds(point)
        if seconds <= previous:
            raise ValueError('Trajectory point times must increase.')
        previous = seconds


class MotionPlan:
    """Inspect a bag once and stream each replay without loading the entire bag."""

    def __init__(self, store, recording_id, joints, check=lambda: None, *, motion_topics):
        """Validate the complete bag and retain first/last poses per topic."""
        self.joints = {joint.name: joint for joint in joints}
        self.first, self.last, self.schemas = {}, {}, {}
        self.topics = set()
        self.first_timestamp = None
        self.duration = 0.0
        previous = None
        for topic, data, timestamp in store.read(recording_id):
            check()
            direct_command = topic in motion_topics
            validate_message(data, self.joints if direct_command else None)
            self.topics.add(topic)
            if previous is not None and timestamp < previous:
                raise ValueError('Recording timestamps must be ordered.')
            previous = timestamp
            if self.first_timestamp is None:
                self.first_timestamp = timestamp
            if direct_command:
                schema = frozenset(data['joint_names'])
                if topic in self.schemas and self.schemas[topic] != schema:
                    raise ValueError(
                        f'Joint membership changes inside controller input {topic}; '
                        'record consistent joint lists for automatic transitions.')
                self.schemas[topic] = schema
                first = dict(zip(data['joint_names'], data['points'][0]['positions']))
                self.first.setdefault(topic, first)
                self.last[topic] = dict(zip(data['joint_names'], data['points'][-1]['positions']))
            self.duration = max(self.duration, (timestamp - self.first_timestamp) / 1e9
                                + duration_seconds(data['points'][-1]))
        if self.first_timestamp is None:
            raise ValueError('Recording contains no trajectory messages.')
        if not self.first:
            raise ValueError(
                'No recorded controller input topics were found. '
                'Automatic start-pose moves require a recorded topic subscribed by a '
                'controller that publishes JointTrajectoryControllerState.')

    def goals(self, end=False):
        """Return recorded endpoints only for direct controller input topics."""
        source = self.last if end else self.first
        return {topic: dict(values) for topic, values in source.items()}


def arrival_errors(goals, positions, joints, arrival_tolerance_deg=0.5,
                   arrival_tolerance_cm=1.0, *, check_all_targets=False):
    """Check arrival using command-route policy while always validating feedback."""
    errors = []
    for topic, group in goals.items():
        check_target = check_all_targets or ARRIVAL_CHECKS.get(topic, True)
        for name, target in group.items():
            linear = joints[name].unit == 'm'
            tolerance = (arrival_tolerance_cm / 100 if linear
                         else math.radians(arrival_tolerance_deg))
            scale, unit = (1000, 'mm') if linear else (180 / math.pi, 'deg')
            current = positions.get(name)
            measured = current is not None and math.isfinite(current)
            if measured and not check_target:
                continue
            error = abs(current - target) if measured else None
            if measured and error <= tolerance:
                continue
            current_text = f'{current * scale:.3f} {unit}' if measured else 'unavailable'
            error_text = f'{error * scale:.3f} {unit}' if measured else 'unavailable'
            errors.append(f'{topic} / {name}: target={target * scale:.3f} {unit}, '
                          f'current={current_text}, error={error_text}, '
                          f'tolerance={tolerance * scale:.3f} {unit}')
    return errors


def arrived(goals, positions, joints, arrival_tolerance_deg=0.5, arrival_tolerance_cm=1.0):
    """Check every joint before skipping a start or return movement, including hands."""
    # Exempting hands here would skip their generated motion when only hands differ.
    return not arrival_errors(goals, positions, joints, arrival_tolerance_deg,
                              arrival_tolerance_cm, check_all_targets=True)


def return_duration(goals, positions, joints, description):
    """Account for quintic peak speed/acceleration, synchronized across all groups."""
    limits = {node.attrib['name']: float(node.find('limit').attrib['velocity'])
              for node in ET.fromstring(description).findall('joint')
              if node.find('limit') is not None and 'velocity' in node.find('limit').attrib}
    duration = 1.0
    for group in goals.values():
        for name, target in group.items():
            joint = joints[name]
            current = positions.get(name)
            if not isinstance(current, (float, int)) or not math.isfinite(current):
                raise ValueError(f'Missing or invalid feedback for {name}.')
            distance = abs(target - current)
            velocity = min(limits[name], RETURN_SPEED[joint.unit])
            duration = max(duration, 1.875 * distance / velocity,
                           math.sqrt(5.774 * distance / RETURN_ACCELERATION[joint.unit]))
    if duration > 120:
        raise ValueError('Return would exceed 120 seconds. Move closer using Jog first.')
    return duration


def interpolate(goals, positions, fraction):
    """Quintic interpolation has zero endpoint velocity and acceleration."""
    t = min(1.0, max(0.0, fraction))
    blend = 10 * t**3 - 15 * t**4 + 6 * t**5
    return {topic: {name: positions[name] + (target - positions[name]) * blend
                    for name, target in values.items()} for topic, values in goals.items()}
