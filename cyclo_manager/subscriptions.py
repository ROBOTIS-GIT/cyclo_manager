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

"""Scoped subscription ownership for viewers and server jobs."""

import re
import threading
from uuid import uuid4


class SubscriptionError(ValueError):
    """Subscription failure with a stable retry policy."""

    def __init__(self, message, code='subscription_unavailable', retryable=True):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def validate_topic(topic):
    """Observers accept absolute ROS topic names only."""
    if not re.fullmatch(r'/[A-Za-z_][A-Za-z0-9_]*(/[A-Za-z_][A-Za-z0-9_]*)*', topic):
        raise SubscriptionError('Invalid topic name.', 'invalid_topic', False)


class SubscriptionOwner:
    """Release a consumer's subscriptions together, even after partial setup failure."""

    def __init__(self, bridge):
        self.bridge = bridge
        self.owner_id = uuid4().hex
        self._lock = threading.Lock()
        self._closed = False
        self._topics = {}

    def subscribe(self, topic, msg_type, qos=None):
        """Register idempotently; serialize against cleanup after async cancellation."""
        validate_topic(topic)
        with self._lock:
            if self._closed:
                raise ValueError('Subscription owner is closed.')
            if topic in self._topics:
                if self._topics[topic] != msg_type:
                    raise SubscriptionError(
                        f'Conflicting message type for {topic}.', 'type_conflict', False)
                return
            if not self.bridge.acquire_subscription(topic, msg_type, self.owner_id, qos):
                raise SubscriptionError(f'Cannot subscribe to {topic}.')
            self._topics[topic] = msg_type

    def close(self):
        """A delayed acquire cannot run after this owner's release."""
        with self._lock:
            if not self._closed:
                self._closed = True
                self.bridge.release_subscriptions(self.owner_id)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def subscribe_joint_feedback(subscriptions):
    """Use identical feedback QoS for every viewer and motion consumer."""
    subscriptions.subscribe('/joint_states', 'sensor_msgs/msg/JointState')
    subscriptions.subscribe('/robot_description', 'std_msgs/msg/String')
