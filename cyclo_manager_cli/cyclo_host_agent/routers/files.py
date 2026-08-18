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
import subprocess
import uuid
from pathlib import Path

from cyclo_host_agent.models import (
    FileCreateRequest,
    FileDiffResponse,
    FileOperationResponse,
    FileReadResponse,
    FileRenameRequest,
    FileSearchResponse,
    FileTreeEntry,
    FileTreeResponse,
    FileUploadResponse,
    FileWriteRequest,
)
from fastapi import APIRouter, HTTPException, Query, Request, status

router = APIRouter(prefix='/files', tags=['files'])

MAX_READ_BYTES = 2 * 1024 * 1024
MAX_WRITE_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_SEARCH_RESULTS = 200
MAX_SEARCH_VISITS = 20000
GIT_STATUS_TIMEOUT_SECONDS = 0.5
GIT_DIFF_TIMEOUT_SECONDS = 2.0
MAX_DIFF_BYTES = 2 * 1024 * 1024


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


def _safe_filename(filename: str) -> str:
    name = Path(filename).name
    if name in {'', '.', '..'} or name != filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid filename')
    return name


def _is_binary(path: Path) -> bool:
    try:
        return b'\x00' in path.read_bytes()[:8192]
    except OSError:
        return True


def _entry(path: Path, git_status: str | None = None) -> FileTreeEntry:
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
        git_status=git_status,
    )


def _run_git_text(
    args: list[str],
    cwd: Path,
    timeout: float = GIT_STATUS_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[str] | None:
    env = os.environ.copy()
    env['GIT_OPTIONAL_LOCKS'] = '0'
    try:
        return subprocess.run(
            ['git', *args],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def _run_git_bytes(args: list[str], cwd: Path) -> subprocess.CompletedProcess[bytes] | None:
    env = os.environ.copy()
    env['GIT_OPTIONAL_LOCKS'] = '0'
    try:
        return subprocess.run(
            ['git', *args],
            cwd=cwd,
            env=env,
            capture_output=True,
            timeout=GIT_STATUS_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def _merge_git_status(current: str | None, incoming: str) -> str:
    if current == 'modified' or incoming == 'modified':
        return 'modified'
    return incoming


def _git_status_by_entry_path(directory: Path, entries: list[FileTreeEntry]) -> dict[str, str]:
    if not entries:
        return {}

    root_result = _run_git_text(['rev-parse', '--show-toplevel'], directory)
    if not root_result or root_result.returncode != 0:
        return {}

    try:
        repo_root = Path(root_result.stdout.strip()).resolve()
        directory_rel = '' if directory == repo_root else directory.relative_to(repo_root).as_posix()
    except (OSError, ValueError):
        return {}

    entry_by_repo_path: dict[str, str] = {}
    for entry in entries:
        try:
            entry_abs = (FILE_ROOT_PATH / entry.path).resolve()
            entry_repo_path = entry_abs.relative_to(repo_root).as_posix()
        except (OSError, ValueError):
            continue
        entry_by_repo_path[entry_repo_path] = entry.path

    pathspec = '.' if not directory_rel else directory_rel
    status_result = _run_git_bytes(
        ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', pathspec],
        repo_root,
    )
    if not status_result or status_result.returncode != 0:
        return {}

    statuses: dict[str, str] = {}
    records = status_result.stdout.split(b'\0')
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if len(record) < 4:
            continue
        raw_status = record[:2].decode('ascii', errors='replace')
        git_path = record[3:].decode('utf-8', errors='surrogateescape')
        if raw_status[0] in {'R', 'C'} or raw_status[1] in {'R', 'C'}:
            index += 1

        if directory_rel:
            if git_path == directory_rel:
                continue
            prefix = f'{directory_rel}/'
            if not git_path.startswith(prefix):
                continue
            remainder = git_path[len(prefix):]
        else:
            remainder = git_path

        child_name = remainder.split('/', 1)[0]
        child_repo_path = f'{directory_rel}/{child_name}' if directory_rel else child_name
        entry_path = entry_by_repo_path.get(child_repo_path)
        if not entry_path:
            continue

        status_value = 'untracked' if raw_status == '??' else 'modified'
        statuses[entry_path] = _merge_git_status(statuses.get(entry_path), status_value)

    return statuses


def _git_root_for_path(path: Path) -> Path | None:
    cwd = path if path.is_dir() else path.parent
    result = _run_git_text(['rev-parse', '--show-toplevel'], cwd)
    if not result or result.returncode != 0:
        return None
    try:
        return Path(result.stdout.strip()).resolve()
    except OSError:
        return None


def _git_status_for_file(repo_root: Path, repo_path: str) -> str | None:
    result = _run_git_bytes(
        ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', repo_path],
        repo_root,
    )
    if not result or result.returncode != 0:
        return None
    first_record = result.stdout.split(b'\0', 1)[0]
    if len(first_record) < 4:
        return None
    raw_status = first_record[:2].decode('ascii', errors='replace')
    return 'untracked' if raw_status == '??' else 'modified'


def _read_text_file_for_diff(path: Path) -> str:
    stat = path.stat()
    if stat.st_size > MAX_DIFF_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='File is too large to diff')
    if _is_binary(path):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail='Binary files are not diffable')
    try:
        return path.read_text(encoding='utf-8', errors='replace')
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


def _git_head_content(repo_root: Path, repo_path: str) -> str:
    result = _run_git_text(
        ['show', f'HEAD:{repo_path}'],
        repo_root,
        timeout=GIT_DIFF_TIMEOUT_SECONDS,
    )
    if not result or result.returncode != 0:
        return ''
    if len(result.stdout.encode('utf-8')) > MAX_DIFF_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='Original file is too large to diff')
    return result.stdout


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
    git_statuses = _git_status_by_entry_path(target, entries)
    for entry in entries:
        entry.git_status = git_statuses.get(entry.path)
    return FileTreeResponse(root_path=str(FILE_ROOT_PATH), path=rel, entries=entries)


