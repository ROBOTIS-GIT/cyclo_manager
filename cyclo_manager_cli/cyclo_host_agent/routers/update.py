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
import subprocess
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/system', tags=['system'])

PYPI_PACKAGE = 'cyclo-manager'
HOST_AGENT_SERVICE = 'cyclo_host_agent'

# Stored result of the last update (survives across the server restart window)
_update_status: dict = {'phase': 'idle', 'install_output': '', 'up_output': '', 'error': ''}


def _fmt(cmd: str, out: str) -> str:
    return f'$ {cmd}\n{out.strip()}' if out.strip() else f'$ {cmd}'


def _restart_self() -> None:
    """Restart the host agent after a short delay so new binary takes effect."""
    time.sleep(2)
    try:
        subprocess.run(
            ['sudo', 'systemctl', 'restart', f'{HOST_AGENT_SERVICE}.service'],
            check=True,
        )
    except Exception as e:
        logger.error('Failed to restart host agent: %s', e)


async def _run_install_and_up(cyclo_exe: str, pip_exe: str) -> None:
    """Run pip install -U and cyclo up in background; store results in _update_status."""
    global _update_status

    # pip install -U
    _update_status['phase'] = 'installing'
    try:
        proc = await asyncio.create_subprocess_exec(
            pip_exe, 'install', '-U', PYPI_PACKAGE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        out = (stdout.decode() + stderr.decode()).strip()
        _update_status['install_output'] = _fmt(f'pip install -U {PYPI_PACKAGE}', out)
        if proc.returncode != 0:
            _update_status['phase'] = 'error'
            _update_status['error'] = f'pip install failed (exit {proc.returncode})'
            return
    except asyncio.TimeoutError:
        _update_status['phase'] = 'error'
        _update_status['error'] = 'pip install timed out'
        return

    # cyclo up
    _update_status['phase'] = 'starting'
    try:
        proc = await asyncio.create_subprocess_exec(
            cyclo_exe, 'up',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        out = (stdout.decode() + stderr.decode()).strip()
        _update_status['up_output'] = _fmt('cyclo_manager up', out)
        if proc.returncode != 0:
            _update_status['phase'] = 'error'
            _update_status['error'] = f'cyclo_manager up failed (exit {proc.returncode})'
            return
    except asyncio.TimeoutError:
        _update_status['phase'] = 'error'
        _update_status['error'] = 'cyclo_manager up timed out'
        return

    _update_status['phase'] = 'done'

    # Restart self so new binary takes effect
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _restart_self)


@router.post('/update')
async def start_update() -> dict:
    """
    Run cyclo down synchronously, then pip install + cyclo up in background.

    Returns cyclo down output immediately. The server goes down during this call;
    the host agent continues the remaining steps and stores results for /system/update/status.
    """
    global _update_status

    cyclo_exe = shutil.which('cyclo_manager')
    pip_exe = shutil.which('pip3') or shutil.which('pip')

    if not cyclo_exe:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail='cyclo_manager command not found')
    if not pip_exe:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail='pip not found')

    _update_status = {'phase': 'stopping', 'install_output': '', 'up_output': '', 'error': ''}

    # cyclo down (synchronous — server goes down here)
    down_output = ''
    try:
        proc = await asyncio.create_subprocess_exec(
            cyclo_exe, 'down',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        down_output = _fmt('cyclo_manager down', (stdout.decode() + stderr.decode()))
    except asyncio.TimeoutError:
        down_output = '$ cyclo_manager down\n(timed out)'
    except Exception as e:
        down_output = f'$ cyclo_manager down\n(error: {e})'

    # Continue install + up in background
    asyncio.create_task(_run_install_and_up(cyclo_exe, pip_exe))

    return {'down_output': down_output}


@router.get('/update/status')
async def get_update_status() -> dict:
    """Return the current update phase and stored outputs."""
    return _update_status


def _delayed_exec(cmd: list[str], delay: float = 2.0) -> None:
    time.sleep(delay)
    subprocess.run(cmd, check=False)


@router.post('/reboot')
async def reboot_host() -> dict:
    """Reboot the host machine after returning a response."""
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _delayed_exec, ['sudo', 'reboot'])
    return {'status': 'rebooting'}


@router.post('/shutdown')
async def shutdown_host() -> dict:
    """Shut down the host machine after returning a response."""
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _delayed_exec, ['sudo', 'poweroff'])
    return {'status': 'shutting_down'}
