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

"""Helper functions to interact with s6-overlay services."""

import logging
from pathlib import Path
import re
import subprocess
import time
from typing import Optional

from cyclo_manager.agent.models import ServiceStatus

logger = logging.getLogger(__name__)

# Default s6 service directories
S6_SERVICE_DIR = Path('/run/service')
S6_RC_DIR = Path('/etc/s6-overlay/s6-rc.d')

LAUNCH_ARGS_DIR = Path('/run/launch_args')
ROBOT_TYPE_FILE = Path('/run/robot_type')
NAVIGATION_TYPE_FILE = Path('/run/navigation_type')

_AI_WORKER_ROBOT_TYPES = frozenset({'sg2', 'bg2', 'sh5', 'bh5', 'mobile'})
_AI_WORKER_NAV_TYPES = frozenset({'map', 'nav'})


def list_services() -> list[str]:
    """
    List all available s6 services.

    Returns
    -------
    List of service names found in /run/service.

    Raises
    ------
    OSError: If /run/service directory cannot be accessed.

    """
    try:
        if not S6_SERVICE_DIR.exists():
            logger.warning(f'Service directory {S6_SERVICE_DIR} does not exist')
            return []

        services = []
        for item in S6_SERVICE_DIR.iterdir():
            if item.is_dir():
                # Check if it looks like an s6 service directory.
                if (item / 'run').exists() or (item / 'type').exists():
                    services.append(item.name)

        logger.debug(f'Found {len(services)} services: {services}')
        return sorted(services)

    except OSError as e:
        logger.error(f'Failed to list services: {e}')
        raise


def get_service_status(name: str) -> ServiceStatus:
    """
    Get status of an s6 service.

    Args
    ----
    name: Service name.

    Returns
    -------
    ServiceStatus object with parsed status information.

    Raises
    ------
    FileNotFoundError: If service does not exist.
    subprocess.CalledProcessError: If s6-svstat command fails.

    """
    service_path = S6_SERVICE_DIR / name

    if not service_path.exists():
        raise FileNotFoundError(f"Service '{name}' not found at {service_path}")

    try:
        result = subprocess.check_output(
            ['s6-svstat', str(service_path)],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
        )

        raw_output = result.strip()
        logger.debug(f"Service '{name}' status: {raw_output}")

        is_up = raw_output.startswith('up')
        pid: Optional[int] = None
        uptime_seconds: Optional[int] = None

        if is_up:
            pid_match = re.search(r'\(pid\s+(\d+)\)', raw_output)
            if pid_match:
                pid = int(pid_match.group(1))

            uptime_match = re.search(r'(\d+)\s+seconds', raw_output)
            if uptime_match:
                uptime_seconds = int(uptime_match.group(1))
        else:
            uptime_match = re.search(r'(\d+)\s+seconds', raw_output)
            if uptime_match:
                uptime_seconds = int(uptime_match.group(1))

        return ServiceStatus(
            name=name,
            raw=raw_output,
            is_up=is_up,
            pid=pid,
            uptime_seconds=uptime_seconds,
        )

    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to get status for service '{name}': {e}")
        raise
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout getting status for service '{name}'")
        raise


def get_all_services_status() -> list[ServiceStatus]:
    """
    Get status of all s6 services.

    This is more efficient than calling get_service_status() for each service
    individually, as it processes all services in a single pass.

    Returns
    -------
    List of ServiceStatus objects for all available services.

    Note
    ----
    Services that fail to get status are skipped (logged but not included).

    """
    try:
        services = list_services()
        statuses: list[ServiceStatus] = []

        for service_name in services:
            try:
                status = get_service_status(service_name)
                statuses.append(status)
            except Exception as e:
                logger.warning(f"Failed to get status for service '{service_name}': {e}")

        return statuses
    except Exception as e:
        logger.error(f'Failed to get all services status: {e}')
        raise


def _write_robot_type(robot_type: str) -> None:
    """
    Write robot type to file for ai_worker_bringup run script.

    Allowed values: sg2, bg2, sh5, bh5, mobile.
    """
    normalized = robot_type.strip().lower()
    if normalized not in _AI_WORKER_ROBOT_TYPES:
        raise ValueError(
            f'robot_type must be one of {sorted(_AI_WORKER_ROBOT_TYPES)!r}, got: {robot_type!r}'
        )
    ROBOT_TYPE_FILE.write_text(normalized, encoding='utf-8')
    logger.info(f'Wrote robot_type to {ROBOT_TYPE_FILE}: {normalized}')


