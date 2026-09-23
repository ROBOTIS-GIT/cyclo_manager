#!/usr/bin/env python3
# Copyright 2026 ROBOTIS CO., LTD.
# Licensed under the Apache License, Version 2.0.
# Author: Hyungyu Kim

"""Verify arrival units, dwell and diagnostics with a deterministic clock."""

import math
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from cyclo_manager.record_play.motion import arrival_errors, arrived
from cyclo_manager.record_play.service import Cancelled, RecordPlayService


class Clock:
    def __init__(self):
        self.milliseconds = 0
        self.cancelled = False

    def now(self):
        return self.milliseconds / 1000

    def wait(self, duration):
        self.milliseconds += max(1, round(duration * 1000))

    def is_set(self):
        return self.cancelled


class ArrivalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.service = RecordPlayService(None, self.tmp.name)
        self.clock = Clock()
        self.service._cancel = self.clock
        self.goals = {'/arm': {'joint1': 0.0}}
        self.plan = SimpleNamespace(joints={'joint1': SimpleNamespace(unit='rad')},
                                    goals=lambda: self.goals)
        self.timer = patch('cyclo_manager.record_play.service.time.monotonic', self.clock.now)
        self.timer.start()
        self.addCleanup(self.timer.stop)

    def connection(self, feedback):
        connection = SimpleNamespace(feedback_received_at=None)

        def require_feedback():
            connection.feedback_received_at = self.clock.now()
            return feedback(self.clock.now())

        connection.require_feedback = require_feedback
        return connection

    def test_selected_angular_boundaries_and_fixed_linear_tolerance(self):
        for degrees in (0.5, 1, 2, 3):
            with self.subTest(degrees=degrees):
                self.assertTrue(arrived(self.goals, {'joint1': math.radians(degrees)},
                                        self.plan.joints, degrees))
                self.assertFalse(arrived(self.goals, {'joint1': math.radians(degrees + .0001)},
                                         self.plan.joints, degrees))
                linear = {'lift': SimpleNamespace(unit='m')}
                goals = {'/lift': {'lift': 0.0}}
                self.assertTrue(arrived(goals, {'lift': .001}, linear, degrees))
                self.assertFalse(arrived(goals, {'lift': .001001}, linear, degrees))

    def test_dwell_resets_after_any_out_of_range_sample(self):
        connection = self.connection(lambda now: {'joint1': .1 if now == .2 else 0.0})
        self.service._arrive(connection, self.plan, self.goals, .5)
        self.assertGreaterEqual(self.clock.now(), .6)
        self.assertLessEqual(self.clock.now(), .7)

    def test_one_cached_in_range_sample_cannot_satisfy_dwell(self):
        connection = SimpleNamespace(require_feedback=lambda: {'joint1': 0.0},
                                     feedback_received_at=0.0)
        with patch('cyclo_manager.record_play.service.ARRIVAL_TIMEOUT', .4):
            with self.assertRaisesRegex(ValueError, 'did not remain within tolerance'):
                self.service._arrive(connection, self.plan, self.goals, .5)
        self.assertGreater(self.clock.now(), .4)

    def test_fast_samples_cannot_finish_before_wall_clock_dwell(self):
        connection = self.connection(lambda _: {'joint1': 0.0})
        original = connection.require_feedback

        def accelerated_samples():
            positions = original()
            connection.feedback_received_at = self.clock.now() * 10
            return positions

        connection.require_feedback = accelerated_samples
        self.service._arrive(connection, self.plan, self.goals, .5)
        self.assertGreaterEqual(self.clock.now(), .3)

    def test_already_near_start_and_repeat_pose_still_wait_in_the_correct_phase(self):
        for phase in ('preparing', 'returning'):
            with self.subTest(phase=phase):
                self.clock.milliseconds = 0
                connection = self.connection(lambda _: {'joint1': math.radians(2)})
                with patch.object(self.service, '_publish_positions') as publish:
                    self.service._return(connection, self.plan, phase, 3)
                self.assertGreaterEqual(self.clock.now(), .3)
                self.assertEqual(self.service.status()['phase'], phase)
                self.assertEqual(self.service.status()['return_duration'], 0)
                publish.assert_not_called()

    def test_preparation_repeated_return_and_final_arrival_share_tolerance_and_dwell(self):
        bias = math.radians(1.6)
        measured = {'joint1': bias}
        connection = self.connection(lambda _: dict(measured))
        connection.pin_topics = Mock()
        connection.joints = list(self.plan.joints.values())
        connection.description = '<robot/>'
        published = []

        def publish(topic, msg_type, data):
            published.append((self.service.status()['phase'], self.clock.now()))
            measured['joint1'] = data['points'][0]['positions'][0] + bias

        connection.publish = publish
        start_message = {'joint_names': ['joint1'], 'points': [{'positions': [0.0]}]}
        end_message = {'joint_names': ['joint1'], 'points': [{'positions': [.1]}]}
        plan = SimpleNamespace(
            joints=self.plan.joints, first=self.goals, first_timestamp=0, duration=.1,
            latch=Mock(), message=lambda _topic, data, _rate: data,
            goals=lambda end=False: {'/arm': {'joint1': .1 if end else 0.0}})
        self.service.bridge = SimpleNamespace(
            prepare_jog_publishers=lambda _: True, jog_publishers_ready=lambda _: True)
        arrivals = []
        arrive = self.service._arrive

        def observe_arrival(*args):
            phase, started = self.service.status()['phase'], self.clock.now()
            arrive(*args)
            arrivals.append((phase, started, self.clock.now()))

        with patch.object(self.service, '_connection', return_value=connection), \
                patch.object(self.service.store, 'get', return_value={'topics': ['/arm']}), \
                patch.object(self.service.store, 'read', side_effect=lambda _: iter([
                    ('/arm', start_message, 0), ('/arm', end_message, 100_000_000)])), \
                patch('cyclo_manager.record_play.service.MotionPlan', return_value=plan), \
                patch('cyclo_manager.record_play.service.return_duration', return_value=.1), \
                patch.object(self.service, '_arrive', side_effect=observe_arrival):
            self.service._run_motion('recording', 'ros', 1, 2, None, 2)

        self.assertEqual(self.service.status()['phase'], 'completed')
        self.assertEqual([phase for phase, _, _ in arrivals],
                         ['preparing', 'settling', 'returning', 'settling'])
        for phase, started, finished in arrivals:
            self.assertGreaterEqual(finished - started + 1e-9, .3, phase)
        playing = [when for phase, when in published if phase == 'playing']
        self.assertEqual(len(playing), 4)
        self.assertGreaterEqual(playing[0], arrivals[0][2])
        self.assertGreaterEqual(playing[2], arrivals[2][2])

    def test_timeout_identifies_missed_angular_and_linear_targets(self):
        goals = {'/arm': {'joint1': 0.0}, '/lift': {'lift': .01}}
        plan = SimpleNamespace(joints={**self.plan.joints, 'lift': SimpleNamespace(unit='m')})
        connection = self.connection(lambda _: {'joint1': math.radians(2), 'lift': .013})
        with patch('cyclo_manager.record_play.service.ARRIVAL_TIMEOUT', .2):
            with self.assertRaises(ValueError) as caught:
                self.service._arrive(connection, plan, goals, 1)
        message = str(caught.exception)
        self.assertIn('Joint target arrival timed out; playback stopped.', message)
        self.assertIn('joint1: target=0.000 deg, current=2.000 deg', message)
        self.assertIn('error=2.000 deg, tolerance=1.000 deg', message)
        self.assertIn('lift: target=10.000 mm, current=13.000 mm', message)
        self.assertIn('error=3.000 mm, tolerance=1.000 mm', message)

    def test_missing_feedback_names_are_reported(self):
        errors = arrival_errors(self.goals, {}, self.plan.joints, 2)
        self.assertEqual(len(errors), 1)
        self.assertIn('joint1: target=0.000 deg', errors[0])
        self.assertIn('current=unavailable, error=unavailable', errors[0])
        self.assertIn('tolerance=2.000 deg', errors[0])

    def test_timeout_inside_tolerance_explains_unfinished_dwell_and_last_mismatch(self):
        connection = self.connection(lambda now: {'joint1': .1 if now < .2 else 0.0})
        with patch('cyclo_manager.record_play.service.ARRIVAL_TIMEOUT', .2):
            with self.assertRaises(ValueError) as caught:
                self.service._arrive(connection, self.plan, self.goals, .5)
        message = str(caught.exception)
        self.assertIn('did not remain within tolerance for 0.3 s continuously', message)
        self.assertIn('Last outside tolerance: joint1:', message)

    def test_cancellation_and_stale_feedback_interrupt_arrival_immediately(self):
        def cancel(_):
            self.clock.cancelled = True
            return {'joint1': 0.0}
        with self.assertRaises(Cancelled):
            self.service._arrive(self.connection(cancel), self.plan, self.goals, .5)
        self.assertLess(self.clock.now(), .3)
        self.clock.cancelled = False
        def stale():
            raise ValueError('Fresh joint feedback and robot description are required.')

        connection = SimpleNamespace(require_feedback=stale)
        with self.assertRaisesRegex(ValueError, 'Fresh joint feedback'):
            self.service._arrive(connection, self.plan, self.goals, .5)


if __name__ == '__main__':
    unittest.main()
