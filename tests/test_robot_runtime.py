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

"""Verify existing bringup status/type reads and profile motion boundaries."""

import asyncio
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from cyclo_manager.agent_client import AgentClient
from cyclo_manager.jog import JogInput, JogSession
from cyclo_manager.robot.runtime import MAX_AGE, RobotRuntime, RobotRuntimes, service_pid
from cyclo_manager.robot.profiles import PROFILES
from cyclo_manager.record_play.service import RecordPlayService
from robot_runtime_fixture import ready_runtime
from test_jog import FakeBridge
from test_motion_discovery import DiscoveredBridge, COMMAND, NAMES
from test_record_play import MemoryStore


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.docker = MagicMock()
        self.docker.running_robot_containers.return_value = [dict(name='custom-name', id='id1')]
        self.docker.get_robot_type.return_value = 'omy'
        self.services = {'open_manipulator_bringup'}
        self.status = dict(is_up=True, pid=123, uptime_seconds=10)
        self.agent = SimpleNamespace(get_service_status=AsyncMock(side_effect=self.get_status))
        self.pool = SimpleNamespace(get_client=lambda _: self.agent)
        self.runtime = RobotRuntime(self.docker, self.pool, 'custom-name')

    async def get_status(self, service):
        if service not in self.services:
            response = httpx.Response(404, request=httpx.Request('GET', f'http://agent/services/{service}/status'))
            raise httpx.HTTPStatusError('Service not found', request=response.request, response=response)
        return self.status

    async def test_existing_endpoints_and_type_setting_select_profile(self):
        for model in PROFILES:
            self.status['pid'] += 1
            self.docker.get_robot_type.return_value = model
            self.services = {PROFILES[model].service}
            await self.runtime.refresh()
            self.assertEqual(self.runtime.require()['model'], model)
        self.agent.get_service_status.assert_called_with('open_manipulator_bringup')
        self.docker.get_robot_type.assert_called_with('id1')

    async def test_deployed_agent_without_list_route_and_null_pid_is_supported(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            if request.url.path == '/services/ai_worker_bringup/status':
                return httpx.Response(200, json={
                    'name': 'ai_worker_bringup', 'is_up': True, 'pid': None,
                    'raw': 'up (pid 111 pgid 111) 187 seconds', 'uptime_seconds': 187})
            return httpx.Response(404, json={'detail': 'Not Found'})
        self.agent = AgentClient('/not-used')
        self.agent._client = httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url='http://agent')
        self.addAsyncCleanup(self.agent.async_close)
        self.docker.get_robot_type.return_value = 'f2'
        await self.runtime.refresh()
        current = self.runtime.require()
        self.assertEqual(current['model'], 'f2')
        self.assertIn(':111:', current['generation'])
        self.assertEqual(set(calls), {
            '/services/ai_worker_bringup/status',
            '/services/open_manipulator_bringup/status',
        })

    async def test_non_404_http_errors_are_not_treated_as_missing_services(self):
        response = httpx.Response(503, request=httpx.Request('GET', 'http://agent/services/test/status'))
        self.agent.get_service_status.side_effect = httpx.HTTPStatusError(
            'Unavailable', request=response.request, response=response)
        await self.runtime.refresh()
        self.assertFalse(self.runtime.snapshot()['ready'])
        self.assertIn('HTTP 503', self.runtime.snapshot()['reason'])

    async def test_raw_pid_change_invalidates_existing_motion(self):
        self.status.update(pid=None, raw='up (pid 111 pgid 111) 187 seconds')
        await self.runtime.refresh()
        generation = self.runtime.require()['generation']
        self.status['raw'] = 'up (pid 222 pgid 222) 187 seconds'
        await self.runtime.refresh()
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.runtime.require(generation)

    async def test_unchanged_service_reuses_type_but_restart_invalidates_generation(self):
        await self.runtime.refresh()
        initial = self.runtime.require()['generation']
        await self.runtime.refresh()
        self.assertEqual(self.runtime.require()['generation'], initial)
        self.docker.get_robot_type.assert_called_once_with('id1')
        for change in ('type', 'pid', 'uptime', 'container'):
            previous = self.runtime.require()['generation']
            if change == 'type':
                self.docker.get_robot_type.return_value = 'omx'
                self.status['pid'] += 1  # Type changes take effect on bringup restart.
            elif change == 'pid':
                self.status['pid'] = 456
            elif change == 'uptime':
                self.status['uptime_seconds'] = 1
            else:
                self.docker.running_robot_containers.return_value[0]['id'] = 'id2'
            await self.runtime.refresh()
            with self.assertRaisesRegex(ValueError, 'changed'):
                self.runtime.require(previous)

    async def test_get_requests_share_cached_observation_and_never_load_image_metadata(self):
        states = await asyncio.gather(*(self.runtime.status() for _ in range(8)))
        self.assertTrue(all(state['ready'] for state in states))
        self.assertEqual(len({state['generation'] for state in states}), 1)
        self.docker.running_robot_containers.assert_called_once_with(('custom-name',))
        self.docker.list_containers.assert_not_called()
        self.docker.get_robot_type.assert_called_once()
        self.assertEqual(self.agent.get_service_status.await_count, 2)
        self.runtime._updated -= 2
        self.runtime._completed -= 2
        await self.runtime.status()
        self.assertEqual(self.docker.running_robot_containers.call_count, 2)
        self.docker.get_robot_type.assert_called_once()

    async def test_no_requests_means_no_queries_and_gap_requires_new_verification(self):
        self.assertFalse(self.runtime.snapshot()['ready'])
        self.docker.running_robot_containers.assert_not_called()
        self.agent.get_service_status.assert_not_awaited()
        first = await self.runtime.status()
        self.runtime._updated -= MAX_AGE + 1
        self.runtime._completed -= MAX_AGE + 1
        self.assertFalse(self.runtime.snapshot()['ready'])
        self.docker.running_robot_containers.assert_called_once()
        current = await self.runtime.status()
        self.assertNotEqual(current['generation'], first['generation'])
        self.assertEqual(self.docker.get_robot_type.call_count, 2)

    async def test_no_running_containers_skips_agent_and_type_queries(self):
        self.docker.running_robot_containers.return_value = []
        self.assertFalse((await self.runtime.status())['ready'])
        self.agent.get_service_status.assert_not_awaited()
        self.docker.get_robot_type.assert_not_called()

    async def test_waiting_gets_share_a_slow_observation_without_refreshing_again(self):
        now = [10.0]
        def slow_type(_):
            now[0] += 2.0
            return 'omy'
        self.docker.get_robot_type.side_effect = slow_type
        with patch('cyclo_manager.robot.runtime.time',
                   SimpleNamespace(monotonic=lambda: now[0])):
            states = await asyncio.gather(*(self.runtime.status() for _ in range(8)))
        self.assertTrue(all(state['ready'] for state in states))
        self.docker.running_robot_containers.assert_called_once()

    async def test_agent_failure_clears_ready_and_recovery_invalidates_old_generation(self):
        await self.runtime.refresh()
        generation = self.runtime.require()['generation']
        self.agent.get_service_status.side_effect = RuntimeError('Agent down')
        await self.runtime.refresh()
        with self.assertRaisesRegex(ValueError, 'service status'):
            self.runtime.require()
        self.agent.get_service_status.side_effect = self.get_status
        await self.runtime.refresh()
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.runtime.require(generation)

    async def test_stopped_or_missing_services_never_read_type(self):
        self.status['is_up'] = False
        await self.runtime.refresh()
        self.assertFalse(self.runtime.snapshot()['ready'])
        self.services = {'leader_bringup'}
        await self.runtime.refresh()
        self.assertFalse(self.runtime.snapshot()['ready'])
        self.docker.get_robot_type.assert_not_called()

    async def test_multiple_bringups_are_not_ready(self):
        self.services = {'open_manipulator_bringup', 'ai_worker_bringup'}
        await self.runtime.refresh()
        self.assertIn('Multiple', self.runtime.snapshot()['reason'])
        self.docker.get_robot_type.assert_not_called()

    async def test_unknown_or_wrong_family_type_and_missing_file_are_not_ready(self):
        for model in ('', 'unknown', 'f2'):
            self.docker.get_robot_type.return_value = model
            await self.runtime.refresh()
            self.assertFalse(self.runtime.snapshot()['ready'])
        self.docker.get_robot_type.side_effect = ValueError('Cannot read /run/robot_type')
        await self.runtime.refresh()
        self.assertIn('/run/robot_type', self.runtime.snapshot()['reason'])

    async def test_stale_or_slow_observation_cannot_authorize_motion(self):
        await self.runtime.refresh()
        self.runtime._updated = time.monotonic() - MAX_AGE - .01
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            self.runtime.require()
        with patch('cyclo_manager.robot.runtime.time',
                   SimpleNamespace(monotonic=MagicMock(side_effect=[1, MAX_AGE + 2, MAX_AGE + 2]))):
            await self.runtime.refresh()
            self.assertFalse(self.runtime.snapshot()['ready'])

    async def test_container_selection_has_independent_caches_and_queries_only_its_agent(self):
        other_agent = SimpleNamespace(get_service_status=AsyncMock(return_value={'is_up': False}))
        clients = SimpleNamespace(get_client=MagicMock(side_effect={
            'custom-name': self.agent, 'other': other_agent}.__getitem__))
        self.docker.running_robot_containers.side_effect = lambda names: [dict(name=names[0], id=names[0])]
        runtimes = RobotRuntimes(self.docker, clients, ['custom-name', 'other'])
        selected = runtimes.get('custom-name')
        first = await selected.status()
        self.assertTrue(first['ready'])
        clients.get_client.assert_called_once_with('custom-name')
        other_agent.get_service_status.assert_not_awaited()
        other = await runtimes.get('other').status()
        self.assertFalse(other['ready'])
        self.assertEqual(other['container'], 'other')
        self.assertEqual(selected.snapshot()['generation'], first['generation'])
        selected._updated -= MAX_AGE + 1
        await runtimes.get('other').status()
        self.assertFalse(selected.snapshot()['ready'])
        self.assertEqual([call.args[0] for call in self.docker.running_robot_containers.call_args_list],
                         [('custom-name',), ('other',)])
        with self.assertRaisesRegex(ValueError, 'supported robot container'):
            runtimes.get('unknown')


