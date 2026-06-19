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

import asyncio
import copy
import logging
import os
import re
import shlex
import subprocess
import time
from typing import Any

import yaml
from cyclo_manager.models import (
    ROS2NavigateToPoseGoalRequest,
    ROS2SubscribeRequest,
    ROS2TopicDataResponse,
    ROS2TopicPublishRequest,
    ROS2TopicsListResponse,
    ROS2TopicStatus,
    ROS2TwistPublishRequest,
)
from cyclo_manager.state import get_docker_client, get_ros2_node, get_validated_container
from docker.errors import DockerException, NotFound
from fastapi import APIRouter, Body, Depends, HTTPException, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/{container}/ros2', tags=['ros2'])
ISOLATED_PUBLISH_TOPICS = frozenset({'/initialpose'})

# QoS presets for topics the UI subscribes on every System page load.
# Skips `ros2 topic info -v` (blocking subprocess) — keeps the FastAPI event loop responsive.
# If a deployment uses different publisher QoS (e.g. BEST_EFFORT joint_states), remove the
# topic here or adjust the preset so matching still works.
KNOWN_TOPIC_QOS_PRESETS: dict[str, dict[str, Any]] = {
    '/joint_states': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    },
    '/robot_description': {
        'durability': 'transient_local',
        'reliability': 'reliable',
        'depth': 1,
    },
    '/map': {
        'durability': 'transient_local',
        'reliability': 'reliable',
        'depth': 1,
    },
    '/global_costmap/costmap': {
        'durability': 'transient_local',
        'reliability': 'reliable',
        'depth': 1,
    },
    '/local_costmap/costmap': {
        'durability': 'transient_local',
        'reliability': 'reliable',
        'depth': 1,
    },
    '/local_costmap/published_footprint': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    },
    '/tf_static': {
        'durability': 'transient_local',
        'reliability': 'reliable',
        'depth': 1,
    },
    '/tf': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 100,
    },
    '/scan': {
        'durability': 'volatile',
        'reliability': 'best_effort',
        'depth': 10,
    },
    '/amcl_pose': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    },
    '/plan': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    },
    '/goal_pose': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    },
    '/local_plan': {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    },
    '/odom': {
        'durability': 'transient_local',
        'reliability': 'reliable',
        'depth': 10,
    },
}


def resolve_qos_profile_for_topic(container: str, topic: str, node) -> dict[str, Any]:
    """Use a known QoS preset when available; otherwise probe publishers via `ros2 topic info`."""
    preset = KNOWN_TOPIC_QOS_PRESETS.get(topic)
    if preset is not None:
        return dict(preset)
    return _get_topic_publisher_qos(container, topic, node)


def _refresh_header_stamp(data: dict[str, Any]) -> None:
    """Stamp outgoing ROS messages with the server's current ROS/system time."""
    header = data.get('header')
    if isinstance(header, dict) and isinstance(header.get('stamp'), dict):
        now_ns = time.time_ns()
        header['stamp'] = {
            'sec': now_ns // 1_000_000_000,
            'nanosec': now_ns % 1_000_000_000,
        }


def _publish_initial_pose_with_ros2_cli(
    topic: str,
    msg_type: str,
    data: dict[str, Any],
    domain_id: int,
) -> tuple[bool, str]:
    """Publish an initial pose once in a subprocess to isolate rclpy publisher failures."""
    env = os.environ.copy()
    env['ROS_DOMAIN_ID'] = str(domain_id)
    _refresh_header_stamp(data)
    payload = yaml.safe_dump(data, default_flow_style=True, sort_keys=False)
    base_command = ['ros2', 'topic', 'pub', '--once']
    message_args = [topic, msg_type, payload]
    run_options = {'capture_output': True, 'text': True, 'timeout': 5, 'env': env}
    try:
        command = [*base_command, '--wait-matching-subscriptions', '1', '--keep-alive', '2', *message_args]
        proc = subprocess.run(command, **run_options)
        if proc.returncode != 0 and '--wait-matching-subscriptions' in (proc.stderr or ''):
            proc = subprocess.run([*base_command, '--keep-alive', '2', *message_args], **run_options)
    except subprocess.TimeoutExpired as exc:
        streams = (
            value.decode(errors='replace') if isinstance(value, bytes) else value
            for value in (exc.stdout, exc.stderr)
        )
        output = '\n'.join(value or '' for value in streams).strip()
        if 'publishing #1' in output:
            return True, output or 'ros2 topic pub timed out after publishing once'
        return False, f'ros2 topic pub timed out: {output}' if output else 'ros2 topic pub timed out'
    except FileNotFoundError:
        return False, 'ros2 CLI not found'

    output = ((proc.stdout or '') + '\n' + (proc.stderr or '')).strip()
    return proc.returncode == 0, output


