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

"""ROS2 endpoints router."""

import logging
import os
import subprocess

from cyclo_manager.models import (
    ROS2SubscribeRequest,
    ROS2TopicDataResponse,
    ROS2TopicsListResponse,
    ROS2TopicStatus,
    ROS2TwistPublishRequest,
)
from cyclo_manager.ros2_node import Ros2Bridge
from cyclo_manager.state import app_state
from fastapi import APIRouter, Body, HTTPException, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/ros2', tags=['ros2'])


def _require_bridge() -> Ros2Bridge:
    bridge = app_state.get_ros2_bridge_or_none()
    if bridge is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='No ROS2 bridge available.',
        )
    return bridge


@router.post('/cmd_vel')
async def publish_cmd_vel(body: ROS2TwistPublishRequest):
    """Publish geometry_msgs/msg/Twist for web jog control."""
    bridge = _require_bridge()
    ok = bridge.publish_twist(body.topic, body.linear_x, body.angular_z)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to publish Twist on topic '{body.topic}'.",
        )
    return {'ok': True, 'topic': body.topic}


@router.get('/topics', response_model=ROS2TopicsListResponse)
async def list_ros2_topics() -> ROS2TopicsListResponse:
    """Get list of ROS2 topics (discovery run on request)."""
    bridge = _require_bridge()
    topics_status = bridge.discovery_topics()
    topics = [
        ROS2TopicStatus(
            topic=topic,
            msg_type=info['msg_type'],
            available=info['available'],
            subscribed=info['subscribed'],
        )
        for topic, info in sorted(topics_status.items())
    ]
    return ROS2TopicsListResponse(domain_id=bridge.domain_id, topics=topics)


@router.get('/topics/{topic:path}/info')
async def get_ros2_topic_info(topic: str) -> dict:
    """Get ros2 topic info -v output for a topic. Must be before get_ros2_topic_data."""
    bridge = _require_bridge()
    env = os.environ.copy()
    env['ROS_DOMAIN_ID'] = str(bridge.domain_id)
    try:
        result = subprocess.run(
            ['ros2', 'topic', 'info', '-v', topic],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
        )
        output = result.stdout or ''
        if result.stderr:
            output = output.rstrip() + '\n' + (result.stderr or '')
        if result.returncode != 0 and not output.strip():
            output = result.stderr or f'Command failed with exit code {result.returncode}'
        return {'topic': topic, 'info': output.strip()}
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail='ros2 topic info timed out',
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='ros2 CLI not found',
        )


@router.get('/topics/{topic:path}/available')
async def get_ros2_topic_available(topic: str) -> dict:
    """
    Cheaply check whether a topic currently has fresh data.

    Unlike GET /topics/{topic}, this never converts the cached message to JSON,
    so it's safe to poll frequently even for large payloads (e.g. compressed images).
    """
    bridge = _require_bridge()
    return {'topic': topic, 'available': bridge.is_topic_receiving(topic)}


@router.get('/topics/{topic:path}', response_model=ROS2TopicDataResponse)
async def get_ros2_topic_data(topic: str) -> ROS2TopicDataResponse:
    """Get the latest data from a specific ROS2 topic. On-demand subscription if needed."""
    bridge = _require_bridge()
    msg_type = bridge.get_topic_msg_type(topic)
    if msg_type and not bridge.is_topic_receiving(topic):
        qos_profile = bridge.get_qos_profile_for_topic(topic)
        bridge.add_topic_subscription(topic, msg_type, qos_profile=qos_profile)
    cached_data = bridge.get_topic_data(topic)
    available = cached_data is not None
    data = cached_data.get('data') if cached_data else None
    return ROS2TopicDataResponse(
        topic=topic, msg_type=msg_type or '',
        data=data, available=available, domain_id=bridge.domain_id,
    )


@router.post('/topics/{topic:path}/subscribe')
async def ros2_topic_subscribe(
    topic: str,
    body: ROS2SubscribeRequest | None = Body(default=None),
):
    """Subscribe to a ROS2 topic. Optionally pass {"msg_type": "..."} in body."""
    bridge = _require_bridge()
    msg_type = (body or ROS2SubscribeRequest()).msg_type
    if not msg_type:
        msg_type = bridge.get_topic_msg_type(topic)
    if not msg_type:
        bridge.request_discovery()
        bridge.wait_discovery()
        msg_type = bridge.get_topic_msg_type(topic)
    if not msg_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown msg_type for topic '{topic}'. Provide msg_type in request body.",
        )
    qos_profile = bridge.get_qos_profile_for_topic(topic)
    ok = bridge.add_topic_subscription(topic, msg_type, qos_profile=qos_profile)
    return {'ok': ok}


@router.post('/topics/{topic:path}/unsubscribe')
async def ros2_topic_unsubscribe(topic: str):
    """Unsubscribe from a ROS2 topic."""
    bridge = _require_bridge()
    bridge.remove_topic_subscription(topic)
    return {'ok': True}
