"""Proxy diagnostics to the robot agent; never open a serial port here."""

import json
from urllib.parse import quote
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from fastapi.responses import StreamingResponse
import httpx
from starlette.background import BackgroundTask

from cyclo_manager.agent.routers.diagnostics import CalibrateTactile, ClearMultiTurn, StartDiagnostic
from cyclo_manager.routers.services import _raise_mapped_service_exception
from cyclo_manager.routers.websocket_utils import run_until_disconnect, close_observer_error
from cyclo_manager.state import get_agent_client, get_validated_container

router = APIRouter(tags=['diagnostics'])


async def request_agent(container, method, path, **kwargs):
    try:
        result = await get_agent_client(container).request_json(
            method, '/diagnostics' + path, timeout=httpx.Timeout(40, connect=5), **kwargs)
        return result
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {404, 405, 501} and path in {'/profiles', '/sessions/current', '/cameras/sessions/current', '/cameras/sessions'}:
            raise HTTPException(501, 'Update the AI Worker image: this agent does not support diagnostics') from exc
        if exc.response.status_code == 404 and path.endswith(('/calibrate-tactile', '/clear-multi-turn')):
            try:
                detail = exc.response.json().get('detail')
            except (ValueError, AttributeError):
                detail = None
            if detail == 'Not Found':
                return {'state': 'failed', 'message': 'The AI Worker agent does not support this command. Update and restart the agent.'}
        _raise_mapped_service_exception(container, exc)
    except Exception as exc:
        _raise_mapped_service_exception(container, exc)


@router.get('/{container}/diagnostics/profiles')
async def profiles(container: str = Depends(get_validated_container)):
    return await request_agent(container, 'GET', '/profiles')


@router.post('/{container}/diagnostics/cameras/sessions')
async def start_cameras(container: str = Depends(get_validated_container)):
    return await request_agent(container, 'POST', '/cameras/sessions')


@router.get('/{container}/diagnostics/cameras/sessions/current')
async def current_cameras(container: str = Depends(get_validated_container)):
    return await request_agent(container, 'GET', '/cameras/sessions/current')


@router.post('/{container}/diagnostics/cameras/sessions/{session_id}/stop')
async def stop_cameras(session_id: str, container: str = Depends(get_validated_container)):
    return await request_agent(container, 'POST', f'/cameras/sessions/{session_id}/stop')


@router.get('/{container}/diagnostics/cameras/sessions/{session_id}/cameras/{camera_id}/stream')
async def camera_stream(session_id: str, camera_id: str, view: Literal['color', 'depth'] = 'color', container: str = Depends(get_validated_container)):
    response = None
    try:
        http = await get_agent_client(container)._ensure_httpx_client()
        path = f'/diagnostics/cameras/sessions/{quote(session_id, safe="")}/cameras/{quote(camera_id, safe="")}/stream'
        request = http.build_request('GET', path, params={'view': view}, timeout=httpx.Timeout(10, connect=5))
        response = await http.send(request, stream=True)
        if response.is_error:
            await response.aread()
            response.raise_for_status()
    except Exception as exc:
        if response is not None:
            await response.aclose()
        _raise_mapped_service_exception(container, exc)

    async def forward():
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()

    return StreamingResponse(forward(), media_type='multipart/x-mixed-replace; boundary=frame',
                             headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'},
                             background=BackgroundTask(response.aclose))


@router.get('/{container}/diagnostics/profiles/{profile}')
async def inspect_profile(profile: str, container: str = Depends(get_validated_container)):
    return await request_agent(container, 'GET', f'/profiles/{profile}')


@router.post('/{container}/diagnostics/sessions')
async def start(request: StartDiagnostic, container: str = Depends(get_validated_container)):
    return await request_agent(container, 'POST', '/sessions', json=request.model_dump())


@router.get('/{container}/diagnostics/sessions/current')
async def current(container: str = Depends(get_validated_container)):
    return await request_agent(container, 'GET', '/sessions/current')


@router.post('/{container}/diagnostics/sessions/{session_id}/stop')
async def stop(session_id: str, container: str = Depends(get_validated_container)):
    return await request_agent(container, 'POST', f'/sessions/{session_id}/stop')


@router.post('/{container}/diagnostics/sessions/{session_id}/calibrate-tactile')
async def calibrate_tactile(session_id: str, request: CalibrateTactile, container: str = Depends(get_validated_container)):
    return await request_agent(container, 'POST', f'/sessions/{session_id}/calibrate-tactile', json=request.model_dump())


@router.post('/{container}/diagnostics/sessions/{session_id}/clear-multi-turn')
async def clear_multi_turn(session_id: str, request: ClearMultiTurn, container: str = Depends(get_validated_container)):
    return await request_agent(container, 'POST', f'/sessions/{session_id}/clear-multi-turn', json=request.model_dump())


@router.websocket('/ws/{container}/diagnostics/{session_id}')
async def stream(websocket: WebSocket, container: str, session_id: str):
    await websocket.accept()

    async def forward():
        client = get_agent_client(container)
        http = await client._ensure_httpx_client()
        async with http.stream('GET', f'/diagnostics/sessions/{session_id}/stream',
                               timeout=httpx.Timeout(40, connect=5)) as response:
            response.raise_for_status()
            await websocket.send_json({'type': 'ready'})
            async for line in response.aiter_lines():
                if not line:
                    continue
                session = json.loads(line)
                await websocket.send_json({'type': 'snapshot', 'data': session})
        await websocket.close(code=1000)

    try:
        await run_until_disconnect(websocket, forward())
    except Exception as exc:
        retryable = isinstance(exc, httpx.RequestError)
        await close_observer_error(websocket, str(exc), 'diagnostics_stream', retryable)
