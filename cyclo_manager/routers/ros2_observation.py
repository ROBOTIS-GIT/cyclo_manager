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

"""Bounded snapshots and low-rate System telemetry with scoped subscriptions."""

import asyncio
import math
import time

from cyclo_manager.routers.websocket_utils import (
    _close_websocket_ignoring_error, _send_websocket_data,
    release_subscription_owner, run_until_disconnect,
    close_observer_error, send_subscription_ready,
)
from cyclo_manager.state import app_state
from cyclo_manager.subscriptions import SubscriptionError, SubscriptionOwner, validate_topic
from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

router = APIRouter()
DESCRIPTION_TIMEOUT = 5.0
STATUS_INTERVAL = 2.0


def require_bridge():
    """Fail explicitly when no ROS bridge exists."""
    bridge = app_state.get_ros2_bridge_or_none()
    if bridge is None:
        raise HTTPException(503, 'No ROS2 bridge available.')
    return bridge


async def read_once(request, bridge, topic, msg_type, timeout):
    """Release the temporary owner on success, timeout, cancellation or disconnect."""
    owner = SubscriptionOwner(bridge)
    deadline = time.monotonic() + timeout
    qos = {'reliability': 'reliable', 'durability': 'transient_local', 'depth': 1}
    try:
        await asyncio.to_thread(owner.subscribe, topic, msg_type, qos)
        while time.monotonic() < deadline:
            if await request.is_disconnected():
                raise HTTPException(499, 'Client disconnected.')
            cached = bridge.get_topic_data(topic)
            if cached is not None:
                return {'topic': topic, 'data': cached['data']}
            await asyncio.sleep(.05)
        raise HTTPException(504, 'Robot description not received within 5 seconds.')
    except SubscriptionError as exc:
        raise HTTPException(503 if exc.retryable else 400, str(exc)) from exc
    finally:
        await release_subscription_owner(owner)


@router.get('/ros2/robot-description')
async def robot_description(request: Request, topic: str = '/robot_description'):
    """Read a retained URDF with a temporary transient-local subscription."""
    return await read_once(request, require_bridge(), topic, 'std_msgs/msg/String',
                           DESCRIPTION_TIMEOUT)


def battery_percentage(bridge, topic):
    """Return a fresh normalized percentage, never JSON NaN or stale values."""
    cached = bridge.get_topic_data(topic)
    value = cached.get('data', {}).get('percentage') if cached else None
    if not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= 1:
        return None
    return round(value * 100)


@router.websocket('/ws/ros2/system-status')
async def system_status(websocket: WebSocket, battery: list[str] = Query(default=[]),
                        camera: list[str] = Query(default=[])):
    """Subscribe only to batteries; inspect camera publishers without image subscriptions."""
    await websocket.accept()
    if len(battery) + len(camera) > 32:
        await close_observer_error(
            websocket, 'Too many status topics.', 'invalid_request', False)
        return
    bridge = app_state.get_ros2_bridge_or_none()
    if bridge is None:
        await close_observer_error(
            websocket, 'ROS bridge unavailable.', 'bridge_unavailable', True)
        return
    owner = SubscriptionOwner(bridge)

    async def stream():
        for topic in set(battery + camera):
            validate_topic(topic)
        for topic in set(battery):
            await asyncio.to_thread(owner.subscribe, topic, 'sensor_msgs/msg/BatteryState')
        await send_subscription_ready(websocket)
        while True:
            publishers = (await asyncio.to_thread(bridge.inspect_publishers, camera)
                          if camera else {})
            batteries = {topic: battery_percentage(bridge, topic) for topic in battery}
            cameras = {topic: publishers.get(topic) if publishers is not None else None
                       for topic in camera}
            if not await _send_websocket_data(websocket, {
                    'batteries': batteries, 'cameras': cameras}):
                return
            await asyncio.sleep(STATUS_INTERVAL)

    try:
        await run_until_disconnect(websocket, stream())
    except WebSocketDisconnect:
        pass
    except SubscriptionError as exc:
        await close_observer_error(websocket, str(exc), exc.code, exc.retryable)
    except Exception:
        await close_observer_error(
            websocket, 'System status unavailable.', 'subscription_unavailable', True)
    finally:
        await release_subscription_owner(owner)
        await _close_websocket_ignoring_error(websocket)
