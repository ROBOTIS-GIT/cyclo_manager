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

"""Cyclo host agent: FastAPI server on Unix Domain Socket for host-level operations."""

import asyncio
import logging
import os
import signal
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, Request, Response

from cyclo_host_agent.routers import repos

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

SOCKET_PATH = '/var/run/robotis/agent_sockets/host/host_agent.sock'
IDLE_TIMEOUT = 60  # seconds of inactivity before the process shuts down

# First file descriptor passed by systemd socket activation (POSIX standard)
_SD_LISTEN_FDS_START = 3

_last_request_at: float = 0.0


def _systemd_fd() -> Optional[int]:
    """
    Return the socket fd passed by systemd socket activation, or None.

    systemd sets LISTEN_PID (current process PID) and LISTEN_FDS (number of
    passed fds) to communicate the socket fd to the service process.
    """
    try:
        listen_pid = int(os.environ.get('LISTEN_PID', 0))
        listen_fds = int(os.environ.get('LISTEN_FDS', 0))
    except ValueError:
        return None
    if listen_pid == os.getpid() and listen_fds >= 1:
        return _SD_LISTEN_FDS_START
    return None


async def _idle_watchdog() -> None:
    """
    Send SIGTERM after IDLE_TIMEOUT seconds of inactivity.

    Checks every 5 seconds. After shutdown the socket is reclaimed by systemd,
    which will restart the process on the next incoming connection.
    """
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(5)
        if loop.time() - _last_request_at >= IDLE_TIMEOUT:
            logger.info('No requests for %ds, shutting down', IDLE_TIMEOUT)
            os.kill(os.getpid(), signal.SIGTERM)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the idle watchdog on startup and cancel it on shutdown."""
    global _last_request_at
    _last_request_at = asyncio.get_running_loop().time()
    watchdog = asyncio.create_task(_idle_watchdog())
    yield
    watchdog.cancel()
    try:
        await watchdog
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title='cyclo_host_agent',
    description='Host agent for Cyclo Manager: repo management.',
    version='0.1.1',
    lifespan=lifespan,
)


@app.middleware('http')
async def _track_activity(request: Request, call_next) -> Response:
    """Update the last-activity timestamp on every request to reset the idle watchdog."""
    global _last_request_at
    _last_request_at = asyncio.get_running_loop().time()
    return await call_next(request)


app.include_router(repos.router)


def main() -> None:
    """
    Entry point for the host agent; called by systemd via ExecStart.

    Detects whether systemd socket activation is in use:
    - Activation: uvicorn binds to the fd passed by systemd.
      The socket file is managed by systemd, so we do not create or remove it.
    - Direct execution (dev/test): binds directly to SOCKET_PATH.
    In both cases the process exits after IDLE_TIMEOUT of inactivity;
    under socket activation systemd will restart it on the next connection.
    """
    fd = _systemd_fd()
    if fd is not None:
        logger.info('Starting via systemd socket activation (fd=%d)', fd)
        uvicorn.run(app, fd=fd, log_level='info')
    else:
        socket_path = Path(SOCKET_PATH)
        socket_path.parent.mkdir(parents=True, exist_ok=True)
        socket_path.unlink(missing_ok=True)
        logger.info('Starting on %s (direct mode)', socket_path)
        uvicorn.run(app, uds=str(socket_path), log_level='info')


if __name__ == '__main__':
    main()
