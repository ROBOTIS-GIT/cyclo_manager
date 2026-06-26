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

"""Terminal endpoints router."""

import asyncio
import json
import logging
import os
import uuid as uuid_module

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/terminal', tags=['terminal'])


@router.websocket('/{name}/ws')
async def terminal_ws(
    name: str,
    websocket: WebSocket,
    session_id: str = Query(default=''),
) -> None:
    """Open a WebSocket terminal backed by a persistent docker exec bash session."""
    from cyclo_manager.state import app_state
    session_manager = app_state.get_terminal_session_manager_or_none()
    if session_manager is None:
        await websocket.accept()
        await websocket.close(code=1011, reason='Terminal session manager not available')
        return

    await websocket.accept()

    sid = session_id or uuid_module.uuid4().hex[:12]
    t1 = t2 = None

    try:
        rows, cols = 24, 80
        try:
            first_msg = await asyncio.wait_for(websocket.receive(), timeout=3.0)
            if first_msg.get('text'):
                payload = json.loads(first_msg['text'])
                if payload.get('type') == 'resize':
                    rows = int(payload.get('rows', 24))
                    cols = int(payload.get('cols', 80))
        except Exception:
            pass

        master_fd = session_manager.attach_pty(name, sid, rows, cols)

        loop = asyncio.get_running_loop()

        async def pty_to_ws() -> None:
            try:
                while True:
                    data = await loop.run_in_executor(
                        None, session_manager.read_pty, sid, 4096,
                    )
                    if not data:
                        break
                    await websocket.send_bytes(data)
            except (OSError, EOFError):
                pass
            except Exception:
                pass

        async def ws_to_pty() -> None:
            try:
                while True:
                    msg = await websocket.receive()
                    if msg['type'] == 'websocket.disconnect':
                        break
                    if msg.get('bytes'):
                        os.write(master_fd, msg['bytes'])
                    elif msg.get('text'):
                        try:
                            payload = json.loads(msg['text'])
                            if payload.get('type') == 'resize':
                                session_manager.resize(
                                    sid,
                                    int(payload.get('rows', 24)),
                                    int(payload.get('cols', 80)),
                                )
                            elif payload.get('type') == 'replay':
                                replay = session_manager.replay(sid)
                                if replay:
                                    await websocket.send_bytes(replay)
                        except Exception:
                            pass
            except (WebSocketDisconnect, RuntimeError):
                pass

        t1 = asyncio.create_task(pty_to_ws())
        t2 = asyncio.create_task(ws_to_pty())
        await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)

    except Exception as e:
        logger.error("Terminal WS error for container '%s': %s", name, e)
        try:
            await websocket.send_bytes(f'\r\nError: {e}\r\n'.encode())
        except Exception:
            pass
    finally:
        for task in [t for t in [t1, t2] if t and not t.done()]:
            task.cancel()
        session_manager.detach_websocket(sid)
        try:
            await websocket.close()
        except Exception:
            pass


@router.delete('/{name}/{session_id}')
async def close_terminal_session(name: str, session_id: str) -> dict:
    """Explicitly kill a terminal session (called when user closes a tab)."""
    from cyclo_manager.state import app_state
    session_manager = app_state.get_terminal_session_manager_or_none()
    if session_manager:
        session_manager.close(session_id)
    return {'result': 'ok'}
