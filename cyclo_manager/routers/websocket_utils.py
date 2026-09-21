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

"""Shared WebSocket send and close helpers."""

import asyncio
import logging

from anyio import CancelScope, to_thread
from fastapi import WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK

logger = logging.getLogger(__name__)


async def _send_websocket_error(websocket: WebSocket, message: str) -> bool:
    """
    Send error message via WebSocket.

    Returns
    -------
        True if message was sent successfully, False otherwise.

    """
    try:
        await websocket.send_json({'type': 'error', 'data': message})
        return True
    except (WebSocketDisconnect, RuntimeError, Exception):
        return False


async def _send_websocket_logs(
    websocket: WebSocket,
    logs: str,
) -> bool:
    """
    Send logs via WebSocket.

    Returns
    -------
        True if message was sent successfully, False otherwise.

    """
    try:
        await websocket.send_json({'type': 'logs', 'data': logs})
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False
    except Exception:
        return False


async def _send_websocket_data(websocket: WebSocket, data: dict) -> bool:
    """
    Send data message via WebSocket.

    Parameters
    ----------
    websocket:
        WebSocket connection.
    data:
        Data dictionary to send.

    Returns
    -------
        True if message was sent successfully, False otherwise.

    """
    try:
        if websocket.client_state.value != 1:
            logger.debug(f'WebSocket not connected (state: {websocket.client_state.value})')
            return False

        await websocket.send_json({'type': 'data', 'data': data})
        return True
    except (WebSocketDisconnect, ConnectionClosedOK, ConnectionClosedError, RuntimeError) as e:
        logger.debug(f'Failed to send data message, WebSocket likely closed: {e}')
        return False
    except Exception as e:
        logger.error(f'Unexpected error sending WebSocket data message: {e}', exc_info=True)
        return False


async def _close_websocket_ignoring_error(websocket: WebSocket) -> None:
    """
    Close WebSocket connection, ignoring any errors.

    This is useful for cleanup in exception handlers where the connection
    may already be closed or in an invalid state.

    """
    try:
        await websocket.close()
    except Exception:
        pass


async def run_until_disconnect(websocket, stream):
    """Stop a stream on disconnect even when no topic data changes or arrives."""
    async def receive():
        while True:
            message = await websocket.receive()
            if message['type'] == 'websocket.disconnect':
                return

    tasks = [asyncio.create_task(receive()), asyncio.create_task(stream)]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def release_subscription_owner(owner):
    """Finish cleanup even when the ASGI connection's cancellation scope is closed."""
    with CancelScope(shield=True):
        await to_thread.run_sync(owner.close)


async def send_subscription_ready(websocket):
    """Acknowledge subscription setup, even when no topic messages have arrived."""
    await websocket.send_json({'type': 'ready'})


async def close_observer_error(websocket, message, code, retryable):
    """Send machine-readable recovery policy before closing the observer."""
    try:
        await websocket.send_json({
            'type': 'error', 'data': message, 'code': code, 'retryable': retryable})
        await websocket.close(code=1013 if retryable else 1008)
    except Exception:
        pass
