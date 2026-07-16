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

"""Docker endpoints router."""

import logging

from cyclo_manager.models import (
    DockerContainerActionRequest,
    DockerContainerActionResponse,
    DockerContainerInfo,
    DockerContainerListResponse,
    DockerContainerLogsResponse,
    DockerTopResponse,
)
from cyclo_manager.state import get_docker_client
import docker
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/docker', tags=['docker'])


@router.get('/containers', response_model=DockerContainerListResponse)
async def list_docker_containers(
    all: bool = False,  # noqa: A002
    docker_client=Depends(get_docker_client),
) -> DockerContainerListResponse:
    """Get list of all Docker containers."""
    try:
        containers = docker_client.list_containers(all=all)
        return DockerContainerListResponse(
            containers=[DockerContainerInfo(**c) for c in containers]
        )
    except Exception as e:
        logger.error(f'Failed to list Docker containers: {e}')
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Failed to list containers: {str(e)}',
        )


@router.post('/{name}', response_model=DockerContainerActionResponse)
async def control_docker_container(
    name: str,
    request: DockerContainerActionRequest,
    docker_client=Depends(get_docker_client),
) -> DockerContainerActionResponse:
    """Control a Docker container (start, stop, or restart)."""
    try:
        if request.action == 'start':
            result = docker_client.start_container(name)
        elif request.action == 'stop':
            result = docker_client.stop_container(name, timeout=request.timeout or 10)
        elif request.action == 'restart':
            result = docker_client.restart_container(name, timeout=request.timeout or 10)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f'Invalid action: {request.action}',
            )

        return DockerContainerActionResponse(**result)
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Docker container '{name}' not found",
        )
    except Exception as e:
        logger.error(f"Failed to control container '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Failed to control container: {str(e)}',
        )


@router.get('/{name}/logs', response_model=DockerContainerLogsResponse)
async def get_docker_container_logs(
    name: str,
    tail: int = 100,
    docker_client=Depends(get_docker_client),
) -> DockerContainerLogsResponse:
    """Get logs from a Docker container."""
    try:
        logs = docker_client.get_container_logs(name, tail=tail)
        return DockerContainerLogsResponse(container=name, logs=logs, tail=tail)
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Docker container '{name}' not found",
        )
    except Exception as e:
        logger.error(f"Failed to get logs for container '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Failed to get container logs: {str(e)}',
        )


@router.get('/{name}/top', response_model=DockerTopResponse)
async def get_container_top(
    name: str,
    docker_client=Depends(get_docker_client),
) -> DockerTopResponse:
    """Get running processes inside a Docker container."""
    try:
        result = docker_client.get_container_top(name)
        return DockerTopResponse(
            container=name,
            titles=result.get('Titles', []),
            processes=result.get('Processes', []) or [],
        )
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Container {name!r} not found',
        )
    except Exception as e:
        logger.error("Failed to get top for container '%s': %s", name, e)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))


@router.delete('/{name}/processes/{pid}')
async def kill_container_process(
    name: str,
    pid: int,
    signal: str = 'SIGTERM',
    docker_client=Depends(get_docker_client),
) -> dict:
    """Send a signal to a process running inside a Docker container."""
    try:
        result = docker_client.kill_container_process(name, pid, signal)
        return result
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Container {name!r} not found',
        )
    except Exception as e:
        logger.error("Failed to kill pid %d in container '%s': %s", pid, name, e)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
