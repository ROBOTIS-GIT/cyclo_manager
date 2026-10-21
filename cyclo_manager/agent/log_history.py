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

"""Read bounded pages from append-only, dated service log files."""

import codecs
from contextlib import ExitStack
import errno
import os
from pathlib import Path
import re
import stat
from typing import BinaryIO

from fastapi import HTTPException

LOG_ID_PATTERN = re.compile(r'[0-9]{4}(?:_[0-9]{2}){4}(?:_[0-9]+)?')
MAX_PAGE_BYTES = 256 * 1024


def open_history_log(root: Path, log_id: str) -> BinaryIO:
    """Open a regular history log without following directory or file symlinks."""
    if not LOG_ID_PATTERN.fullmatch(log_id):
        raise HTTPException(400, 'Invalid log ID.')
    try:
        with ExitStack() as stack:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            root_fd = os.open(root, flags)
            stack.callback(os.close, root_fd)
            log_fd = os.open(log_id, flags, dir_fd=root_fd)
            stack.callback(os.close, log_fd)
            fd = os.open(
                'current', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=log_fd,
            )
            stream = os.fdopen(fd, 'rb')
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                stream.close()
                raise HTTPException(404, 'Log file is unavailable.')
            return stream
    except OSError as exc:
        if exc.errno in {errno.ENOENT, errno.ENOTDIR, errno.ELOOP}:
            raise HTTPException(404, 'Log not found or already removed.') from exc
        raise HTTPException(500, 'Could not open log file.') from exc


def list_log_history(root: Path) -> dict:
    """List dated logs newest first; the current link does not imply running."""
    history = []
    if root.is_symlink():
        raise HTTPException(404, 'Service log directory is unavailable.')
    try:
        for entry in root.iterdir():
            if not LOG_ID_PATTERN.fullmatch(entry.name):
                continue
            try:
                with open_history_log(root, entry.name) as stream:
                    size = os.fstat(stream.fileno()).st_size
            except HTTPException as exc:
                if exc.status_code == 404:
                    continue
                raise
            history.append({'log_id': entry.name, 'size_bytes': size})
    except FileNotFoundError:
        pass
    history.sort(key=lambda entry: tuple(map(int, entry['log_id'].split('_'))), reverse=True)
    current_log_id = None
    try:
        target = (root / 'current').resolve(strict=True)
        for entry in history:
            if target == root.resolve() / entry['log_id'] / 'current':
                current_log_id = entry['log_id']
                break
    except (OSError, RuntimeError):
        pass
    return {'history': history, 'current_log_id': current_log_id}


def read_log_page(root: Path, log_id: str, before: int | None, lines: int) -> dict:
    """Read backwards from an exclusive byte cursor within a bounded window."""
    with open_history_log(root, log_id) as stream:
        return read_log_page_from_file(stream, log_id, before, lines)


def read_log_page_from_file(
    stream: BinaryIO, log_id: str, before: int | None, lines: int,
) -> dict:
    """Read a page using an already open file so snapshots and streams share identity."""
    size = os.fstat(stream.fileno()).st_size
    end = size if before is None else before
    if end > size:
        raise HTTPException(409, 'Log file was truncated; reload this log.')
    start = max(0, end - MAX_PAGE_BYTES)
    stream.seek(start)
    data = stream.read(end - start)
    if len(data) != end - start:
        raise HTTPException(409, 'Log file changed while reading; reload this log.')

    # A byte-limited window may start inside a UTF-8 character.
    offset = 0
    if start:
        while offset < min(3, len(data)) and 0x80 <= data[offset] <= 0xBF:
            offset += 1
    data = data[offset:]
    start += offset
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    decoder.decode(data, final=False)
    pending = len(decoder.getstate()[0])
    if before is not None and pending:
        raise HTTPException(400, 'Cursor must be on a UTF-8 character boundary.')
    if pending:
        # Leave a character still being written for the next live read.
        data = data[:-pending]
        end -= pending

    # Ignore the last terminator when counting backwards through lines.
    position = len(data) - 1 if data.endswith(b'\n') else len(data)
    for _ in range(lines):
        position = data.rfind(b'\n', 0, position)
        if position < 0:
            break
    if position >= 0:
        start += position + 1
        data = data[position + 1:]
    elif start > 0:
        # Prefer whole lines; split only a line larger than the byte limit.
        newline = data.find(b'\n')
        if 0 <= newline < len(data) - 1:
            start += newline + 1
            data = data[newline + 1:]

    starts_mid_line = False
    if start:
        stream.seek(start - 1)
        starts_mid_line = stream.read(1) != b'\n'
    return {
        'log_id': log_id,
        'logs': data.decode('utf-8', errors='replace'),
        'start_cursor': start,
        'end_cursor': end,
        'has_more_before': start > 0,
        'starts_mid_line': starts_mid_line,
        'ends_mid_line': bool(data) and not data.endswith(b'\n'),
    }


def iter_log_download(stream: BinaryIO, size: int):
    """Yield a fixed-size snapshot and close the file, even after cancellation."""
    try:
        remaining = size
        while remaining:
            chunk = stream.read(min(MAX_PAGE_BYTES, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        stream.close()
