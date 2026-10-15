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

"""Follow current logs, optionally reporting log identity and service state."""

import asyncio
import codecs
import json
import os
from pathlib import Path
import time

from cyclo_manager.agent.log_history import LOG_ID_PATTERN, MAX_PAGE_BYTES, read_log_page_from_file
from cyclo_manager.agent.s6_client import get_service_status
from cyclo_manager.agent.utils import strip_ansi_codes
from fastapi import HTTPException

POLL_INTERVAL = 0.1
STATUS_INTERVAL = 1.0
READ_RETRY_INTERVAL = 1.0
HEARTBEAT_INTERVAL = 15.0


def _log_id(root: Path, path: Path) -> str | None:
    """Get the dated folder name of a current link, or None for old layouts."""
    if (path.parent.parent == root.resolve() and path.name == 'current'
            and LOG_ID_PATTERN.fullmatch(path.parent.name)):
        return path.parent.name
    return None


def _read_forward(stream, cursor: int, final: bool) -> tuple[str, int]:
    """Read one bounded chunk, retaining incomplete UTF-8 bytes until the next read."""
    size = os.fstat(stream.fileno()).st_size
    stream.seek(cursor)
    data = stream.read(min(MAX_PAGE_BYTES, max(0, size - cursor)))
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    text = decoder.decode(data, final=final and cursor + len(data) == size)
    return text, cursor + len(data) - len(decoder.getstate()[0])


def _follow_current(root, name, requested_id, requested_cursor, tail, strip_ansi, live):
    """Keep the original current/offset loop; yield before opening a replacement file."""
    stream = None
    selected = None
    log_id = None
    cursor = 0
    first = True
    replacement = False
    observed = None
    producer_up = logger_up = False
    status_known = False
    status_time = float('-inf')
    status_target = None
    last_errors = {}

    def event(kind, **fields):
        return {'type': kind, 'log_id': log_id, 'cursor': cursor, **fields}

    def logs(text, start):
        return event('logs', start_cursor=start, end_cursor=cursor,
                     logs=strip_ansi_codes(text) if strip_ansi else text)

    def report_error(source, exc):
        message = exc.detail if isinstance(exc, HTTPException) else str(exc)
        identity = (type(exc).__name__, message)
        if last_errors.get(source) != identity:
            last_errors[source] = identity
            retryable = not (
                source == 'read' and isinstance(exc, HTTPException) and exc.status_code == 400)
            yield event('error', source=source, message=message, state='unknown',
                        retryable=retryable)

    def recover(source):
        if last_errors.pop(source, None) is not None:
            yield event('recovered', source=source)

    try:
        while True:
            try:
                target = (root / 'current').resolve()
                if live and (target != status_target or
                             time.monotonic() - status_time >= STATUS_INTERVAL):
                    status_time = time.monotonic()
                    status_target = target
                    try:
                        producer_up = get_service_status(name).is_up
                        logger_up = get_service_status(f'{name}-log').is_up
                        status_known = True
                        yield from recover('status')
                    except Exception as exc:
                        status_known = False
                        status_time = time.monotonic()
                        yield from report_error('status', exc)
                target_id = _log_id(root, target)
                changed = observed is not None and target != observed
                if observed is None:
                    observed = target

                if stream is not None and target != selected:
                    start = cursor
                    text, cursor = _read_forward(stream, cursor, final=True)
                    if cursor != start:
                        yield logs(text, start)
                        yield from recover('read')
                        yield None
                        continue
                    yield from recover('read')
                    yield event('state', state='stopped')
                    stream.close()
                    stream = None
                    first = False

                if stream is None:
                    resume = first and requested_cursor is not None and (
                        not live or requested_id == target_id)
                    active = status_known and (producer_up or logger_up)
                    if live and target_id is not None and not (active or changed or resume):
                        state = 'unknown' if not status_known else (
                            'waiting' if producer_up else 'stopped')
                        yield event('state', state=state)
                        yield None
                        continue
                    # Resolving once keeps the selected path and opened file consistent.
                    stream = target.open('rb', buffering=0)
                    selected, log_id = target, target_id
                    size = os.fstat(stream.fileno()).st_size
                    cursor = requested_cursor if resume and requested_cursor <= size else 0
                    # Fixed-path logs have no execution identity; reconnect with a fresh tail.
                    recent = first and (requested_cursor is None or (
                        live and target_id is None)) and (not live or not changed)
                    if recent:
                        page = read_log_page_from_file(stream, log_id, None, max(1, tail))
                        cursor = page['start_cursor'] if tail else page['end_cursor']
                        yield event('reset', reason='initial')
                        if tail:
                            start, cursor = cursor, page['end_cursor']
                            yield logs(page['logs'], start)
                    elif not resume or requested_cursor > size:
                        reason = ('truncated' if resume else
                                  'replaced' if replacement else 'new_log')
                        yield event('reset', reason=reason)
                    else:
                        # A supplied resume cursor must not split a UTF-8 character.
                        stream.seek(max(0, cursor - 4))
                        decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
                        decoder.decode(stream.read(min(cursor, 4)), final=False)
                        if decoder.getstate()[0] and (not status_known or active or cursor < size):
                            raise HTTPException(400, 'Cursor splits a UTF-8 character.')
                    first = False
                    replacement = False
                    observed = target

                opened = os.fstat(stream.fileno())
                if target.exists() and target.stat().st_ino != opened.st_ino:
                    stream.close()
                    stream = None
                    first = False
                    replacement = True
                    yield None
                    continue
                if opened.st_size < cursor:
                    cursor = 0
                    yield event('reset', reason='truncated')
                start = cursor
                final = live and status_known and not producer_up and not logger_up
                text, cursor = _read_forward(stream, cursor, final)
                if cursor != start:
                    yield logs(text, start)
                yield from recover('read')
                caught_up = cursor >= os.fstat(stream.fileno()).st_size
                state = ('unknown' if not status_known else 'running' if producer_up else
                         'stopping' if logger_up or not caught_up else 'stopped')
                yield event('state', state=state)
            except FileNotFoundError:
                # The logger changes its link before opening the new current file.
                pass
            except Exception as exc:
                yield from report_error('read', exc)
                if isinstance(exc, HTTPException) and exc.status_code == 400:
                    return
                yield READ_RETRY_INTERVAL
                continue
            yield None
    finally:
        if stream is not None:
            stream.close()


