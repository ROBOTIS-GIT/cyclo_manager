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

"""Compatibility policy for container s6 agents."""

import re

# Change this version when the s6 agent API changes.
MIN_COMPATIBLE_S6_AGENT_VERSION = '1.0.0'


def _parse_release_version(version: str) -> tuple[int, int, int] | None:
    """Parse the numeric release prefix from a version string."""
    match = re.match(r'^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?', version)
    if match is None:
        return None
    major, minor, patch = match.groups(default='0')
    return int(major), int(minor), int(patch)


def compare_s6_agent_version(version: str | None) -> int | None:
    """Compare an agent version with the minimum required version."""
    if not version:
        return None

    agent_version = _parse_release_version(version)
    minimum_version = _parse_release_version(MIN_COMPATIBLE_S6_AGENT_VERSION)
    if agent_version is None or minimum_version is None:
        return None

    return (agent_version > minimum_version) - (agent_version < minimum_version)
