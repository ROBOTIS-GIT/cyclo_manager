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

import asyncio
import fcntl
import json
import logging
import os
import pty
import re
import struct
import subprocess
import termios
import uuid as uuid_module

import docker
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from cyclo_manager.state import get_config, get_docker_client
from cyclo_manager.utils.versioning import is_newer
from cyclo_manager.models import (
    DockerContainerActionRequest,
    DockerContainerActionResponse,
    DockerContainerInfo,
    DockerContainerListResponse,
    DockerContainerLogsResponse,
    DockerContainerStatus,
    DockerTopResponse,
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


@router.get("/{name}/top", response_model=DockerTopResponse)
async def get_container_top(
    name: str,
    docker_client=Depends(get_docker_client),
) -> DockerTopResponse:
    """Get running processes inside a Docker container."""
    try:
        result = docker_client.get_container_top(name)
        return DockerTopResponse(
            container=name,
            titles=result.get("Titles", []),
            processes=result.get("Processes", []) or [],
        )
    except docker.errors.NotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Container '{name}' not found")
    except Exception as e:
        logger.error("Failed to get top for container '%s': %s", name, e)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))


@router.delete("/{name}/processes/{pid}")
async def kill_container_process(
    name: str,
    pid: int,
    signal: str = "SIGTERM",
    docker_client=Depends(get_docker_client),
) -> dict:
    """Send a signal to a process running inside a Docker container."""
    try:
        result = docker_client.kill_container_process(name, pid, signal)
        return result
    except docker.errors.NotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Container '{name}' not found")
    except Exception as e:
        logger.error("Failed to kill pid %d in container '%s': %s", pid, name, e)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))


@router.websocket("/{name}/terminal/ws")
async def terminal_ws(
    name: str,
    websocket: WebSocket,
    session_id: str = Query(default=""),
) -> None:
    """WebSocket terminal backed by a persistent tmux session in cyclo_manager."""
    from cyclo_manager.state import app_state
    session_manager = app_state.get_terminal_session_manager_or_none()
    if session_manager is None:
        await websocket.accept()
        await websocket.close(code=1011, reason="Terminal session manager not available")
        return

    await websocket.accept()

    sid = session_id or uuid_module.uuid4().hex[:12]
    master_fd = -1
    proc = None
    t1 = t2 = None
    tmux_name = None

    try:
        tmux_name = session_manager.get_or_create(name, sid)

        rows, cols = 24, 80
        try:
            first_msg = await asyncio.wait_for(websocket.receive(), timeout=3.0)
            if first_msg.get("text"):
                payload = json.loads(first_msg["text"])
                if payload.get("type") == "resize":
                    rows = int(payload.get("rows", 24))
                    cols = int(payload.get("cols", 80))
        except Exception:
            pass

        master_fd, slave_fd = pty.openpty()
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        proc = subprocess.Popen(
            ["tmux", "attach-session", "-t", tmux_name],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid,
            close_fds=True,
            env={**os.environ, "TERM": "xterm-256color"},
        )
        os.close(slave_fd)

        loop = asyncio.get_event_loop()

        async def pty_to_ws() -> None:
            try:
                while True:
                    data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                    if not data:
                        break
                    await websocket.send_bytes(data)
            except (OSError, EOFError):
                pass
            except Exception:
                pass

        async def ws_to_pty() -> None:
            try:
                while True:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.disconnect":
                        break
                    if msg.get("bytes"):
                        os.write(master_fd, msg["bytes"])
                    elif msg.get("text"):
                        try:
                            payload = json.loads(msg["text"])
                            if payload.get("type") == "resize":
                                fcntl.ioctl(
                                    master_fd, termios.TIOCSWINSZ,
                                    struct.pack("HHHH", payload["rows"], payload["cols"], 0, 0),
                                )
                        except Exception:
                            pass
            except (WebSocketDisconnect, RuntimeError):
                pass

        t1 = asyncio.create_task(pty_to_ws())
        t2 = asyncio.create_task(ws_to_pty())
        await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)

    except Exception as e:
        logger.error("Terminal WS error for container '%s': %s", name, e)
        try:
            await websocket.send_bytes(f"\r\nError: {e}\r\n".encode())
        except Exception:
            pass
    finally:
        for task in [t for t in [t1, t2] if t and not t.done()]:
            task.cancel()
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        if master_fd >= 0:
            try:
                os.close(master_fd)
            except OSError:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.delete("/{name}/terminal/{session_id}")
async def close_terminal_session(name: str, session_id: str) -> dict:
    """Explicitly kill a terminal session (called when user closes a tab)."""
    from cyclo_manager.state import app_state
    session_manager = app_state.get_terminal_session_manager_or_none()
    if session_manager:
        session_manager.close(session_id)
    return {"result": "ok"}


# Robot metapackage version check (ai_worker only)
VERSION_RE = re.compile(r"<version>([^<]+)</version>")

DEFAULT_REPO_VERSION_CONFIG = RepoVersionConfig()



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
        update_available = is_newer(latest_ver, current_ver)

    return RepoVersionResponse(
        container=name,
        current=current_ver,
        latest=latest_ver or "unknown",
        update_available=update_available,
    )
