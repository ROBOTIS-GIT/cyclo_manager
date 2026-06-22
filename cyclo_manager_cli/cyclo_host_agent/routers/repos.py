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

"""Repository management endpoints: git clone, pull, delete."""

import asyncio
import json
import re
import shutil
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status

from cyclo_host_agent.models import (
    CloneRequest,
    CloneResponse,
    DeleteResponse,
    PullResponse,
    RepoInfo,
    RepoListResponse,
    RepoUpdateStatus,
    RepoUpdatesResponse,
)

router = APIRouter(prefix='/repos', tags=['repos'])

WORKSPACE_PATH = Path('/root/ros2_ws/src')
GIT_TIMEOUT = 120.0  # seconds


async def _git(args: list[str], cwd: Optional[Path] = None) -> tuple[int, str, str]:
    """
    git 명령을 비동기로 실행하고 (returncode, stdout, stderr)를 반환한다.

    GIT_TIMEOUT 초 안에 완료되지 않으면 프로세스를 강제 종료하고 TimeoutError를 던진다.
    """
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
    """
    단일 git 레포 경로에서 브랜치명과 origin remote URL을 읽어 RepoInfo를 반환한다.

    git 명령 실패 시 해당 필드를 None으로 두고 계속 진행한다.
    """
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


def _parse_github_slug(remote_url: str) -> Optional[str]:
    """git remote URL에서 'owner/repo' 슬러그를 파싱한다. GitHub URL이 아니면 None."""
    https_match = re.match(r'https?://github\.com/([^/]+/[^/]+?)(?:\.git)?/?$', remote_url)
    if https_match:
        return https_match.group(1)
    ssh_match = re.match(r'git@github\.com:([^/]+/[^/]+?)(?:\.git)?$', remote_url)
    if ssh_match:
        return ssh_match.group(1)
    return None


def _read_package_xml_version(repo_path: Path) -> Optional[str]:
    """repo 디렉토리에서 package.xml을 찾아 <version> 값을 반환한다."""
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


