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
from cyclo_manager.http_errors import proxy_error
from cyclo_manager.state import get_host_agent_client
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/host', tags=['host'])

MAX_FILE_UPLOAD_BYTES = 20 * 1024 * 1024


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


class ContainerStartStatusResponse(BaseModel):
    running: bool
    output: str
    success: bool | None = None
    error: str = ''


class FileWriteRequest(BaseModel):
    path: str
    content: str
    expected_modified: float | None = None


class FileCreateRequest(BaseModel):
    path: str
    type: str
    content: str = ''


class FileRenameRequest(BaseModel):
    path: str
    new_name: str


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
        raise proxy_error(e, 'Host agent')


@router.get('/repos', response_model=RepoListResponse)
async def list_repos(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoListResponse:
    try:
        data = await client.list_repos()
        return RepoListResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/repos/{name}/branch', response_model=RepoBranchCheckResponse)
async def get_repo_branch(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoBranchCheckResponse:
    try:
        data = await client.get_repo_branch(name)
        return RepoBranchCheckResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/repos/{name}/status', response_model=RepoStatusResponse)
async def get_repo_status(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoStatusResponse:
    try:
        data = await client.get_repo_status(name)
        return RepoStatusResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.post('/repos/{name}/container/stop', response_model=ContainerScriptResponse)
async def stop_repo_container(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> ContainerScriptResponse:
    try:
        data = await client.stop_repo_container(name)
        return ContainerScriptResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.post('/repos/{name}/container/start', response_model=ContainerStartStatusResponse)
async def start_repo_container(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> ContainerStartStatusResponse:
    try:
        data = await client.start_repo_container(name)
        return ContainerStartStatusResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get(
    '/repos/{name}/container/start/status',
    response_model=ContainerStartStatusResponse,
)
async def get_start_repo_container_status(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> ContainerStartStatusResponse:
    try:
        data = await client.get_start_repo_container_status(name)
        return ContainerStartStatusResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


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
        raise proxy_error(e, 'Host agent')


@router.post('/update')
async def update_cyclo_manager(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.update_cyclo_manager()
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/update/status')
async def get_update_status(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.get_update_status()
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/version')
async def get_host_agent_version(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.get_version()
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/files/tree')
async def list_files(
    path: str = '',
    show_hidden: bool = False,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.list_files(path, show_hidden)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/files/read')
async def read_file(
    path: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.read_file(path)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/files/diff')
async def get_file_diff(
    path: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.get_file_diff(path)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/files/search')
async def search_files(
    query: str,
    path: str = '',
    show_hidden: bool = False,
    limit: int = 200,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.search_files(path, query, show_hidden, limit)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.post('/files/write')
async def write_file(
    req: FileWriteRequest,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.write_file(req.path, req.content, req.expected_modified)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.post('/files/create')
async def create_file_path(
    req: FileCreateRequest,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.create_file_path(req.path, req.type, req.content)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.post('/files/rename')
async def rename_file_path(
    req: FileRenameRequest,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.rename_file_path(req.path, req.new_name)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.post('/files/upload')
async def upload_file(
    request: Request,
    path: str = '',
    filename: str = '',
    overwrite: bool = False,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    content_length = request.headers.get('content-length')
    if content_length is not None:
        try:
            if int(content_length) > MAX_FILE_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail='File is too large to upload',
                )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Invalid Content-Length header',
            )

    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_FILE_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail='File is too large to upload',
            )

    try:
        content_type = request.headers.get('content-type', 'application/octet-stream')
        return await client.upload_file(
            path,
            filename,
            bytes(content),
            overwrite,
            content_type,
        )
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.delete('/files')
async def delete_file_path(
    path: str,
    recursive: bool = False,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> dict:
    try:
        return await client.delete_file_path(path, recursive)
    except Exception as e:
        raise proxy_error(e, 'Host agent')
