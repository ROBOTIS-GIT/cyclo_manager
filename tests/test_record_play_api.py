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

    def test_invalid_playback_arguments_never_start_motion(self):
        for change in ({'repeats': -1}, {'rate': 10}, {'recording_id': '../escape'},
                       {'robot': 'unknown'}, {'owner': ''}):
            response = self.client.post(
                '/record-play/play', json={**self.play, **change})
            self.assertEqual(response.status_code, 422)
        self.manager.motion.assert_not_called()

    def test_repeat_zero_means_infinite_and_rate_is_forwarded(self):
        response = self.client.post(
            '/record-play/play', json={**self.play, 'repeats': 0, 'rate': .5})
        self.assertEqual(response.status_code, 200)
        self.manager.motion.assert_called_once_with('a' * 32, 'f2', 'browser', rate=.5, repeats=0)

    def test_bringup_stopped_rejects_motion_but_stop_still_works(self):
        self.agent.get_service_status.return_value = {'is_up': False}
        self.assertEqual(self.client.post('/record-play/play', json=self.play).status_code, 409)
        self.manager.motion.assert_not_called()
        self.assertEqual(self.client.post('/record-play/stop').status_code, 200)
        self.manager.stop.assert_called_once_with(owner=None)

    def test_busy_operation_returns_conflict(self):
        self.manager.motion.side_effect = ValueError('already active')
        self.assertEqual(self.client.post('/record-play/play', json=self.play).status_code, 409)

    def test_optional_owner_scoped_stop(self):
        response = self.client.post('/record-play/stop', json={'owner': 'old-browser'})
        self.assertEqual(response.status_code, 200)
        self.manager.stop.assert_called_once_with(owner='old-browser')


if __name__ == '__main__':
    unittest.main()
