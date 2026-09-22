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

"""Exercise disconnect/error handling without ROS or a running manager."""

import asyncio
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import WebSocketDisconnect
from starlette.websockets import WebSocketState
from test_jog import FakeBridge
from robot_runtime_fixture import ready_runtime


class FakeSocket:
    def __init__(self, inputs):
        self.inputs = iter(inputs)
        self.output = []
        self.closed = False
        self.client_state = WebSocketState.CONNECTING
        self.application_state = WebSocketState.CONNECTING
        self.close_calls = 0

    async def accept(self):
        self.client_state = WebSocketState.CONNECTED
        self.application_state = WebSocketState.CONNECTED

    async def receive_json(self):
        value = next(self.inputs, 'disconnect')
        if isinstance(value, tuple):
            delay, value = value
            await asyncio.sleep(delay)
        if value == 'timeout':
            await asyncio.sleep(1)
        if value == 'disconnect':
            self.client_state = WebSocketState.DISCONNECTED
            self.closed = True
            raise WebSocketDisconnect()
        return value

    async def send_json(self, value):
        self.output.append(value)

    async def close(self, **kwargs):
        self.close_calls += 1
        if (self.client_state == WebSocketState.DISCONNECTED
                or self.application_state == WebSocketState.DISCONNECTED):
            raise AssertionError('Must not close an already disconnected socket')
        self.application_state = WebSocketState.DISCONNECTED
        self.closed = True


class WebsocketJogTests(unittest.IsolatedAsyncioTestCase):
    async def run_socket(self, inputs, runtime=None):
        bridge = FakeBridge()
        bridge.prepare_jog_publishers = lambda *args: True
        fake_state = SimpleNamespace(app_state=SimpleNamespace(
            get_ros2_bridge_or_none=lambda: bridge, robot_runtime=runtime or ready_runtime()))
        path = Path(__file__).parents[1] / 'cyclo_manager/routers/websocket_jog.py'
        spec = importlib.util.spec_from_file_location('isolated_jog_router', path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'cyclo_manager.state': fake_state}):
            spec.loader.exec_module(module)
        socket = FakeSocket(inputs)
        await module.websocket_jog(socket, 'sg2')
        return bridge, socket

    async def test_old_client_model_does_not_override_actual_profile(self):
        bridge, socket = await self.run_socket(
            [{'kind': 'base', 'x': .1}], ready_runtime('omy'))
        self.assertEqual(bridge.published, [])
        self.assertIn('does not support', socket.output[0]['error'])

    async def test_bringup_down_keeps_status_connected_but_blocks_motion(self):
        runtime = ready_runtime()
        runtime._state.update(ready=False, model=None, generation=None, reason='Bringup down')
        bridge, socket = await self.run_socket(
            [{'kind': 'idle'}, {'kind': 'joint', 'joint': 'head_joint1'}], runtime)
        self.assertFalse(socket.output[0]['state']['robot']['ready'])
        self.assertIn('Bringup down', socket.output[1]['error'])
        self.assertEqual(bridge.published, [])

    async def test_disconnect_stops_base(self):
        bridge, socket = await self.run_socket([{'kind': 'base', 'y': 0.1}, 'disconnect'])
        self.assertGreater(bridge.published[0][2]['linear']['y'], 0)
        self.assertEqual(bridge.published[-1][2]['linear']['y'], 0)
        self.assertEqual(socket.close_calls, 0)

    async def test_disconnect_before_first_input_does_not_close_again(self):
        bridge, socket = await self.run_socket(['disconnect'])
        self.assertEqual(socket.close_calls, 0)
        self.assertEqual(bridge.published, [])

    async def test_heartbeat_timeout_stops_and_closes(self):
        bridge, socket = await self.run_socket([{'kind': 'base', 'x': 0.1}, 'timeout'])
        self.assertEqual(bridge.published[-1][2]['linear']['x'], 0)
        self.assertTrue(socket.closed)
        self.assertEqual(socket.close_calls, 1)

    async def test_joint_hold_timeout_stops_at_measured_position(self):
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1'}, 'timeout'])
        self.assertGreater(bridge.published[0][2]['points'][-1]['positions'][0], 0.2)
        self.assertEqual(bridge.published[-1][2]['points'][-1]['positions'], [0.2, 0.1])
        self.assertTrue(socket.closed)

    async def test_joint_hold_disconnect_holds_measured_position(self):
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1'}, 'disconnect'])
        self.assertGreater(bridge.published[0][2]['points'][-1]['positions'][0], 0.2)
        point = bridge.published[-1][2]['points'][-1]
        self.assertEqual(point['positions'], [0.2, 0.1])
        self.assertEqual(point['time_from_start'], {'sec': 0, 'nanosec': 0})
        self.assertNotIn('velocities', point)
        self.assertTrue(socket.closed)

    async def test_read_only_session_survives_a_background_pause(self):
        bridge, socket = await self.run_socket([
            {'kind': 'idle'}, (0.6, {'kind': 'idle'}), 'disconnect'])
        self.assertEqual(len(socket.output), 2)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(bridge.published, [])

    async def test_stopped_motion_survives_a_background_pause(self):
        bridge, socket = await self.run_socket([
            {'kind': 'base', 'x': 0.1}, {'kind': 'stop'},
            (0.6, {'kind': 'idle'}), 'disconnect'])
        self.assertEqual(len(socket.output), 3)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(len(bridge.published), 2)
        self.assertGreater(bridge.published[0][2]['linear']['x'], 0)
        self.assertEqual(bridge.published[1][2]['linear']['x'], 0)

    async def test_joint_idle_stops_and_allows_background_pause(self):
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1'},
            {'kind': 'idle'}, (0.6, {'kind': 'idle'})])
        self.assertEqual(len(socket.output), 3)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(len(bridge.published), 2)
        self.assertEqual(bridge.published[-1][2]['points'][-1]['positions'], [0.2, 0.1])

    async def test_invalid_input_stops_preceding_motion(self):
        bridge, socket = await self.run_socket([
            {'kind': 'base', 'x': 0.1}, {'kind': 'base', 'x': 2}])
        self.assertEqual(bridge.published[-1][2]['linear']['x'], 0)
        self.assertTrue(socket.closed)

    async def test_unknown_joint_reports_error_and_closes(self):
        bridge, socket = await self.run_socket([{'kind': 'joint', 'joint': 'unknown'}])
        self.assertTrue(socket.output[-1]['error'])
        self.assertTrue(socket.closed)
        self.assertEqual(bridge.published, [])

    async def test_read_only_connection_never_sends_motion(self):
        bridge, socket = await self.run_socket([{'kind': 'idle'}, 'disconnect'])
        self.assertEqual(bridge.published, [])
        self.assertTrue(socket.output[0]['state']['feedback_fresh'])


if __name__ == '__main__':
    unittest.main()
