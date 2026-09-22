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

"""Server-owned bringup observation shared by all motion pages and jobs."""

import asyncio
import re
import threading
import time

from cyclo_manager.robot.profiles import PROFILES
import httpx

MAX_AGE = 4.0


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
    """Resolve one running follower on the manager's shared ROS topic namespace."""

    def __init__(self, docker, clients, containers):
        self.docker = docker
        self.clients = clients
        self.containers = tuple(containers)
        self._lock = threading.Lock()
        self._state = unavailable('Checking robot bringup…')
        self._updated = 0.0
        self._run_key = None
        self._uptime = None
        self._revision = 0

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
            raise ValueError('Robot bringup changed. Enable Jog or start playback again.')
        return state

    async def refresh(self):
        started = time.monotonic()
        try:
            if self.docker is None:
                raise ValueError('Docker is unavailable; cannot verify robot bringup.')
            containers = await asyncio.to_thread(self.docker.list_containers)
            running = [c for c in containers if c['name'] in self.containers
                       and c['status'] == 'running']

            async def inspect(container):
                client = self.clients.get_client(container['name'])

                async def inspect_service(service):
                    try:
                        status = await asyncio.wait_for(client.get_service_status(service), 2)
                    except httpx.HTTPStatusError as exc:
                        if exc.response.status_code == 404:
                            return None  # This robot family is not installed here.
                        raise ValueError(
                            f"Cannot check {container['name']}/{service} service status "
                            f'(HTTP {exc.response.status_code}).') from exc
                    except Exception as exc:
                        raise ValueError(
                            f"Cannot check {container['name']}/{service} service status "
                            f'({type(exc).__name__}).') from exc
                    return dict(status, service=service, container=container['name'],
                                container_id=container['id'])

                # Some deployed agents expose individual status routes only.
                services = sorted({profile.service for profile in PROFILES.values()})
                statuses = await asyncio.gather(*(inspect_service(service) for service in services))
                return [status for status in statuses if status is not None]

            observations = await asyncio.gather(*(inspect(c) for c in running))
            robots = [r for group in observations for r in group]
            active = [r for r in robots if r['is_up']]
            if not active:
                raise ValueError('Robot bringup is stopped.')
            if len(active) != 1:
                raise ValueError('Multiple robot bringups share this ROS connection. Run one follower.')
            robot = active[0]
            model = await asyncio.to_thread(self.docker.get_robot_type, robot['container_id'])
            profile = PROFILES.get(model)
            if not profile or profile.service != robot['service']:
                raise ValueError('Bringup type is unsupported or does not match its service.')
            pid = service_pid(robot)
            if pid is None:
                raise ValueError('Bringup process status is unavailable.')
            state = dict(ready=True, model=profile.model, container=robot['container'],
                         generation=f"{robot['container_id']}:{robot['service']}:{pid}:{profile.model}",
                         reason=None)
        except Exception as exc:
            state = unavailable(str(exc))
        with self._lock:
            run_key = state['generation']
            uptime = robot.get('uptime_seconds') if state['ready'] else None
            if run_key and (run_key != self._run_key
                            or started - self._updated > MAX_AGE
                            or (uptime is not None and self._uptime is not None
                                and uptime < self._uptime)):
                self._revision += 1
            self._run_key, self._uptime = run_key, uptime
            if run_key:
                state['generation'] = f'{run_key}:{self._revision}'
            self._state = state
            # Slow/stuck observations must not appear fresh after they finish.
            self._updated = started

    async def monitor(self):
        while True:
            await self.refresh()
            await asyncio.sleep(1)
