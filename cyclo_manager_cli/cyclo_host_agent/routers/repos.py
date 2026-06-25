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

"""Repository management endpoints."""

import asyncio
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status

from cyclo_host_agent.models import (
    ContainerScriptResponse,
    FileChange,
    RepoInfo,
    RepoListResponse,
    RepoStatusResponse,
    RepoUpdateStatus,
    RepoUpdatesResponse,
    UpdateRequest,
    UpdateResponse,
)

router = APIRouter(prefix='/repos', tags=['repos'])

GIT_TIMEOUT = 120.0


def _resolve_home() -> Path:
    sudo_user = os.environ.get('SUDO_USER')
    if sudo_user:
        return Path(f'/home/{sudo_user}')
    return Path.home()


WORKSPACE_PATH = _resolve_home()
MANAGED_GITHUB_ORG = 'ROBOTIS-GIT'
ALLOWED_UPDATE_BRANCHES = frozenset({'main', 'jazzy'})


# ── shared helpers ─────────────────────────────────────────────────────────────

def _get_repo(name: str) -> Path:
    """Return the repo path, raising HTTPException if it does not exist or is not a git repo."""
    repo_path = WORKSPACE_PATH / name
    if not repo_path.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Repo '{name}' not found")
    if not (repo_path / '.git').exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"'{name}' is not a git repository")
    return repo_path


def _scan_repo_paths() -> list[Path]:
    """Return all directories under WORKSPACE_PATH that contain a .git folder."""
    if not WORKSPACE_PATH.exists():
        return []
    return [
        item for item in sorted(WORKSPACE_PATH.iterdir())
        if item.is_dir() and (item / '.git').exists()
    ]


def _fmt_cmd(cmd: str, output: str) -> str:
    return f'$ {cmd}\n{output.strip()}' if output.strip() else f'$ {cmd}'


# ── git helpers ────────────────────────────────────────────────────────────────

async def _stash_count(cwd: Path) -> int:
    rc, out, _ = await _git(['stash', 'list'], cwd=cwd)
    if rc != 0:
        return 0
    return sum(1 for line in out.splitlines() if line.strip())


async def _current_branch(repo_path: Path) -> Optional[str]:
    rc, out, _ = await _git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd=repo_path)
    if rc != 0:
        return None
    branch = out.strip()
    if not branch or branch == 'HEAD':
        return None
    return branch


async def _ensure_allowed_branch(repo_path: Path) -> None:
    branch = await _current_branch(repo_path)
    if branch in ALLOWED_UPDATE_BRANCHES:
        return
    allowed = ', '.join(sorted(ALLOWED_UPDATE_BRANCHES))
    if branch:
        detail = (
            f"Updates are only allowed on branches: {allowed}. "
            f"Current branch is '{branch}'."
        )
    else:
        detail = (
            f"Updates are only allowed on branches: {allowed}. "
            'Could not determine the current branch (detached HEAD?).'
        )
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def _git(args: list[str], cwd: Optional[Path] = None) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        'git', *args,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=GIT_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise
    return proc.returncode, stdout.decode(), stderr.decode()


async def _repo_info(repo_path: Path) -> RepoInfo:
    branch: Optional[str] = None
    remote: Optional[str] = None
    try:
        rc, out, _ = await _git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd=repo_path)
        if rc == 0:
            branch = out.strip()
        rc, out, _ = await _git(['remote', 'get-url', 'origin'], cwd=repo_path)
        if rc == 0:
            remote = out.strip()
    except Exception:
        pass
    return RepoInfo(name=repo_path.name, path=str(repo_path), branch=branch, remote=remote)


# ── version check helpers ──────────────────────────────────────────────────────

def _parse_version(version_str: str) -> tuple[int, ...]:
    parts = []
    for p in (version_str or '').strip().lstrip('v').split('.'):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts) if parts else (0,)


def _is_newer(latest: str, current: str) -> bool:
    return _parse_version(latest) > _parse_version(current)


