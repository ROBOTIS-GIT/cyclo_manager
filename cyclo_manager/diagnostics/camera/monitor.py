"""Per-stream health, frame rates, and requested video previews."""

import math
import time

from cyclo_manager.diagnostics.camera.frames import frame_paths, publish, requested


class Stream:
    def __init__(self, width, height, fps):
        self.data = dict(state='starting', error=None, width=width, height=height, configured_fps=fps,
                         fps=None, camera_fps=None, last_frame_at=None, frames_received=0)
        self.last_frame = self.window_start = time.monotonic()
        self.count = 0
        self.camera_start = None

    def observe(self, number=None, timestamp=None, camera_fps=None):
        now = time.monotonic()
        self.last_frame = now
        self.count += 1
        self.data.update(state='streaming', error=None, last_frame_at=time.time(),
                         frames_received=self.data['frames_received'] + 1)
        sample = (number, timestamp) if number is not None and timestamp is not None else None
        if self.camera_start is None:
            self.camera_start = sample
        elapsed = now - self.window_start
        if elapsed >= 1:
            measured = camera_fps
            if sample and self.camera_start:
                count = sample[0] - self.camera_start[0]
                milliseconds = sample[1] - self.camera_start[1]
                measured = count * 1000 / milliseconds if count > 0 and milliseconds > 0 else None
            self.data.update(fps=round(self.count / elapsed, 1),
                             camera_fps=round(measured, 1) if measured is not None and math.isfinite(measured) and measured > 0 else None)
            self.window_start, self.count, self.camera_start = now, 0, sample

    def fail(self, message, immediate=False):
        if immediate or time.monotonic() - self.last_frame >= 5:
            self.data.update(state='error', error=message, fps=0, camera_fps=None)


class CameraMonitor:
    def __init__(self, record, lock, modes, directory, cv2):
        self.record, self.lock, self.cv2 = record, lock, cv2
        self.streams = {view: Stream(*mode) for view, mode in modes.items()}
        self.paths = {view: frame_paths(directory, record.get('id', record['serial']), view)
                      for view in modes} if directory else {}
        self.requests = {}
        self.update()

    def wants(self, view):
        if view not in self.paths:
            return False
        checked, active = self.requests.get(view, (0, False))
        if time.monotonic() - checked >= .25:
            active = requested(self.paths[view][1])
            self.requests[view] = (time.monotonic(), active)
        return active

    def send(self, view, pixels):
        success, encoded = self.cv2.imencode('.jpg', pixels, [self.cv2.IMWRITE_JPEG_QUALITY, 80])
        if not success:
            raise RuntimeError(f'Unable to encode {view} frame')
        publish(self.paths[view][0], encoded.tobytes())

    def update(self):
        streams = {view: dict(stream.data) for view, stream in self.streams.items()}
        errors = [f'{view.title()}: {stream["error"]}' for view, stream in streams.items() if stream['state'] == 'error']
        state = 'error' if errors else 'streaming' if all(s['state'] == 'streaming' for s in streams.values()) else 'starting'
        color = streams['color']
        last_seen = [s['last_frame_at'] for s in streams.values()]
        with self.lock:
            self.record.update(**{key: color[key] for key in ('width', 'height', 'configured_fps', 'fps', 'camera_fps', 'frames_received')},
                               streams=streams, state=state, error='; '.join(errors) or None,
                               last_frame_at=min(last_seen) if all(value is not None for value in last_seen) else None)

    def fail_all(self, message, immediate=False):
        for stream in self.streams.values():
            stream.fail(message, immediate)
        self.update()