def _write_navigation_type(
    navigation_type: str | None,
    launch_args: dict[str, str] | None = None,
) -> None:
    """
    Write navigation type to file for ai_worker_navigation run script.

    Allowed values: map, nav.
    """
    normalized = navigation_type.strip().lower() if navigation_type else None

    # Backward compatibility for old callers that still send use_slam directly.
    if normalized is None and launch_args is not None:
        use_slam = launch_args.get('use_slam')
        if use_slam is not None:
            normalized = 'map' if use_slam.lower() == 'true' else 'nav'

    if normalized not in _AI_WORKER_NAV_TYPES:
        raise ValueError(
            f'navigation_type must be one of {sorted(_AI_WORKER_NAV_TYPES)!r}, '
            f'got: {navigation_type!r}'
        )
    NAVIGATION_TYPE_FILE.write_text(normalized, encoding='utf-8')
    logger.info(f'Wrote navigation_type to {NAVIGATION_TYPE_FILE}: {normalized}')


def _strip_navigation_mode_args(
    launch_args: dict[str, str] | None,
) -> dict[str, str] | None:
    if launch_args is None:
        return None
    stripped = {key: value for key, value in launch_args.items() if key != 'use_slam'}
    return stripped or None


def _write_launch_args(name: str, launch_args: dict[str, str]) -> None:
    """
    Write launch args to file for the run script to read.

    Format: key:=value key:=value (ROS2 launch argument format)
    """
    LAUNCH_ARGS_DIR.mkdir(parents=True, exist_ok=True)
    args_str = ' '.join(f'{k}:={v}' for k, v in launch_args.items())
    args_file = LAUNCH_ARGS_DIR / name
    args_file.write_text(args_str, encoding='utf-8')
    logger.info(f"Wrote launch args for service '{name}' to {args_file}")


def _is_s6rc_service(service_path: Path, service_def_path: Path) -> bool:
    if service_def_path.exists():
        return True

    if service_path.exists() and (
        (service_path / 'producer-for').exists() or (service_path / 'consumer-for').exists()
    ):
        return True

    try:
        if service_path.is_symlink():
            target = service_path.readlink()
            return 's6-rc' in str(target)
    except Exception:
        return False

    return False


def control_service(
    name: str,
    action: str,
    launch_args: dict[str, str] | None = None,
    robot_type: str | None = None,
    navigation_type: str | None = None,
) -> None:
    """
    Control an s6 service (start, stop, or restart).

    For s6-rc services (especially those with pipelines), uses s6-rc commands.
    For legacy services, falls back to s6-svc.

    Args
    ----
    name: Service name.
    action: Action to perform ('up', 'down', or 'restart').
    launch_args: Optional launch arguments for ros2 launch (used for up/restart).
    robot_type: Required for ai_worker_bringup up/restart. One of sg2, bg2, sh5, bh5, mobile.
    navigation_type: Required for ai_worker_navigation up/restart. One of map, nav.

    Raises
    ------
    FileNotFoundError: If service does not exist.
    ValueError: If action is invalid or required type is missing/invalid.
    RuntimeError: If s6 command fails.
    subprocess.TimeoutExpired: If s6 command times out.

    """
    service_path = S6_SERVICE_DIR / name
    service_def_path = S6_RC_DIR / name

    if not service_path.exists() and not service_def_path.exists():
        raise FileNotFoundError(
            f"Service '{name}' not found at {service_path} or {service_def_path}"
        )

    if action not in ['up', 'down', 'restart']:
        raise ValueError(f"Invalid action: {action}. Must be one of: ['up', 'down', 'restart']")

    if action in ('up', 'restart') and name == 'ai_worker_bringup':
        if not robot_type:
            raise ValueError(
                'robot_type is required for ai_worker_bringup (up/restart). '
                "Use 'sg2', 'bg2', 'sh5', 'bh5', or 'mobile'."
            )
        _write_robot_type(robot_type)

    if action in ('up', 'restart') and name == 'ai_worker_navigation':
        _write_navigation_type(navigation_type, launch_args)
        launch_args = _strip_navigation_mode_args(launch_args)

    if action in ('up', 'restart') and launch_args is not None:
        _write_launch_args(name, launch_args)

    is_s6rc_service = _is_s6rc_service(service_path, service_def_path)

    try:
        if is_s6rc_service:
            if action == 'up':
                cmd = ['s6-rc', '-u', 'change', name]
            elif action == 'down':
                cmd = ['s6-rc', '-d', 'change', name]
            else:
                cmd = ['s6-rc', '-d', 'change', name]
                subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True, timeout=60)
                time.sleep(1)
                cmd = ['s6-rc', '-u', 'change', name]

            subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True, timeout=60)
            logger.info(f"Successfully executed action '{action}' on s6-rc service '{name}'")
        else:
            action_map = {
                'up': '-u',
                'down': '-d',
                'restart': '-r',
            }
            flag = action_map[action]
            subprocess.check_output(
                ['s6-svc', flag, str(service_path)],
                stderr=subprocess.STDOUT,
                text=True,
                timeout=60,
            )
            logger.info(f"Successfully executed action '{action}' on service '{name}'")

    except subprocess.CalledProcessError as e:
        output = (e.output or '').strip()
        message = f"Failed to {action} service '{name}'"
        if output:
            message = f'{message}: {output}'
        logger.error(message)
        raise RuntimeError(message) from e