def _next_event(iterator):
    """Avoid passing StopIteration through an asyncio Future."""
    return next(iterator, False)


async def stream_service_log_events(
    root: Path, name: str, log_id: str | None, cursor: int | None,
    tail: int, strip_ansi: bool, live: bool = False,
):
    """Use one reader for both protocols, with file I/O off the event loop."""
    reader = _follow_current(root, name, log_id, cursor, tail, strip_ansi, live)
    last_event = time.monotonic() - HEARTBEAT_INTERVAL
    last_state = None
    position = {'log_id': None, 'cursor': 0}
    pending = None
    try:
        while True:
            pending = asyncio.create_task(asyncio.to_thread(_next_event, reader))
            event = await asyncio.shield(pending)
            if event is False:
                return
            if event is None or isinstance(event, float):
                await asyncio.sleep(POLL_INTERVAL if event is None else event)
                if time.monotonic() - last_event < HEARTBEAT_INTERVAL:
                    continue
                event = {'type': 'heartbeat', **position}
            position = {key: event[key] for key in ('log_id', 'cursor')}
            if event['type'] == 'state':
                state = (event['log_id'], event['state'])
                if not live or state == last_state:
                    continue
                last_state = state
            if not live:
                if event['type'] in {'reset', 'recovered'}:
                    continue
                event = {key: value for key, value in event.items()
                         if key in {'type', 'cursor', 'logs', 'message', 'retryable'}}
            elif event['type'] == 'heartbeat':
                event['state'] = last_state[1] if last_state else 'unknown'
            yield (json.dumps(event) + '\n').encode('utf-8')
            last_event = time.monotonic()
    finally:
        if pending is not None and not pending.done():
            def close_after_read(task):
                if not task.cancelled():
                    task.exception()
                    reader.close()
            pending.add_done_callback(close_after_read)
        else:
            reader.close()