def _cancel_navigate_to_pose_goal_with_ros2_cli(domain_id: int) -> tuple[bool, str]:
    """Cancel all active Nav2 NavigateToPose goals."""
    env = os.environ.copy()
    env['ROS_DOMAIN_ID'] = str(domain_id)
    payload = yaml.safe_dump(
        {
            'goal_info': {
                'goal_id': {'uuid': [0] * 16},
                'stamp': {'sec': 0, 'nanosec': 0},
            },
        },
        default_flow_style=True,
        sort_keys=False,
    )
    try:
        proc = subprocess.run(
            ['ros2', 'service', 'call', '/navigate_to_pose/_action/cancel_goal',
            'action_msgs/srv/CancelGoal', payload,
            ],
            capture_output=True,
            text=True,
            timeout=5,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return False, 'ros2 service call timed out'
    except FileNotFoundError:
        return False, 'ros2 CLI not found'

    output = ((proc.stdout or '') + '\n' + (proc.stderr or '')).strip()
    return proc.returncode == 0, output


def _send_navigate_to_pose_goal_in_container(
    docker_client,
    container: str,
    domain_id: int,
    pose: dict[str, Any],
    behavior_tree: str = '',
) -> tuple[bool, str]:
    """Send a Nav2 NavigateToPose action goal from inside the target container."""
    pose_stamped = copy.deepcopy(pose)
    _refresh_header_stamp(pose_stamped)
    payload = yaml.safe_dump(
        {'pose': pose_stamped, 'behavior_tree': behavior_tree},
        default_flow_style=True,
        sort_keys=False,
    )
    command = (
        'for setup_file in /opt/ros/*/setup.bash; do '
        '[ -f "$setup_file" ] && source "$setup_file" && break; '
        'done; '
        '[ -f /root/ros2_ws/install/setup.bash ] && '
        'source /root/ros2_ws/install/setup.bash; '
        'timeout 5s ros2 action send_goal '
        f'/navigate_to_pose nav2_msgs/action/NavigateToPose {shlex.quote(payload)}'
    )
    container_obj = docker_client.get_container(container)
    result = container_obj.exec_run(
        ['bash', '-lc', command],
        environment={'ROS_DOMAIN_ID': str(domain_id)},
    )
    output = result.output.decode(errors='replace').strip()
    return result.exit_code == 0 or (
        result.exit_code == 124 and 'Goal accepted' in output
    ), output


def _get_topic_publisher_qos(container: str, topic: str, node) -> dict:
    """
    Parse ros2 topic info -v and return QoS profile to match publisher(s).

    Returns dict with: durability (transient_local|volatile), reliability (best_effort|reliable),
    depth (int). Uses publisher section only; defaults ensure compatibility with most publishers.
    """
    env = os.environ.copy()
    env['ROS_DOMAIN_ID'] = str(node.domain_id)
    result = {
        'durability': 'volatile',
        'reliability': 'reliable',
        'depth': 10,
    }
    try:
        proc = subprocess.run(
            ['ros2', 'topic', 'info', '-v', topic],
            capture_output=True,
            text=True,
            timeout=8,
            env=env,
        )
        output = (proc.stdout or '') + '\n' + (proc.stderr or '')
        if 'Subscription count' in output:
            publisher_section = output.split('Subscription count')[0]
        elif 'Subscriber count' in output:
            publisher_section = output.split('Subscriber count')[0]
        else:
            publisher_section = output

        # Durability: use VOLATILE if any publisher has it (to match all);
        # TRANSIENT_LOCAL only when all publishers use it
        if 'Durability: VOLATILE' in publisher_section:
            result['durability'] = 'volatile'
        elif 'Durability: TRANSIENT_LOCAL' in publisher_section:
            result['durability'] = 'transient_local'
            result['depth'] = 1  # Static topics typically use depth 1

        # Reliability: BEST_EFFORT required to receive from BEST_EFFORT publishers
        if 'Reliability: BEST_EFFORT' in publisher_section:
            result['reliability'] = 'best_effort'

        # Parse depth from "History (Depth): KEEP_LAST (N)" or "Depth: N"
        depth_match = re.search(
            r'\(Depth\):\s*KEEP_LAST\s*\((\d+)\)|Depth:\s*(\d+)', publisher_section
        )
        if depth_match:
            d = depth_match.group(1) or depth_match.group(2)
            if d:
                result['depth'] = int(d)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return result


@router.get('/topics', response_model=ROS2TopicsListResponse)
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
            msg_type=status_info['msg_type'],
            available=status_info['available'],
            subscribed=status_info['subscribed'],
        )
        for topic, status_info in sorted(topics_status.items(), key=lambda x: x[0])
    ]

    return ROS2TopicsListResponse(
        container=container,
        domain_id=node.domain_id,
        topics=topics,
    )


