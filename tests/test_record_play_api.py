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

"""Validate the Record & Play HTTP boundary with no ROS or robot commands."""

import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from cyclo_manager.record_play.bags import RecordingNotFoundError
from fastapi import FastAPI
from fastapi.testclient import TestClient


class RecordPlayAPITests(unittest.TestCase):
    def setUp(self):
        self.manager = MagicMock()
        self.manager.status.return_value = {'phase': 'idle', 'active': False}
        self.agent = SimpleNamespace(get_service_status=AsyncMock(return_value={'is_up': True}))
        fake_state = SimpleNamespace(app_state=SimpleNamespace(record_play=self.manager),
                                     get_agent_client=lambda _: self.agent)
        path = Path(__file__).parents[1] / 'cyclo_manager/routers/record_play.py'
        spec = importlib.util.spec_from_file_location('isolated_record_router', path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'cyclo_manager.state': fake_state}):
            spec.loader.exec_module(module)
        app = FastAPI()
        app.include_router(module.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.play = {'recording_id': 'a' * 32, 'robot': 'f2', 'owner': 'browser'}

    def test_robot_name_is_metadata_only_and_recording_needs_no_runtime(self):
        for robot in ('omy', 'omx'):
            response = self.client.post('/record_play/record', json={
                'name': 'Arm motion', 'robot': robot, 'groups': ['arm'], 'owner': 'browser'})
            self.assertEqual(response.status_code, 200)
            self.agent.get_service_status.assert_not_awaited()
            self.manager.record.assert_called_with('Arm motion', robot, ['arm'], 'browser')

    def test_invalid_playback_arguments_never_start_motion(self):
        for change in ({'repeats': -1}, {'rate': 10}, {'recording_id': '../escape'},
                       {'owner': ''}):
            response = self.client.post(
                '/record_play/play', json={**self.play, **change})
            self.assertEqual(response.status_code, 422)
        self.manager.motion.assert_not_called()

    def test_repeat_zero_means_infinite_and_rate_is_forwarded(self):
        response = self.client.post(
            '/record_play/play', json={**self.play, 'repeats': 0, 'rate': .5})
        self.assertEqual(response.status_code, 200)
        self.manager.motion.assert_called_once_with(
            'a' * 32, 'f2', 'browser', rate=.5, repeats=0, arrival_tolerance_deg=.5)
        self.agent.get_service_status.assert_not_awaited()

    def test_arrival_tolerance_choices_are_forwarded_without_bringup_lookup(self):
        for tolerance in (.5, 1, 2, 3):
            with self.subTest(tolerance=tolerance):
                self.manager.motion.reset_mock()
                response = self.client.post('/record_play/play', json={
                    **self.play, 'arrival_tolerance_deg': tolerance})
                self.assertEqual(response.status_code, 200)
                self.manager.motion.assert_called_once_with(
                    'a' * 32, 'f2', 'browser', rate=1, repeats=1,
                    arrival_tolerance_deg=tolerance)
        self.agent.get_service_status.assert_not_awaited()

    def test_invalid_arrival_tolerance_never_starts_motion(self):
        for tolerance in (-1, 0, 2.5, 4, '2', 'NaN', None):
            with self.subTest(tolerance=tolerance):
                response = self.client.post('/record_play/play', json={
                    **self.play, 'arrival_tolerance_deg': tolerance})
                self.assertEqual(response.status_code, 422)
        self.manager.motion.assert_not_called()

    def test_overview_reads_ros_catalog_without_runtime(self):
        self.manager.catalog.return_value = [{'joints': ['joint1']}]
        self.manager.store.list.return_value = []
        response = self.client.get('/record_play')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['feedback_ready'])
        self.assertNotIn('robot', response.json())
        self.agent.get_service_status.assert_not_awaited()

    def test_recording_does_not_require_agent_bringup(self):
        self.agent.get_service_status.return_value = {'is_up': False}
        response = self.client.post('/record_play/record', json={
            'name': 'Topic capture', 'groups': ['/custom/trajectory'], 'owner': 'browser'})
        self.assertEqual(response.status_code, 200)
        self.agent.get_service_status.assert_not_awaited()


    def test_busy_operation_returns_conflict(self):
        self.manager.motion.side_effect = ValueError('already active')
        self.assertEqual(self.client.post('/record_play/play', json=self.play).status_code, 409)

    def test_optional_owner_scoped_stop(self):
        response = self.client.post('/record_play/stop', json={'owner': 'old-browser'})
        self.assertEqual(response.status_code, 200)
        self.manager.stop.assert_called_once_with(owner='old-browser')

    def test_delete_returns_current_job_state(self):
        response = self.client.delete(f'/record_play/recordings/{"a" * 32}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), self.manager.status.return_value)
        self.manager.delete.assert_called_once_with('a' * 32)
        self.agent.get_service_status.assert_not_awaited()

    def test_delete_validates_id_before_calling_service(self):
        for recording_id in ('invalid', 'A' * 32, 'a' * 31, 'a' * 33):
            with self.subTest(recording_id=recording_id):
                response = self.client.delete(f'/record_play/recordings/{recording_id}')
                self.assertEqual(response.status_code, 422)
        self.manager.delete.assert_not_called()

    def test_delete_reports_missing_active_and_storage_failure_separately(self):
        cases = ((RecordingNotFoundError('missing recording'), 404),
                 (ValueError('active recording'), 409),
                 (PermissionError('storage denied'), 503))
        for error, status_code in cases:
            with self.subTest(status_code=status_code):
                self.manager.delete.side_effect = error
                response = self.client.delete(f'/record_play/recordings/{"a" * 32}')
                self.assertEqual(response.status_code, status_code)
                self.assertIn(str(error), response.json()['detail'])


if __name__ == '__main__':
    unittest.main()
