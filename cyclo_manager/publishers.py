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

"""Scoped publisher ownership for control sessions and server jobs."""

import threading
from uuid import uuid4

from cyclo_manager.subscriptions import validate_topic


class PublisherOwner:
    """Share topic publishers until their last consumer closes."""

    def __init__(self, bridge):
        self.bridge = bridge
        self.owner_id = uuid4().hex
        self._lock = threading.Lock()
        self._closed = False
        self._topics = {}

    def acquire(self, topics):
        """Prepare publishers without sending commands; repeated acquires are idempotent."""
        for topic, _ in topics:
            validate_topic(topic)
        with self._lock:
            if self._closed:
                raise ValueError('Publisher owner is closed.')
            for topic, msg_type in topics:
                if topic in self._topics and self._topics[topic] != msg_type:
                    raise ValueError(f'Conflicting publisher message type for {topic}.')
            missing = [(topic, msg_type) for topic, msg_type in topics
                       if topic not in self._topics]
            if missing:
                if not self.bridge.acquire_publishers(missing, self.owner_id):
                    raise ValueError('Cannot prepare ROS publishers.')
                self._topics.update(missing)

    def publish(self, topic, msg_type, data):
        """Publish only through this owner's previously acquired topics."""
        with self._lock:
            if self._closed or not self.bridge.publish_jog(
                    topic, msg_type, data, self.owner_id):
                raise ValueError('ROS command failed: publish failed or timed out.')

    def close(self):
        """Release ownership after pending acquires and publishes have finished."""
        with self._lock:
            if not self._closed:
                self._closed = True
                self.bridge.release_publishers(self.owner_id)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
