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

"""Host system status and process endpoints."""

import time
from pathlib import Path

from cyclo_host_agent.models import (
    HostProcessesResponse,
    HostProcessInfo,
    HostSystemStatsResponse,
)
from fastapi import APIRouter, Query
import psutil

router = APIRouter(prefix='/system', tags=['system'])

PROCESS_SAMPLE_INTERVAL_SECONDS = 0.2
PROCESS_DEFAULT_LIMIT = 80
EXTRA_STORAGE_MOUNT_PATHS = ('/mnt/ssd', '/data')


def _temperature() -> float | None:
    try:
        sensors = psutil.sensors_temperatures()
        if not sensors:
            return None
        for readings in sensors.values():
            if readings:
                return round(float(readings[0].current), 1)
    except (AttributeError, Exception):
        pass
    return None


def _mounted_disk_usage(path: str):
    path_obj = Path(path)
    if not path_obj.is_mount():
        return None
    try:
        return psutil.disk_usage(path)
    except OSError:
        return None


def _extra_storage_disk_usage():
    for mount_path in EXTRA_STORAGE_MOUNT_PATHS:
        usage = _mounted_disk_usage(mount_path)
        if usage:
            return mount_path, usage
    return None, None


def _command_for_process(process: psutil.Process, info: dict) -> str:
    cmdline = info.get('cmdline') or []
    if cmdline:
        return ' '.join(str(part) for part in cmdline)
    return str(info.get('name') or process.pid)


def _sample_processes(limit: int = PROCESS_DEFAULT_LIMIT) -> HostProcessesResponse:
    tracked: list[psutil.Process] = []
    cpu_count = psutil.cpu_count() or 1
    for process in psutil.process_iter(['pid']):
        try:
            process.cpu_percent(None)
            tracked.append(process)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    overall_cpu_percent = psutil.cpu_percent(interval=PROCESS_SAMPLE_INTERVAL_SECONDS)
    mem = psutil.virtual_memory()

    processes: list[HostProcessInfo] = []
    for process in tracked:
        try:
            info = process.as_dict(
                attrs=['pid', 'username', 'cpu_percent', 'memory_percent', 'memory_info', 'cmdline', 'name']
            )
            memory_info = info.get('memory_info')
            rss_kb = int(memory_info.rss // 1024) if memory_info else None
            process_cpu_percent = float(info.get('cpu_percent') or 0.0) / cpu_count
            processes.append(
                HostProcessInfo(
                    pid=int(info['pid']),
                    user=str(info.get('username') or ''),
                    cpu_percent=round(process_cpu_percent, 1),
                    memory_percent=round(float(info.get('memory_percent') or 0.0), 1),
                    rss_kb=rss_kb,
                    command=_command_for_process(process, info),
                )
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    processes.sort(key=lambda item: item.cpu_percent, reverse=True)
    return HostProcessesResponse(
        cpu_percent=round(float(overall_cpu_percent), 1),
        memory_used_mb=int(mem.used // (1024 * 1024)),
        memory_total_mb=int(mem.total // (1024 * 1024)),
        processes=processes[:max(1, min(limit, 500))],
    )


@router.get('/status', response_model=HostSystemStatsResponse)
async def get_system_stats() -> HostSystemStatsResponse:
    """Return host CPU, memory, disk, and uptime stats."""
    cpu_percent = psutil.cpu_percent(interval=PROCESS_SAMPLE_INTERVAL_SECONDS)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    extra_storage_path, extra_storage_disk = _extra_storage_disk_usage()
    uptime_seconds = int(time.time() - psutil.boot_time())
    return HostSystemStatsResponse(
        cpu_percent=round(float(cpu_percent), 1),
        memory_used_mb=int(mem.used // (1024 * 1024)),
        memory_total_mb=int(mem.total // (1024 * 1024)),
        disk_used_gb=round(float(disk.used / (1024 ** 3)), 1),
        disk_total_gb=round(float(disk.total / (1024 ** 3)), 1),
        ssd_used_gb=(
            round(float(extra_storage_disk.used / (1024 ** 3)), 1)
            if extra_storage_disk
            else None
        ),
        ssd_total_gb=(
            round(float(extra_storage_disk.total / (1024 ** 3)), 1)
            if extra_storage_disk
            else None
        ),
        ssd_mount_path=extra_storage_path,
        uptime_seconds=uptime_seconds,
        temperature_celsius=_temperature(),
    )


@router.get('/processes', response_model=HostProcessesResponse)
async def get_system_processes(
    limit: int = Query(PROCESS_DEFAULT_LIMIT, ge=1, le=500),
) -> HostProcessesResponse:
    """Return host process CPU/memory usage sorted by CPU usage."""
    return _sample_processes(limit)
