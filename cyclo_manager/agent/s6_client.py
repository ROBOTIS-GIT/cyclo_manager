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

# Default s6 service directory
S6_SERVICE_DIR = Path('/run/service')


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
        # Call s6-svstat to get service status
        result = subprocess.check_output(
            ['s6-svstat', str(service_path)],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
        )

        raw_output = result.strip()
        logger.debug(f"Service '{name}' status: {raw_output}")

        # Parse the output
        # Example formats:
        # "up (pid 1234) 10 seconds"
        # "down 5 seconds"
        # "up (pid 1234) 0 seconds"
        is_up = raw_output.startswith('up')
        pid: Optional[int] = None
        uptime_seconds: Optional[int] = None

        if is_up:
            # Extract PID: "up (pid 1234) 10 seconds"
            pid_match = re.search(r'\(pid\s+(\d+)\)', raw_output)
            if pid_match:
                pid = int(pid_match.group(1))

            # Extract uptime: "10 seconds" or "0 seconds"
            uptime_match = re.search(r'(\d+)\s+seconds', raw_output)
            if uptime_match:
                uptime_seconds = int(uptime_match.group(1))
        else:
            # For down services, might have: "down 5 seconds"
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


LAUNCH_ARGS_DIR = Path('/run/launch_args')
ROBOT_TYPE_FILE = Path('/run/robot_type')
LEADER_TYPE_FILE = Path('/run/leader_type')


_ROBOT_TYPE_BY_SERVICE = {
    'ai_worker_bringup': frozenset({'sg2', 'bg2', 'sh5', 'bh5', 'mobile'}),
    'open_manipulator_bringup': frozenset({'omy', 'omx'}),
    'leader_bringup': frozenset({'omy', 'omx'}),
}

_ROBOT_TYPE_FILE_BY_SERVICE = {
    'ai_worker_bringup': ROBOT_TYPE_FILE,
    'open_manipulator_bringup': ROBOT_TYPE_FILE,
    'leader_bringup': LEADER_TYPE_FILE,
}


def _write_robot_type(service_name: str, robot_type: str) -> None:
    """
    Write robot type to file for run scripts that dispatch by robot type.
    """
    normalized = robot_type.strip().lower()
    allowed = _ROBOT_TYPE_BY_SERVICE.get(service_name)
    if allowed is None:
        return
    if normalized not in allowed:
        raise ValueError(
            f'robot_type for {service_name} must be one of {sorted(allowed)!r}, '
            f'got: {robot_type!r}'
        )
    robot_type_file = _ROBOT_TYPE_FILE_BY_SERVICE[service_name]
    robot_type_file.write_text(normalized, encoding='utf-8')
    logger.info(f'Wrote robot_type for {service_name} to {robot_type_file}: {normalized}')


def _write_launch_args(name: str, launch_args: dict[str, str]) -> None:
    """
    Write launch args to file for the run script to read.

    Format: key:=value key:=value (ROS2 launch argument format)
    """
    if not launch_args:
        return
    LAUNCH_ARGS_DIR.mkdir(parents=True, exist_ok=True)
    args_str = ' '.join(f'{k}:={v}' for k, v in launch_args.items())
    args_file = LAUNCH_ARGS_DIR / name
    args_file.write_text(args_str, encoding='utf-8')
    logger.info(f"Wrote launch args for service '{name}' to {args_file}")


def control_service(
    name: str,
    action: str,
    launch_args: dict[str, str] | None = None,
    robot_type: str | None = None,
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
    robot_type: Required for services that select launch files by robot type.

    Raises
    ------
    FileNotFoundError: If service does not exist.
    ValueError: If action is invalid or robot_type missing/invalid for ai_worker_bringup.
    subprocess.CalledProcessError: If command fails.

    """
    service_path = S6_SERVICE_DIR / name

    if not service_path.exists():
        raise FileNotFoundError(f"Service '{name}' not found at {service_path}")

    if action in ('up', 'restart') and name in _ROBOT_TYPE_BY_SERVICE:
        if not robot_type:
            allowed = sorted(_ROBOT_TYPE_BY_SERVICE[name])
            raise ValueError(
                f'robot_type is required for {name} (up/restart). '
                f'Use one of: {allowed!r}.'
            )
        _write_robot_type(name, robot_type)

    # Write launch args before up/restart so the run script can read them
    if action in ('up', 'restart') and launch_args:
        _write_launch_args(name, launch_args)

    # Check if this is an s6-rc service (has producer-for or consumer-for)
    # For s6-rc services with pipelines, we should use s6-rc commands
    is_s6rc_service = (
        (service_path / 'producer-for').exists()
        or (service_path / 'consumer-for').exists()
    )

    # Also check if it's a symlink to s6-rc servicedirs (indicates s6-rc service)
    try:
        if service_path.is_symlink():
            target = service_path.readlink()
            if 's6-rc' in str(target):
                is_s6rc_service = True
    except Exception:
        pass

    if action not in ['up', 'down', 'restart']:
        raise ValueError(f"Invalid action: {action}. Must be one of: ['up', 'down', 'restart']")

    try:
        if is_s6rc_service:
            # For s6-rc services, use s6-rc commands
            # For pipelines, starting the producer service will start the entire pipeline
            if action == 'up':
                cmd = ['s6-rc', '-u', 'change', name]
            elif action == 'down':
                cmd = ['s6-rc', '-d', 'change', name]
            else:  # restart
                cmd = ['s6-rc', '-d', 'change', name]
                subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=10)
                # Wait a moment, then bring it back up
                time.sleep(1)
                cmd = ['s6-rc', '-u', 'change', name]

            subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=10)
            logger.info(f"Successfully executed action '{action}' on s6-rc service '{name}'")
        else:
            # For legacy services, use s6-svc
            action_map = {
                'up': '-u',
                'down': '-d',
                'restart': '-r',
            }
            flag = action_map[action]
            subprocess.check_output(
                ['s6-svc', flag, str(service_path)],
                stderr=subprocess.STDOUT,
                timeout=10,
            )
            logger.info(f"Successfully executed action '{action}' on service '{name}'")

    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to {action} service '{name}': {e}")
        raise
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout executing action '{action}' on service '{name}'")
        raise
