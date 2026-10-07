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

"""System info and stats endpoints."""

import asyncio
import glob
import os
from pathlib import Path
import platform
import socket
from typing import Optional

from cyclo_manager.host_agent_client import HostAgentClient
from cyclo_manager.http_errors import proxy_error
from cyclo_manager.models import (
    RobotInfoResponse,
    SerialPortInfo,
    SerialPortsResponse,
    SystemProcessesResponse,
    SystemStatsResponse,
)
from cyclo_manager.state import get_host_agent_client
from fastapi import APIRouter, Depends, Query
import psutil

router = APIRouter(prefix='/system', tags=['system'])

# Host filesystem mounted read-only at this path in docker-compose.
# Used to read host OS info and serial device paths.
_HOST_ROOT = '/host_root'
_PROCESS_DEFAULT_LIMIT = 80
_SERIAL_PORT_GLOBS = (
    '/dev/serial/by-id/*',
    '/dev/ttyACM*',
    '/dev/ttyUSB*',
    '/dev/ttyAMA*',
)


async def _check_internet() -> bool:
    loop = asyncio.get_event_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: socket.create_connection(('8.8.8.8', 53), timeout=3),
            ),
            timeout=4,
        )
        return True
    except Exception:
        return False


def _read_file(path: str) -> str | None:
    """Read a file, strip null bytes, and return its content. Returns None if missing."""
    try:
        return Path(path).read_text(encoding='utf-8', errors='replace').replace('\x00', '').strip()
    except OSError:
        return None


def _os_info() -> str | None:
    """Read the host OS name from /host_root/etc/os-release."""
    content = _read_file(f'{_HOST_ROOT}/etc/os-release')
    if content:
        for line in content.splitlines():
            if line.startswith('PRETTY_NAME='):
                return line.split('=', 1)[1].strip('"')
    return platform.platform()


def _host_path(path: str) -> Path:
    if Path(_HOST_ROOT).is_mount():
        return Path(_HOST_ROOT, path.lstrip('/'))
    return Path(path)


def _display_dev_path(path: Path) -> str:
    text = str(path)
    if text.startswith(f'{_HOST_ROOT}/'):
        return text[len(_HOST_ROOT):]
    return text


def _real_dev_path(path: Path) -> str | None:
    try:
        real = path.resolve(strict=True)
    except OSError:
        return None
    return _display_dev_path(real)


def _serial_port_label(path: str, real_path: str | None) -> str:
    if path.startswith('/dev/serial/by-id/'):
        return f'{real_path} ({path})' if real_path else path
    if path.startswith('/dev/ttyAMA'):
        return f'Raspberry Pi UART ({path})'
    if path.startswith('/dev/ttyACM'):
        return f'USB CDC serial ({path})'
    if path.startswith('/dev/ttyUSB'):
        return f'USB serial ({path})'
    return path


def _serial_ports() -> list[SerialPortInfo]:
    ports: list[SerialPortInfo] = []
    seen_real_paths: set[str] = set()

    for pattern in _SERIAL_PORT_GLOBS:
        host_pattern = str(_host_path(pattern))
        for raw_path in sorted(glob.glob(host_pattern)):
            host_port_path = Path(raw_path)
            display_path = _display_dev_path(host_port_path)
            real_path = _real_dev_path(host_port_path)
            if real_path and real_path in seen_real_paths:
                continue
            path = real_path if real_path else display_path
            if path in seen_real_paths:
                continue
            if real_path:
                seen_real_paths.add(real_path)
            ports.append(
                SerialPortInfo(
                    path=path,
                    real_path=real_path,
                    label=_serial_port_label(display_path, real_path),
                )
            )

    return ports


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get('/info', response_model=RobotInfoResponse)
async def get_robot_info() -> RobotInfoResponse:
    """
    Return hostname, OS name, and IP address.

    Uses HOST_HOSTNAME env var for hostname if set, otherwise the container hostname.
    """
    hostname = os.environ.get('HOST_HOSTNAME') or socket.gethostname()

    ip_address: Optional[str] = None
    try:
        for iface, addrs in psutil.net_if_addrs().items():
            if iface == 'lo':
                continue
            for addr in addrs:
                if addr.family == socket.AF_INET and not addr.address.startswith('127.'):
                    ip_address = addr.address
                    break
            if ip_address:
                break
    except Exception:
        pass

    return RobotInfoResponse(
        hostname=hostname,
        os_info=_os_info(),
        ip_address=ip_address,
        internet_connected=await _check_internet(),
    )


@router.get('/status', response_model=SystemStatsResponse)
async def get_system_stats(
    client: HostAgentClient = Depends(get_host_agent_client),
) -> SystemStatsResponse:
    """Return host CPU, memory, disk, and uptime stats from cyclo_host_agent."""
    try:
        data = await client.get_system_stats()
        return SystemStatsResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/processes', response_model=SystemProcessesResponse)
async def get_system_processes(
    limit: int = Query(_PROCESS_DEFAULT_LIMIT, ge=1, le=500),
    client: HostAgentClient = Depends(get_host_agent_client),
) -> SystemProcessesResponse:
    """Return host process CPU/memory usage from cyclo_host_agent."""
    try:
        data = await client.get_system_processes(limit)
        return SystemProcessesResponse(**data)
    except Exception as e:
        raise proxy_error(e, 'Host agent')


@router.get('/serial-ports', response_model=SerialPortsResponse)
async def get_serial_ports() -> SerialPortsResponse:
    """Return serial device candidates from the host /dev tree."""
    return SerialPortsResponse(ports=_serial_ports())
