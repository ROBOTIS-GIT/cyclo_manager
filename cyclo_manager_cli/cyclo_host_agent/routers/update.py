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
import codecs
import os
import signal
import sys

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix='/system', tags=['system'])

_update_status: dict = {'phase': 'idle', 'output': '', 'error': ''}
UPDATE_TIMEOUT_SECONDS = 600
UPDATE_OUTPUT_LIMIT = 200_000


def _append_output(job: dict, text: str) -> None:
    """Keep a bounded tail of output available while the command is running."""
    job['output'] = (job['output'] + text.replace('\r', '\n'))[-UPDATE_OUTPUT_LIMIT:]


async def _collect_output(proc: asyncio.subprocess.Process, job: dict) -> None:
    """Read progress in chunks, including partial lines and split UTF-8 characters."""
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    while chunk := await proc.stdout.read(4096):
        _append_output(job, decoder.decode(chunk))
    _append_output(job, decoder.decode(b'', final=True))
    await proc.wait()


async def _stop_update_process(proc: asyncio.subprocess.Process | None, job: dict) -> None:
    """Stop the isolated command group and drain remaining output with a time limit."""
    if proc is None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        if stdout:
            _append_output(job, stdout.decode(errors='replace'))
    except asyncio.TimeoutError:
        pass


@router.get('/version')
async def get_host_agent_version() -> dict:
    """Return the running cyclo_host_agent package version."""
    from cyclo_manager_cli import __version__

    return {'version': __version__}


async def _run_update() -> None:
    job = _update_status
    proc = None
    try:
        env = os.environ.copy()
        env.update({
            'PYTHONUNBUFFERED': '1',
            'PIP_PROGRESS_BAR': 'off',
            'COMPOSE_PROGRESS': 'plain',
            'COMPOSE_ANSI': 'never',
        })
        proc = await asyncio.create_subprocess_exec(
            sys.executable, '-u', '-m', 'cyclo_manager_cli.cli', 'update',
            env=env,
            start_new_session=True,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        await asyncio.wait_for(_collect_output(proc, job), timeout=UPDATE_TIMEOUT_SECONDS)
        if proc.returncode != 0:
            job['phase'] = 'error'
            job['error'] = f'cyclo_manager update failed (exit {proc.returncode})'
        else:
            job['phase'] = 'done'
    except asyncio.TimeoutError:
        await _stop_update_process(proc, job)
        job['phase'] = 'error'
        job['error'] = 'cyclo_manager update timed out'
    except asyncio.CancelledError:
        await _stop_update_process(proc, job)
        job['phase'] = 'error'
        job['error'] = 'cyclo_manager update was cancelled'
        raise
    except Exception as e:
        await _stop_update_process(proc, job)
        job['phase'] = 'error'
        job['error'] = f'Failed to run cyclo_manager update: {e}'


@router.post('/update')
async def start_update() -> dict:
    """Run cyclo_manager update in the background."""
    global _update_status

    if _update_status.get('phase') == 'updating':
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail='Update already in progress')

    _update_status = {'phase': 'updating', 'output': '', 'error': ''}
    asyncio.create_task(_run_update())
    return {'status': 'update started'}


@router.get('/update/status')
async def get_update_status() -> dict:
    """Return the current update phase and stored outputs."""
    return _update_status
