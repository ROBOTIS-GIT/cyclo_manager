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

"""Ordered jog input and feedback; no leader arbitration or automatic restart."""

import asyncio
import logging

from cyclo_manager.jog import JogInput, JogSession
from cyclo_manager.state import app_state
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from starlette.websockets import WebSocketState

router = APIRouter()
logger = logging.getLogger(__name__)
INPUT_TIMEOUT = 0.4
ROBOT_TYPES = {'sg2', 'bg2', 'sh5', 'bh5', 'f1', 'f2', 'mobile'}


@router.websocket('/ws/jog/{robot_type}')
async def websocket_jog(websocket: WebSocket, robot_type: str):
    """Process ordered jog inputs and stop when the input stream ends."""
    await websocket.accept()
    bridge = app_state.get_ros2_bridge_or_none()
    if bridge is None or robot_type not in ROBOT_TYPES:
        await websocket.send_json({'error': 'ROS bridge or robot model unavailable.'})
        await websocket.close(code=1008)
        return
    session = JogSession(bridge, robot_type)
    watchdog_armed = False
    try:
        await asyncio.to_thread(session.setup)
        while True:
            try:
                # A stopped session may stay idle in a background tab. Only
                # active motion requires the operator's input heartbeat.
                raw = await asyncio.wait_for(
                    websocket.receive_json(), INPUT_TIMEOUT if watchdog_armed else None)
                command = JogInput.model_validate(raw)
            except asyncio.TimeoutError:
                await asyncio.to_thread(session.stop)
                await websocket.close(code=1008, reason='Jog input timed out')
                break
            except (ValidationError, ValueError):
                await asyncio.to_thread(session.stop)
                await websocket.close(code=1008, reason='Invalid jog input')
                break
            error = None
            try:
                await asyncio.to_thread(session.apply, command)
            except ValueError as exc:
                error = str(exc)
                try:
                    await asyncio.to_thread(session.stop)
                except ValueError:
                    logger.warning('Jog stop could not reach the controller')
            if command.kind == 'stop':
                watchdog_armed = False
            elif command.kind in ('base', 'joint'):
                watchdog_armed = True
            elif not any(session.base) and session.active_joint is None:
                watchdog_armed = False
            state = await asyncio.to_thread(session.snapshot)
            await asyncio.wait_for(
                websocket.send_json({'state': state, 'error': error}), INPUT_TIMEOUT)
            if error:
                await websocket.close(code=1008, reason='Jog stopped after command error')
                break
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception('Jog connection failed')
        try:
            await asyncio.wait_for(
                websocket.send_json({'error': str(exc) or 'Jog connection failed.'}),
                INPUT_TIMEOUT)
        except Exception:
            pass
    finally:
        try:
            await asyncio.to_thread(session.stop)
        except Exception:
            logger.exception(
                'Could not send final jog stop; last joint targets remain; base timeout applies')
        try:
            # A peer can leave before the opening handshake finishes. Once
            # disconnected, the legacy transport must not be closed again.
            if (websocket.client_state != WebSocketState.DISCONNECTED
                    and websocket.application_state != WebSocketState.DISCONNECTED):
                await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
