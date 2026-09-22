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

import time

from cyclo_manager.robot.runtime import RobotRuntime


def ready_runtime(model='sg2'):
    runtime = RobotRuntime(None, None, ())
    runtime._state = dict(ready=True, model=model, container='test-container',
                          generation='process-1', reason=None)
    runtime._updated = time.monotonic()
    return runtime
