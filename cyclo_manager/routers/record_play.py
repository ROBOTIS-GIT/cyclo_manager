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

from cyclo_manager.record_play.bags import RecordingNotFoundError
from cyclo_manager.state import app_state
from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix='/record_play', tags=['record_play'])
Robot = str


class OwnerInput(BaseModel):
    """Identify the originating page for job attribution."""

    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    owner: str = Field(min_length=1, max_length=100)


class RecordInput(OwnerInput):
    """Select a display name and available controller groups."""

    name: str = Field(min_length=1, max_length=80, pattern=r'.*\S.*')
    robot: Robot = 'ros'
    groups: list[str] = Field(
        min_length=1, max_length=64)


class PlaybackInput(OwnerInput):
    """Configure total passes, time scaling and arrival tolerances."""

    recording_id: str = Field(pattern=r'^[0-9a-f]{32}$')
    robot: Robot = 'ros'
    rate: float = Field(default=1.0, ge=0.5, le=1.5)
    repeats: int = Field(default=1, ge=0, le=10000)
    arrival_tolerance_deg: Literal[3.0, 5.0] = 3.0
    arrival_tolerance_cm: Literal[1.0, 2.0, 3.0] = 1.0


def service():
    """Resolve the lifespan-owned Record & Play service."""
    if app_state.record_play is None:
        raise HTTPException(503, 'Record & Play unavailable. Check ROS and recording storage.')
    return app_state.record_play


async def execute(function, *args, **kwargs):
    """Run blocking job commands outside the API event loop."""
    try:
        await asyncio.to_thread(function, *args, **kwargs)
    except RecordingNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (OSError, ImportError) as exc:
        raise HTTPException(
            503, f'Recording storage or ROS bag support unavailable: {exc}') from exc
    return service().status()


@router.get('')
async def overview(robot: Robot = 'ros'):
    """Return the shared job, robot groups and persisted library."""
    manager = service()
    try:
        groups, recordings = await asyncio.gather(
            asyncio.to_thread(manager.catalog, robot),
            asyncio.to_thread(manager.store.list_recordings))
    except (ValueError, OSError) as exc:
        raise HTTPException(503, str(exc)) from exc
    return {'state': manager.status(), 'groups': groups, 'recordings': recordings,
            'storage': str(manager.store.root)}


@router.get('/status')
def status():
    """Read the server-owned job without affecting its lifetime."""
    return service().status()


@router.post('/record')
async def record(body: RecordInput):
    """Record discovered trajectory topics without requiring robot feedback."""
    manager = service()
    return await execute(manager.record, body.name.strip(), body.robot,
                         body.groups, body.owner)


@router.post('/play')
async def play(body: PlaybackInput):
    """Move to the start pose, then replay with optional synchronized returns."""
    manager = service()
    return await execute(manager.motion, body.recording_id, body.robot, body.owner,
                         rate=body.rate, repeats=body.repeats,
                         arrival_tolerance_deg=body.arrival_tolerance_deg,
                         arrival_tolerance_cm=body.arrival_tolerance_cm)


@router.post('/stop')
async def stop(body: OwnerInput | None = None):
    """Stop even when ROS feedback or the original client are unavailable."""
    # Stop remains available even after feedback/client status fails.
    return await execute(service().stop, owner=body.owner if body else None)


@router.delete('/recordings/{recording_id}')
async def delete_recording(recording_id: str = Path(pattern=r'^[0-9a-f]{32}$')):
    """Delete one saved recording and return the current server job state."""
    return await execute(service().delete, recording_id)
