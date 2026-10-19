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

"""WebSocket endpoint for service log streaming."""

import asyncio
from contextlib import aclosing
import logging

from cyclo_manager.agent.log_history import LOG_ID_PATTERN
from cyclo_manager.routers.websocket_utils import (
    _close_websocket_ignoring_error,
    _send_websocket_error,
    run_until_disconnect,
)
from cyclo_manager.state import app_state
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
import httpx

logger = logging.getLogger(__name__)

router = APIRouter()

INITIAL_LOG_TAIL = 5000
STREAM_RECONNECT_DELAY = 1.0


async def _setup_log_stream_client(websocket: WebSocket, container: str):
    """
    Validate config and return an AgentClient for the given container.

    Returns the AgentClient on success, or None after sending an error and
    closing the WebSocket.
    """
    config = app_state.get_config_or_none()
    if config is None:
        await _send_websocket_error(websocket, 'Configuration not loaded')
        await _close_websocket_ignoring_error(websocket)
        return None

    if container not in config.container_sockets:
        await _send_websocket_error(websocket, f"Container '{container}' not found")
        await _close_websocket_ignoring_error(websocket)
        return None

    client_pool = app_state.get_client_pool_or_none()
    if client_pool is None:
        await _send_websocket_error(websocket, 'Agent client pool not initialized')
        await _close_websocket_ignoring_error(websocket)
        return None

    client = client_pool.get_client(container)
    if client is None:
        await _send_websocket_error(
            websocket, f"Agent client for container '{container}' not available"
        )
        await _close_websocket_ignoring_error(websocket)
        return None

    return client


def _coerce_cursor(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


@router.websocket('/ws/{container}/services/{service}/logs')
async def websocket_service_logs(
    websocket: WebSocket,
    container: str,
    service: str,
    live: bool = False,
    log_id: str | None = Query(default=None, pattern=f'^{LOG_ID_PATTERN.pattern}$'),
    cursor: int | None = Query(default=None, ge=0),
    tail: int = Query(default=INITIAL_LOG_TAIL, ge=0, le=5000),
):
    """Forward extended events or legacy type/data messages, according to the request."""
    await websocket.accept()

    async def send_event(event):
        if live:
            await websocket.send_json(event)
        elif event['type'] in {'logs', 'error'}:
            key = 'logs' if event['type'] == 'logs' else 'message'
            await websocket.send_json({'type': event['type'], 'data': event.get(key, '')})

    error = None
    if not live and log_id is not None:
        error = 'log_id requires live=true.'
    elif live and (log_id is None) != (cursor is None):
        error = 'Live resume requires both log_id and cursor.'
    if error:
        await send_event({'type': 'error', 'message': error, 'retryable': False})
        await websocket.close(code=1008)
        return

    client = await _setup_log_stream_client(websocket, container)
    if client is None:
        return

    async def forward():
        last_cursor, last_log_id = cursor, log_id
        use_live = live
        checked = not live
        while True:
            try:
                if not checked:
                    history = await client.get_service_log_history(service)
                    use_live = history.get('supported', True)
                    checked = True
                    await websocket.send_json({'type': 'capabilities', 'history': use_live})
                    if not use_live:
                        # A dated cursor must never be applied to an unidentified legacy file.
                        last_log_id, last_cursor = None, None
                        await websocket.send_json({'type': 'reset', 'reason': 'legacy'})

                events = client.stream_service_logs(
                    service, tail=tail, cursor=last_cursor,
                    live=use_live, log_id=last_log_id,
                )
                async with aclosing(events):
                    async for event in events:
                        event_type = event.get('type', 'logs')
                        if event_type in {'logs', 'reset'}:
                            event_cursor = _coerce_cursor(event.get('cursor'))
                            if event_cursor is not None:
                                last_cursor = event_cursor
                                if use_live:
                                    last_log_id = event.get('log_id')
                                    if last_log_id is None:
                                        last_cursor = None
                        await send_event(event)
                        if event_type == 'error' and event.get('retryable') is False:
                            await websocket.close(code=1008)
                            return
                logger.warning(
                    'Agent log stream ended for %s/%s; reconnecting', container, service)
            except WebSocketDisconnect:
                return
            except Exception as exc:
                retryable = not (
                    isinstance(exc, httpx.HTTPStatusError)
                    and 400 <= exc.response.status_code < 500
                    and exc.response.status_code not in {408, 429}
                )
                if isinstance(exc, (httpx.HTTPStatusError, httpx.RequestError)):
                    logger.warning('Agent log stream error for %s/%s: %s', container, service, exc)
                else:
                    logger.exception('Unexpected log stream error for %s/%s', container, service)
                await send_event({
                    'type': 'error', 'source': 'connection',
                    'message': f'Error streaming logs: {exc}', 'retryable': retryable,
                })
                if not retryable:
                    await websocket.close(code=1008)
                    return
            await asyncio.sleep(STREAM_RECONNECT_DELAY)

    try:
        await run_until_disconnect(websocket, forward())
    except WebSocketDisconnect:
        pass
    finally:
        await _close_websocket_ignoring_error(websocket)
