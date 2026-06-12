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
# Author: Howon Kim

"""Map file maintenance endpoints."""

import base64
import logging
from pathlib import PurePosixPath

from cyclo_manager.state import get_docker_client, get_validated_container
from docker.errors import DockerException, NotFound
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/{container}/maps', tags=['maps'])

MAPS_DIR = PurePosixPath('/root/ros2_ws/src/ai_worker/ffw_navigation/maps')


class PgmFileInfo(BaseModel):
    """PGM file entry under the maps directory."""

    path: str
    name: str


class PgmFileListResponse(BaseModel):
    """Response containing available PGM files."""

    container: str
    files: list[PgmFileInfo]


class PgmImageResponse(BaseModel):
    """Decoded PGM image for browser canvas rendering."""

    container: str
    path: str
    width: int
    height: int
    maxval: int
    pixels_base64: str


class PgmSaveRequest(BaseModel):
    """Request body for saving an edited PGM image in place."""

    path: str = Field(..., description='PGM file path relative to the maps directory')
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    maxval: int = Field(..., gt=0, le=255)
    pixels_base64: str


class PgmSaveResponse(BaseModel):
    """Response for selected PGM save operation."""

    container: str
    path: str
    width: int
    height: int
    saved: bool


def _is_under_maps_dir(path: PurePosixPath) -> bool:
    return path == MAPS_DIR or str(path).startswith(str(MAPS_DIR) + '/')


def _normalize_posix_path(path: PurePosixPath) -> PurePosixPath:
    parts: list[str] = []
    for part in path.parts:
        if part in {'', '/'}:
            continue
        if part == '.':
            continue
        if part == '..':
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return PurePosixPath('/' + '/'.join(parts))


def _resolve_relative_pgm_path(path: str) -> PurePosixPath:
    raw = path.strip()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='PGM path must not be empty',
        )
    candidate = PurePosixPath(raw)
    resolved = _normalize_posix_path(candidate if candidate.is_absolute() else MAPS_DIR / candidate)
    if not _is_under_maps_dir(resolved) or resolved.suffix.lower() != '.pgm':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'PGM path must be a .pgm file under {MAPS_DIR}',
        )
    return resolved


def _relative_to_maps_dir(path: PurePosixPath) -> str:
    return str(path).removeprefix(str(MAPS_DIR) + '/')


def _read_container_file(docker_client, container: str, path: PurePosixPath) -> bytes:
    return docker_client.read_container_file_bytes(container, str(path))


def _skip_pnm_ws_and_comments(data: bytes, index: int) -> int:
    while index < len(data):
        byte = data[index]
        if byte == ord('#'):
            while index < len(data) and data[index] not in (10, 13):
                index += 1
            continue
        if chr(byte).isspace():
            index += 1
            continue
        break
    return index


def _read_pnm_token(data: bytes, index: int) -> tuple[str, int]:
    index = _skip_pnm_ws_and_comments(data, index)
    start = index
    while index < len(data) and not chr(data[index]).isspace() and data[index] != ord('#'):
        index += 1
    if start == index:
        raise ValueError('Unexpected end of PGM header')
    return data[start:index].decode('ascii'), index


def _parse_pgm(data: bytes) -> tuple[int, int, int, list[int]]:
    magic, index = _read_pnm_token(data, 0)
    if magic not in {'P2', 'P5'}:
        raise ValueError(f'Unsupported PGM magic: {magic}')
    width_token, index = _read_pnm_token(data, index)
    height_token, index = _read_pnm_token(data, index)
    maxval_token, index = _read_pnm_token(data, index)
    width = int(width_token)
    height = int(height_token)
    maxval = int(maxval_token)
    if width <= 0 or height <= 0 or maxval <= 0 or maxval > 255:
        raise ValueError('Only 8-bit PGM files with positive dimensions are supported')
    pixel_count = width * height

    if magic == 'P5':
        if index < len(data) and chr(data[index]).isspace():
            index += 1
        pixels = list(data[index:index + pixel_count])
        if len(pixels) != pixel_count:
            raise ValueError('PGM pixel data is shorter than expected')
        return width, height, maxval, pixels

    pixels: list[int] = []
    for _ in range(pixel_count):
        token, index = _read_pnm_token(data, index)
        value = int(token)
        if value < 0 or value > maxval:
            raise ValueError('PGM pixel value is outside maxval')
        pixels.append(value)
    return width, height, maxval, pixels