@router.get('/search', response_model=FileSearchResponse)
async def search_files(
    query: str,
    path: str = '',
    show_hidden: bool = Query(False),
    limit: int = Query(MAX_SEARCH_RESULTS, ge=1, le=1000),
) -> FileSearchResponse:
    """Search file and folder names recursively under the current directory."""
    target, rel = _safe_path(path)
    if not target.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not a directory')
    normalized_query = query.strip().lower()
    if not normalized_query:
        return FileSearchResponse(root_path=str(FILE_ROOT_PATH), path=rel, query=query, entries=[])

    entries: list[FileTreeEntry] = []
    visits = 0
    truncated = False
    stack = [target]
    while stack:
        current = stack.pop()
        try:
            children = sorted(current.iterdir(), key=lambda item: item.name.lower(), reverse=True)
        except OSError:
            continue
        for child in children:
            visits += 1
            if visits > MAX_SEARCH_VISITS:
                truncated = True
                stack.clear()
                break
            if not show_hidden and child.name.startswith('.'):
                continue
            if normalized_query in child.name.lower():
                try:
                    entries.append(_entry(child))
                except OSError:
                    pass
                if len(entries) >= limit:
                    truncated = True
                    stack.clear()
                    break
            if child.is_dir() and not child.is_symlink():
                stack.append(child)

    return FileSearchResponse(
        root_path=str(FILE_ROOT_PATH),
        path=rel,
        query=query,
        entries=entries,
        truncated=truncated,
    )


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


@router.get('/diff', response_model=FileDiffResponse)
async def diff_file(
    path: str,
) -> FileDiffResponse:
    """Return original and current file content for a git diff view."""
    target, rel = _safe_path(path)
    if not target.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not a file')

    repo_root = _git_root_for_path(target)
    if not repo_root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not in a git repository')
    try:
        repo_path = target.relative_to(repo_root).as_posix()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not in a git repository')

    git_status = _git_status_for_file(repo_root, repo_path)
    if not git_status:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='File has no git changes')

    current_content = _read_text_file_for_diff(target)
    original_content = '' if git_status == 'untracked' else _git_head_content(repo_root, repo_path)
    return FileDiffResponse(
        path=rel,
        status=git_status,
        original_content=original_content,
        current_content=current_content,
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


@router.post('/upload', response_model=FileUploadResponse)
async def upload_file(
    request: Request,
    path: str = '',
    filename: str = Query(...),
    overwrite: bool = False,
) -> FileUploadResponse:
    """Upload one file into a directory under the configured file root."""
    target_dir, _ = _safe_path(path)
    if not target_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path is not a directory')

    safe_name = _safe_filename(filename)
    destination = (target_dir / safe_name).resolve()
    if destination != FILE_ROOT_PATH and FILE_ROOT_PATH not in destination.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Path escapes file root')
    if destination.exists() and destination.is_dir():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='A folder with that name already exists')
    overwritten = destination.exists()
    if overwritten and not overwrite:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='File already exists')

    temp_path = target_dir / f'.{safe_name}.{uuid.uuid4().hex}.uploading'
    size_bytes = 0
    try:
        with temp_path.open('wb') as output:
            async for chunk in request.stream():
                size_bytes += len(chunk)
                if size_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='File is too large to upload')
                output.write(chunk)
        os.replace(temp_path, destination)
    except HTTPException:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    except OSError as exc:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    rel = destination.relative_to(FILE_ROOT_PATH).as_posix()
    return FileUploadResponse(
        name=safe_name,
        path=rel,
        size=size_bytes,
        overwritten=overwritten,
        success=True,
        message='Uploaded',
    )


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
