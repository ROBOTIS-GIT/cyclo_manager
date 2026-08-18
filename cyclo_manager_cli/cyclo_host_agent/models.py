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
    branch: Optional[str] = None
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


class RepoBranchCheckResponse(BaseModel):
    """Response for GET /repos/{name}/branch."""

    name: str
    branch: Optional[str] = None
    allowed: bool


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


class ContainerStartStatusResponse(BaseModel):
    """Current output/status for a container start operation."""

    running: bool
    output: str
    success: bool | None = None
    error: str = ''


class HostSystemStatsResponse(BaseModel):
    """Host CPU/memory/disk/uptime/temperature status."""

    cpu_percent: float
    memory_used_mb: int
    memory_total_mb: int
    disk_used_gb: float
    disk_total_gb: float
    ssd_used_gb: float | None = None
    ssd_total_gb: float | None = None
    ssd_mount_path: str | None = None
    uptime_seconds: int
    temperature_celsius: float | None = None


class HostProcessInfo(BaseModel):
    """Single host process CPU/memory usage sample."""

    pid: int
    user: str
    cpu_percent: float
    memory_percent: float
    rss_kb: int | None = None
    command: str


class HostProcessesResponse(BaseModel):
    """Host process list with aggregate resource summary."""

    cpu_percent: float
    memory_used_mb: int
    memory_total_mb: int
    processes: list[HostProcessInfo]


class FileTreeEntry(BaseModel):
    """Single file browser entry."""

    name: str
    path: str
    type: str
    size: int | None = None
    modified: float | None = None
    readonly: bool = False
    hidden: bool = False
    symlink: bool = False
    git_status: str | None = None


class FileTreeResponse(BaseModel):
    """Response for GET /files/tree."""

    root_path: str
    path: str
    entries: list[FileTreeEntry]


class FileSearchResponse(BaseModel):
    """Response for GET /files/search."""

    root_path: str
    path: str
    query: str
    entries: list[FileTreeEntry]
    truncated: bool = False


class FileReadResponse(BaseModel):
    """Response for GET /files/read."""

    path: str
    content: str
    size: int
    modified: float
    readonly: bool = False


class FileDiffResponse(BaseModel):
    """Response for GET /files/diff."""

    path: str
    status: str
    original_content: str
    current_content: str


class FileWriteRequest(BaseModel):
    """Request body for POST /files/write."""

    path: str
    content: str
    expected_modified: float | None = None


class FileCreateRequest(BaseModel):
    """Request body for POST /files/create."""

    path: str
    type: str
    content: str = ''


class FileRenameRequest(BaseModel):
    """Request body for POST /files/rename."""

    path: str
    new_name: str


class FileUploadResponse(BaseModel):
    """Response for POST /files/upload."""

    name: str
    path: str
    size: int
    overwritten: bool = False
    success: bool
    message: str


class FileOperationResponse(BaseModel):
    """Generic file operation response."""

    path: str
    success: bool
    message: str
