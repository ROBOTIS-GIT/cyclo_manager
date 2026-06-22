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
    """Single git repository info."""

    name: str
    path: str
    branch: Optional[str] = None
    remote: Optional[str] = None


class RepoListResponse(BaseModel):
    """Response for GET /repos."""

    repos: list[RepoInfo]
    workspace_path: str


class RepoUpdateStatus(BaseModel):
    """Version update status for a single repository."""

    name: str
    current_version: Optional[str] = None
    latest_version: Optional[str] = None
    has_update: bool


class RepoUpdatesResponse(BaseModel):
    """Response for GET /repos/updates."""

    repos: list[RepoUpdateStatus]
    workspace_path: str


class FileChange(BaseModel):
    """A single entry from git status --porcelain."""

    path: str
    status: str  # e.g. M, D, ??, etc.


class RepoStatusResponse(BaseModel):
    """Response for GET /repos/{name}/status."""

    name: str
    changes: list[FileChange]
    has_changes: bool


class UpdateRequest(BaseModel):
    """Request body for POST /repos/{name}/update."""

    strategy: str  # 'stash' | 'reset'
    preserve_files: list[str] = []  # files to keep when using the reset strategy


class UpdateResponse(BaseModel):
    """Response for POST /repos/{name}/update."""

    name: str
    success: bool
    output: str
    stash_conflict: bool = False
    stash_conflict_files: list[str] = []


class ContainerScriptResponse(BaseModel):
    """Response for POST /repos/{name}/container/{action}."""

    name: str
    action: str
    success: bool
    output: str
