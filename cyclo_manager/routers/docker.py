"""Docker endpoints router."""

import re
import logging

import docker
import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from cyclo_manager.state import get_config, get_docker_client
from cyclo_manager.models import (
    DockerContainerActionRequest,
    DockerContainerActionResponse,
    DockerContainerInfo,
    DockerContainerListResponse,
    DockerContainerLogsResponse,
    DockerContainerStatus,
    RepoVersionConfig,
    RepoVersionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/docker", tags=["docker"])


@router.get("/containers", response_model=DockerContainerListResponse)
async def list_docker_containers(
    all: bool = False,
    docker_client=Depends(get_docker_client),
) -> DockerContainerListResponse:
    """Get list of all Docker containers."""
    try:
        containers = docker_client.list_containers(all=all)
        return DockerContainerListResponse(
            containers=[DockerContainerInfo(**c) for c in containers]
        )
    except Exception as e:
        logger.error(f"Failed to list Docker containers: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to list containers: {str(e)}",
        )


@router.get("/{name}/status", response_model=DockerContainerStatus)
async def get_docker_container_status(
    name: str,
    docker_client=Depends(get_docker_client),
) -> DockerContainerStatus:
    """Get detailed status of a Docker container."""
    try:
        status_info = docker_client.get_container_status(name)
        return DockerContainerStatus(**status_info)
    except docker.errors.NotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Docker container '{name}' not found",
        )
    except Exception as e:
        logger.error(f"Failed to get container status for '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to get container status: {str(e)}",
        )


@router.post("/{name}", response_model=DockerContainerActionResponse)
async def control_docker_container(
    name: str,
    request: DockerContainerActionRequest,
    docker_client=Depends(get_docker_client),
) -> DockerContainerActionResponse:
    """Control a Docker container (start, stop, or restart)."""
    try:
        if request.action == "start":
            result = docker_client.start_container(name)
        elif request.action == "stop":
            result = docker_client.stop_container(name, timeout=request.timeout or 10)
        elif request.action == "restart":
            result = docker_client.restart_container(name, timeout=request.timeout or 10)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid action: {request.action}",
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
            detail=f"Failed to control container: {str(e)}",
        )


@router.get("/{name}/logs", response_model=DockerContainerLogsResponse)
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
            detail=f"Failed to get container logs: {str(e)}",
        )


# Robot metapackage version check (ai_worker only)
VERSION_RE = re.compile(r"<version>([^<]+)</version>")

DEFAULT_REPO_VERSION_CONFIG = RepoVersionConfig()


def _parse_version(version_str: str) -> tuple[int, ...]:
    """Parse version string into comparable tuple (e.g. '1.2.3' -> (1, 2, 3))."""
    parts = []
    for p in (version_str or "").strip().lstrip("v").split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts) if parts else (0,)


def _is_newer(latest: str, current: str) -> bool:
    """Return True if latest > current (semver-style comparison)."""
    return _parse_version(latest) > _parse_version(current)


@router.get("/{name}/version", response_model=RepoVersionResponse)
async def get_repo_version(
    name: str,
    docker_client=Depends(get_docker_client),
    config=Depends(get_config),
) -> RepoVersionResponse:
    """Get robot metapackage version and compare with GitHub latest (ai_worker only)."""
    normalized = name.replace("-", "_")
    if normalized != "ai_worker":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version check is only supported for ai_worker, got: {name}",
        )

    container_config = config.containers.get("ai_worker")
    version_config = (
        container_config.repo_version
        if container_config and container_config.repo_version
        else DEFAULT_REPO_VERSION_CONFIG
    )
    github_api = version_config.github_releases_api
    package_xml_path = version_config.package_xml_path

    current_ver = "unknown"
    latest_ver = ""
    update_available = False

    # Get current version from package.xml inside container (must be running for exec)
    try:
        container = docker_client.get_container(name)
        if container.status == "running":
            content = docker_client.get_container_file_content(name, package_xml_path)
            match = VERSION_RE.search(content)
            if match:
                current_ver = match.group(1).strip()
    except docker.errors.NotFound:
        current_ver = "unknown"
    except Exception as e:
        logger.warning("Failed to get current version from container '%s': %s", name, e)

    # Get latest version from GitHub
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(github_api, timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            tag = data.get("tag_name", "")
            latest_ver = tag.lstrip("v").strip() if tag else ""
    except Exception as e:
        logger.warning("Failed to fetch GitHub latest release: %s", e)

    if latest_ver and current_ver != "unknown":
        update_available = _is_newer(latest_ver, current_ver)

    return RepoVersionResponse(
        container=name,
        current=current_ver,
        latest=latest_ver or "unknown",
        update_available=update_available,
    )
