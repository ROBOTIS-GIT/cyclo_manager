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
IDLE_TIMEOUT = 60  # 마지막 요청 후 이 시간(초) 동안 요청이 없으면 종료

# systemd가 소켓 fd를 넘겨줄 때 시작하는 fd 번호 (POSIX 표준)
_SD_LISTEN_FDS_START = 3

_last_request_at: float = 0.0


def _systemd_fd() -> Optional[int]:
    """
    systemd socket activation으로 전달된 소켓 fd를 반환한다.

    systemd는 LISTEN_PID(현재 프로세스 PID)와 LISTEN_FDS(전달된 fd 수)
    환경변수로 소켓 fd를 알려준다. 해당하지 않으면 None을 반환한다.
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
    IDLE_TIMEOUT 초 동안 요청이 없으면 프로세스에 SIGTERM을 보내 종료한다.

    5초마다 마지막 요청 시각을 확인한다. 종료 후 소켓은 systemd가 다시 접수하며
    다음 연결 요청이 들어오면 systemd가 프로세스를 재기동한다.
    """
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(5)
        if loop.time() - _last_request_at >= IDLE_TIMEOUT:
            logger.info('No requests for %ds, shutting down', IDLE_TIMEOUT)
            os.kill(os.getpid(), signal.SIGTERM)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """idle watchdog 태스크를 앱 생명주기에 맞춰 시작/종료한다."""
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
    """요청이 들어올 때마다 마지막 활동 시각을 갱신해 idle watchdog을 리셋한다."""
    global _last_request_at
    _last_request_at = asyncio.get_running_loop().time()
    return await call_next(request)


app.include_router(repos.router)


def main() -> None:
    """
    호스트 에이전트 진입점. systemd의 ExecStart로 호출된다.

    systemd socket activation 여부를 감지해 동작 방식을 결정한다.
    - activation인 경우: systemd가 전달한 fd로 uvicorn을 시작한다.
      소켓 파일은 systemd가 관리하므로 직접 생성/삭제하지 않는다.
    - 직접 실행인 경우(개발/테스트): config의 socket_path에 직접 바인딩한다.
    어느 경우든 IDLE_TIMEOUT 후 자동 종료되며, socket activation 환경에서는
    다음 연결 시 systemd가 자동으로 재기동한다.
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