def _fetch_github_latest(slug: str) -> Optional[str]:
    """GitHub Releases API에서 최신 tag_name을 가져온다. 실패 시 None."""
    url = f'https://api.github.com/repos/{slug}/releases/latest'
    req = urllib.request.Request(url, headers={'User-Agent': 'cyclo-manager/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return (data.get('tag_name') or '').strip() or None
    except Exception:
        return None


async def _repo_update_status(repo_path: Path) -> RepoUpdateStatus:
    """단일 레포의 버전 업데이트 상태를 반환한다."""
    rc, remote_url, _ = await _git(['remote', 'get-url', 'origin'], cwd=repo_path)
    remote_url = remote_url.strip() if rc == 0 else ''

    slug = _parse_github_slug(remote_url) if remote_url else None
    if not slug:
        return RepoUpdateStatus(name=repo_path.name, has_update=False)

    current = _read_package_xml_version(repo_path)
    if not current:
        return RepoUpdateStatus(name=repo_path.name, has_update=False)

    latest = await asyncio.to_thread(_fetch_github_latest, slug)
    if not latest:
        return RepoUpdateStatus(
            name=repo_path.name, current_version=current, has_update=False
        )

    has_update = _is_newer(latest, current)
    return RepoUpdateStatus(
        name=repo_path.name,
        current_version=current,
        latest_version=latest,
        has_update=has_update,
    )


@router.get('/updates', response_model=RepoUpdatesResponse)
async def get_repo_updates() -> RepoUpdatesResponse:
    """
    워크스페이스 내 각 레포의 GitHub 최신 릴리즈와 package.xml 버전을 비교해 반환한다.

    GitHub URL이 아닌 remote이거나 package.xml이 없는 레포는 has_update=False로 포함된다.
    """
    if not WORKSPACE_PATH.exists():
        return RepoUpdatesResponse(repos=[], workspace_path=str(WORKSPACE_PATH))

    repo_paths = [
        item for item in sorted(WORKSPACE_PATH.iterdir())
        if item.is_dir() and (item / '.git').exists()
    ]
    statuses = await asyncio.gather(*(_repo_update_status(p) for p in repo_paths))
    return RepoUpdatesResponse(repos=list(statuses), workspace_path=str(WORKSPACE_PATH))


@router.get('', response_model=RepoListResponse)
async def list_repos() -> RepoListResponse:
    """
    워크스페이스 내 모든 git 레포를 목록으로 반환한다.

    WORKSPACE_PATH 하위 디렉토리 중 .git 폴더가 있는 것만 레포로 인식한다.
    워크스페이스 경로가 존재하지 않으면 빈 목록을 반환한다.
    """
    if not WORKSPACE_PATH.exists():
        return RepoListResponse(repos=[], workspace_path=str(WORKSPACE_PATH))
    repos = [
        await _repo_info(item)
        for item in sorted(WORKSPACE_PATH.iterdir())
        if item.is_dir() and (item / '.git').exists()
    ]
    return RepoListResponse(repos=repos, workspace_path=str(WORKSPACE_PATH))


@router.post('/clone', response_model=CloneResponse, status_code=status.HTTP_201_CREATED)
async def clone_repo(req: CloneRequest) -> CloneResponse:
    """
    지정한 URL의 git 레포를 워크스페이스에 클론한다.

    name을 생략하면 URL 마지막 경로에서 레포 이름을 추출한다.
    branch를 지정하면 해당 브랜치를 체크아웃한다.
    이미 같은 이름의 디렉토리가 존재하면 409를 반환한다.
    """
    name = req.name or req.url.rstrip('/').split('/')[-1].removesuffix('.git')
    dest = WORKSPACE_PATH / name
    if dest.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{name}' already exists. Delete it first or provide a different name.",
        )
    WORKSPACE_PATH.mkdir(parents=True, exist_ok=True)
    args = ['clone', req.url]
    if req.branch:
        args += ['-b', req.branch]
    args.append(str(dest))
    try:
        rc, _, stderr = await _git(args)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail='git clone timed out')
    if rc != 0:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f'git clone failed: {stderr.strip()}')
    return CloneResponse(name=name, path=str(dest), message='Clone successful')


@router.post('/{name}/pull', response_model=PullResponse)
async def pull_repo(name: str) -> PullResponse:
    """
    워크스페이스 내 지정한 레포에서 git pull을 실행한다.

    레포가 존재하지 않으면 404, .git 폴더가 없으면 400을 반환한다.
    pull 결과(stdout + stderr)를 응답에 포함한다.
    """
    repo_path = WORKSPACE_PATH / name
    if not repo_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Repo '{name}' not found in workspace")
    if not (repo_path / '.git').exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"'{name}' is not a git repository")
    try:
        rc, stdout, stderr = await _git(['pull'], cwd=repo_path)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail='git pull timed out')
    if rc != 0:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f'git pull failed: {stderr.strip()}')
    return PullResponse(name=name, message='Pull successful', output=(stdout + stderr).strip())


@router.delete('/{name}', response_model=DeleteResponse)
async def delete_repo(name: str) -> DeleteResponse:
    """
    워크스페이스 내 지정한 레포 디렉토리를 완전히 삭제한다(rm -rf).

    .git 폴더가 없는 일반 디렉토리는 실수로 삭제되지 않도록 400을 반환한다.
    삭제는 블로킹 I/O이므로 스레드풀에서 실행한다.
    """
    repo_path = WORKSPACE_PATH / name
    if not repo_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Repo '{name}' not found in workspace")
    if not (repo_path / '.git').exists():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"'{name}' is not a git repository")
    try:
        await asyncio.to_thread(shutil.rmtree, repo_path)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f'Failed to delete: {e}')
    return DeleteResponse(name=name, message='Deleted successfully')
