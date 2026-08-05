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

"""Async HTTP client for communicating with agents via Unix Domain Sockets."""

import json
import logging
from typing import Any, AsyncIterator, Optional, TYPE_CHECKING

from cyclo_manager.socket_http_client import SocketHttpClient
import httpx

if TYPE_CHECKING:
    from cyclo_manager.models import SystemConfig

logger = logging.getLogger(__name__)


class AgentClient(SocketHttpClient):
    """
    Async HTTP client for agent communication over Unix Domain Socket.

    This client uses httpx to communicate with agents running inside containers
    via Unix Domain Sockets. All methods are async for efficient I/O handling.
    """

    def __init__(self, socket_path: str, timeout: float = 5.0):
        """Initialize agent client."""
        super().__init__(socket_path, base_url='http://agent', timeout=timeout)

    async def get_agent_version(self) -> dict:
        """Get agent version metadata from the root endpoint."""
        logger.debug(f'Requesting agent version from {self.socket_path}')
        return await self.request_json('GET', '/')

    async def get_service_status(self, service_name: str) -> dict:
        """
        Get status of a specific service from agent.

        Args
        ----
        service_name: Name of the service.

        Returns
        -------
        Response JSON from agent's /services/{name}/status endpoint.

        Raises
        ------
        httpx.RequestError: If request fails.
        httpx.HTTPStatusError: If agent returns error status (e.g., 404).

        """
        logger.debug(
            f'Requesting status for service {service_name!r} from agent at {self.socket_path}'
        )
        return await self.request_json('GET', f'/services/{service_name}/status')

    async def control_service(
        self,
        service_name: str,
        action: str,
        launch_args: dict[str, str] | None = None,
        robot_type: str | None = None,
    ) -> dict:
        """
        Control a service (up/down/restart) via agent.

        Args
        ----
        service_name: Name of the service.
        action: Action to perform ('up', 'down', or 'restart').
        launch_args: Optional launch arguments for ros2 launch (used for up/restart).
        robot_type: Required for services that select launch files by robot type.

        Returns
        -------
        Response JSON from agent's /services/{name} endpoint.

        Raises
        ------
        httpx.RequestError: If request fails.
        httpx.HTTPStatusError: If agent returns error status.

        """
        logger.debug(
            f'Sending action {action!r} to service {service_name!r} '
            f'via agent at {self.socket_path}'
        )
        payload: dict[str, object] = {'action': action}
        if launch_args is not None:
            payload['launch_args'] = launch_args
        if robot_type is not None:
            payload['robot_type'] = robot_type
        return await self.request_json('POST', f'/services/{service_name}', json=payload)

    async def stream_service_logs(
        self,
        service_name: str,
        tail: int = 100,
        cursor: Optional[int] = None,
        strip_ansi: bool = False,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Stream logs for a service from agent as NDJSON events.

        Each yielded event contains ``logs`` and ``cursor`` fields.
        """
        client = await self._ensure_httpx_client()
        logger.debug(
            f'Streaming logs for service {service_name!r} from agent at {self.socket_path} '
            f'(cursor={cursor}, tail={tail if cursor is None else None})'
        )
        params: dict[str, object] = {
            'tail': tail,
            'strip_ansi': strip_ansi,
        }
        if cursor is not None:
            params['cursor'] = cursor

        timeout = httpx.Timeout(
            connect=self.timeout,
            read=None,
            write=self.timeout,
            pool=self.timeout,
        )
        try:
            async with client.stream(
                'GET',
                f'/services/{service_name}/logs/stream',
                params=params,
                timeout=timeout,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        logger.warning(
                            "Failed to decode log stream event for service '%s': %r",
                            service_name,
                            line,
                        )
                        continue
                    yield event
        except httpx.RequestError as e:
            logger.error(f'Failed to stream logs from agent at {self.socket_path}: {e}')
            raise
        except httpx.HTTPStatusError as e:
            logger.error(f"Agent returned error status for log stream '{service_name}': {e}")
            raise
        except Exception as e:
            logger.error(f"Agent log stream failed for service '{service_name}': {e}")
            raise

    async def open_service_log_download(self, service_name: str) -> httpx.Response:
        """
        Open a streaming response for a service's downloadable current log file.

        The caller is responsible for closing the returned response.
        """
        client = await self._ensure_httpx_client()
        logger.debug(
            f'Downloading log file for service {service_name!r} from agent at {self.socket_path}'
        )
        response: httpx.Response | None = None
        try:
            request = client.build_request(
                'GET',
                f'/services/{service_name}/logs/download',
            )
            response = await client.send(request, stream=True)
            response.raise_for_status()
            return response
        except httpx.RequestError as e:
            logger.error(f'Failed to download logs from agent at {self.socket_path}: {e}')
            raise
        except httpx.HTTPStatusError as e:
            await e.response.aclose()
            logger.error(f"Agent returned error status for log download '{service_name}': {e}")
            raise
        except Exception as e:
            if response is not None:
                await response.aclose()
            logger.error(f"Agent log download failed for service '{service_name}': {e}")
            raise

    async def clear_service_logs(self, service_name: str) -> dict:
        """
        Clear logs for a service from agent.

        Args
        ----
        service_name: Name of the service.

        Returns
        -------
        Response JSON from agent's DELETE /services/{name}/logs endpoint.

        Raises
        ------
        httpx.RequestError: If request fails.
        httpx.HTTPStatusError: If agent returns error status (e.g., 404).

        """
        logger.debug(f"Clearing logs for service '{service_name}' via agent at {self.socket_path}")
        return await self.request_json('DELETE', f'/services/{service_name}/logs')


class AgentClientPool:
    """
    Pool of async agent clients, one per container.

    Manages lifecycle of agent clients and provides easy access by container name.
    All clients are async for efficient I/O handling.
    """

    def __init__(self, config: 'SystemConfig') -> None:
        """Initialize client pool from configuration."""
        self._clients: dict[str, AgentClient] = {}
        for container_name, socket_path in config.container_sockets.items():
            self._clients[container_name] = AgentClient(socket_path)

    def get_client(self, container_name: str) -> Optional[AgentClient]:
        """
        Get agent client for a container.

        Args
        ----
        container_name: Name of the container.

        Returns
        -------
        AgentClient instance, or None if container not found.

        """
        return self._clients.get(container_name)

    async def close_all(self) -> None:
        """Close all agent clients (async)."""
        for client in self._clients.values():
            await client.async_close()
        self._clients.clear()
