"""Diagnostic execution API. Bringup gating belongs to the Manager UI."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, StrictInt, field_validator

from cyclo_manager.agent.diagnostics_process import configuration, sessions
from cyclo_manager.agent.camera_diagnostics_process import camera_sessions
from cyclo_manager.diagnostics.robot.profiles import PROFILES

router = APIRouter(prefix='/diagnostics', tags=['diagnostics'])


@router.post('/cameras/sessions')
async def start_cameras():
    try:
        return await camera_sessions.start()
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get('/cameras/sessions/current')
async def current_cameras():
    return dict(session=camera_sessions.current)


@router.post('/cameras/sessions/{session_id}/stop')
async def stop_cameras(session_id: str):
    try:
        return await camera_sessions.stop(session_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get('/cameras/sessions/{session_id}/cameras/{camera_id}/stream')
async def camera_stream(session_id: str, camera_id: str, view: Literal['color', 'depth'] = 'color'):
    try:
        frames = camera_sessions.camera_stream(session_id, camera_id, view)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return StreamingResponse(frames, media_type='multipart/x-mixed-replace; boundary=frame',
                             headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


class StartDiagnostic(BaseModel):
    profile: str
    ports: dict[str, str] = Field(default_factory=dict)
    baud_rates: dict[str, StrictInt] = Field(default_factory=dict)

    @field_validator('profile')
    @classmethod
    def valid_profile(cls, value):
        if value not in PROFILES:
            raise ValueError('Unknown diagnostic profile')
        return value

    @field_validator('baud_rates')
    @classmethod
    def valid_baud_rates(cls, value):
        if len(value) > 16 or any(not k or '=' in k or '\x00' in k or len(k) > 128
                                 or rate <= 0 for k, rate in value.items()):
            raise ValueError('Invalid system/baud rate override')
        return value
    @field_validator('ports')
    @classmethod
    def valid_ports(cls, value):
        if len(value) > 16 or any(not k or '=' in k or len(k) > 128
                                 or not p.startswith('/dev/') or len(p) > 512
                                 or '\x00' in p for k, p in value.items()):
            raise ValueError('Invalid system/port override')
        return value


class CalibrateTactile(BaseModel):
    model_config = {'extra': 'forbid'}
    system: str = Field(min_length=1, max_length=128)
    controller_id: StrictInt = Field(ge=0, le=252)
    device_id: StrictInt = Field(ge=0, le=252)


class ClearMultiTurn(BaseModel):
    model_config = {'extra': 'forbid'}
    system: str = Field(min_length=1, max_length=128)
    device_id: StrictInt = Field(ge=0, le=252)


@router.get('/profiles')
async def profiles():
    try:
        return await configuration('--list-profiles')
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get('/profiles/{profile}')
async def inspect_profile(profile: str):
    if profile not in PROFILES:
        raise HTTPException(404, 'Unknown profile')
    try:
        return await configuration('--profile', profile, '--inspect')
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post('/sessions')
async def start(request: StartDiagnostic):
    try:
        return await sessions.start(request.profile, request.ports, request.baud_rates)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get('/sessions/current')
async def current():
    return dict(session=sessions.current)


@router.post('/sessions/{session_id}/stop')
async def stop(session_id: str):
    try:
        return await sessions.stop(session_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post('/sessions/{session_id}/calibrate-tactile')
async def calibrate_tactile(session_id: str, request: CalibrateTactile):
    try:
        return await sessions.calibrate_tactile(session_id, request.system, request.controller_id, request.device_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post('/sessions/{session_id}/clear-multi-turn')
async def clear_multi_turn(session_id: str, request: ClearMultiTurn):
    try:
        return await sessions.clear_multi_turn(session_id, request.system, request.device_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get('/sessions/{session_id}/stream')
async def stream(session_id: str):
    if not sessions.current or sessions.current['id'] != session_id:
        raise HTTPException(404, 'Diagnostic session not found')
    return StreamingResponse(sessions.stream(session_id), media_type='application/x-ndjson')
