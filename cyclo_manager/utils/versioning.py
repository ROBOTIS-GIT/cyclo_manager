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

"""Version parsing and comparison utilities."""


def parse_version(version_str: str) -> tuple[int, ...]:
    """Parse version string into comparable tuple (e.g. '1.2.3' -> (1, 2, 3))."""
    parts = []
    for p in (version_str or "").strip().lstrip("v").split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts) if parts else (0,)


def is_newer(latest: str, current: str) -> bool:
    """Return True if latest > current (semver-style comparison)."""
    return parse_version(latest) > parse_version(current)
