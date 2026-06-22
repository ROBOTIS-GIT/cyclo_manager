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
    """
    호스트에서 실행 중인 cyclo_host_agent와 UDS로 통신하는 비동기 HTTP 클라이언트.

    컨테이너 내부에서 /agents/host/host_agent.sock 경로로 접근하며,
    호스트의 git 레포 관리 API를 호출한다.
    httpx.AsyncClient는 첫 요청 시 지연 생성되며(lazy init),
    lifespan 종료 시 async_close()로 명시적으로 닫아야 한다.
    """

    def __init__(self, socket_path: str, timeout: float = 30.0) -> None:
        """소켓 경로와 요청 타임아웃을 설정한다. git 작업은 오래 걸릴 수 있어 기본값 30초."""
        self.socket_path = socket_path
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        """httpx 클라이언트를 지연 생성하고 반환한다. UDS 전용 transport를 사용한다."""
        if self._client is None:
            transport = httpx.AsyncHTTPTransport(uds=self.socket_path)
            self._client = httpx.AsyncClient(
                base_url='http://host-agent',
                transport=transport,
                timeout=self.timeout,
            )
        return self._client

    async def async_close(self) -> None:
        """열려 있는 httpx 클라이언트를 닫는다. lifespan 종료 시 호출된다."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def list_repos(self) -> dict:
        """워크스페이스의 git 레포 목록을 반환한다."""
        client = await self._ensure_client()
        response = await client.get('/repos')
        response.raise_for_status()
        return response.json()

    async def clone_repo(
        self, url: str, name: Optional[str] = None, branch: Optional[str] = None
    ) -> dict:
        """지정한 URL의 레포를 호스트 워크스페이스에 클론한다."""
        client = await self._ensure_client()
        payload: dict = {'url': url}
        if name:
            payload['name'] = name
        if branch:
            payload['branch'] = branch
        response = await client.post('/repos/clone', json=payload)
        response.raise_for_status()
        return response.json()

    async def pull_repo(self, name: str) -> dict:
        """호스트 워크스페이스의 특정 레포에서 git pull을 실행한다."""
        client = await self._ensure_client()
        response = await client.post(f'/repos/{name}/pull')
        response.raise_for_status()
        return response.json()

    async def delete_repo(self, name: str) -> dict:
        """호스트 워크스페이스의 특정 레포 디렉토리를 삭제한다."""
        client = await self._ensure_client()
        response = await client.delete(f'/repos/{name}')
        response.raise_for_status()
        return response.json()

    async def get_repo_updates(self) -> dict:
        """워크스페이스 내 각 레포의 GitHub 릴리즈 기준 업데이트 가능 여부를 반환한다."""
        client = await self._ensure_client()
        response = await client.get('/repos/updates')
        response.raise_for_status()
        return response.json()
