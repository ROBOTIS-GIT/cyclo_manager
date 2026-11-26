"""Latest-frame exchange between the camera worker and its supervising Agent."""

import hashlib
import os
from pathlib import Path
import time

LEASE_SECONDS = 3


def frame_paths(directory, camera_id, view='color'):
    identity = camera_id if view == 'color' else f'{camera_id}\0{view}'
    key = hashlib.sha256(identity.encode()).hexdigest()
    root = Path(directory)
    return root / f'{key}.jpg', root / f'{key}.requested'


def requested(path):
    try:
        return time.time() - path.stat().st_mtime < LEASE_SECONDS
    except FileNotFoundError:
        return False


def publish(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def read_latest(path):
    try:
        with path.open('rb') as stream:
            stat = os.fstat(stream.fileno())
            if time.time() - stat.st_mtime > LEASE_SECONDS:
                return None
            return stat.st_mtime_ns, stream.read()
    except FileNotFoundError:
        return None
