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

import httpx
from cyclo_manager.host_agent_client import HostAgentClient
from cyclo_manager.state import get_host_agent_client
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/host', tags=['host'])


# ---------------------------------------------------------------------------
# Request / Response models (mirrors cyclo_host_agent models)
# ---------------------------------------------------------------------------

class RepoInfo(BaseModel):
    name: str
    path: str
    branch: Optional[str] = None
    remote: Optional[str] = None


class RepoListResponse(BaseModel):
    repos: list[RepoInfo]
    workspace_path: str


class CloneRequest(BaseModel):
    url: str
    name: Optional[str] = None
    branch: Optional[str] = None


class CloneResponse(BaseModel):
    name: str
    path: str
    message: str


class PullResponse(BaseModel):
    name: str
    message: str
    output: str


class DeleteResponse(BaseModel):
    name: str
    message: str


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _proxy_error(e: Exception) -> HTTPException:
    """
    host_agent_client에서 발생한 예외를 FastAPI HTTPException으로 변환한다.

    - RequestError: 소켓 연결 실패 등 통신 문제 → 503
    - HTTPStatusError: 호스트 에이전트가 반환한 오류 → 에이전트의 status code 그대로 전달
    - 그 외: 500
    """
    if isinstance(e, httpx.RequestError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Host agent unreachable: {e}',
        )
    if isinstance(e, httpx.HTTPStatusError):
        return HTTPException(
            status_code=e.response.status_code,
            detail=e.response.json().get('detail', str(e)),
        )
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get('/repos', response_model=RepoListResponse)
async def list_repos(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> RepoListResponse:
    """호스트 워크스페이스의 git 레포 목록을 반환한다."""
    try:
        data = await client.list_repos()
        return RepoListResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.post('/repos/clone', response_model=CloneResponse, status_code=status.HTTP_201_CREATED)
async def clone_repo(
    req: CloneRequest,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> CloneResponse:
    """지정한 URL의 레포를 호스트 워크스페이스에 클론한다."""
    try:
        data = await client.clone_repo(url=req.url, name=req.name, branch=req.branch)
        return CloneResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.post('/repos/{name}/pull', response_model=PullResponse)
async def pull_repo(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> PullResponse:
    """호스트 워크스페이스의 특정 레포에서 git pull을 실행한다."""
    try:
        data = await client.pull_repo(name)
        return PullResponse(**data)
    except Exception as e:
        raise _proxy_error(e)


@router.delete('/repos/{name}', response_model=DeleteResponse)
async def delete_repo(
    name: str,
    client: HostAgentClient = Depends(get_host_agent_client),
) -> DeleteResponse:
    """호스트 워크스페이스의 특정 레포 디렉토리를 삭제한다."""
    try:
        data = await client.delete_repo(name)
        return DeleteResponse(**data)
    except Exception as e:
        raise _proxy_error(e)
