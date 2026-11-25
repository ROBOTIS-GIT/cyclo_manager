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

import logging
import os
from pathlib import Path
from typing import Optional

from cyclo_manager.agent.log_history import (
    iter_log_download,
    list_log_history,
    LOG_ID_PATTERN,
    open_history_log,
    read_log_page,
)
from cyclo_manager.agent.log_stream import stream_service_log_events
from cyclo_manager.agent.utils import strip_ansi_codes
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/services', tags=['services'])

LOG_BASE_PATH = Path('/var/log')


def _get_service_log_path(name: str) -> Path:
    """Return the s6 current log path for a service name."""
    if name in {'', '.', '..'} or '/' in name or '\\' in name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Invalid service name: {name!r}',
        )
    return LOG_BASE_PATH / name / 'current'


def _iter_stripped_log_file(log_path: Path):
    """Yield log file lines with ANSI escape codes removed."""
    with log_path.open('r', encoding='utf-8', errors='replace') as f:
        for line in f:
            yield strip_ansi_codes(line).encode('utf-8')


def _read_log_tail(log_path: Path, lines: int) -> tuple[str, int]:
    """Read the last lines and cursor from the same open file and fixed byte range."""
    # GNU tail treats negative counts as their absolute value.
    lines = abs(lines)
    with log_path.open('rb') as stream:
        end = os.fstat(stream.fileno()).st_size
        if lines == 0:
            return '', end
        start = end
        chunks = []
        newlines = 0
        while start > 0 and newlines <= lines:
            size = min(start, 64 * 1024)
            start -= size
            stream.seek(start)
            chunk = stream.read(size)
            if len(chunk) != size:
                raise HTTPException(409, 'Log file changed while reading; retry without cursor.')
            chunks.append(chunk)
            newlines += chunk.count(b'\n')

    data = b''.join(reversed(chunks))
    position = len(data) - 1 if data.endswith(b'\n') else len(data)
    for _ in range(lines):
        position = data.rfind(b'\n', 0, position)
        if position < 0:
            break
    if position >= 0:
        data = data[position + 1:]
    # Preserve the universal newline handling of the original text-mode tail call.
    text = data.decode('utf-8', errors='replace').replace('\r\n', '\n').replace('\r', '\n')
    return text, end


@router.get(
    '/{name}/logs',
    summary='Get service logs',
    description='Retrieve logs for a service from s6-overlay log directory',
)
def get_service_logs(
    name: str, tail: int = 100, strip_ansi: bool = False, cursor: Optional[int] = None
):
    """
    Get logs for a service.

    Reads logs from /var/log/{service_name}/current (s6-overlay log directory).
    Missing log files return empty logs and cursor 0 for compatibility with 0.3.0.

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
    HTTPException: 400 for invalid service names, 409 if the initial read is
        truncated concurrently, 500 on read errors.

    """
    log_path = _get_service_log_path(name)

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
                logger.warning(
                    f'Cursor {cursor} is beyond file size {current_size} '
                    f'for service {name!r}, resetting to current size'
                )
                cursor = current_size

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
            logs, new_cursor = _read_log_tail(log_path, tail)
            logs = strip_ansi_codes(logs) if strip_ansi else logs

            return {
                'service': name,
                'logs': logs,
                'tail': tail,
                'cursor': new_cursor,
                'log_path': str(log_path),
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reading logs for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to read logs: {str(e)}',
        )


@router.get('/{name}/logs/history', summary='List service log history')
def get_service_log_history(name: str):
    """List dated log folders; current_log_id identifies a link, not service status."""
    return list_log_history(_get_service_log_path(name).parent)


@router.get('/{name}/logs/history/{log_id}', summary='Read a service log history page')
def get_service_log_history_page(
    name: str,
    log_id: str,
    before: Optional[int] = Query(default=None, ge=0),
    lines: int = Query(default=500, ge=1, le=5000),
):
    """Read recent lines or a page before an exclusive byte cursor, up to 256 KiB."""
    return read_log_page(_get_service_log_path(name).parent, log_id, before, lines)


@router.get(
    '/{name}/logs/history/{log_id}/download', summary='Download a service log history entry',
)
def download_service_log_history(name: str, log_id: str):
    """Download original bytes up to the file size captured when the request opens."""
    stream = open_history_log(_get_service_log_path(name).parent, log_id)
    size = os.fstat(stream.fileno()).st_size
    return StreamingResponse(
        iter_log_download(stream, size),
        media_type='text/plain; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="{log_id}.log"'},
        background=BackgroundTask(stream.close),
    )


@router.get(
    '/{name}/logs/stream',
    summary='Stream service logs',
    description='Stream service logs from a byte cursor as newline-delimited JSON.',
)
async def stream_service_logs(
    name: str,
    tail: int = Query(default=100, ge=0, le=5000),
    strip_ansi: bool = False,
    cursor: Optional[int] = Query(default=None, ge=0),
    live: bool = False,
    log_id: Optional[str] = None,
):
    """
    Stream logs for a service as NDJSON events.

    Each event has ``logs`` and ``cursor`` fields. The cursor is a byte offset in
    /var/log/{service_name}/current and can be passed back on reconnect.
    Opt into dated live logs with ``live=true``; resume with both log_id and cursor.
    """
    log_path = _get_service_log_path(name)
    if live:
        if (log_id is None) != (cursor is None):
            raise HTTPException(400, 'Live resume requires both log_id and cursor.')
        if log_id is not None and not LOG_ID_PATTERN.fullmatch(log_id):
            raise HTTPException(400, 'Invalid log ID.')
    elif log_id is not None:
        raise HTTPException(400, 'log_id requires live=true.')
    return StreamingResponse(
        stream_service_log_events(
            log_path.parent, name, log_id, cursor, tail, strip_ansi, live=live,
        ),
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
