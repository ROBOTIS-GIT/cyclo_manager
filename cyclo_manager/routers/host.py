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

"""Host agent proxy router: repo management."""

import logging
from typing import Optional

from cyclo_manager.host_agent_client import HostAgentClient
from cyclo_manager.state import get_host_agent_client
from fastapi import APIRouter, Depends, HTTPException, status
import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/host', tags=['host'])


# ---------------------------------------------------------------------------
# Models (mirrors cyclo_host_agent models)
# ---------------------------------------------------------------------------

class RepoInfo(BaseModel):
    name: str
    path: str
    branch: Optional[str] = None
    remote: Optional[str] = None


class RepoListResponse(BaseModel):
    repos: list[RepoInfo]
    workspace_path: str


class RepoUpdateStatus(BaseModel):
    name: str
    branch: Optional[str] = None
    current_version: Optional[str] = None
    latest_version: Optional[str] = None
    has_update: bool


class RepoUpdatesResponse(BaseModel):
    repos: list[RepoUpdateStatus]
    workspace_path: str


class FileChange(BaseModel):
    path: str
    status: str


class RepoStatusResponse(BaseModel):
    name: str
    changes: list[FileChange]
    has_changes: bool


class RepoBranchCheckResponse(BaseModel):
    name: str
    branch: Optional[str] = None
    allowed: bool


class UpdateRequest(BaseModel):
    strategy: str
    preserve_files: list[str] = []


class UpdateResponse(BaseModel):
    name: str
    success: bool
    output: str
    stash_conflict: bool = False
    stash_conflict_files: list[str] = []


class ContainerScriptResponse(BaseModel):
    name: str
    action: str
    success: bool
    output: str


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _proxy_error(e: Exception) -> HTTPException:
    if isinstance(e, httpx.RequestError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Host agent unreachable: {e}',
        )
    if isinstance(e, httpx.HTTPStatusError):
        try:
            detail = e.response.json().get('detail', str(e))
        except Exception:
            detail = e.response.text or str(e)
        return HTTPException(status_code=e.response.status_code, detail=detail)
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get('/repos/updates', response_model=RepoUpdatesResponse)
async def get_repo_updates(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoUpdatesResponse:
    try:
        data = await client.get_repo_updates()
        return RepoUpdatesResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.get('/repos', response_model=RepoListResponse)
async def list_repos(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoListResponse:
    try:
        data = await client.list_repos()
        return RepoListResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.get('/repos/{name}/branch', response_model=RepoBranchCheckResponse)
async def get_repo_branch(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoBranchCheckResponse:
    try:
        data = await client.get_repo_branch(name)
        return RepoBranchCheckResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.get('/repos/{name}/status', response_model=RepoStatusResponse)
async def get_repo_status(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoStatusResponse:
    try:
        data = await client.get_repo_status(name)
        return RepoStatusResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.post('/repos/{name}/container/stop', response_model=ContainerScriptResponse)
async def stop_repo_container(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> ContainerScriptResponse:
    try:
        data = await client.stop_repo_container(name)
        return ContainerScriptResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.post('/repos/{name}/container/start', response_model=ContainerScriptResponse)
async def start_repo_container(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> ContainerScriptResponse:
    try:
        data = await client.start_repo_container(name)
        return ContainerScriptResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.post('/repos/{name}/update', response_model=UpdateResponse)
async def update_repo(
    name: str,
    req: UpdateRequest,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> UpdateResponse:
    try:
        data = await client.update_repo(name, req.strategy, req.preserve_files)
        return UpdateResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.post('/update')
async def update_cyclo_manager(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.update_cyclo_manager()
    except Exception as e:
        raise _proxy_error(e)


@router.get('/update/status')
async def get_update_status(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.get_update_status()
    except Exception as e:
        raise _proxy_error(e)


@router.get('/version')
async def get_host_agent_version(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.get_version()
    except Exception as e:
        raise _proxy_error(e)
