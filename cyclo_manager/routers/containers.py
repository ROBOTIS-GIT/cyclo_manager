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

"""Container endpoints router."""

from cyclo_manager import __version__ as manager_version
from cyclo_manager.agent_compat import (
    compare_s6_agent_version,
    MIN_COMPATIBLE_S6_AGENT_VERSION,
)
from cyclo_manager.models import (
    S6AgentStatusListResponse,
    S6AgentStatusResponse,
    S6AgentUpdateResponse,
    SupportedRobotContainersResponse,
)
from cyclo_manager.state import (
    get_client_pool,
    get_config,
    get_docker_client,
    get_validated_container,
)
import docker
from fastapi import APIRouter, Depends, HTTPException, status

router = APIRouter(prefix='/containers', tags=['containers'])


def _build_unreachable_agent_status(
    container: str,
    error: str,
) -> S6AgentStatusResponse:
    """Build a status response for an unreachable container agent."""
    return S6AgentStatusResponse(
        container=container,
        status='unreachable',
        version=None,
        minimum_required_version=MIN_COMPATIBLE_S6_AGENT_VERSION,
        message=f'Container agent unreachable: {error}',
    )


def _build_agent_status(
    container: str,
    version: str | None,
) -> S6AgentStatusResponse:
    """Build a status response from reachable agent version metadata."""
    comparison = compare_s6_agent_version(version)
    compatible = comparison is not None and comparison >= 0
    if not version:
        status = 'unknown_version'
    elif comparison is None:
        status = 'unknown_version'
    elif comparison == 0:
        status = 'up_to_date'
    elif compatible:
        status = 'compatible'
    else:
        status = 'outdated'

    return S6AgentStatusResponse(
        container=container,
        status=status,
        version=version,
        minimum_required_version=MIN_COMPATIBLE_S6_AGENT_VERSION,
        message=None if compatible else 'Container agent update required',
    )


@router.get(
    '/agents/status',
    response_model=S6AgentStatusListResponse,
    summary='List container agent compatibility status',
    description='Check version compatibility for all configured s6 container agents.',
)
async def list_agent_statuses(
    config=Depends(get_config),
    client_pool=Depends(get_client_pool),
    docker_client=Depends(get_docker_client),
) -> S6AgentStatusListResponse:
    """Return status and compatibility for configured container agents that exist locally."""
    statuses: list[S6AgentStatusResponse] = []
    existing_containers = {
        container['name']
        for container in docker_client.list_containers(all=True)
    }

    for container in config.container_sockets:
        if container not in existing_containers:
            continue
        client = client_pool.get_client(container)
        if client is None:
            statuses.append(
                _build_unreachable_agent_status(
                    container,
                    'Agent client is not available',
                )
            )
            continue

        try:
            metadata = await client.get_agent_version()
            version = metadata.get('version') if isinstance(metadata, dict) else None
            statuses.append(
                _build_agent_status(
                    container,
                    str(version) if version else None,
                )
            )
        except Exception as e:
            statuses.append(
                _build_unreachable_agent_status(
                    container,
                    str(e),
                )
            )

    return S6AgentStatusListResponse(agents=statuses)


@router.post(
    '/{container}/agent/update',
    response_model=S6AgentUpdateResponse,
    summary='Update container s6 agent',
    description=(
        'Update /opt/cyclo_manager inside the container to the manager version '
        'and restart it.'
    ),
)
async def update_s6_agent(
    container: str = Depends(get_validated_container),
    docker_client=Depends(get_docker_client),
) -> S6AgentUpdateResponse:
    """Update the s6 agent checkout to the manager release and restart the container."""
    try:
        target_ref = manager_version
        result = docker_client.update_s6_agent(container, target_ref)
        return S6AgentUpdateResponse(**result)
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Docker container '{container}' not found",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Failed to update container agent: {str(e)}',
        )


@router.get(
    '',
    response_model=SupportedRobotContainersResponse,
    summary='List supported robot containers',
    description='Retrieve robot containers that can open the System page.',
    response_description='List of supported robot container names',
)
async def list_supported_robot_containers(
    config=Depends(get_config),
    docker_client=Depends(get_docker_client),
) -> SupportedRobotContainersResponse:
    """
    Get robot container names that can open the System page.

    These names are filtered from supported_robot_containers in config.yml to
    containers that exist on the local Docker host.

    Returns
    -------
        SupportedRobotContainersResponse containing supported robot container names.

    Example Response
    ----------------
        ```json
        {
          "supported_robot_containers": ["ai_worker", "open_manipulator"]
        }
        ```

    """
    existing_containers = {
        container['name']
        for container in docker_client.list_containers(all=True)
    }
    return SupportedRobotContainersResponse(
        supported_robot_containers=[
            container
            for container in config.supported_robot_containers
            if container in existing_containers
        ],
    )
