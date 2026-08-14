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

"""Host file browser and editor endpoints."""

import os
import shutil
from pathlib import Path

from cyclo_host_agent.models import (
    FileCreateRequest,
    FileOperationResponse,
    FileReadResponse,
    FileRenameRequest,
    FileTreeEntry,
    FileTreeResponse,
    FileWriteRequest,
)
from fastapi import APIRouter, HTTPException, Query, status

router = APIRouter(prefix='/files', tags=['files'])

MAX_READ_BYTES = 2 * 1024 * 1024
MAX_WRITE_BYTES = 4 * 1024 * 1024


def _resolve_file_root() -> Path:
    configured_root = os.environ.get('CYCLO_HOST_AGENT_FILE_ROOT')
    if configured_root:
        return Path(configured_root).expanduser().resolve()
    sudo_user = os.environ.get('SUDO_USER')
    if sudo_user:
        return Path(f'/home/{sudo_user}').resolve()
    return Path.home().resolve()


FILE_ROOT_PATH = _resolve_file_root()


def _safe_path(relative_path: str = '') -> tuple[Path, str]:
    target = (FILE_ROOT_PATH / relative_path).resolve()
    if target != FILE_ROOT_PATH and FILE_ROOT_PATH not in target.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path escapes file root')
    rel = '' if target == FILE_ROOT_PATH else target.relative_to(FILE_ROOT_PATH).as_posix()
    return target, rel


def _is_binary(path: Path) -> bool:
    try:
        return b'\x00' in path.read_bytes()[:8192]
    except OSError:
        return True


def _entry(path: Path) -> FileTreeEntry:
    stat = path.lstat()
    return FileTreeEntry(
        name=path.name,
        path='' if path == FILE_ROOT_PATH else path.relative_to(FILE_ROOT_PATH).as_posix(),
        type='directory' if path.is_dir() else 'file',
        size=None if path.is_dir() else stat.st_size,
        modified=stat.st_mtime,
        readonly=not os.access(path, os.W_OK),
        hidden=path.name.startswith('.'),
        symlink=path.is_symlink(),
    )


@router.get('/tree', response_model=FileTreeResponse)
async def list_directory(
    path: str = '',
    show_hidden: bool = Query(False),
) -> FileTreeResponse:
    """Return one directory level under the configured file root."""
    target, rel = _safe_path(path)
    if not target.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not a directory')

    entries: list[FileTreeEntry] = []
    for child in sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        if not show_hidden and child.name.startswith('.'):
            continue
        try:
            entries.append(_entry(child))
        except OSError:
            continue
    return FileTreeResponse(root_path=str(FILE_ROOT_PATH), path=rel, entries=entries)


@router.get('/read', response_model=FileReadResponse)
async def read_file(
    path: str,
) -> FileReadResponse:
    """Read a UTF-8 text file under the configured file root."""
    target, rel = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not a file')
    stat = target.stat()
    if stat.st_size > MAX_READ_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='File is too large to edit')
    if _is_binary(target):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail='Binary files are not editable')
    try:
        content = target.read_text(encoding='utf-8', errors='replace')
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    return FileReadResponse(
        path=rel,
        content=content,
        size=stat.st_size,
        modified=stat.st_mtime,
        readonly=not os.access(target, os.W_OK),
    )


@router.post('/write', response_model=FileOperationResponse)
async def write_file(req: FileWriteRequest) -> FileOperationResponse:
    """Write a UTF-8 text file under the configured file root."""
    target, rel = _safe_path(req.path)
    if target.exists() and not target.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not a file')
    if len(req.content.encode('utf-8')) > MAX_WRITE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='Content is too large')
    if req.expected_modified is not None and target.exists():
        current_modified = target.stat().st_mtime
        if abs(current_modified - req.expected_modified) > 0.001:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='File changed on disk')
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(req.content, encoding='utf-8')
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    return FileOperationResponse(path=rel, success=True, message='Saved')


@router.post('/create', response_model=FileOperationResponse)
async def create_path(req: FileCreateRequest) -> FileOperationResponse:
    """Create a file or folder under the configured file root."""
    target, rel = _safe_path(req.path)
    if target.exists():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Path already exists')
    try:
        if req.type == 'directory':
            target.mkdir(parents=True)
            message = 'Folder created'
        elif req.type == 'file':
            if len(req.content.encode('utf-8')) > MAX_WRITE_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='Content is too large')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(req.content, encoding='utf-8')
            message = 'File created'
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Type must be file or directory')
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    return FileOperationResponse(path=rel, success=True, message=message)


@router.post('/rename', response_model=FileOperationResponse)
async def rename_path(req: FileRenameRequest) -> FileOperationResponse:
    """Rename a file or folder under the configured file root."""
    target, _ = _safe_path(req.path)
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Path not found')
    if '/' in req.new_name or '\\' in req.new_name or req.new_name in {'', '.', '..'}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid name')
    destination = (target.parent / req.new_name).resolve()
    if destination != FILE_ROOT_PATH and FILE_ROOT_PATH not in destination.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path escapes file root')
    if destination.exists():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Destination already exists')
    try:
        target.rename(destination)
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    rel = '' if destination == FILE_ROOT_PATH else destination.relative_to(FILE_ROOT_PATH).as_posix()
    return FileOperationResponse(path=rel, success=True, message='Renamed')


@router.delete('', response_model=FileOperationResponse)
async def delete_path(
    path: str,
    recursive: bool = Query(False),
) -> FileOperationResponse:
    """Delete a file or folder under the configured file root."""
    target, rel = _safe_path(path)
    if target == FILE_ROOT_PATH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Cannot delete file root')
    if not target.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Path not found')
    try:
        if target.is_dir():
            if recursive:
                shutil.rmtree(target)
            else:
                target.rmdir()
        else:
            target.unlink()
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    return FileOperationResponse(path=rel, success=True, message='Deleted')
