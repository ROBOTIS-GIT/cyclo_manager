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
    release_subscription_owner,
    run_until_disconnect, close_observer_error, send_subscription_ready,
)
from cyclo_manager.state import app_state
from cyclo_manager.subscriptions import SubscriptionError, SubscriptionOwner, validate_topic
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()

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
async def websocket_ros2_topic_data(
    websocket: WebSocket, topic: str, msg_type: str | None = None, metadata_only: bool = False,
):
    """Share a topic subscription for exactly the lifetime of this connection."""
    await websocket.accept()
    bridge = app_state.get_ros2_bridge_or_none()
    if bridge is None:
        await close_observer_error(
            websocket, 'No ROS2 bridge available.', 'bridge_unavailable', True)
        return
    subscriptions = SubscriptionOwner(bridge)

    async def stream():
        validate_topic(topic)
        resolved = msg_type or bridge.get_topic_msg_type(topic)
        if not resolved:
            response = ROS2TopicDataResponse(
                topic=topic, msg_type='', data=None,
                available=False, domain_id=bridge.domain_id)
            if not await _send_websocket_data(websocket, response.model_dump()):
                return
        while not resolved:
            await asyncio.to_thread(bridge.run_discovery)
            resolved = bridge.get_topic_msg_type(topic)
            if not resolved:
                await asyncio.sleep(1)
        await asyncio.to_thread(subscriptions.subscribe, topic, resolved)
        await send_subscription_ready(websocket)
        last_send_time, last_hash = 0.0, None
        last_available = None
        while True:
            if metadata_only:
                available = bridge.is_topic_receiving(topic)
                if available != last_available:
                    response = ROS2TopicDataResponse(
                        topic=topic, msg_type=resolved, data=None,
                        available=available, domain_id=bridge.domain_id)
                    if not await _send_websocket_data(websocket, response.model_dump()):
                        return
                    last_available = available
            else:
                alive, last_send_time, last_hash = await _poll_and_send_single_topic_data(
                    websocket, bridge, topic, last_send_time, last_hash,
                    1.0 / ROS2_TOPIC_MAX_SEND_RATE)
                if not alive:
                    return
            await asyncio.sleep(1.0 / ROS2_TOPIC_MAX_SEND_RATE)

    try:
        await run_until_disconnect(websocket, stream())
    except WebSocketDisconnect:
        pass
    except SubscriptionError as exc:
        await close_observer_error(websocket, str(exc), exc.code, exc.retryable)
    except Exception:
        logger.exception('WebSocket topic stream failed: %s', topic)
        await close_observer_error(
            websocket, 'Topic subscription failed.', 'subscription_unavailable', True)
    finally:
        await release_subscription_owner(subscriptions)
        await _close_websocket_ignoring_error(websocket)
