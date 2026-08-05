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

"""WebSocket endpoint for ROS 2 topic streaming."""

import asyncio
import logging
import time
from typing import Any, Optional, Tuple

from cyclo_manager.models import ROS2TopicDataResponse
from cyclo_manager.routers.websocket_utils import (
    _close_websocket_ignoring_error,
    _send_websocket_data,
    _send_websocket_error,
)
from cyclo_manager.state import app_state
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()

ROS2_TOPIC_POLL_INTERVAL = 0.5  # seconds
ROS2_TOPIC_MAX_SEND_RATE = 10.0  # Hz (10 messages per second max)


def _get_topic_msg_type(bridge: Any, topic: str) -> str:
    """
    Get message type for a topic (control, discovered, or on-demand).

    Args
    ----
    bridge: Ros2Bridge instance.
    topic: Topic name.

    Returns
    -------
    Message type string, or empty string if unknown.

    """
    return bridge.get_topic_msg_type(topic) or ''


async def _poll_and_send_single_topic_data(
    websocket: WebSocket,
    bridge: Any,
    topic: str,
    last_send_time: float,
    last_sent_data_hash: Optional[int],
    min_interval: float
) -> Tuple[bool, float, Optional[int]]:
    """
    Poll for single topic data and send if changed (with throttling).

    This is optimized for single-topic WebSocket connections.

    Args
    ----
    websocket: WebSocket connection.
    bridge: Ros2Bridge instance.
    topic: Topic name.
    last_send_time: Last send time for this topic.
    last_sent_data_hash: Last sent data hash for this topic.
    min_interval: Minimum time between sends (throttling).

    Returns
    -------
    Tuple of (connection_alive, new_last_send_time, new_last_sent_data_hash).

    """
    current_time = time.time()
    time_since_last_send = current_time - last_send_time

    if time_since_last_send < min_interval:
        return True, last_send_time, last_sent_data_hash

    cached_data = bridge.get_topic_data(topic)
    available = cached_data is not None

    if cached_data:
        data = cached_data.get('data')
        data_hash = hash(str(data)) if data is not None else None

        if data_hash != last_sent_data_hash or not available:
            msg_type = _get_topic_msg_type(bridge, topic)
            response = ROS2TopicDataResponse(
                topic=topic,
                msg_type=msg_type,
                data=data,
                available=available,
                domain_id=bridge.domain_id,
            )

            success = await _send_websocket_data(websocket, response.model_dump())
            return success, current_time, data_hash
    elif not available:
        if last_sent_data_hash is None:
            msg_type = _get_topic_msg_type(bridge, topic)
            response = ROS2TopicDataResponse(
                topic=topic,
                msg_type=msg_type,
                data=None,
                available=False,
                domain_id=bridge.domain_id,
            )

            success = await _send_websocket_data(websocket, response.model_dump())
            return success, current_time, -1
        elif last_sent_data_hash != -1:
            msg_type = _get_topic_msg_type(bridge, topic)
            response = ROS2TopicDataResponse(
                topic=topic,
                msg_type=msg_type,
                data=None,
                available=False,
                domain_id=bridge.domain_id,
            )

            success = await _send_websocket_data(websocket, response.model_dump())
            return success, current_time, -1
        return True, last_send_time, last_sent_data_hash

    return True, last_send_time, last_sent_data_hash


@router.websocket('/ws/ros2/topics/{topic:path}')
async def websocket_ros2_topic_data(websocket: WebSocket, topic: str):
    """Stream single ROS2 topic data in real-time over a WebSocket connection."""
    await websocket.accept()
    logger.info(f'WebSocket connection established for ros2/{topic}')

    try:
        bridge = app_state.get_ros2_bridge_or_none()
        if bridge is None:
            await _send_websocket_error(websocket, 'No ROS2 bridge available.')
            await _close_websocket_ignoring_error(websocket)
            return

        msg_type = bridge.get_topic_msg_type(topic)
        if msg_type:
            qos_profile = bridge.get_qos_profile_for_topic(topic)
            bridge.add_topic_subscription(topic, msg_type, qos_profile=qos_profile)
            if bridge.is_topic_transient_local_subscription(topic):
                for _ in range(5):
                    await asyncio.sleep(0.1)
                    if bridge.is_topic_receiving(topic):
                        break

        last_send_time: float = 0.0
        last_sent_data_hash: Optional[int] = None
        min_interval = 1.0 / ROS2_TOPIC_MAX_SEND_RATE

        try:
            cached_data = bridge.get_topic_data(topic)
            available = cached_data is not None

            if cached_data:
                data = cached_data.get('data')
                data_hash = hash(str(data)) if data is not None else None
                msg_type = _get_topic_msg_type(bridge, topic)
                response = ROS2TopicDataResponse(
                    topic=topic, msg_type=msg_type,
                    data=data, available=available, domain_id=bridge.domain_id,
                )
                if await _send_websocket_data(websocket, response.model_dump()):
                    last_send_time = time.time()
                    last_sent_data_hash = data_hash
            elif not available:
                msg_type = _get_topic_msg_type(bridge, topic)
                response = ROS2TopicDataResponse(
                    topic=topic, msg_type=msg_type,
                    data=None, available=False, domain_id=bridge.domain_id,
                )
                if await _send_websocket_data(websocket, response.model_dump()):
                    last_send_time = time.time()
                    last_sent_data_hash = -1

            while True:
                await asyncio.sleep(min(ROS2_TOPIC_POLL_INTERVAL, min_interval))

                connection_alive, new_last_send_time, new_last_sent_data_hash = (
                    await _poll_and_send_single_topic_data(
                        websocket, bridge, topic,
                        last_send_time, last_sent_data_hash, min_interval
                    )
                )

                if not connection_alive:
                    logger.info(f'WebSocket disconnected for ros2/{topic}')
                    return

                last_send_time = new_last_send_time
                last_sent_data_hash = new_last_sent_data_hash

        except WebSocketDisconnect:
            logger.info(f'WebSocket disconnected for ros2/{topic}')
        except Exception as e:
            logger.error(f'Error in WebSocket loop for ros2/{topic}: {e}')

    except HTTPException as e:
        await _send_websocket_error(websocket, e.detail or 'Unknown error')
        await _close_websocket_ignoring_error(websocket)
    except WebSocketDisconnect:
        logger.info(f'WebSocket disconnected for ros2/{topic}')
    except Exception as e:
        logger.error(f'WebSocket error for ros2/{topic}: {e}', exc_info=True)
        await _close_websocket_ignoring_error(websocket)