def _is_managed_remote(remote_url: str) -> bool:
    https_match = re.match(r'https?://github\.com/([^/]+)/', remote_url)
    if https_match:
        return https_match.group(1).lower() == MANAGED_GITHUB_ORG.lower()
    ssh_match = re.match(r'git@github\.com:([^/]+)/', remote_url)
    if ssh_match:
        return ssh_match.group(1).lower() == MANAGED_GITHUB_ORG.lower()
    return False


def _read_package_xml_version(repo_path: Path) -> Optional[str]:
    candidates = [repo_path / 'package.xml'] + sorted(repo_path.glob('*/package.xml'))
    for candidate in candidates:
        if candidate.is_file():
            try:
                text = candidate.read_text(errors='replace')
                m = re.search(r'<version>\s*([^<]+)\s*</version>', text)
                if m:
                    return m.group(1).strip()
            except OSError:
                continue
    return None


async def _fetch_latest_tag(remote_url: str) -> Optional[str]:
    rc, out, _ = await _git(['ls-remote', '--tags', remote_url])
    if rc != 0:
        return None
    tags = []
    for line in out.splitlines():
        if 'refs/tags/' not in line or '^{}' in line:
            continue
        tags.append(line.split('refs/tags/')[-1].strip())
    if not tags:
        return None
    return max(tags, key=_parse_version)


async def _repo_update_status(repo_path: Path) -> Optional[RepoUpdateStatus]:
    rc, remote_url, _ = await _git(['remote', 'get-url', 'origin'], cwd=repo_path)
    remote_url = remote_url.strip() if rc == 0 else ''

    if not remote_url or not _is_managed_remote(remote_url):
        return None

    rc, branch_out, _ = await _git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd=repo_path)
    branch = branch_out.strip() if rc == 0 else None

    current = _read_package_xml_version(repo_path)
    if not current:
        return RepoUpdateStatus(name=repo_path.name, branch=branch, has_update=False)

    latest = await _fetch_latest_tag(remote_url)
    if not latest:
        return RepoUpdateStatus(name=repo_path.name, branch=branch, current_version=current, has_update=False)

    return RepoUpdateStatus(
        name=repo_path.name,
        branch=branch,
        current_version=current,
        latest_version=latest,
        has_update=_is_newer(latest, current),
    )


# ── update strategy helpers ────────────────────────────────────────────────────

async def _update_stash(repo_path: Path) -> UpdateResponse:
    name = repo_path.name
    lines: list[str] = []

    stash_before = await _stash_count(repo_path)
    rc, out, err = await _git(['stash', '-u'], cwd=repo_path)
    lines.append(_fmt_cmd('git stash -u', out + err))
    if rc != 0:
        return UpdateResponse(name=name, success=False, output='\n'.join(lines))
    stashed = await _stash_count(repo_path) > stash_before

    rc, out, err = await _git(['pull'], cwd=repo_path)
    lines.append(_fmt_cmd('git pull', out + err))
    if rc != 0:
        if stashed:
            await _git(['stash', 'pop'], cwd=repo_path)
        return UpdateResponse(name=name, success=False, output='\n'.join(lines))

    if not stashed:
        return UpdateResponse(name=name, success=True, output='\n'.join(lines))

    rc, out, err = await _git(['stash', 'pop'], cwd=repo_path)
    lines.append(_fmt_cmd('git stash pop', out + err))

    stash_conflict = False
    stash_conflict_files: list[str] = []
    if rc != 0:
        _, conflict_out, _ = await _git(
            ['diff', '--name-only', '--diff-filter=U'], cwd=repo_path
        )
        stash_conflict_files = [f for f in conflict_out.splitlines() if f.strip()]
        await _git(['checkout', 'stash@{0}', '--', '.'], cwd=repo_path)
        await _git(['reset', 'HEAD', '.'], cwd=repo_path)
        await _git(['stash', 'drop'], cwd=repo_path)
        stash_conflict = True
        lines.append(
            'Conflict detected — local changes preserved'
            + (f': {", ".join(stash_conflict_files)}' if stash_conflict_files else '')
        )

    return UpdateResponse(
        name=name, success=True, output='\n'.join(lines),
        stash_conflict=stash_conflict, stash_conflict_files=stash_conflict_files,
    )


