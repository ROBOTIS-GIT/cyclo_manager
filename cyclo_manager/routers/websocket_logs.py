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
import logging

from cyclo_manager.routers.websocket_utils import (
    _close_websocket_ignoring_error,
    _send_websocket_error,
    _send_websocket_logs,
)
from cyclo_manager.state import app_state
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
    if isinstance(value, int):
        return value
    return None


@router.websocket('/ws/{container}/services/{service}/logs')
async def websocket_service_logs(
    websocket: WebSocket,
    container: str,
    service: str,
):
    """Stream service logs in real-time over a WebSocket connection."""
    await websocket.accept()
    logger.info(f'WebSocket connection established for {container}/{service} logs')

    client = await _setup_log_stream_client(websocket, container)
    if client is None:
        return

    last_cursor: int | None = None

    try:
        while True:
            try:
                async for event in client.stream_service_logs(
                    service,
                    tail=INITIAL_LOG_TAIL,
                    cursor=last_cursor,
                ):
                    event_type = event.get('type', 'logs')
                    event_cursor = _coerce_cursor(event.get('cursor'))
                    if event_cursor is not None:
                        last_cursor = event_cursor

                    if event_type == 'heartbeat':
                        continue
                    if event_type == 'error':
                        message = event.get('message') or 'Log stream error'
                        if not await _send_websocket_error(websocket, str(message)):
                            return
                        continue
                    if event_type != 'logs':
                        logger.warning(
                            'Unknown log stream event type for %s/%s: %s',
                            container,
                            service,
                            event_type,
                        )
                        continue

                    logs = event.get('logs', '')
                    if not await _send_websocket_logs(websocket, logs):
                        logger.info(f'WebSocket disconnected for {container}/{service}')
                        return
                logger.warning(f'Agent log stream ended for {container}/{service}; reconnecting')
                await asyncio.sleep(STREAM_RECONNECT_DELAY)
            except WebSocketDisconnect:
                logger.info(f'WebSocket disconnected for {container}/{service}')
                return
            except Exception as e:
                logger.error(
                    f'Agent log stream error for {container}/{service}: {e}',
                    exc_info=True,
                )
                if not await _send_websocket_error(websocket, f'Error streaming logs: {str(e)}'):
                    return
                await asyncio.sleep(STREAM_RECONNECT_DELAY)

    except WebSocketDisconnect:
        logger.info(f'WebSocket disconnected normally for {container}/{service}')
    except Exception as e:
        logger.error(f'Unexpected WebSocket error for {container}/{service}: {e}', exc_info=True)
        await _close_websocket_ignoring_error(websocket)
