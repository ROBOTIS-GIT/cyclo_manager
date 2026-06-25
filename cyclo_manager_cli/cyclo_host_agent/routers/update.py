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

"""System-level endpoints for the host agent."""

import asyncio
import logging
import shutil

from fastapi import APIRouter, HTTPException, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/system', tags=['system'])

_update_status: dict = {'phase': 'idle', 'output': '', 'error': ''}


async def _run_update(cyclo_exe: str) -> None:
    global _update_status
    try:
        proc = await asyncio.create_subprocess_exec(
            cyclo_exe, 'update',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
        out = (stdout.decode() + stderr.decode()).strip()
        _update_status['output'] = out
        if proc.returncode != 0:
            _update_status['phase'] = 'error'
            _update_status['error'] = f'cyclo_manager update failed (exit {proc.returncode})'
        else:
            _update_status['phase'] = 'done'
    except asyncio.TimeoutError:
        _update_status['phase'] = 'error'
        _update_status['error'] = 'cyclo_manager update timed out'


@router.post('/update')
async def start_update() -> dict:
    """Delegate update to cyclo_manager update, which handles containers and host agent restart."""
    global _update_status

    cyclo_exe = shutil.which('cyclo_manager')
    if not cyclo_exe:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail='cyclo_manager command not found')

    if _update_status.get('phase') == 'updating':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail='Update already in progress')

    _update_status = {'phase': 'updating', 'output': '', 'error': ''}
    asyncio.create_task(_run_update(cyclo_exe))
    return {'status': 'update started'}


@router.get('/update/status')
async def get_update_status() -> dict:
    """Return the current update phase and stored outputs."""
    return _update_status


