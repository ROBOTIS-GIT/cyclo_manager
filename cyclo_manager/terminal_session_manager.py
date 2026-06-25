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

"""
Manage persistent bash sessions for the web terminal.

Architecture:
  WebSocket → PTY → docker exec -it <container> bash

Navigating away: WebSocket closes, PTY + bash keep running (background drain thread).
Closing a tab:   bash is killed via its container-namespace PID, PTY is closed.
"""

from dataclasses import dataclass, field
import fcntl
import glob
import logging
import os
import pty
import re
import select
import struct
import subprocess
import termios
import threading
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_META_DIR = '/tmp'

# container and session_id are interpolated into a shell command in
# attach_pty(); restrict them to a safe character set to block injection.
_NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]*$')
_SESSION_ID_RE = re.compile(r'^[A-Za-z0-9]+$')


def _validate(container: str, session_id: str) -> None:
    """Reject inputs that could break out of the shell command. Raises ValueError."""
    if not _NAME_RE.match(container or ''):
        raise ValueError(f'Invalid container name: {container!r}')
    if not _SESSION_ID_RE.match(session_id or ''):
        raise ValueError(f'Invalid session id: {session_id!r}')


def _meta_file(session_id: str) -> str:
    return f'{_META_DIR}/.cm_meta_{session_id}'


def _pid_file_in_container(session_id: str) -> str:
    return f'/tmp/.cm_{session_id}'


def _set_winsize(master_fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


_MAX_BUFFER_BYTES = 512 * 1024


@dataclass
class _LiveSession:
    container: str
    session_id: str
    master_fd: int
    proc: subprocess.Popen
    lock: threading.Lock = field(default_factory=threading.Lock)
    draining: bool = False
    drain_thread: Optional[threading.Thread] = None
    output_buffer: bytearray = field(default_factory=bytearray)

    def record_output(self, data: bytes) -> None:
        if not data:
            return
        with self.lock:
            self.output_buffer.extend(data)
            if len(self.output_buffer) > _MAX_BUFFER_BYTES:
                del self.output_buffer[:-_MAX_BUFFER_BYTES]

    def replay_output(self) -> bytes:
        with self.lock:
            return bytes(self.output_buffer)

    def start_drain(self) -> None:
        with self.lock:
            if self.draining or self.proc.poll() is not None:
                return
            self.draining = True

            def _drain() -> None:
                while True:
                    with self.lock:
                        if not self.draining or self.proc.poll() is not None:
                            break
                        fd = self.master_fd
                    try:
                        ready, _, _ = select.select([fd], [], [], 0.5)
                        if not ready:
                            continue
                        data = os.read(fd, 4096)
                        if not data:
                            break
                        with self.lock:
                            if self.draining:
                                self.output_buffer.extend(data)
                                if len(self.output_buffer) > _MAX_BUFFER_BYTES:
                                    del self.output_buffer[:-_MAX_BUFFER_BYTES]
                    except OSError:
                        break
                with self.lock:
                    self.draining = False

            self.drain_thread = threading.Thread(target=_drain, daemon=True)
            self.drain_thread.start()

    def read_and_record(self, size: int = 4096) -> bytes:
        try:
            data = os.read(self.master_fd, size)
        except OSError:
            return b''
        if data:
            self.record_output(data)
        return data

    def stop_drain(self) -> None:
        with self.lock:
            self.draining = False
        if self.drain_thread and self.drain_thread.is_alive():
            self.drain_thread.join(timeout=1.0)
        self.drain_thread = None

    def close(self) -> None:
        self.stop_drain()
        if self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=2)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        try:
            os.close(self.master_fd)
        except OSError:
            pass


