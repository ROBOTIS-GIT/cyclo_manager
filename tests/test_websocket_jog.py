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
import math
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

from fastapi import WebSocketDisconnect
from starlette.websockets import WebSocketState
from test_jog import FakeBridge
from robot_runtime_fixture import ready_runtime, ready_runtimes, runtime_state


class FakeSocket:
    def __init__(self, inputs, send_delay=0):
        self.inputs = iter(inputs)
        self.send_delay = send_delay
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
        delay = 0.02
        if isinstance(value, tuple):
            delay, value = value
        await asyncio.sleep(delay)
        if callable(value):
            value = value()
        if value == 'timeout':
            await asyncio.sleep(1)
        if value == 'disconnect':
            self.client_state = WebSocketState.DISCONNECTED
            self.closed = True
            raise WebSocketDisconnect()
        return value

    async def send_json(self, value):
        if self.send_delay:
            await asyncio.sleep(self.send_delay)
        self.output.append(value)

    async def close(self, **kwargs):
        self.close_calls += 1
        if (self.client_state == WebSocketState.DISCONNECTED
                or self.application_state == WebSocketState.DISCONNECTED):
            raise AssertionError('Must not close an already disconnected socket')
        self.application_state = WebSocketState.DISCONNECTED
        self.closed = True


class WebsocketJogTests(unittest.IsolatedAsyncioTestCase):
    async def run_socket(self, inputs, runtime=None, bridge=None, send_delay=0, container='test-container'):
        bridge = bridge or FakeBridge()
        bridge.prepare_jog_publishers = lambda *args: True
        fake_state = runtime_state(ready_runtimes(runtime), get_ros2_bridge_or_none=lambda: bridge)
        path = Path(__file__).parents[1] / 'cyclo_manager/routers/websocket_jog.py'
        spec = importlib.util.spec_from_file_location('isolated_jog_router', path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'cyclo_manager.state': fake_state}):
            spec.loader.exec_module(module)
        socket = FakeSocket(inputs, send_delay)
        await module.websocket_jog(socket, 'sg2', container=container)
        return bridge, socket

    async def test_unselected_or_unknown_container_cannot_open_motion_session(self):
        for container in (None, '', 'unknown'):
            bridge, socket = await self.run_socket([{'kind': 'base', 'x': .1}], container=container)
            self.assertIn('supported robot container', socket.output[-1]['error'])
            self.assertTrue(socket.closed)
            self.assertEqual(bridge.published, [])
            self.assertFalse(bridge.subscription_users)

    async def test_old_client_model_does_not_override_actual_profile(self):
        bridge, socket = await self.run_socket(
            [{'kind': 'base', 'x': .1}], ready_runtime('omy'))
        self.assertEqual(bridge.published, [])
        self.assertIn('does not support', socket.output[-1]['error'])

    async def test_bringup_down_keeps_status_connected_but_blocks_motion(self):
        runtime = ready_runtime()
        runtime._state.update(ready=False, model=None, generation=None, reason='Bringup down')
        bridge, socket = await self.run_socket(
            [{'kind': 'idle'}, {'kind': 'joint', 'joint': 'head_joint1'}], runtime)
        self.assertFalse(socket.output[0]['state']['robot']['ready'])
        self.assertIn('Bringup down', socket.output[-1]['error'])
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

    async def test_joint_release_retains_last_goal_through_idle_and_disconnect(self):
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1', 'resolution': 'coarse'},
            {'kind': 'release'}, (0.6, {'kind': 'idle'}), 'disconnect'])
        self.assertGreaterEqual(len(socket.output), 3)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(len(bridge.published), 1)
        target = 0.2 + math.radians(3)
        self.assertAlmostEqual(bridge.published[0][2]['points'][0]['positions'][0], target)
        shown = next(j for j in socket.output[-1]['state']['joints'] if j['name'] == 'head_joint1')
        self.assertAlmostEqual(shown['target'], target)
        self.assertEqual(socket.close_calls, 0)

    async def test_joint_hold_disconnect_holds_measured_position(self):
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1'}, 'disconnect'])
        self.assertGreater(bridge.published[0][2]['points'][-1]['positions'][0], 0.2)
        point = bridge.published[-1][2]['points'][-1]
        self.assertEqual(point['positions'], [0.2, 0.1])
        self.assertEqual(point['time_from_start'], {'sec': 0, 'nanosec': 0})
        self.assertNotIn('velocities', point)
        self.assertTrue(socket.closed)

    async def test_small_held_joint_boundary_error_does_not_close_connection(self):
        bridge = FakeBridge()
        bridge.cache['/joint_states']['data']['position'][1] = 0.4 + math.radians(0.003)
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1'},
            {'kind': 'joint', 'joint': 'head_joint1'},
            {'kind': 'stop'}, {'kind': 'idle'}, 'disconnect'], bridge=bridge)
        self.assertGreaterEqual(len(socket.output), 2)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(socket.close_calls, 0)
        self.assertEqual(len(bridge.published), 2)
        for _, _, message in bridge.published:
            values = dict(zip(message['joint_names'], message['points'][0]['positions']))
            self.assertEqual(values['head_joint2'], 0.4)

    async def test_read_only_session_survives_a_background_pause(self):
        bridge, socket = await self.run_socket([
            {'kind': 'idle'}, (0.6, {'kind': 'idle'}), 'disconnect'])
        self.assertGreaterEqual(len(socket.output), 2)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(bridge.published, [])

    async def test_stopped_motion_survives_a_background_pause(self):
        bridge, socket = await self.run_socket([
            {'kind': 'base', 'x': 0.1}, {'kind': 'stop'},
            (0.6, {'kind': 'idle'}), 'disconnect'])
        self.assertGreaterEqual(len(socket.output), 3)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertEqual(len(bridge.published), 2)
        self.assertGreater(bridge.published[0][2]['linear']['x'], 0)
        self.assertEqual(bridge.published[1][2]['linear']['x'], 0)

    async def test_joint_idle_stops_and_allows_background_pause(self):
        bridge, socket = await self.run_socket([
            {'kind': 'joint', 'joint': 'head_joint1'},
            {'kind': 'idle'}, (0.6, {'kind': 'idle'})])
        self.assertGreaterEqual(len(socket.output), 3)
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

    async def test_slow_status_send_does_not_set_ros_publish_cadence(self):
        bridge = FakeBridge()
        original_read = bridge.get_topic_data
        original_publish = bridge.publish_jog
        published_at = []

        def read(topic):
            if topic == '/joint_states':
                bridge.feedback(0.2)
            return original_read(topic)

        def publish(*args):
            published_at.append(time.monotonic())
            return original_publish(*args)

        bridge.get_topic_data = read
        bridge.publish_jog = publish
        command = {'kind': 'joint', 'joint': 'head_joint1'}
        bridge, socket = await self.run_socket([
            command, (0.1, command), (0.1, command), (0.1, command),
            (0.06, {'kind': 'release'}), (0.12, 'disconnect')], bridge=bridge, send_delay=0.18)
        self.assertGreaterEqual(len(bridge.published), 6)
        intervals = [b - a for a, b in zip(published_at, published_at[1:])]
        self.assertGreaterEqual(sum(gap < 0.09 for gap in intervals), 4)
        self.assertLessEqual(len(socket.output), 3)
        self.assertFalse(any(item['error'] for item in socket.output))
        self.assertFalse(bridge.subscription_users)

    async def test_many_heartbeats_do_not_accelerate_ros_publishing(self):
        bridge = FakeBridge()
        original_read = bridge.get_topic_data

        def read(topic):
            if topic == '/joint_states':
                bridge.feedback(0.2)
            return original_read(topic)

        bridge.get_topic_data = read
        command = {'kind': 'joint', 'joint': 'head_joint1'}
        bridge, socket = await self.run_socket([
            command, *[(0.002, command) for _ in range(20)],
            {'kind': 'release'}, (0.1, 'disconnect')], bridge=bridge)
        self.assertLessEqual(len(bridge.published), 4)
        self.assertGreaterEqual(len(bridge.published), 1)
        self.assertFalse(any(item['error'] for item in socket.output))

    async def test_blocked_status_transport_stops_motion_and_closes_without_an_error_frame(self):
        command = {'kind': 'base', 'x': 0.1}
        bridge, socket = await self.run_socket([
            command, (0.1, command), (0.1, command), (0.1, command),
            (1, 'disconnect')], send_delay=0.5)
        self.assertGreater(bridge.published[0][2]['linear']['x'], 0)
        self.assertEqual(bridge.published[-1][2]['linear']['x'], 0)
        self.assertEqual(socket.close_calls, 1)
        self.assertFalse(bridge.subscription_users)

    async def test_periodic_joint_updates_still_require_fresh_feedback(self):
        bridge = FakeBridge()
        command = {'kind': 'joint', 'joint': 'head_joint1'}
        bridge, socket = await self.run_socket([
            command, *[(0.1, command) for _ in range(7)]], bridge=bridge)
        self.assertIn('stale', socket.output[-1]['error'])
        self.assertEqual(len(bridge.published), 1)
        self.assertFalse(bridge.subscription_users)


if __name__ == '__main__':
    unittest.main()
