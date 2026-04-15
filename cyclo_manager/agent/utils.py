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

