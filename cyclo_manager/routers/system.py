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

"""System info and stats endpoints: reads directly from /proc inside the container."""

import asyncio
import os
import platform
import socket
import time
from pathlib import Path
from typing import Optional

import psutil
from cyclo_manager.models import RobotInfoResponse, SystemStatsResponse
from fastapi import APIRouter

router = APIRouter(prefix='/system', tags=['system'])

# Host filesystem mounted read-only at this path in docker-compose.
# Used to read host disk usage and host OS info.
_HOST_ROOT = '/host_root'


async def _check_internet() -> bool:
    loop = asyncio.get_event_loop()
    try:
        await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: socket.create_connection(("8.8.8.8", 53), timeout=3),
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


def _temperature() -> float | None:
    try:
        sensors = psutil.sensors_temperatures()
        if not sensors:
            return None
        for readings in sensors.values():
            if readings:
                return round(readings[0].current, 1)
    except (AttributeError, Exception):
        pass
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get('/info', response_model=RobotInfoResponse)
async def get_robot_info() -> RobotInfoResponse:
    """Return hostname, OS name, and IP address.

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
async def get_system_stats() -> SystemStatsResponse:
    """Return CPU, memory, disk, and uptime stats.

    CPU/memory/uptime are read from /proc (host values via bind mount).
    Disk usage prefers /host_root (host root mount); falls back to /.
    """
    cpu_percent = psutil.cpu_percent(interval=0.2)
    mem = psutil.virtual_memory()
    disk_path = _HOST_ROOT if Path(_HOST_ROOT).is_mount() else '/'
    disk = psutil.disk_usage(disk_path)
    uptime_seconds = int(time.time() - psutil.boot_time())
    return SystemStatsResponse(
        cpu_percent=round(cpu_percent, 1),
        memory_used_mb=mem.used // (1024 * 1024),
        memory_total_mb=mem.total // (1024 * 1024),
        disk_used_gb=round(disk.used / (1024 ** 3), 1),
        disk_total_gb=round(disk.total / (1024 ** 3), 1),
        uptime_seconds=uptime_seconds,
        temperature_celsius=_temperature(),
    )
