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

"""Pydantic models for cyclo_host_agent API."""

from typing import Optional

from pydantic import BaseModel


class RepoInfo(BaseModel):
    """단일 git 레포 정보."""

    name: str
    path: str
    branch: Optional[str] = None
    remote: Optional[str] = None


class RepoListResponse(BaseModel):
    """GET /repos 응답."""

    repos: list[RepoInfo]
    workspace_path: str


class CloneRequest(BaseModel):
    """POST /repos/clone 요청."""

    url: str
    name: Optional[str] = None
    branch: Optional[str] = None


class CloneResponse(BaseModel):
    """POST /repos/clone 응답."""

    name: str
    path: str
    message: str


class PullResponse(BaseModel):
    """POST /repos/{name}/pull 응답."""

    name: str
    message: str
    output: str


class DeleteResponse(BaseModel):
    """DELETE /repos/{name} 응답."""

    name: str
    message: str


class RepoUpdateStatus(BaseModel):
    """단일 레포의 버전 업데이트 상태."""

    name: str
    current_version: Optional[str] = None
    latest_version: Optional[str] = None
    has_update: bool


class RepoUpdatesResponse(BaseModel):
    """GET /repos/updates 응답."""

    repos: list[RepoUpdateStatus]
    workspace_path: str
