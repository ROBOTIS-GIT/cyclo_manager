"""Container-level endpoints (bashrc via docker exec)."""

import logging

import docker
from fastapi import APIRouter, Depends, HTTPException, status

from cyclo_manager.models import BashrcResponse, BashrcUpdateRequest
from cyclo_manager.state import get_docker_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/{container}", tags=["container"])


@router.get("/bashrc", response_model=BashrcResponse)
def get_bashrc(
    container: str,
    docker_client=Depends(get_docker_client),
) -> BashrcResponse:
    """Get ~/.bashrc content from the container via docker exec."""
    try:
        result = docker_client.get_container_bashrc(container)
        return BashrcResponse(
            container=container,
            path=result.get("path", ""),
            content=result.get("content", ""),
        )
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Docker container '{container}' not found",
        )
    except Exception as e:
        logger.error("Failed to get bashrc for container '%s': %s", container, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/bashrc", response_model=BashrcResponse)
def update_bashrc(
    container: str,
    request: BashrcUpdateRequest,
    docker_client=Depends(get_docker_client),
) -> BashrcResponse:
    """Update ~/.bashrc content in the container via docker exec (put_archive)."""
    if not request.content or not request.content.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content must not be empty",
        )
    try:
        result = docker_client.update_container_bashrc(container, request.content)
        logger.info("Successfully updated bashrc for container '%s'", container)
        return BashrcResponse(
            container=container,
            path=result.get("path", ""),
            content=result.get("content", ""),
        )
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Docker container '{container}' not found",
        )
    except Exception as e:
        logger.error("Failed to update bashrc for container '%s': %s", container, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
