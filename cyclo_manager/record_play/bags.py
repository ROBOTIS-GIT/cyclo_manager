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

"""MCAP storage adapter; ROS imports stay out of the motion state machine."""

import json
from pathlib import Path
import re
import uuid

TRAJECTORY_TYPE = 'trajectory_msgs/msg/JointTrajectory'


class BagStore:
    """Keep completed recordings and unfinished bags in a persistent directory."""

    def __init__(self, root):
        """Create the configured persistent storage directory."""
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, recording_id):
        """Resolve a generated ID without accepting user paths or symlinks."""
        if not re.fullmatch(r'[0-9a-f]{32}', recording_id):
            raise ValueError('Invalid recording ID.')
        path = self.root / recording_id
        if path.is_symlink() or path.resolve().parent != self.root.resolve():
            raise ValueError('Invalid recording path.')
        return path

    def create(self):
        """Allocate an unfinished recording directory."""
        recording_id = uuid.uuid4().hex
        path = self.path(recording_id)
        path.mkdir()
        return recording_id, path

    def save(self, recording_id, metadata):
        """Atomically expose a fully finalized recording to the library."""
        path = self.path(recording_id)
        temporary = path / 'recording.json.tmp'
        temporary.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        temporary.replace(path / 'recording.json')

    def get(self, recording_id):
        """Read metadata for a completed recording."""
        try:
            return json.loads((self.path(recording_id) / 'recording.json').read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError('Recording is missing or incomplete.') from exc

    def list(self):
        """List completed recordings, leaving incomplete captures on disk."""
        records = []
        for path in self.root.iterdir():
            if re.fullmatch(r'[0-9a-f]{32}', path.name) and not path.is_symlink():
                try:
                    records.append(self.get(path.name))
                except ValueError:
                    continue
        return sorted(records, key=lambda item: item['created_at'], reverse=True)

    def writer(self, recording_id, topics):
        """Open an MCAP writer for the selected trajectory topics."""
        return BagWriter(self.path(recording_id) / 'bag', topics)

    def read(self, recording_id):
        """Stream deserialized trajectories in recorded timestamp order."""
        import rosbag2_py
        from rclpy.serialization import deserialize_message
        from rosidl_runtime_py.convert import message_to_ordereddict
        from trajectory_msgs.msg import JointTrajectory

        path = self.path(recording_id) / 'bag'
        if path.is_symlink():
            raise ValueError('Invalid bag path.')
        reader = rosbag2_py.SequentialReader()
        reader.open(rosbag2_py.StorageOptions(uri=str(path), storage_id='mcap'),
                    rosbag2_py.ConverterOptions('', ''))
        if any(topic.type != TRAJECTORY_TYPE for topic in reader.get_all_topics_and_types()):
            raise ValueError('Only JointTrajectory recordings can be played.')
        while reader.has_next():
            topic, raw, timestamp = reader.read_next()
            message = message_to_ordereddict(deserialize_message(raw, JointTrajectory))
            yield topic, message, timestamp


class BagWriter:
    """Write raw ROS messages on the recorder worker, never in the executor callback."""

    def __init__(self, path, topics):
        """Open storage and declare ROS message types before writing."""
        import rosbag2_py

        self.writer = rosbag2_py.SequentialWriter()
        self.writer.open(rosbag2_py.StorageOptions(uri=str(path), storage_id='mcap'),
                         rosbag2_py.ConverterOptions('', ''))
        for index, topic in enumerate(topics):
            self.writer.create_topic(rosbag2_py.TopicMetadata(
                id=index, name=topic, type=TRAJECTORY_TYPE, serialization_format='cdr'))

    def write(self, topic, message, timestamp):
        """Serialize one received ROS message to the bag."""
        from rclpy.serialization import serialize_message
        self.writer.write(topic, serialize_message(message), timestamp)

    def close(self):
        """Flush MCAP data and write rosbag metadata."""
        self.writer.close()
