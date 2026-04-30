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

"""Global state management and FastAPI dependencies for cyclo_manager."""

from typing import Optional
from fastapi import Depends, HTTPException, status

from cyclo_manager.agent_client import AgentClient, AgentClientPool
from cyclo_manager.config import SystemConfig
from cyclo_manager.docker_client import DockerClient
from cyclo_manager.ros2_node import CycloManagerTopicSubscriber


class AppState:
    """Encapsulates all global application state.

    Lifecycle management (startup / shutdown) is done via ``app_state``
    directly from ``lifespan.py``.  Routers access state through the
    module-level FastAPI dependency functions below.
    """

    def __init__(self) -> None:
        self._config: Optional[SystemConfig] = None
        self._client_pool: Optional[AgentClientPool] = None
        self._docker_client: Optional[DockerClient] = None
        self._ros2_nodes: dict[str, CycloManagerTopicSubscriber] = {}

    # ------------------------------------------------------------------
    # Setters — called by lifespan.py
    # ------------------------------------------------------------------

    def set_config(self, config: SystemConfig) -> None:
        self._config = config

    def set_client_pool(self, pool: AgentClientPool) -> None:
        self._client_pool = pool

    def set_docker_client(self, client: Optional[DockerClient]) -> None:
        self._docker_client = client

    def set_ros2_node(self, container_name: str, node: CycloManagerTopicSubscriber) -> None:
        self._ros2_nodes[container_name] = node

    def get_ros2_nodes(self) -> dict[str, CycloManagerTopicSubscriber]:
        return self._ros2_nodes

    def clear_ros2_nodes(self) -> None:
        self._ros2_nodes.clear()

    # ------------------------------------------------------------------
    # Accessors — return None instead of raising (used by lifespan & WebSocket)
    # ------------------------------------------------------------------

    def get_config_or_none(self) -> Optional[SystemConfig]:
        return self._config

    def get_client_pool_or_none(self) -> Optional[AgentClientPool]:
        return self._client_pool

    def get_docker_client_or_none(self) -> Optional[DockerClient]:
        return self._docker_client

    def get_ros2_node(self, container_name: str) -> Optional[CycloManagerTopicSubscriber]:
        if self._config is None or container_name not in self._config.containers:
            return None
        return self._ros2_nodes.get(container_name)


# Public singleton.  lifespan.py owns its lifecycle; routers use the
# module-level dependency functions below.
app_state = AppState()


# ===========================================================================
# FastAPI Dependencies — raise HTTPException when state is missing
# ===========================================================================

def get_config() -> SystemConfig:
    """Dependency: return loaded configuration or raise 503."""
    config = app_state.get_config_or_none()
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Configuration not loaded",
        )
    return config


def get_client_pool() -> AgentClientPool:
    """Dependency: return agent client pool or raise 503."""
    pool = app_state.get_client_pool_or_none()
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent client pool not initialized",
        )
    return pool


def get_docker_client() -> DockerClient:
    """Dependency: return Docker client or raise 503."""
    client = app_state.get_docker_client_or_none()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Docker client not available. Ensure Docker socket is mounted.",
        )
    return client


def get_validated_container(container: str, config: SystemConfig = Depends(get_config)) -> str:
    """Dependency: validate that *container* exists in config or raise 404."""
    if container not in config.containers:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Container '{container}' not found",
        )
    return container


def get_agent_client(container_name: str) -> AgentClient:
    """Return an AgentClient for *container_name* or raise an appropriate HTTPException."""
    config = get_config()
    if container_name not in config.containers:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Container '{container_name}' not found",
        )
    client_pool = get_client_pool()
    client = client_pool.get_client(container_name)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Agent client for container '{container_name}' not available",
        )
    return client


# ===========================================================================
# Optional accessors — return None; used by WebSocket handlers (can't Depends)
# ===========================================================================

def get_config_or_none() -> Optional[SystemConfig]:
    return app_state.get_config_or_none()


def get_client_pool_or_none() -> Optional[AgentClientPool]:
    return app_state.get_client_pool_or_none()


def get_ros2_node(container_name: str) -> Optional[CycloManagerTopicSubscriber]:
    return app_state.get_ros2_node(container_name)
