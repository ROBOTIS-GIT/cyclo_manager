#!/usr/bin/env python3
# Copyright 2026 ROBOTIS CO., LTD.
# Licensed under the Apache License, Version 2.0.
# Author: Hyungyu Kim

"""Exercise publish/stop ordering with blocked work, without a real robot."""

import asyncio
import threading
import unittest

from cyclo_manager.jog import JogInput
from cyclo_manager.jog_stream import JogController
from cyclo_manager.motion_guard import motion_lock
from robot_runtime_fixture import ready_runtime
from test_jog import FakeBridge


class JogControllerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tasks = []
        self.gates = []

    async def asyncTearDown(self):
        for gate in self.gates:
            gate.set()
        for task in self.tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.assertFalse(motion_lock.locked())

    async def start(self, bridge=None):
        controller = JogController(bridge or FakeBridge(), ready_runtime())
        task = asyncio.create_task(controller.run())
        self.tasks.append(task)
        await asyncio.wait_for(controller.states.get(), 1)
        return controller, task

    async def until(self, predicate):
        async def wait():
            while not predicate():
                await asyncio.sleep(0.002)
        await asyncio.wait_for(wait(), 1)

    def blocked_bridge(self):
        bridge = FakeBridge()
        entered, proceed = threading.Event(), threading.Event()
        self.gates.append(proceed)
        publish = bridge.publish_jog

        def blocked(*args):
            if not entered.is_set():
                entered.set()
                if not proceed.wait(1):
                    raise AssertionError('Publish was not released by the test')
            return publish(*args)

        bridge.publish_jog = blocked
        return bridge, entered, proceed

    async def test_disconnect_joins_inflight_publish_before_final_stop_and_cleanup(self):
        bridge, entered, proceed = self.blocked_bridge()
        controller, task = await self.start(bridge)
        controller.update(JogInput(kind='joint', joint='head_joint1'))
        self.assertTrue(await asyncio.to_thread(entered.wait, 1))
        task.cancel()
        await asyncio.sleep(0.02)
        self.assertFalse(task.done())
        self.assertTrue(bridge.subscription_users)
        self.assertTrue(motion_lock.locked())
        proceed.set()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(len(bridge.published), 2)
        self.assertGreater(bridge.published[0][2]['points'][0]['positions'][0], 0.2)
        self.assertEqual(bridge.published[-1][2]['points'][0]['positions'], [0.2, 0.1])
        self.assertFalse(bridge.subscription_users)

    async def test_release_during_publish_retains_goal_and_prevents_more_ticks(self):
        bridge, entered, proceed = self.blocked_bridge()
        controller, _ = await self.start(bridge)
        controller.update(JogInput(kind='joint', joint='head_joint1'))
        self.assertTrue(await asyncio.to_thread(entered.wait, 1))
        controller.update(JogInput(kind='release'))
        proceed.set()
        await self.until(lambda: not controller.owns_motion and bool(bridge.published))
        await asyncio.sleep(0.12)
        self.assertEqual(len(bridge.published), 1)
        self.assertIsNone(controller.session.active_joint)
        self.assertFalse(motion_lock.locked())

    async def test_release_barrier_survives_a_new_press_before_publish_finishes(self):
        bridge, entered, proceed = self.blocked_bridge()
        controller, _ = await self.start(bridge)
        command = JogInput(kind='joint', joint='head_joint1')
        controller.update(command)
        self.assertTrue(await asyncio.to_thread(entered.wait, 1))
        controller.update(JogInput(kind='release'))
        bridge.cache['/joint_states']['data']['position'][1] = 0.15
        controller.update(command)
        proceed.set()
        await self.until(lambda: len(bridge.published) >= 2)
        self.assertEqual(bridge.published[0][2]['points'][0]['positions'][1], 0.1)
        self.assertEqual(bridge.published[1][2]['points'][0]['positions'][1], 0.15)

    async def test_runtime_change_interrupts_held_motion_without_another_input(self):
        controller, task = await self.start()
        controller.update(JogInput(kind='joint', joint='head_joint1'))
        await self.until(lambda: bool(controller.bridge.published))
        controller.runtime._state['generation'] = 'process-2'
        with self.assertRaisesRegex(ValueError, 'bringup changed'):
            await asyncio.wait_for(task, 1)
        self.assertEqual(len(controller.bridge.published), 1)
        self.assertFalse(controller.bridge.subscription_users)

    async def test_stalled_status_consumer_keeps_only_latest_state(self):
        controller, _ = await self.start()
        controller.update(JogInput(kind='base', x=0.1))
        await asyncio.sleep(0.25)
        self.assertEqual(controller.states.qsize(), 1)
        self.assertGreaterEqual(len(controller.bridge.published), 4)
        controller.update(JogInput(kind='stop'))
        await self.until(lambda: not controller.owns_motion)
        await asyncio.sleep(0.02)
        status = controller.states.get_nowait()
        self.assertEqual(status['state']['base'], [0, 0, 0])

    async def test_shared_feedback_conflict_disables_and_blocks_selected_container(self):
        for topic in ('/robot_description', '/joint_states'):
            bridge = FakeBridge()
            graph = bridge.motion_graph()
            graph[topic] = {'type': 'sensor_msgs/msg/JointState', 'publishers': ['/robot', '/robot'], 'subscribers': []}
            bridge.motion_graph = lambda: graph
            controller = JogController(bridge, ready_runtime())
            state = controller.robot_status()
            self.assertFalse(state['ready'])
            self.assertIn(topic, state['reason'])
            with self.assertRaisesRegex(ValueError, 'Multiple publishers'):
                controller.session.apply(JogInput(kind='base', x=.1))
            self.assertEqual(bridge.published, [])
            graph[topic]['publishers'] = ['/robot']
            self.assertTrue(controller.robot_status()['ready'])

    async def test_feedback_conflict_during_motion_blocks_later_commands(self):
        controller, task = await self.start()
        controller.update(JogInput(kind='base', x=.1))
        await self.until(lambda: bool(controller.bridge.published))
        graph = controller.bridge.motion_graph()
        graph['/joint_states'] = {'type': 'sensor_msgs/msg/JointState', 'publishers': ['/robot1', '/robot2'], 'subscribers': []}
        controller.bridge.motion_graph = lambda: graph
        with self.assertRaisesRegex(ValueError, 'Multiple publishers'):
            await asyncio.wait_for(task, 1)
        self.assertEqual(len(controller.bridge.published), 1)
        self.assertFalse(controller.bridge.subscription_users)


if __name__ == '__main__':
    unittest.main()
