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

from fastapi import APIRouter, Depends
from cyclo_manager.state import get_config
from cyclo_manager.models import ConfiguredContainerListResponse, ConfiguredContainerInfo

router = APIRouter(prefix="/containers", tags=["containers"])


@router.get(
    "",
    response_model=ConfiguredContainerListResponse,
    summary="List all known containers",
    description="Retrieve a list of all containers configured in cyclo_manager",
    response_description="List of containers with their names and socket paths",
)
async def list_containers(config=Depends(get_config)) -> ConfiguredContainerListResponse:
    """Get list of all known containers from configuration.

    Returns a list of all containers that are configured in cyclo_manager's
    configuration file. Each container entry includes its name and the path to
    its agent's Unix Domain Socket.

    Returns:
        ConfiguredContainerListResponse containing a list of ConfiguredContainerInfo objects.

    Example Response:
        ```json
        {
          "containers": [
            {
              "name": "ai_worker",
              "socket_path": "/agents/ai_worker/s6_agent.sock"
            }
          ]
        }
        ```
    """
    containers = [
        ConfiguredContainerInfo(name=name, socket_path=container_config.socket_path)
        for name, container_config in config.containers.items()
    ]
    return ConfiguredContainerListResponse(containers=containers)

