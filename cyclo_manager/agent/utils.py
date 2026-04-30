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

"""Utility functions for s6 agent."""

import re


def strip_ansi_codes(text: str) -> str:
    """Remove ANSI escape codes from text.

    ANSI escape codes are used for terminal coloring and formatting.
    This function removes them to produce clean log output.

    Args:
        text: Text that may contain ANSI escape codes.

    Returns:
        Text with ANSI escape codes removed.
    """
    # Pattern to match ANSI escape sequences
    # Matches: \x1b[...m, \033[...m, \u001b[...m, etc.
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m|\033\[[0-9;]*m|\u001b\[[0-9;]*m')
    return ansi_escape.sub('', text)

