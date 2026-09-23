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

"""Request-driven bringup status for Jog, without a background monitor."""

import asyncio
import re
import threading
import time

from cyclo_manager.robot.profiles import PROFILES
import httpx

MAX_AGE = 4.0
STATUS_CACHE_AGE = 1.0


def unavailable(reason):
    return dict(ready=False, model=None, container=None, generation=None, reason=reason)


def service_pid(status):
    """Older agents omit pid when s6-svstat includes a pgid in its output."""
    pid = status.get('pid')
    if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0:
        return pid
    match = re.search(r'\(pid\s+(\d+)\b', status.get('raw') or '')
    return int(match[1]) if match and int(match[1]) > 0 else None


class RobotRuntime:
    """Observe bringup only inside the container selected by the operator."""

    def __init__(self, docker, clients, container):
        self.docker = docker
        self.clients = clients
        self.container = container
        self._lock = threading.Lock()
        self._refresh_lock = asyncio.Lock()
        self._state = unavailable('Checking robot bringup…')
        self._updated = 0.0
        self._completed = 0.0
        self._run_key = None
        self._uptime = None
        self._revision = 0
        self._process_key = None

    def snapshot(self):
        with self._lock:
            if time.monotonic() - self._updated > MAX_AGE:
                return unavailable('Robot bringup status unavailable.')
            return dict(self._state)

    def require(self, generation=None):
        state = self.snapshot()
        if not state['ready']:
            raise ValueError(state['reason'])
        if generation is not None and generation != state['generation']:
            raise ValueError('Robot bringup changed. Enable Jog again.')
        return state

    async def status(self):
        """Coalesce concurrent page GETs; idle applications never query Docker/s6."""
        async with self._refresh_lock:
            if time.monotonic() - self._completed >= STATUS_CACHE_AGE:
                await self.refresh()
            return self.snapshot()

    async def refresh(self):
        started = time.monotonic()
        process_key = None
        try:
            if self.docker is None:
                raise ValueError('Docker is unavailable; cannot verify robot bringup.')
            running = await asyncio.to_thread(
                self.docker.running_robot_containers, (self.container,))
            if not running:
                raise ValueError(f'Robot container {self.container} is not running.')
            container_id = running[0]['id']
            client = self.clients.get_client(self.container)

            async def inspect_service(service):
                try:
                    # Same AgentClient method used by System's service status API.
                    status = await asyncio.wait_for(client.get_service_status(service), 2)
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 404:
                        return None  # This robot family is not installed here.
                    raise ValueError(
                        f'Cannot check {self.container}/{service} service status '
                        f'(HTTP {exc.response.status_code}).') from exc
                except Exception as exc:
                    raise ValueError(
                        f'Cannot check {self.container}/{service} service status '
                        f'({type(exc).__name__}).') from exc
                return dict(status, service=service)

            services = sorted({profile.service for profile in PROFILES.values()})
            statuses = await asyncio.gather(*(inspect_service(service) for service in services))
            active = [r for r in statuses if r and r['is_up']]
            if not active:
                raise ValueError('Robot bringup is stopped.')
            if len(active) != 1:
                raise ValueError('Multiple robot bringups are running in the selected container.')
            robot = active[0]
            pid = service_pid(robot)
            if pid is None:
                raise ValueError('Bringup process status is unavailable.')
            process_key = (container_id, robot['service'], pid)
            uptime = robot.get('uptime_seconds')
            same_process = (process_key == self._process_key
                            and started - self._updated <= MAX_AGE
                            and (uptime is None or self._uptime is None
                                 or uptime >= self._uptime))
            # The agent writes this setting when starting/restarting bringup.
            # Reuse it until that process changes or observation has been interrupted.
            model = self._state['model'] if same_process and self._state['ready'] else None
            if model is None:
                model = await asyncio.to_thread(self.docker.get_robot_type, container_id)
            profile = PROFILES.get(model)
            if not profile or profile.service != robot['service']:
                raise ValueError('Bringup type is unsupported or does not match its service.')
            state = dict(ready=True, model=profile.model, container=self.container,
                         generation=f"{container_id}:{robot['service']}:{pid}:{profile.model}",
                         reason=None)
        except Exception as exc:
            state = unavailable(str(exc))
            state['container'] = self.container
        with self._lock:
            run_key = state['generation']
            uptime = robot.get('uptime_seconds') if state['ready'] else None
            if run_key and (run_key != self._run_key
                            or started - self._updated > MAX_AGE
                            or (uptime is not None and self._uptime is not None
                                and uptime < self._uptime)):
                self._revision += 1
            self._run_key, self._uptime = run_key, uptime
            self._process_key = process_key if state['ready'] else None
            if run_key:
                state['generation'] = f'{run_key}:{self._revision}'
            self._state = state
            # Slow/stuck observations must not appear fresh after they finish.
            self._updated = started
            # Waiting GETs also share slow observations rather than querying again.
            self._completed = time.monotonic()


class RobotRuntimes:
    """Independent status caches for configured robot containers; no global selection."""

    def __init__(self, docker, clients, containers):
        self._runtimes = {name: RobotRuntime(docker, clients, name) for name in containers}

    def get(self, container):
        if container not in self._runtimes:
            raise ValueError('Select a supported robot container before opening Jog.')
        return self._runtimes[container]