class ServicePIDTests(unittest.TestCase):
    def test_structured_pid_and_both_s6_output_formats(self):
        for status, expected in (
            ({'pid': 42, 'raw': 'up (pid 111 pgid 111) 10 seconds'}, 42),
            ({'pid': None, 'raw': 'up (pid 111 pgid 111) 10 seconds'}, 111),
            ({'pid': None, 'raw': 'up (pid 111) 10 seconds'}, 111),
            ({'pid': None, 'raw': 'up (pgid 111) 10 seconds'}, None),
            ({'pid': 0, 'raw': 'down 1 seconds'}, None),
            ({'pid': True, 'raw': ''}, None),
            ({'pid': None, 'raw': None}, None),
        ):
            with self.subTest(status=status):
                self.assertEqual(service_pid(status), expected)


class ProfileMotionTests(unittest.TestCase):
    def test_profile_uses_dynamic_joint_names_and_ignores_alternative_routes(self):
        bridge = DiscoveredBridge()
        profile = PROFILES['omy']
        bridge.graph[profile.topics[0]] = bridge.graph[COMMAND]
        jog = JogSession(bridge, 'omy', command_topics=profile.topics, base_topic=None)
        jog.apply(JogInput(kind='joint', joint=NAMES[0]))
        self.assertEqual(bridge.published[0][0], profile.topics[0])
        self.assertEqual(bridge.published[0][2]['joint_names'], NAMES)
        self.assertEqual(bridge.published[0][2]['points'][0]['positions'][1], .4)
        with self.assertRaisesRegex(ValueError, 'does not support'):
            jog.apply(JogInput(kind='base', x=.1))

    def test_restart_guard_rejects_old_session_before_any_publish(self):
        bridge = FakeBridge()
        runtime = ready_runtime()
        generation = runtime.require()['generation']
        jog = JogSession(bridge, command_topics=PROFILES['sg2'].topics,
                         guard=lambda: runtime.require(generation))
        runtime._state['generation'] = 'new-process'
        with self.assertRaisesRegex(ValueError, 'changed'):
            jog.apply(JogInput(kind='joint', joint='head_joint1'))
        self.assertEqual(bridge.published, [])

    def test_playback_uses_ros_routes_without_a_runtime_or_profile(self):
        bridge = DiscoveredBridge()
        bridge.jog_publishers_ready = lambda _: True
        with tempfile.TemporaryDirectory() as root:
            store = MemoryStore(root)
            recording, _ = store.create()
            store.messages[recording] = [(COMMAND, {
                'joint_names': NAMES, 'points': [{'positions': [.2, .4]}]}, 1)]
            store.save(recording, dict(id=recording, topics=[COMMAND], duration=0))
            service = RecordPlayService(bridge, root, store)
            self.addCleanup(service.close)
            self.assertFalse(service.catalog('sg2')[0]['recommended'])
            service.motion(recording, 'ros', 'browser')
            service._thread.join(timeout=3)
            self.assertEqual(service.status()['robot'], 'ros')
            self.assertEqual(service.status()['phase'], 'completed', service.status())
            self.assertEqual(bridge.published[0][0], COMMAND)

    def test_ros_mapping_change_during_playback_stops_later_commands(self):
        bridge = DiscoveredBridge()
        bridge.jog_publishers_ready = lambda _: True
        original_publish = bridge.publish_jog
        def publish(*args):
            result = original_publish(*args)
            bridge.graph[COMMAND]['subscribers'] = ['/other_controller']
            return result
        bridge.publish_jog = publish
        with tempfile.TemporaryDirectory() as root:
            store = MemoryStore(root)
            recording, _ = store.create()
            message = {'joint_names': NAMES, 'points': [{'positions': [.2, .4]}]}
            store.messages[recording] = [(COMMAND, message, 1), (COMMAND, message, 100000001)]
            store.save(recording, dict(id=recording, topics=[COMMAND], duration=.1))
            service = RecordPlayService(bridge, root, store)
            self.addCleanup(service.close)
            service.motion(recording, 'omy', 'browser')
            service._thread.join(timeout=3)
            self.assertEqual(service.status()['phase'], 'error')
            self.assertEqual(len(bridge.published), 1)
            self.assertIn('feedback', service.status()['error'])
