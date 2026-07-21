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
    MIN_COMPATIBLE_S6_AGENT_VERSION,
    is_s6_agent_version_compatible,
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
        update_required=True,
        message=f'Container agent unreachable: {error}',
    )


def _build_agent_status(
    container: str,
    version: str | None,
) -> S6AgentStatusResponse:
    """Build a status response from reachable agent version metadata."""
    compatible = is_s6_agent_version_compatible(version)
    if not version:
        status = 'unknown_version'
    elif compatible:
        status = 'ok'
    else:
        status = 'outdated'

    return S6AgentStatusResponse(
        container=container,
        status=status,
        version=version,
        minimum_required_version=MIN_COMPATIBLE_S6_AGENT_VERSION,
        update_required=not compatible,
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
) -> S6AgentStatusListResponse:
    """Return status and compatibility for configured container agents."""
    statuses: list[S6AgentStatusResponse] = []

    for container in config.container_sockets:
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
    description='Update /opt/cyclo_manager inside the container to the manager version and restart it.',
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
) -> SupportedRobotContainersResponse:
    """
    Get robot container names that can open the System page.

    These names come directly from supported_robot_containers in config.yml.

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
    return SupportedRobotContainersResponse(
        supported_robot_containers=config.supported_robot_containers,
    )
