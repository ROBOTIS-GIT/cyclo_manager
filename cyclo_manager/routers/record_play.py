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

"""Record & Play API; the server owns one job across all browser clients."""

import asyncio
from typing import Literal

from cyclo_manager.routers.websocket_utils import (
    _close_websocket_ignoring_error, _send_websocket_error,
    release_subscription_owner, run_until_disconnect, send_subscription_ready,
)
from cyclo_manager.state import app_state, get_agent_client
from cyclo_manager.subscriptions import SubscriptionOwner
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix='/record-play', tags=['record-play'])
Robot = Literal['sg2', 'bg2', 'sh5', 'bh5', 'f1', 'f2', 'mobile']


class OwnerInput(BaseModel):
    """Identify the originating page for job attribution."""

    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    owner: str = Field(min_length=1, max_length=100)


class RecordInput(OwnerInput):
    """Select a display name and available controller groups."""

    name: str = Field(min_length=1, max_length=80, pattern=r'.*\S.*')
    robot: Robot
    groups: list[Literal['arm_l', 'arm_r', 'head', 'lift', 'hand_l', 'hand_r']] = Field(
        min_length=1, max_length=6)


class PlaybackInput(OwnerInput):
    """Configure total passes and time scaling for a stored bag."""

    recording_id: str = Field(pattern=r'^[0-9a-f]{32}$')
    robot: Robot
    rate: Literal[0.5, 1.0] = 1.0
    repeats: int = Field(default=1, ge=0, le=10000)


def service():
    """Resolve the lifespan-owned Record & Play service."""
    if app_state.record_play is None:
        raise HTTPException(503, 'Record & Play unavailable. Check ROS and recording storage.')
    return app_state.record_play


async def bringup():
    """Read agent health without treating errors as a running robot."""
    try:
        result = await asyncio.wait_for(
            get_agent_client('ai_worker').get_service_status('ai_worker_bringup'), 1.5)
        running = bool(result.get('is_up'))
    except Exception:
        running = False
    if app_state.record_play:
        app_state.record_play.set_bringup(running)
    return running


async def monitor_bringup():
    """Watch running jobs independently of browser polling."""
    while True:
        if app_state.record_play and app_state.record_play.status()['active']:
            await bringup()
        await asyncio.sleep(0.5)


async def execute(function, *args, **kwargs):
    """Run blocking job commands outside the API event loop."""
    try:
        await asyncio.to_thread(function, *args, **kwargs)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (OSError, ImportError) as exc:
        raise HTTPException(
            503, f'Recording storage or ROS bag support unavailable: {exc}') from exc
    return service().status()


@router.get('')
async def overview(robot: Robot):
    """Return the shared job, robot groups and persisted library."""
    manager = service()
    running = await bringup()
    try:
        groups, recordings = await asyncio.gather(
            asyncio.to_thread(manager.catalog, robot), asyncio.to_thread(manager.store.list))
    except (ValueError, OSError) as exc:
        raise HTTPException(503, str(exc)) from exc
    return {'state': manager.status(), 'groups': groups, 'recordings': recordings,
            'bringup': running, 'storage': str(manager.store.root)}


@router.get('/status')
def status():
    """Read the server-owned job without affecting its lifetime."""
    return service().status()


@router.post('/record')
async def record(body: RecordInput):
    """Record selected incoming trajectories while bringup is running."""
    manager = service()
    if not await bringup():
        raise HTTPException(409, 'Start robot bringup before recording.')
    return await execute(manager.record, body.name.strip(), body.robot, body.groups, body.owner)


@router.post('/play')
async def play(body: PlaybackInput):
    """Move to the start pose, then replay with optional synchronized returns."""
    manager = service()
    if not await bringup():
        raise HTTPException(409, 'Start robot bringup before playback.')
    return await execute(manager.motion, body.recording_id, body.robot, body.owner,
                         rate=body.rate, repeats=body.repeats)


@router.post('/stop')
async def stop(body: OwnerInput | None = None):
    """Stop even when bringup checks or the original client are unavailable."""
    # Stop remains available even after bringup/client status fails.
    return await execute(service().stop, owner=body.owner if body else None)


@router.websocket('/watch/{robot}')
async def watch_catalog(websocket: WebSocket, robot: Robot):
    """Keep catalog inputs subscribed only while this page is connected."""
    await websocket.accept()
    subscriptions = None
    try:
        manager = service()
        subscriptions = SubscriptionOwner(manager.bridge)

        async def stream():
            await asyncio.to_thread(manager.catalog, robot, subscriptions)
            await send_subscription_ready(websocket)
            while True:
                await asyncio.to_thread(manager.catalog, robot, subscriptions)
                await asyncio.sleep(.5)

        await run_until_disconnect(websocket, stream())
    except WebSocketDisconnect:
        pass
    except Exception:
        await _send_websocket_error(websocket, 'Record & Play topic monitoring unavailable.')
    finally:
        if subscriptions is not None:
            await release_subscription_owner(subscriptions)
        await _close_websocket_ignoring_error(websocket)
