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

import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from cyclo_host_agent.routers import repos, update

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

SOCKET_PATH = '/var/run/robotis/agent_sockets/host/host_agent.sock'

app = FastAPI(
    title='cyclo_host_agent',
    description='Host agent for Cyclo Manager: repo management.',
    version='0.2.0',
)

app.include_router(repos.router)
app.include_router(update.router)


def main() -> None:
    """Entry point for the host agent; called by systemd via ExecStart."""
    socket_path = Path(SOCKET_PATH)
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    socket_path.unlink(missing_ok=True)
    logger.info('Starting on %s', socket_path)
    uvicorn.run(app, uds=str(socket_path), log_level='info')


if __name__ == '__main__':
    main()
