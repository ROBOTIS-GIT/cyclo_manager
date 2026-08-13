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

"""Async HTTP client for communicating with the cyclo_host_agent via Unix Domain Socket."""

from cyclo_manager.socket_http_client import SocketHttpClient


class HostAgentClient(SocketHttpClient):

    def __init__(self, socket_path: str, timeout: float = 30.0) -> None:
        super().__init__(socket_path, base_url='http://host-agent', timeout=timeout)

    async def list_repos(self) -> dict:
        return await self.request_json('GET', '/repos')

    async def get_repo_updates(self) -> dict:
        return await self.request_json('GET', '/repos/updates')

    async def get_repo_branch(self, name: str) -> dict:
        return await self.request_json('GET', f'/repos/{name}/branch')

    async def get_repo_status(self, name: str) -> dict:
        return await self.request_json('GET', f'/repos/{name}/status')

    async def update_repo(self, name: str, strategy: str, preserve_files: list[str]) -> dict:
        return await self.request_json(
            'POST',
            f'/repos/{name}/update',
            json={'strategy': strategy, 'preserve_files': preserve_files},
            timeout=180.0,
        )

    async def stop_repo_container(self, name: str) -> dict:
        return await self.request_json(
            'POST',
            f'/repos/{name}/container/stop',
            timeout=120.0,
        )

    async def start_repo_container(self, name: str) -> dict:
        return await self.request_json(
            'POST',
            f'/repos/{name}/container/start',
            timeout=10.0,
        )

    async def get_start_repo_container_status(self, name: str) -> dict:
        return await self.request_json(
            'GET',
            f'/repos/{name}/container/start/status',
            timeout=10.0,
        )

    async def update_cyclo_manager(self) -> dict:
        return await self.request_json('POST', '/system/update', timeout=60.0)

    async def get_update_status(self) -> dict:
        return await self.request_json('GET', '/system/update/status', timeout=10.0)

    async def get_version(self) -> dict:
        return await self.request_json('GET', '/system/version', timeout=10.0)

    async def get_system_stats(self) -> dict:
        return await self.request_json('GET', '/system/status', timeout=10.0)

    async def get_system_processes(self, limit: int) -> dict:
        return await self.request_json(
            'GET',
            '/system/processes',
            params={'limit': limit},
            timeout=10.0,
        )
