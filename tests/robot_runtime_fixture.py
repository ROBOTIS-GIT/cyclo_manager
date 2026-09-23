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

"""A fresh runtime observation for motion tests without Docker or an agent."""

import importlib.util
from pathlib import Path
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch

from cyclo_manager.robot.runtime import RobotRuntime, RobotRuntimes


def ready_runtime(model='sg2'):
    runtime = RobotRuntime(None, None, 'test-container')
    runtime._state = dict(ready=True, model=model, container='test-container',
                          generation='process-1', reason=None)
    runtime._updated = time.monotonic()
    return runtime


def ready_runtimes(runtime=None):
    runtimes = RobotRuntimes(None, None, ['test-container'])
    runtimes._runtimes['test-container'] = runtime or ready_runtime()
    return runtimes


def runtime_state(runtimes, **values):
    """Use production HTTP/WS dependencies with an isolated, non-ROS app state."""
    path = Path(__file__).parents[1] / 'cyclo_manager/state.py'
    spec = importlib.util.spec_from_file_location('isolated_runtime_state', path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'cyclo_manager.ros2_node': SimpleNamespace(Ros2Bridge=object)}):
        spec.loader.exec_module(module)
    module.app_state = SimpleNamespace(robot_runtimes=runtimes, **values)
    return module