@router.get('/topics/{topic:path}/info')
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
    env['ROS_DOMAIN_ID'] = str(node.domain_id)
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


@router.get('/topics/{topic:path}', response_model=ROS2TopicDataResponse)
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
    data = cached_data.get('data') if cached_data else None
    if msg_type is None:
        msg_type = node.get_topic_msg_type(topic) or ''

    return ROS2TopicDataResponse(
        container=container,
        topic=topic,
        msg_type=msg_type,
        data=data,
        available=available,
        domain_id=node.domain_id,
    )


@router.post('/cmd_vel')
async def publish_cmd_vel(
    body: ROS2TwistPublishRequest,
    container: str = Depends(get_validated_container),
):
    """Publish geometry_msgs/msg/Twist to /cmd_vel for web jog control."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    ok = node.publish_twist(body.topic, body.linear_x, body.angular_z)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to publish Twist on topic '{body.topic}'.",
        )
    return {'ok': True, 'topic': body.topic}


@router.post('/navigate_to_pose/cancel')
async def cancel_navigate_to_pose_goal(
    container: str = Depends(get_validated_container),
):
    """Cancel active Nav2 NavigateToPose action goals."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    ok, output = await asyncio.to_thread(
        _cancel_navigate_to_pose_goal_with_ros2_cli,
        node.domain_id,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to cancel NavigateToPose action goal: {output}",
        )
    return {'ok': True, 'action': '/navigate_to_pose/cancel'}


@router.post('/navigate_to_pose/goal')
async def send_navigate_to_pose_goal(
    body: ROS2NavigateToPoseGoalRequest,
    container: str = Depends(get_validated_container),
    docker_client=Depends(get_docker_client),
):
    """Send a Nav2 NavigateToPose action goal from inside the target container."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    try:
        ok, output = await asyncio.to_thread(
            _send_navigate_to_pose_goal_in_container,
            docker_client,
            container,
            node.domain_id,
            body.pose,
            body.behavior_tree,
        )
    except (DockerException, NotFound) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to exec NavigateToPose action CLI in container '{container}': {exc}",
        ) from exc

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to send NavigateToPose action goal: {output}",
        )
    return {'ok': True, 'action': '/navigate_to_pose/goal'}


@router.post('/topics/{topic:path}/publish')
async def ros2_topic_publish(
    topic: str,
    body: ROS2TopicPublishRequest,
    container: str = Depends(get_validated_container),
):
    """Publish a generic ROS2 message."""
    node = get_ros2_node(container)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"ROS2 node for container '{container}' is not available.",
        )

    if topic in ISOLATED_PUBLISH_TOPICS:
        ok, output = await asyncio.to_thread(
            _publish_initial_pose_with_ros2_cli,
            topic,
            body.msg_type,
            body.data,
            node.domain_id,
        )
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f"Failed to publish {body.msg_type!r} on topic '{topic}' "
                    f"with ros2 CLI: {output}"
                ),
            )
        return {'ok': True, 'topic': topic, 'msg_type': body.msg_type}

    _refresh_header_stamp(body.data)
    ok = node.publish_topic(topic, body.msg_type, body.data)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to publish {body.msg_type!r} on topic '{topic}'.",
        )
    return {'ok': True, 'topic': topic, 'msg_type': body.msg_type}


@router.post('/topics/{topic:path}/subscribe')
async def ros2_topic_subscribe(
    topic: str,
    body: ROS2SubscribeRequest | None = Body(default=None),
    container: str = Depends(get_validated_container),
):
    """
    Subscribe to a ROS2 topic.

    Optionally pass {"msg_type": "sensor_msgs/msg/JointState"} in body.

    """
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
    return {'ok': ok}


@router.post('/topics/{topic:path}/unsubscribe')
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
    return {'ok': True}