class TerminalSessionManager:
    """Keeps docker exec bash sessions alive across WebSocket disconnects."""

    def __init__(self) -> None:
        self._sessions: Dict[str, _LiveSession] = {}
        self._lock = threading.Lock()

    def replay(self, session_id: str) -> bytes:
        with self._lock:
            session = self._sessions.get(session_id)
        if session and session.proc.poll() is None:
            return session.replay_output()
        return b''

    def attach_pty(self, container: str, session_id: str, rows: int, cols: int) -> int:
        """Return PTY master fd connected to bash in the container."""
        _validate(container, session_id)

        with self._lock:
            existing = self._sessions.pop(session_id, None)

        if existing:
            if existing.proc.poll() is None:
                existing.stop_drain()
                _set_winsize(existing.master_fd, rows, cols)
                with self._lock:
                    self._sessions[session_id] = existing
                return existing.master_fd
            existing.close()

        try:
            with open(_meta_file(session_id), 'w') as f:
                f.write(container)
        except IOError as e:
            logger.warning('Could not write meta file: %s', e)

        master_fd, slave_fd = pty.openpty()
        _set_winsize(master_fd, rows, cols)

        pid_path = _pid_file_in_container(session_id)
        inner_cmd = f'echo $$ > {pid_path}; exec /bin/bash'
        proc = subprocess.Popen(
            ['/usr/bin/docker', 'exec', '-it', container, '/bin/bash', '-c', inner_cmd],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid,
            close_fds=True,
            env={**os.environ, 'TERM': 'xterm-256color'},
        )
        os.close(slave_fd)

        session = _LiveSession(
            container=container,
            session_id=session_id,
            master_fd=master_fd,
            proc=proc,
        )
        with self._lock:
            self._sessions[session_id] = session
        logger.info(
            "Started terminal session '%s' for container '%s' (pid %s)",
            session_id, container, proc.pid,
        )
        return master_fd

    def read_pty(self, session_id: str, size: int = 4096) -> bytes:
        with self._lock:
            session = self._sessions.get(session_id)
        if not session or session.proc.poll() is not None:
            return b''
        return session.read_and_record(size)

    def detach_websocket(self, session_id: str) -> None:
        """Keep bash running after the browser disconnects."""
        with self._lock:
            session = self._sessions.get(session_id)
        if session and session.proc.poll() is None:
            session.start_drain()

    def resize(self, session_id: str, rows: int, cols: int) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
        if session and session.proc.poll() is None:
            _set_winsize(session.master_fd, rows, cols)

    def close(self, session_id: str) -> None:
        """Kill bash in the container, then close the local PTY session."""
        if not _SESSION_ID_RE.match(session_id or ''):
            logger.warning('Ignoring close() for invalid session id: %r', session_id)
            return

        container = None
        try:
            with open(_meta_file(session_id)) as f:
                container = f.read().strip()
        except FileNotFoundError:
            pass

        if container:
            pid_path = _pid_file_in_container(session_id)
            r = subprocess.run(
                ['/usr/bin/docker', 'exec', container, 'cat', pid_path],
                capture_output=True, text=True,
            )
            if r.returncode == 0 and r.stdout.strip().isdigit():
                bash_pid = r.stdout.strip()
                subprocess.run(
                    ['/usr/bin/docker', 'exec', container, 'kill', '-9', bash_pid],
                    capture_output=True,
                )
                subprocess.run(
                    ['/usr/bin/docker', 'exec', container, 'rm', '-f', pid_path],
                    capture_output=True,
                )
                logger.info("Killed bash (PID %s) in container '%s'", bash_pid, container)

        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session:
            session.close()
            logger.info("Closed terminal session '%s'", session_id)

        try:
            os.unlink(_meta_file(session_id))
        except FileNotFoundError:
            pass

    def close_all(self) -> None:
        """Kill all known sessions (in-memory and any orphaned meta files)."""
        with self._lock:
            session_ids = set(self._sessions.keys())
        for path in glob.glob(f'{_META_DIR}/.cm_meta_*'):
            session_ids.add(os.path.basename(path).removeprefix('.cm_meta_'))
        for session_id in session_ids:
            self.close(session_id)
