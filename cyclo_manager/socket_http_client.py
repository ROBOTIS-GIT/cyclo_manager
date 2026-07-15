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

"""Shared async HTTP client for socket-backed APIs."""

from typing import Any, Optional

import httpx


class SocketHttpClient:
    """Lazy async HTTP client backed by an HTTP Unix Domain Socket transport."""

    def __init__(self, socket_path: str, base_url: str, timeout: float) -> None:
        self.socket_path = socket_path
        self.timeout = timeout
        self.base_url = base_url
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_httpx_client(self) -> httpx.AsyncClient:
        """Create the underlying httpx client on first use and return it."""
        if self._client is None:
            transport = httpx.AsyncHTTPTransport(uds=self.socket_path)
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                transport=transport,
                timeout=self.timeout,
            )
        return self._client

    async def async_close(self) -> None:
        """Close the underlying HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def request_json(self, method: str, path: str, **kwargs: Any) -> dict:
        """Send a request, raise for non-2xx responses, and return JSON."""
        client = await self._ensure_httpx_client()
        response = await client.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()
