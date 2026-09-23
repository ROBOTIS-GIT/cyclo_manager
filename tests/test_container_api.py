#!/usr/bin/env python3
# Copyright 2026 ROBOTIS CO., LTD.
# Licensed under the Apache License, Version 2.0.
# Author: Hyungyu Kim

"""Exercise the request-driven status endpoint without Docker or ROS."""

import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from robot_runtime_fixture import runtime_state


class ContainerAPITests(unittest.TestCase):
    def setUp(self):
        self.runtime = SimpleNamespace(status=AsyncMock(return_value={
            'ready': True, 'model': 'f2', 'container': 'ai_worker',
            'generation': 'process-1', 'reason': None}))
        def get(container):
            if container != 'ai_worker':
                raise ValueError('Select a supported robot container.')
            return self.runtime
        self.runtimes = SimpleNamespace(get=MagicMock(side_effect=get))
        self.docker = MagicMock()
        self.config = SimpleNamespace(supported_robot_containers=['ai_worker', 'open_manipulator'])
        state_module = runtime_state(self.runtimes,
            get_config_or_none=lambda: self.config, get_docker_client_or_none=lambda: self.docker)
        self.state = state_module.app_state
        app = FastAPI()
        for name in ('container', 'containers'):
            path = Path(__file__).parents[1] / f'cyclo_manager/routers/{name}.py'
            spec = importlib.util.spec_from_file_location(f'isolated_{name}_router', path)
            module = importlib.util.module_from_spec(spec)
            with patch.dict(sys.modules, {'cyclo_manager.state': state_module}):
                spec.loader.exec_module(module)
            app.include_router(module.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_only_get_refreshes_status(self):
        self.runtime.status.assert_not_awaited()
        response = self.client.get('/ai_worker/bringup_status')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['model'], 'f2')
        self.runtime.status.assert_awaited_once()
        self.runtimes.get.assert_called_once_with('ai_worker')

    def test_unsupported_container_is_not_automatically_replaced(self):
        self.assertEqual(self.client.get('/unknown/bringup_status').status_code, 404)
        self.runtime.status.assert_not_awaited()

    def test_missing_runtime_reports_unavailable(self):
        self.state.robot_runtimes = None
        self.assertEqual(self.client.get('/ai_worker/bringup_status').status_code, 503)
        self.runtime.status.assert_not_awaited()

    def test_running_selection_reuses_lightweight_docker_query(self):
        self.docker.running_robot_containers.return_value = [{'name': 'ai_worker', 'id': 'id'}]
        response = self.client.get('/containers?running=true')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['supported_robot_containers'], ['ai_worker'])
        self.docker.running_robot_containers.assert_called_once_with(self.config.supported_robot_containers)
        self.docker.list_containers.assert_not_called()

    def test_default_container_list_keeps_stopped_supported_containers(self):
        self.docker.list_containers.return_value = [
            {'name': 'ai_worker', 'status': 'running'},
            {'name': 'open_manipulator', 'status': 'exited'},
            {'name': 'unrelated', 'status': 'running'}]
        response = self.client.get('/containers')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['supported_robot_containers'], self.config.supported_robot_containers)
        self.docker.list_containers.assert_called_once_with(all=True)
        self.docker.running_robot_containers.assert_not_called()
