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

"""Known ROS2 topic metadata (msg type, QoS presets, static cache)."""

from __future__ import annotations

from typing import Any, TypedDict


class KnownTopicMeta(TypedDict, total=False):
    msg_type: str
    qos: dict[str, Any]
    static: bool


# Single source for known topics used by System page / fallbacks.
# qos: skip `ros2 topic info -v` on subscribe. If publisher QoS differs in a
# deployment, adjust or remove the preset so matching still works.
# static: cached data never expires (e.g. latched URDF).
KNOWN_TOPICS: dict[str, KnownTopicMeta] = {
    '/cmd_vel': {
        'msg_type': 'geometry_msgs/msg/Twist',
    },
    '/joint_states': {
        'msg_type': 'sensor_msgs/msg/JointState',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 10,
        },
    },
    '/robot_description': {
        'msg_type': 'std_msgs/msg/String',
        'qos': {
            'durability': 'transient_local',
            'reliability': 'reliable',
            'depth': 1,
        },
        'static': True,
    },
    '/ai_worker/battery/left/state': {
        'msg_type': 'sensor_msgs/msg/BatteryState',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 10,
        },
    },
    '/ai_worker/battery/right/state': {
        'msg_type': 'sensor_msgs/msg/BatteryState',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 10,
        },
    },
    '/zed/zed_node/left/image_rect_color/compressed': {
        'msg_type': 'sensor_msgs/msg/CompressedImage',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 10,
        },
    },
    '/camera_head/camera_head/color/image_raw/compressed': {
        'msg_type': 'sensor_msgs/msg/CompressedImage',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 42,
        },
    },
    '/camera_left/camera_left/color/image_rect_raw/compressed': {
        'msg_type': 'sensor_msgs/msg/CompressedImage',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 42,
        },
    },
    '/camera_right/camera_right/color/image_rect_raw/compressed': {
        'msg_type': 'sensor_msgs/msg/CompressedImage',
        'qos': {
            'durability': 'volatile',
            'reliability': 'reliable',
            'depth': 42,
        },
    },
}

KNOWN_TOPIC_TYPES: dict[str, str] = {
    topic: meta['msg_type']
    for topic, meta in KNOWN_TOPICS.items()
    if 'msg_type' in meta
}

KNOWN_TOPIC_QOS_PRESETS: dict[str, dict[str, Any]] = {
    topic: dict(meta['qos'])
    for topic, meta in KNOWN_TOPICS.items()
    if 'qos' in meta
}

STATIC_TOPICS: frozenset[str] = frozenset(
    topic for topic, meta in KNOWN_TOPICS.items() if meta.get('static')
)

# Seconds after which dynamic topic data is considered stale
DYNAMIC_TOPIC_STALE_TIME = 3.0
