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
