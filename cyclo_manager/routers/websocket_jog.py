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

"""Jog input and status transport; ROS cadence belongs to the session controller."""

import asyncio
import logging

from anyio import CancelScope
from cyclo_manager.jog import JogInput
from cyclo_manager.jog_stream import JogController, INPUT_TIMEOUT
from cyclo_manager.state import app_state
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from starlette.websockets import WebSocketState

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket('/ws/jog')
@router.websocket('/ws/jog/{robot_type}')
async def websocket_jog(websocket: WebSocket, robot_type: str = 'ros'):
    """Receive current intent and stream status independently of ROS publishing."""
    await websocket.accept()
    bridge = app_state.get_ros2_bridge_or_none()
    if bridge is None:
        await websocket.send_json({'error': 'ROS bridge or robot model unavailable.'})
        await websocket.close(code=1008)
        return
    runtime = app_state.robot_runtime
    if runtime is None:
        await websocket.send_json({'error': 'Robot bringup monitoring unavailable.'})
        await websocket.close(code=1013)
        return
    controller = JogController(bridge, runtime)

    async def receive():
        while True:
            try:
                command = JogInput.model_validate(await websocket.receive_json())
            except (ValidationError, ValueError) as exc:
                raise ValueError('Invalid jog input') from exc
            controller.update(command)

    async def send():
        while True:
            state = await controller.states.get()
            try:
                await asyncio.wait_for(websocket.send_json(state), INPUT_TIMEOUT)
            except asyncio.TimeoutError as exc:
                raise ValueError('Jog feedback send timed out') from exc

    tasks = [asyncio.create_task(controller.run()), asyncio.create_task(receive()),
             asyncio.create_task(send())]
    error = None
    close_code = 1000
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    except ValueError as exc:
        error, close_code = str(exc), 1008
    except Exception as exc:
        logger.exception('Jog connection failed')
        error, close_code = str(exc) or 'Jog connection failed.', 1011
    finally:
        # Join the publishing thread and stop before releasing subscriptions/ownership.
        with CancelScope(shield=True):
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            if error and websocket.client_state != WebSocketState.DISCONNECTED:
                await asyncio.wait_for(websocket.send_json({'error': error}), INPUT_TIMEOUT)
        except (RuntimeError, WebSocketDisconnect, asyncio.TimeoutError):
            pass
        try:
            if (websocket.client_state != WebSocketState.DISCONNECTED
                    and websocket.application_state != WebSocketState.DISCONNECTED):
                await websocket.close(code=close_code)
        except (RuntimeError, WebSocketDisconnect):
            pass
