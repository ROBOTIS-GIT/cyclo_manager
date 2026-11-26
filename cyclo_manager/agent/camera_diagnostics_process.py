"""Manage the camera worker independently of the DYNAMIXEL worker."""

import asyncio
import os
from pathlib import Path
import shutil
import tempfile
import time
import uuid

from cyclo_manager.agent.diagnostics_process import ACTIVE_STATES, DiagnosticSessions, worker_command
from cyclo_manager.diagnostics.camera.frames import frame_paths, read_latest


class CameraSessions(DiagnosticSessions):
    snapshot_key = 'cameras'

    def __init__(self):
        super().__init__()
        self.frame_directory = None

    async def start(self):
        async with self.lock:
            if self.current and self.current['state'] in ACTIVE_STATES:
                raise ValueError('A camera check is already active')
            if self.task:
                await self.task
            directory = Path(tempfile.mkdtemp(prefix='cyclo-camera-', dir='/dev/shm'))
            try:
                self.process = await asyncio.create_subprocess_exec(
                    *worker_command(check='camera'),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    env={**os.environ, 'CYCLO_CAMERA_FRAME_DIR': str(directory)},
                    start_new_session=True, limit=1024 * 1024)
            except BaseException:
                shutil.rmtree(directory)
                raise
            self.frame_directory = directory
            self.current = dict(id=str(uuid.uuid4()), state='starting', started_at=time.time(),
                                snapshot=None, error=None, stderr=[], revision=0)
            self.notify()
            self.task = asyncio.create_task(self._consume(self.process, self.current))
            self.watch_viewers()
            return self.current

    async def _consume(self, process, session):
        directory = self.frame_directory
        try:
            await super()._consume(process, session)
        finally:
            shutil.rmtree(directory, ignore_errors=True)
            if self.frame_directory == directory:
                self.frame_directory = None

    def camera_stream(self, session_id, camera_id, view='color'):
        session = self.current
        if not session or session['id'] != session_id:
            raise LookupError('Camera session not found')
        if session['state'] not in {'starting', 'running'} or not self.frame_directory:
            raise ValueError('Camera check is not running')
        cameras = (session.get('snapshot') or {}).get('cameras', [])
        camera = next((camera for camera in cameras if camera.get('id', camera['serial']) == camera_id), None)
        if camera is None:
            raise LookupError('Camera not found in this check')
        if view not in {'color', 'depth'}:
            raise ValueError('Unknown camera stream')
        if view == 'depth' and view not in camera.get('streams', {}):
            raise ValueError('Depth stream is not available')
        return self._stream_frames(session, camera_id, self.frame_directory, view)

    async def _stream_frames(self, session, camera_id, directory, view='color'):
        image, lease = frame_paths(directory, camera_id, view)
        last_frame = None
        last_lease = 0
        while self.current is session and session['state'] in {'starting', 'running'}:
            try:
                if time.monotonic() - last_lease >= 1:
                    lease.touch()
                    last_lease = time.monotonic()
                frame = await asyncio.to_thread(read_latest, image)
                if frame and frame[0] != last_frame:
                    last_frame, data = frame
                    yield (b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '
                           + str(len(data)).encode() + b'\r\n\r\n' + data + b'\r\n')
                await asyncio.sleep(.01)
            except FileNotFoundError:
                return


camera_sessions = CameraSessions()
