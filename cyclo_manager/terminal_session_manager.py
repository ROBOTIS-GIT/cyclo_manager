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
Manage persistent bash sessions via tmux in cyclo_manager.

Architecture:
  WebSocket → PTY → tmux attach (in cyclo_manager)
                      ↕  tmux socket
                    tmux session → docker exec -it <container> bash

Navigating away: only the WebSocket/PTY/attach dies.
                 tmux session + docker exec + bash keep running.
Closing a tab:   bash is killed via its container-namespace PID,
                 then the tmux session is killed.
"""

import glob
import logging
import os
import re
import subprocess

logger = logging.getLogger(__name__)

_TMUX_PREFIX = 'cm_'
_META_DIR = '/tmp'

# container and session_id are interpolated into a shell command in
# get_or_create(); restrict them to a safe character set to block injection.
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


class TerminalSessionManager:
    """Keeps docker exec bash sessions alive across WebSocket disconnects."""

    def get_or_create(self, container: str, session_id: str) -> str:
        """Return tmux session name, creating it if not alive."""
        _validate(container, session_id)
        tmux_name = _TMUX_PREFIX + session_id
        if self._is_alive(tmux_name):
            return tmux_name

        try:
            with open(_meta_file(session_id), 'w') as f:
                f.write(container)
        except IOError as e:
            logger.warning('Could not write meta file: %s', e)

        # bash writes its container-namespace PID on startup so close() can kill it later.
        # 'exec /bin/bash' replaces the -c subshell while keeping the same PID.
        pid_path = _pid_file_in_container(session_id)
        inner_cmd = f'echo $$ > {pid_path}; exec /bin/bash'
        start_cmd = (
            f'/usr/bin/docker exec -it {container} /bin/bash '
            "-c '" + inner_cmd + "'"
        )
        result = subprocess.run(
            ['tmux', 'new-session', '-d', '-s', tmux_name, '/bin/sh', '-c', start_cmd],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 and not self._is_alive(tmux_name):
            raise RuntimeError(
                f'tmux session creation failed: {result.stderr.strip()}'
            )
        logger.info("Created tmux session '%s' for container '%s'", tmux_name, container)
        return tmux_name

    def close(self, session_id: str) -> None:
        """Kill bash in the container, then kill the tmux session."""
        if not _SESSION_ID_RE.match(session_id or ''):
            logger.warning('Ignoring close() for invalid session id: %r', session_id)
            return
        tmux_name = _TMUX_PREFIX + session_id

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

        if self._is_alive(tmux_name):
            subprocess.run(
                ['tmux', 'kill-session', '-t', tmux_name], capture_output=True
            )
            logger.info("Killed tmux session '%s'", tmux_name)

        try:
            os.unlink(_meta_file(session_id))
        except FileNotFoundError:
            pass

    def close_all(self) -> None:
        """Kill all sessions tracked by meta files."""
        for path in glob.glob(f'{_META_DIR}/.cm_meta_*'):
            session_id = os.path.basename(path).removeprefix('.cm_meta_')
            self.close(session_id)

    @staticmethod
    def _is_alive(tmux_name: str) -> bool:
        return subprocess.run(
            ['tmux', 'has-session', '-t', tmux_name], capture_output=True
        ).returncode == 0
