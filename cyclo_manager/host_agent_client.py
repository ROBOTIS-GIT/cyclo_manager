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

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class HostAgentClient:
    def __init__(self, socket_path: str, timeout: float = 30.0) -> None:
        self.socket_path = socket_path
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            transport = httpx.AsyncHTTPTransport(uds=self.socket_path)
            self._client = httpx.AsyncClient(
                base_url='http://host-agent',
                transport=transport,
                timeout=self.timeout,
            )
        return self._client

    async def async_close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def list_repos(self) -> dict:
        client = await self._ensure_client()
        response = await client.get('/repos')
        response.raise_for_status()
        return response.json()

    async def get_repo_updates(self) -> dict:
        client = await self._ensure_client()
        response = await client.get('/repos/updates')
        response.raise_for_status()
        return response.json()

    async def get_repo_branch(self, name: str) -> dict:
        client = await self._ensure_client()
        response = await client.get(f'/repos/{name}/branch')
        response.raise_for_status()
        return response.json()

    async def get_repo_status(self, name: str) -> dict:
        client = await self._ensure_client()
        response = await client.get(f'/repos/{name}/status')
        response.raise_for_status()
        return response.json()

    async def update_repo(self, name: str, strategy: str, preserve_files: list[str]) -> dict:
        client = await self._ensure_client()
        response = await client.post(
            f'/repos/{name}/update',
            json={'strategy': strategy, 'preserve_files': preserve_files},
            timeout=180.0,
        )
        response.raise_for_status()
        return response.json()

    async def stop_repo_container(self, name: str) -> dict:
        client = await self._ensure_client()
        response = await client.post(f'/repos/{name}/container/stop', timeout=120.0)
        response.raise_for_status()
        return response.json()

    async def start_repo_container(self, name: str) -> dict:
        client = await self._ensure_client()
        response = await client.post(f'/repos/{name}/container/start', timeout=300.0)
        response.raise_for_status()
        return response.json()

    async def update_cyclo_manager(self) -> dict:
        client = await self._ensure_client()
        response = await client.post('/system/update', timeout=60.0)
        response.raise_for_status()
        return response.json()

    async def get_update_status(self) -> dict:
        client = await self._ensure_client()
        response = await client.get('/system/update/status', timeout=10.0)
        response.raise_for_status()
        return response.json()