def _encode_pgm(width: int, height: int, maxval: int, pixels: list[int]) -> bytes:
    header = f'P5\n# fixed by cyclo_manager\n{width} {height}\n{maxval}\n'.encode('ascii')
    return header + bytes(pixels)


@router.get('/pgm-files', response_model=PgmFileListResponse)
async def list_pgm_files(
    container: str = Depends(get_validated_container),
    docker_client=Depends(get_docker_client),
) -> PgmFileListResponse:
    """List PGM files under the ai_worker maps directory."""
    if container != 'ai_worker':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='PGM editing is currently supported only for the ai_worker container',
        )
    try:
        container_obj = docker_client.get_container(container)
        result = container_obj.exec_run([
            'find',
            str(MAPS_DIR),
            '-maxdepth',
            '4',
            '-type',
            'f',
            '-name',
            '*.pgm',
        ])
    except (DockerException, NotFound) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to list PGM files: {exc}',
        )

    if result.exit_code != 0:
        output = (result.output or b'').decode('utf-8', errors='replace').strip()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to list PGM files: {output}',
        )

    files: list[PgmFileInfo] = []
    for line in (result.output or b'').decode('utf-8', errors='replace').splitlines():
        full_path = _normalize_posix_path(PurePosixPath(line.strip()))
        if not _is_under_maps_dir(full_path) or full_path.suffix.lower() != '.pgm':
            continue
        relative = _relative_to_maps_dir(full_path)
        files.append(PgmFileInfo(path=relative, name=full_path.name))

    files.sort(key=lambda item: item.path)
    return PgmFileListResponse(container=container, files=files)


@router.get('/pgm', response_model=PgmImageResponse)
async def get_pgm_image(
    path: str,
    container: str = Depends(get_validated_container),
    docker_client=Depends(get_docker_client),
) -> PgmImageResponse:
    """Read and decode a selected PGM file."""
    if container != 'ai_worker':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='PGM editing is currently supported only for the ai_worker container',
        )
    pgm_path = _resolve_relative_pgm_path(path)
    try:
        pgm_bytes = _read_container_file(docker_client, container, pgm_path)
        width, height, maxval, pixels = _parse_pgm(pgm_bytes)
    except (FileNotFoundError, NotFound):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'PGM file not found: {path}',
        )
    except (DockerException, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to read PGM file: {exc}',
        )

    return PgmImageResponse(
        container=container,
        path=_relative_to_maps_dir(pgm_path),
        width=width,
        height=height,
        maxval=maxval,
        pixels_base64=base64.b64encode(bytes(pixels)).decode('ascii'),
    )


@router.post('/pgm/save', response_model=PgmSaveResponse)
async def save_pgm_image(
    request: PgmSaveRequest,
    container: str = Depends(get_validated_container),
    docker_client=Depends(get_docker_client),
) -> PgmSaveResponse:
    """Save a selected PGM file in place without creating a backup."""
    if container != 'ai_worker':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='PGM editing is currently supported only for the ai_worker container',
        )
    pgm_path = _resolve_relative_pgm_path(request.path)
    try:
        pixels = list(base64.b64decode(request.pixels_base64.encode('ascii'), validate=True))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Invalid PGM pixel payload: {exc}',
        )
    if len(pixels) != request.width * request.height:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='PGM pixel payload size does not match width * height',
        )
    try:
        docker_client.write_container_file_bytes(
            container,
            str(pgm_path),
            _encode_pgm(request.width, request.height, request.maxval, pixels),
        )
    except (DockerException, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Failed to save PGM file: {exc}',
        )

    return PgmSaveResponse(
        container=container,
        path=_relative_to_maps_dir(pgm_path),
        width=request.width,
        height=request.height,
        saved=True,
    )
