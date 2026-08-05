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

"""Router for log management endpoints."""

import asyncio
import json
import logging
from pathlib import Path
import subprocess
from typing import Optional

from cyclo_manager.agent.utils import strip_ansi_codes
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/services', tags=['services'])

LOG_STREAM_POLL_INTERVAL = 0.1
LOG_STREAM_HEARTBEAT_INTERVAL = 15.0
LOG_BASE_PATH = Path('/var/log')


def _get_service_log_path(name: str) -> Path:
    """Return the s6 current log path for a service name."""
    if name in {'', '.', '..'} or '/' in name or '\\' in name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Invalid service name: {name!r}',
        )
    return LOG_BASE_PATH / name / 'current'


def _tail_log_file(log_path: Path, tail: int, strip_ansi: bool) -> tuple[str, int, int]:
    """Return the last tail lines, current byte cursor, and inode."""
    result = subprocess.run(
        ['tail', '-n', str(tail), str(log_path)],
        capture_output=True,
        text=True,
        timeout=5,
    )
    if result.returncode != 0:
        logger.error(f'Failed to tail log file {log_path}: {result.stderr}')
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to read log file: {result.stderr}',
        )
    stat = log_path.stat()
    logs = strip_ansi_codes(result.stdout) if strip_ansi else result.stdout
    return logs, stat.st_size, stat.st_ino


def _read_log_file_from_cursor(
    log_path: Path, cursor: int, strip_ansi: bool
) -> tuple[str, int, int]:
    """Read log bytes from cursor, returning decoded logs, new cursor, and inode."""
    stat = log_path.stat()
    if cursor < 0 or cursor > stat.st_size:
        cursor = 0
    with log_path.open('rb') as f:
        f.seek(cursor)
        logs_bytes = f.read()
        new_cursor = f.tell()
    logs = logs_bytes.decode('utf-8', errors='replace')
    logs = strip_ansi_codes(logs) if strip_ansi else logs
    return logs, new_cursor, stat.st_ino


def _encode_log_stream_event(
    event_type: str,
    cursor: int,
    logs: str = '',
    message: Optional[str] = None,
) -> bytes:
    """Encode one log stream event as NDJSON."""
    payload: dict[str, object] = {'type': event_type, 'cursor': cursor}
    if logs:
        payload['logs'] = logs
    if message:
        payload['message'] = message
    return (json.dumps(payload) + '\n').encode('utf-8')


def _iter_stripped_log_file(log_path: Path):
    """Yield log file lines with ANSI escape codes removed."""
    with log_path.open('r', encoding='utf-8', errors='replace') as f:
        for line in f:
            yield strip_ansi_codes(line).encode('utf-8')


@router.get(
    '/{name}/logs/stream',
    summary='Stream service logs',
    description='Stream service logs from a byte cursor as newline-delimited JSON.',
)
async def stream_service_logs(
    name: str,
    tail: int = 100,
    strip_ansi: bool = False,
    cursor: Optional[int] = None,
):
    """
    Stream logs for a service as NDJSON events.

    Each event has ``logs`` and ``cursor`` fields. The cursor is a byte offset in
    /var/log/{service_name}/current and can be passed back on reconnect.
    """
    log_path = _get_service_log_path(name)

    async def generate():
        current_cursor = cursor
        inode: Optional[int] = None
        last_event_time = asyncio.get_running_loop().time()

        if not log_path.exists():
            yield _encode_log_stream_event('heartbeat', 0)
            last_event_time = asyncio.get_running_loop().time()
        while not log_path.exists():
            if (
                asyncio.get_running_loop().time() - last_event_time
                >= LOG_STREAM_HEARTBEAT_INTERVAL
            ):
                yield _encode_log_stream_event('heartbeat', 0)
                last_event_time = asyncio.get_running_loop().time()
            await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)

        try:
            if current_cursor is None:
                logs, current_cursor, inode = await asyncio.to_thread(
                    _tail_log_file,
                    log_path,
                    tail,
                    strip_ansi,
                )
            else:
                logs, current_cursor, inode = await asyncio.to_thread(
                    _read_log_file_from_cursor,
                    log_path,
                    current_cursor,
                    strip_ansi,
                )
            yield _encode_log_stream_event('logs', current_cursor, logs=logs)
            last_event_time = asyncio.get_running_loop().time()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Error initializing log stream for service '{name}': {e}")
            yield _encode_log_stream_event(
                'error',
                0,
                message=f'Error initializing log stream: {str(e)}',
            )
            current_cursor = 0

        while True:
            try:
                if not log_path.exists():
                    current_cursor = 0
                    inode = None
                    await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)
                    continue

                stat = log_path.stat()
                if inode is None:
                    inode = stat.st_ino
                if stat.st_ino != inode or current_cursor is None or stat.st_size < current_cursor:
                    inode = stat.st_ino
                    current_cursor = 0

                if stat.st_size > current_cursor:
                    logs, current_cursor, inode = await asyncio.to_thread(
                        _read_log_file_from_cursor,
                        log_path,
                        current_cursor,
                        strip_ansi,
                    )
                    if logs:
                        yield _encode_log_stream_event('logs', current_cursor, logs=logs)
                        last_event_time = asyncio.get_running_loop().time()
                elif (
                    asyncio.get_running_loop().time() - last_event_time
                    >= LOG_STREAM_HEARTBEAT_INTERVAL
                ):
                    yield _encode_log_stream_event('heartbeat', current_cursor)
                    last_event_time = asyncio.get_running_loop().time()

                await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Error streaming logs for service '{name}': {e}")
                yield _encode_log_stream_event(
                    'error',
                    current_cursor or 0,
                    message=f'Error streaming logs: {str(e)}',
                )
                await asyncio.sleep(1.0)

    return StreamingResponse(
        generate(),
        media_type='application/x-ndjson',
    )


@router.get(
    '/{name}/logs/download',
    summary='Download service log',
    description='Download the current s6 log file with ANSI escape codes removed.',
)
async def download_service_log(name: str):
    """Download /var/log/{service_name}/current as a plain text log file."""
    log_path = _get_service_log_path(name)

    if not log_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f'Log file not found for service {name!r}. '
                "Service may not have logging enabled or log directory doesn't exist."
            ),
        )

    return StreamingResponse(
        _iter_stripped_log_file(log_path),
        media_type='text/plain; charset=utf-8',
    )


@router.delete(
    '/{name}/logs',
    summary='Clear service logs',
    description='Clear (truncate) logs for a service',
)
async def clear_service_logs(name: str):
    """
    Clear logs for a service.

    Truncates the log file at /var/log/{service_name}/current to clear all logs.
    Note: s6-log will continue writing new logs to this file after clearing.

    Args
    ----
    name: Service name.

    Returns
    -------
    Dictionary with service name and success message.

    Raises
    ------
    HTTPException: 404 if service not found or logs unavailable, 500 on other errors.

    """
    log_path = _get_service_log_path(name)

    if not log_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f'Log file not found for service {name!r}. '
                "Service may not have logging enabled or log directory doesn't exist."
            ),
        )

    try:
        # Truncate the log file (clear all contents)
        log_path.open('w').close()
        logger.info(f"Successfully cleared logs for service '{name}'")

        return {
            'service': name,
            'message': 'Logs cleared successfully',
            'log_path': str(log_path),
        }
    except Exception as e:
        logger.error(f"Error clearing logs for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to clear logs: {str(e)}',
        )