async def _update_reset(repo_path: Path, preserve_files: list[str]) -> UpdateResponse:
    name = repo_path.name
    lines: list[str] = []

    backups: dict[str, bytes] = {}
    for rel in preserve_files:
        full = repo_path / rel
        if full.is_file():
            try:
                backups[rel] = full.read_bytes()
            except OSError:
                pass

    rc, out, err = await _git(['reset', '--hard', 'HEAD'], cwd=repo_path)
    lines.append(_fmt_cmd('git reset --hard HEAD', out + err))

    rc, out, err = await _git(['clean', '-fd'], cwd=repo_path)
    lines.append(_fmt_cmd('git clean -fd', out + err))

    rc, out, err = await _git(['pull'], cwd=repo_path)
    lines.append(_fmt_cmd('git pull', out + err))
    if rc != 0:
        return UpdateResponse(name=name, success=False, output='\n'.join(lines))

    for rel, content in backups.items():
        full = repo_path / rel
        try:
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(content)
            lines.append(f'Restored: {rel}')
        except OSError as e:
            lines.append(f'Restore failed: {rel} ({e})')

    return UpdateResponse(name=name, success=True, output='\n'.join(lines))


# ── container helper ───────────────────────────────────────────────────────────

async def _run_container_sh(repo_path: Path, action: str) -> tuple[bool, str]:
    script = repo_path / 'docker' / 'container.sh'
    if not script.exists():
        return False, f'container.sh not found at {script}'
    proc = await asyncio.create_subprocess_exec(
        'bash', str(script), action,
        cwd=str(repo_path / 'docker'),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(input=b'y\n'), timeout=300.0)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return False, 'Timeout waiting for container.sh'
    return proc.returncode == 0, (stdout.decode() + stderr.decode()).strip()


# ── endpoints ──────────────────────────────────────────────────────────────────

@router.get('/updates', response_model=RepoUpdatesResponse)
async def get_repo_updates() -> RepoUpdatesResponse:
    repo_paths = _scan_repo_paths()
    raw = await asyncio.gather(*(_repo_update_status(p) for p in repo_paths))
    statuses = [s for s in raw if s is not None]
    return RepoUpdatesResponse(repos=statuses, workspace_path=str(WORKSPACE_PATH))


@router.get('', response_model=RepoListResponse)
async def list_repos() -> RepoListResponse:
    candidates = _scan_repo_paths()
    infos = await asyncio.gather(*(_repo_info(item) for item in candidates))
    repos = [r for r in infos if r.remote and _is_managed_remote(r.remote)]
    return RepoListResponse(repos=repos, workspace_path=str(WORKSPACE_PATH))


@router.get('/{name}/status', response_model=RepoStatusResponse)
async def get_repo_status(name: str) -> RepoStatusResponse:
    repo_path = _get_repo(name)
    rc, out, _ = await _git(['status', '--porcelain'], cwd=repo_path)
    changes: list[FileChange] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        code = line[0:2].rstrip()
        path = line[3:].strip()
        if ' -> ' in path:
            path = path.split(' -> ', 1)[1]
        changes.append(FileChange(path=path, status=code))
    return RepoStatusResponse(name=name, changes=changes, has_changes=bool(changes))


@router.post('/{name}/container/stop', response_model=ContainerScriptResponse)
async def stop_repo_container(name: str) -> ContainerScriptResponse:
    repo_path = _get_repo(name)
    success, output = await _run_container_sh(repo_path, 'stop')
    return ContainerScriptResponse(name=name, action='stop', success=success, output=output)


@router.post('/{name}/container/start', response_model=ContainerScriptResponse)
async def start_repo_container(name: str) -> ContainerScriptResponse:
    repo_path = _get_repo(name)
    success, output = await _run_container_sh(repo_path, 'start')
    return ContainerScriptResponse(name=name, action='start', success=success, output=output)


@router.post('/{name}/update', response_model=UpdateResponse)
async def update_repo(name: str, req: UpdateRequest) -> UpdateResponse:
    repo_path = _get_repo(name)
    await _ensure_allowed_branch(repo_path)
    try:
        if req.strategy == 'reset':
            return await _update_reset(repo_path, req.preserve_files)
        return await _update_stash(repo_path)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                            detail='git operation timed out')
