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

"""ttyd subprocess manager for per-container web terminal sessions."""

import logging
import socket
import subprocess
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

_PORT_START = 17000


class TtydManager:
    """Manages multiple ttyd processes, one per terminal session."""

    def __init__(self, port_start: int = _PORT_START) -> None:
        self._procs: dict[str, subprocess.Popen] = {}   # session_id -> proc
        self._ports: dict[str, int] = {}                # session_id -> port
        self._port_start = port_start

    def create_session(self, container: str) -> tuple[str, int]:
        """Spawn a new ttyd process and return (session_id, port).

        Each session gets a unique ID used as the tmux session name so that
        reconnecting to the same tab re-attaches to the same shell.
        """
        session_id = uuid.uuid4().hex[:12]
        port = self._allocate_port()
        # Each tab gets its own tmux session (named by session_id) for persistence.
        # Falls back to bash if tmux is not installed in the target container.
        shell_cmd = (
            f"command -v tmux >/dev/null 2>&1 "
            f"&& exec tmux new-session -A -s {session_id} "
            f"|| exec bash"
        )
        proc = subprocess.Popen(
            ["/usr/bin/ttyd", "-p", str(port), "-W",
             "/usr/bin/docker", "exec", "-it", container, "/bin/sh", "-c", shell_cmd],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._procs[session_id] = proc
        self._ports[session_id] = port
        logger.info(
            "Created ttyd session '%s' for container '%s' on port %d",
            session_id, container, port,
        )
        return session_id, port

    def get_port(self, session_id: str) -> Optional[int]:
        """Return the port for a live session, or None if it has died."""
        proc = self._procs.get(session_id)
        if proc is not None and proc.poll() is None:
            return self._ports[session_id]
        self._procs.pop(session_id, None)
        self._ports.pop(session_id, None)
        return None

    def close_session(self, session_id: str) -> bool:
        """Terminate a specific session. Returns True if it existed."""
        if session_id not in self._procs:
            return False
        self._terminate(session_id)
        logger.info("Closed ttyd session '%s'", session_id)
        return True

    def stop_all(self) -> None:
        """Terminate all sessions (called on app shutdown)."""
        for sid in list(self._procs.keys()):
            self._terminate(sid)

    def _terminate(self, session_id: str) -> None:
        proc = self._procs.pop(session_id, None)
        self._ports.pop(session_id, None)
        if proc is None or proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    def _allocate_port(self) -> int:
        used = set(self._ports.values())
        port = self._port_start
        while port in used or self._port_in_use(port):
            port += 1
        return port

    @staticmethod
    def _port_in_use(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(("127.0.0.1", port)) == 0
