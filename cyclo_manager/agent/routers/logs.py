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


@router.get(
    '/{name}/logs',
    summary='Get service logs',
    description='Retrieve logs for a service from s6-overlay log directory',
)
async def get_service_logs(
    name: str, tail: int = 100, strip_ansi: bool = False, cursor: Optional[int] = None
):
    """
    Get logs for a service.

    Reads logs from /var/log/{service_name}/current (s6-overlay log directory).
    If the log file doesn't exist or the service doesn't have logging enabled,
    returns an appropriate error.

    Args
    ----
    name: Service name.
    tail: Number of log lines to return from the end. Defaults to 100.
        Ignored if cursor is provided.
    strip_ansi: If True, remove ANSI escape codes (color/formatting) from the output.
    cursor: Byte offset in the log file. If provided, returns logs from this offset
        to the end of the file. This is more efficient for streaming logs.

    Returns
    -------
    Dictionary with service name, logs content, tail count (or cursor), and new cursor.

    Raises
    ------
    HTTPException: 404 if service not found or logs unavailable, 500 on other errors.

    """
    # s6-overlay logs are stored in /var/log/{service_name}/current
    log_path = Path(f'/var/log/{name}/current')

    if not log_path.exists():
        # Return empty logs instead of 404 when log file doesn't exist
        logger.debug(f"Log file not found for service '{name}', returning empty logs")
        return {
            'service': name,
            'logs': '',
            'tail': tail if cursor is None else None,
            'cursor': 0,
            'log_path': str(log_path),
        }

    try:
        # If cursor is provided, read from that offset (more efficient for streaming)
        if cursor is not None:
            # Get current file size for validation
            current_size = log_path.stat().st_size

            if cursor < 0:
                cursor = 0
            if cursor > current_size:
                # Cursor is beyond file size (file was truncated or rotated)
                cursor = current_size
                logger.warning(
                    f'Cursor {cursor} is beyond file size {current_size} '
                    f'for service {name!r}, resetting to current size'
                )

            # Read from cursor to end of file
            with log_path.open('rb') as f:
                f.seek(cursor)
                logs_bytes = f.read()
                # IMPORTANT: Get the actual position after reading to prevent duplication
                new_cursor = f.tell()
                logs = logs_bytes.decode('utf-8', errors='replace')

            logs = strip_ansi_codes(logs) if strip_ansi else logs

            return {
                'service': name,
                'logs': logs,
                'cursor': new_cursor,
                'log_path': str(log_path),
            }
        else:
            # Fallback to tail command for backward compatibility
            result = subprocess.run(
                ['tail', '-n', str(tail), str(log_path)],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0:
                logger.error(f"Failed to read logs for service '{name}': {result.stderr}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f'Failed to read log file: {result.stderr}',
                )

            # Get cursor AFTER tail command finishes to be as accurate as possible
            current_size = log_path.stat().st_size
            logs = strip_ansi_codes(result.stdout) if strip_ansi else result.stdout

            return {
                'service': name,
                'logs': logs,
                'tail': tail,
                'cursor': current_size,
                'log_path': str(log_path),
            }

    except subprocess.TimeoutExpired:
        logger.error(f"Timeout reading logs for service '{name}'")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Timeout reading log file',
        )
    except Exception as e:
        logger.error(f"Error reading logs for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to read logs: {str(e)}',
        )


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
    log_path = Path(f'/var/log/{name}/current')

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
    # s6-overlay logs are stored in /var/log/{service_name}/current
    log_path = Path(f'/var/log/{name}/current')

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
