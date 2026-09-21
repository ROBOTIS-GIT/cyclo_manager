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

from copy import deepcopy
import math
import xml.etree.ElementTree as ET

from cyclo_manager.jog import FEEDBACK_MAX_AGE

RETURN_SPEED = {'rad': math.radians(10), 'm': 0.01}
RETURN_ACCELERATION = {'rad': math.radians(20), 'm': 0.02}
ARRIVAL_TOLERANCE = {'rad': math.radians(0.5), 'm': 0.001}


def feedback(session):
    """Require fresh measured positions and usable robot limits."""
    positions, age, _ = session.feedback()
    if age is None or age > FEEDBACK_MAX_AGE or not session.joints:
        raise ValueError('Fresh joint feedback and robot description are required.')
    return positions


def duration_seconds(point):
    """Read a validated nonnegative ROS duration."""
    duration = point.get('time_from_start', {})
    sec, nano = duration.get('sec', 0), duration.get('nanosec', 0)
    if not isinstance(sec, int) or not isinstance(nano, int) or sec < 0 or not 0 <= nano < 1e9:
        raise ValueError('Invalid trajectory duration.')
    return sec + nano / 1e9


def validate_message(topic, data, joints):
    """Reject ambiguous, non-finite or out-of-range trajectories before any movement."""
    names, points = data.get('joint_names', []), data.get('points', [])
    if not names or len(set(names)) != len(names) or not points:
        raise ValueError('Trajectory has empty or duplicate joint names/points.')
    if any(name not in joints or joints[name].topic != topic for name in names):
        raise ValueError('Recording joint names/topics do not match this robot.')
    previous = -1
    for point in points:
        positions = point.get('positions', [])
        if len(positions) != len(names):
            raise ValueError('Position count does not match joint names.')
        for name, value in zip(names, positions):
            joint = joints[name]
            if not isinstance(value, (float, int)) or not math.isfinite(value):
                raise ValueError('Non-finite joint goal.')
            if not joint.lower <= value <= joint.upper:
                raise ValueError(f'Recorded goal exceeds limits: {name}')
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

    def __init__(self, store, recording_id, session, check=lambda: None):
        """Validate the complete bag and retain first/last poses per topic."""
        self.joints = {joint.name: joint for joint in session.joints}
        self.first, self.last, self.schemas = {}, {}, {}
        self.first_timestamp = None
        self.duration = 0.0
        previous = None
        for topic, data, timestamp in store.read(recording_id):
            check()
            validate_message(topic, data, self.joints)
            if previous is not None and timestamp < previous:
                raise ValueError('Recording timestamps must be ordered.')
            previous = timestamp
            if self.first_timestamp is None:
                self.first_timestamp = timestamp
            schema = frozenset(data['joint_names'])
            if topic in self.schemas and self.schemas[topic] != schema:
                raise ValueError(
                    'Joint membership changes inside a topic; record full groups. '
                    'Jog recordings with changing joint lists cannot be replayed in Record & Play.')
            self.schemas[topic] = schema
            first = dict(zip(data['joint_names'], data['points'][0]['positions']))
            self.first.setdefault(topic, first)
            self.last[topic] = dict(zip(data['joint_names'], data['points'][-1]['positions']))
            self.duration = max(self.duration, (timestamp - self.first_timestamp) / 1e9
                                + duration_seconds(data['points'][-1]))
        if self.first_timestamp is None:
            raise ValueError('Recording contains no trajectory messages.')
        self.held = {}

    def latch(self, positions):
        """Explicitly hold unrecorded joints, including grippers sharing an arm topic."""
        for topic, recorded in self.schemas.items():
            self.held[topic] = {}
            for name, joint in self.joints.items():
                if joint.topic == topic and name not in recorded:
                    value = positions.get(name)
                    if value is None or not joint.lower <= value <= joint.upper:
                        raise ValueError(f'Missing or invalid feedback for {name}.')
                    self.held[topic][name] = value

    def goals(self, end=False):
        """Combine recorded endpoints with latched unrecorded joint goals."""
        source = self.last if end else self.first
        return {topic: {**values, **self.held.get(topic, {})} for topic, values in source.items()}

    def message(self, topic, data, rate):
        """Rebase stale header stamps and scale point timing and derivatives together."""
        result = deepcopy(data)
        result['header'] = {'stamp': {'sec': 0, 'nanosec': 0},
                            'frame_id': data.get('header', {}).get('frame_id', '')}
        held = self.held.get(topic, {})
        result['joint_names'] = list(data['joint_names']) + list(held)
        for point in result['points']:
            point['positions'] = list(point['positions']) + list(held.values())
            for field, multiplier in (('velocities', rate), ('accelerations', rate * rate)):
                if point.get(field):
                    point[field] = [v * multiplier for v in point[field]] + [0.0] * len(held)
            nanoseconds = round(duration_seconds(point) / rate * 1e9)
            point['time_from_start'] = {'sec': nanoseconds // 10**9, 'nanosec': nanoseconds % 10**9}
        return result


def arrived(goals, positions, joints):
    """Compare each commanded joint against its measured position."""
    return all(name in positions and abs(positions[name] - target) <= ARRIVAL_TOLERANCE[
        joints[name].unit] for group in goals.values() for name, target in group.items())


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
            if current is None or not joint.lower <= current <= joint.upper:
                raise ValueError(f'Missing or out-of-range feedback for {name}.')
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


def position_message(values):
    """Build an immediate position-only trajectory point."""
    return {'joint_names': list(values), 'points': [{'positions': list(values.values()),
            'time_from_start': {'sec': 0, 'nanosec': 0}}]}
