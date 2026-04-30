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
import re
import subprocess
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status

from cyclo_manager.state import get_validated_container, get_ros2_node
from cyclo_manager.models import (
    ROS2SubscribeRequest,
    ROS2TopicDataResponse,
    ROS2TopicsListResponse,
    ROS2TopicStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/{container}/ros2", tags=["ros2"])

# QoS presets for topics the UI subscribes on every System page load.
# Skips `ros2 topic info -v` (blocking subprocess) — keeps the FastAPI event loop responsive.
# If a deployment uses different publisher QoS (e.g. BEST_EFFORT joint_states), remove the
# topic here or adjust the preset so matching still works.
KNOWN_TOPIC_QOS_PRESETS: dict[str, dict[str, Any]] = {
    "/joint_states": {
        "durability": "volatile",
        "reliability": "reliable",
        "depth": 10,
    },
    "/robot_description": {
        "durability": "transient_local",
        "reliability": "reliable",
        "depth": 1,
    },
}


def resolve_qos_profile_for_topic(container: str, topic: str, node) -> dict[str, Any]:
    """Use a known QoS preset when available; otherwise probe publishers via `ros2 topic info`."""
    preset = KNOWN_TOPIC_QOS_PRESETS.get(topic)
    if preset is not None:
        return dict(preset)
    return _get_topic_publisher_qos(container, topic, node)


def _get_topic_publisher_qos(container: str, topic: str, node) -> dict:
    """Parse ros2 topic info -v and return QoS profile to match publisher(s).

    Returns dict with: durability (transient_local|volatile), reliability (best_effort|reliable),
    depth (int). Uses publisher section only; defaults ensure compatibility with most publishers.
    """
    env = os.environ.copy()
    env["ROS_DOMAIN_ID"] = str(node.domain_id)
    result = {
        "durability": "volatile",
        "reliability": "reliable",
        "depth": 10,
    }
    try:
        proc = subprocess.run(
            ["ros2", "topic", "info", "-v", topic],
            capture_output=True,
            text=True,
            timeout=8,
            env=env,
        )
        output = (proc.stdout or "") + "\n" + (proc.stderr or "")
        if "Subscriber count" in output:
            publisher_section = output.split("Subscriber count")[0]
        else:
            publisher_section = output

        # Durability: use VOLATILE if any publisher has it (to match all);
        # TRANSIENT_LOCAL only when all publishers use it
        if "Durability: VOLATILE" in publisher_section:
            result["durability"] = "volatile"
        elif "Durability: TRANSIENT_LOCAL" in publisher_section:
            result["durability"] = "transient_local"
            result["depth"] = 1  # Static topics typically use depth 1

        # Reliability: BEST_EFFORT required to receive from BEST_EFFORT publishers
        if "Reliability: BEST_EFFORT" in publisher_section:
            result["reliability"] = "best_effort"

        # Parse depth from "History (Depth): KEEP_LAST (N)" or "Depth: N"
        depth_match = re.search(r"\(Depth\):\s*KEEP_LAST\s*\((\d+)\)|Depth:\s*(\d+)", publisher_section)
        if depth_match:
            d = depth_match.group(1) or depth_match.group(2)
            if d:
                result["depth"] = int(d)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return result


@router.get("/topics", response_model=ROS2TopicsListResponse)
async def list_ros2_topics(
    container: str = Depends(get_validated_container),
) -> ROS2TopicsListResponse:
    """Get list of ROS2 topics (discovery run on request). Topic list button calls this."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    topics_status = node.get_all_topics_status()

    topics = [
        ROS2TopicStatus(
            topic=topic,
            msg_type=status_info["msg_type"],
            available=status_info["available"],
            subscribed=status_info["subscribed"],
        )
        for topic, status_info in sorted(topics_status.items(), key=lambda x: x[0])
    ]

    return ROS2TopicsListResponse(
        container=container,
        domain_id=node.domain_id,
        topics=topics,
    )


@router.get("/topics/{topic:path}/info")
async def get_ros2_topic_info(
    topic: str,
    container: str = Depends(get_validated_container),
) -> dict:
    """Get ros2 topic info -v output for a topic. Must be before get_ros2_topic_data."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    env = os.environ.copy()
    env["ROS_DOMAIN_ID"] = str(node.domain_id)
    try:
        result = subprocess.run(
            ["ros2", "topic", "info", "-v", topic],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
        )
        output = result.stdout or ""
        if result.stderr:
            output = output.rstrip() + "\n" + (result.stderr or "")
        if result.returncode != 0 and not output.strip():
            output = result.stderr or f"Command failed with exit code {result.returncode}"
        return {"topic": topic, "info": output.strip()}
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="ros2 topic info timed out",
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ros2 CLI not found",
        )


@router.get("/topics/{topic:path}", response_model=ROS2TopicDataResponse)
async def get_ros2_topic_data(
    topic: str,
    container: str = Depends(get_validated_container),
) -> ROS2TopicDataResponse:
    """Get the latest data from a specific ROS2 topic. On-demand subscription if needed."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    if topic not in node.list_topics():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Topic '{topic}' not found for container '{container}'",
        )

    msg_type = node.get_topic_msg_type(topic)
    if msg_type and not node.is_topic_available(topic):
        qos_profile = resolve_qos_profile_for_topic(container, topic, node)
        node.add_topic_subscription(topic, msg_type, qos_profile=qos_profile)

    cached_data = node.get_topic_data(topic)
    available = node.is_topic_available(topic)
    data = cached_data.get("data") if cached_data else None
    if msg_type is None:
        msg_type = node.get_topic_msg_type(topic) or ""

    return ROS2TopicDataResponse(
        container=container,
        topic=topic,
        msg_type=msg_type,
        data=data,
        available=available,
        domain_id=node.domain_id,
    )


@router.post("/topics/{topic:path}/subscribe")
async def ros2_topic_subscribe(
    topic: str,
    body: ROS2SubscribeRequest | None = Body(default=None),
    container: str = Depends(get_validated_container),
):
    """Subscribe to a ROS2 topic. Optionally pass {"msg_type": "sensor_msgs/msg/JointState"} in body."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )
    msg_type = (body or ROS2SubscribeRequest()).msg_type
    if not msg_type:
        msg_type = node.get_topic_msg_type(topic)
    if not msg_type:
        node.request_discovery()
        node.wait_discovery()
        msg_type = node.get_topic_msg_type(topic)
    if not msg_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown msg_type for topic '{topic}'. Provide msg_type in request body.",
        )
    qos_profile = resolve_qos_profile_for_topic(container, topic, node)
    ok = node.add_topic_subscription(topic, msg_type, qos_profile=qos_profile)
    return {"ok": ok}


@router.post("/topics/{topic:path}/unsubscribe")
async def ros2_topic_unsubscribe(
    topic: str,
    container: str = Depends(get_validated_container),
):
    """Unsubscribe from a ROS2 topic."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )
    node.remove_topic_subscription(topic)
    return {"ok": True}
