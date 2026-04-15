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

