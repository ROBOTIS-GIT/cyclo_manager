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

import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from cyclo_manager.agent_client import AgentClient
from cyclo_manager.jog import JogInput, JogSession
from cyclo_manager.robot.runtime import MAX_AGE, RobotRuntime, service_pid
from cyclo_manager.robot.profiles import PROFILES
from cyclo_manager.record_play.service import RecordPlayService
from robot_runtime_fixture import ready_runtime
from test_jog import FakeBridge
from test_motion_discovery import DiscoveredBridge, COMMAND, NAMES
from test_record_play import MemoryStore


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.docker = MagicMock()
        self.docker.list_containers.return_value = [dict(name='custom-name', id='id1', status='running')]
        self.docker.get_robot_type.return_value = 'omy'
        self.services = {'open_manipulator_bringup'}
        self.status = dict(is_up=True, pid=123, uptime_seconds=10)
        self.agent = SimpleNamespace(get_service_status=AsyncMock(side_effect=self.get_status))
        self.pool = SimpleNamespace(get_client=lambda _: self.agent)
        self.runtime = RobotRuntime(self.docker, self.pool, ['custom-name'])

    async def get_status(self, service):
        if service not in self.services:
            response = httpx.Response(404, request=httpx.Request('GET', f'http://agent/services/{service}/status'))
            raise httpx.HTTPStatusError('Service not found', request=response.request, response=response)
        return self.status

    async def test_existing_endpoints_and_type_setting_select_profile(self):
        for model in PROFILES:
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
        self.assertNotIn('/services', calls)
        self.assertNotIn('/robot/status', calls)

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

    async def test_unchanged_service_keeps_generation_but_type_pid_restart_change_it(self):
        await self.runtime.refresh()
        initial = self.runtime.require()['generation']
        await self.runtime.refresh()
        self.assertEqual(self.runtime.require()['generation'], initial)
        for change in ('type', 'pid', 'uptime', 'container'):
            previous = self.runtime.require()['generation']
            if change == 'type':
                self.docker.get_robot_type.return_value = 'omx'
            elif change == 'pid':
                self.status['pid'] = 456
            elif change == 'uptime':
                self.status['uptime_seconds'] = 1
            else:
                self.docker.list_containers.return_value[0]['id'] = 'id2'
            await self.runtime.refresh()
            with self.assertRaisesRegex(ValueError, 'changed'):
                self.runtime.require(previous)

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
                   SimpleNamespace(monotonic=MagicMock(side_effect=[1, MAX_AGE + 2]))):
            await self.runtime.refresh()
            self.assertFalse(self.runtime.snapshot()['ready'])


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
        jog.apply(JogInput(kind='joint', joint=NAMES[0], mode='step'))
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

    def test_playback_cannot_bypass_bringup_with_client_robot_name(self):
        runtime = ready_runtime()
        runtime._state['ready'] = False
        runtime._state['reason'] = 'Stopped'
        with tempfile.TemporaryDirectory() as root:
            service = RecordPlayService(FakeBridge(), root, runtime=runtime)
            with self.assertRaisesRegex(ValueError, 'Stopped'):
                service.motion('a' * 32, 'sg2', 'browser')
            self.assertIsNone(service._thread)

    def test_manual_topic_playback_and_recommendations_follow_actual_profile(self):
        bridge = DiscoveredBridge()
        bridge.jog_publishers_ready = lambda _: True
        runtime = ready_runtime('omy')
        with tempfile.TemporaryDirectory() as root:
            store = MemoryStore(root)
            recording, _ = store.create()
            store.messages[recording] = [(COMMAND, {
                'joint_names': NAMES, 'points': [{'positions': [.2, .4]}]}, 1)]
            store.save(recording, dict(id=recording, topics=[COMMAND], duration=0))
            service = RecordPlayService(bridge, root, store, runtime=runtime)
            self.addCleanup(service.close)
            self.assertFalse(service.catalog('sg2')[0]['recommended'])
            service.motion(recording, 'sg2', 'browser')
            service._thread.join(timeout=3)
            self.assertEqual(service.status()['robot'], 'omy')
            self.assertEqual(service.status()['phase'], 'completed', service.status())
            self.assertEqual(bridge.published[0][0], COMMAND)

    def test_runtime_change_during_playback_stops_later_commands(self):
        bridge = DiscoveredBridge()
        bridge.jog_publishers_ready = lambda _: True
        runtime = ready_runtime('omy')
        original_publish = bridge.publish_jog
        def publish(*args):
            result = original_publish(*args)
            runtime._state['generation'] = 'new-process'
            return result
        bridge.publish_jog = publish
        with tempfile.TemporaryDirectory() as root:
            store = MemoryStore(root)
            recording, _ = store.create()
            message = {'joint_names': NAMES, 'points': [{'positions': [.2, .4]}]}
            store.messages[recording] = [(COMMAND, message, 1), (COMMAND, message, 100000001)]
            store.save(recording, dict(id=recording, topics=[COMMAND], duration=.1))
            service = RecordPlayService(bridge, root, store, runtime=runtime)
            self.addCleanup(service.close)
            service.motion(recording, 'omy', 'browser')
            service._thread.join(timeout=3)
            self.assertEqual(service.status()['phase'], 'error')
            self.assertEqual(len(bridge.published), 1)
            self.assertIn('changed', service.status()['error'])
