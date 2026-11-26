"""Run diagnostic workers and stop managed checks when their page is unattended."""

import asyncio
from collections import deque
import json
import os
from pathlib import Path
import signal
import time
import uuid

from cyclo_manager.diagnostics.robot.calibration import tactile_target
from cyclo_manager.diagnostics.robot.multi_turn import y_motor_target



ACTIVE_STATES = {'starting', 'running', 'stopping'}
VIEWER_TIMEOUT_SECONDS = 5


def worker_command(*arguments, check='robot'):
    # Deployment-owned paths, never request-supplied shell fragments. The agent
    # itself need not load ROS; only the standalone child needs package lookup.
    setup = os.environ.get('CYCLO_DIAGNOSTICS_SETUP', '/root/ros2_ws/install/setup.bash')
    script = 'set -e; source "$1" >&2; shift; exec python3 -u -m "$@"'
    if not Path(setup).is_file():
        raise RuntimeError(f'Robot workspace setup not found: {setup}')
    return ['bash', '-c', script, 'cyclo-diagnostics', setup, 'cyclo_manager.diagnostics', check, *arguments]


async def terminate(process):
    if process.returncode is not None:
        return
    if process.stdin:
        process.stdin.close()
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(process.wait(), 3)
    except asyncio.TimeoutError:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()


async def configuration(*arguments):
    process = await asyncio.create_subprocess_exec(*worker_command(*arguments),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), 30)
        if process.returncode:
            raise RuntimeError((stdout or stderr).decode(errors='replace')[-4000:])
        result = json.loads(stdout)
        return result
    finally:
        if process.returncode is None:
            await terminate(process)


class DiagnosticSessions:
    snapshot_key = 'buses'

    def __init__(self):
        self.current = None
        self.process = None
        self.task = None
        self.lock = asyncio.Lock()
        self.changed = asyncio.Event()
        self.pending_calibrations = {}
        self.viewer_deadline = 0.0
        self.viewer_task = None

    def keep_viewer_alive(self):
        self.viewer_deadline = time.monotonic() + VIEWER_TIMEOUT_SECONDS

    def watch_viewers(self):
        self.keep_viewer_alive()
        if self.viewer_task:
            self.viewer_task.cancel()
        self.viewer_task = asyncio.create_task(self._watch_viewers(self.current))

    async def _watch_viewers(self, session):
        while self.current is session and session['state'] in ACTIVE_STATES:
            remaining = self.viewer_deadline - time.monotonic()
            if remaining <= 0:
                await self.stop(session['id'], unattended=True)
            else:
                await asyncio.sleep(min(remaining, 1))

    def notify(self):
        self.current['revision'] = self.current.get('revision', 0) + 1
        self.changed.set()
        self.changed = asyncio.Event()

    async def start(self, profile, ports, baud_rates=None):
        async with self.lock:
            if self.current and self.current['state'] in ACTIVE_STATES:
                raise ValueError('A diagnostic session is already active')
            if self.task:
                await self.task
            args = ['--profile', profile, '--watch', '--format', 'ndjson', '--managed']
            for system, port in ports.items():
                args.extend(['--port', f'{system}={port}'])
            for system, baud in (baud_rates or {}).items():
                args.extend(['--baud-rate', f'{system}={baud}'])
            self.process = await asyncio.create_subprocess_exec(*worker_command(*args),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE, start_new_session=True, limit=1024 * 1024)
            self.current = dict(id=str(uuid.uuid4()), profile=profile,
                state='starting', health='unknown', started_at=time.time(), snapshot=None,
                error=None, stderr=[], revision=0)
            self.notify()
            self.task = asyncio.create_task(self._consume(self.process, self.current))
            self.watch_viewers()
            return self.current

    async def _consume(self, process, session):
        messages = deque(maxlen=20)

        async def stderr_reader():
            # Read chunks, not lines: a malformed/no-newline log cannot deadlock a pipe.
            while data := await process.stderr.read(4096):
                messages.append(data.decode(errors='replace'))

        stderr_task = asyncio.create_task(stderr_reader())
        try:
            while True:
                line = await asyncio.wait_for(process.stdout.readline(), 35)
                if not line:
                    break
                snapshot = json.loads(line)
                if 'buses' in snapshot:
                    for bus in snapshot['buses']:
                        result = bus.pop('calibration_result', None)
                        if result:
                            pending = self.pending_calibrations.get(result['request_id'])
                            if pending and not pending[1].done():
                                pending[1].set_result({'state': result['state'], 'message': result['message']})
                if self.snapshot_key in snapshot:
                    session['snapshot'] = snapshot
                if session['state'] != 'stopping' and snapshot['state'] in ACTIVE_STATES:
                    session['state'] = snapshot['state']
                session['health'] = snapshot.get('health', 'unknown')
                if snapshot.get('error'):
                    session['error'] = snapshot['error']
                self.notify()
            code = await asyncio.wait_for(process.wait(), 3)
            if session['state'] == 'stopping':
                session['state'] = 'stopped'
            elif code in {0, 1} and (session.get('snapshot') or {}).get('state') in {'completed', 'stopped'}:
                session['state'] = session['snapshot']['state']
            else:
                session['state'] = 'failed'
                session['error'] = session['error'] or f'Worker exited unexpectedly ({code})'
        except Exception as exc:
            await terminate(process)
            if session['state'] == 'stopping':
                session['state'] = 'stopped'
            else:
                session.update(state='failed', error=str(exc) or 'Worker did not respond within 35 seconds')
        finally:
            if process.returncode is None:
                await terminate(process)
            await stderr_task
            session.update(stderr=list(messages), finished_at=time.time())
            for _, future in list(self.pending_calibrations.values()):
                if not future.done():
                    future.set_result({'state': 'unconfirmed', 'message': 'Check ended before calibration was acknowledged'})
            self.notify()

    async def calibrate_tactile(self, session_id, system, controller_id, device_id):
        return await self._device_command(session_id, system, controller_id, device_id, 'calibrate_tactile')

    async def clear_multi_turn(self, session_id, system, device_id):
        return await self._device_command(session_id, system, device_id, device_id, 'clear_multi_turn')

    async def _device_command(self, session_id, system, controller_id, device_id, action):
        async with self.lock:
            session = self.current
            if not session or session['id'] != session_id:
                raise LookupError('Diagnostic session not found')
            if (session['state'] != 'running' or not self.process
                    or self.process.returncode is not None or not self.process.stdin):
                raise ValueError('Start a check before calibrating a tactile sensor')
            snapshot = session.get('snapshot') or {}
            buses = [bus for bus in snapshot.get('buses', []) if system in bus['systems']]
            if len(buses) != 1:
                raise ValueError('Calibration system not found')
            if action == 'calibrate_tactile':
                tactile_target(buses[0], system, controller_id, device_id)
            else:
                y_motor_target(buses[0], system, device_id)
            target = (system, controller_id, device_id)
            if any(pending_target == target for pending_target, _ in self.pending_calibrations.values()):
                raise ValueError('Calibration is already pending for this sensor')
            request_id = str(uuid.uuid4())
            command = dict(action=action, request_id=request_id, system=system,
                           controller_id=controller_id, device_id=device_id, expires_at=time.time() + 30)
            loop = asyncio.get_running_loop()
            future = loop.create_future()
            self.pending_calibrations[request_id] = (target, future)
            def expire():
                if not future.done():
                    future.set_result({'state': 'unconfirmed', 'message': 'Worker did not acknowledge calibration'})
            timer = loop.call_later(35, expire)
            def clear(_):
                timer.cancel()
                self.pending_calibrations.pop(request_id, None)
            future.add_done_callback(clear)
            try:
                self.process.stdin.write((json.dumps(command, allow_nan=False) + '\n').encode())
                await asyncio.wait_for(self.process.stdin.drain(), 1)
            except (OSError, RuntimeError, asyncio.TimeoutError):
                # The worker may still receive bytes already passed to write().
                # Keep the request pending until its result or the deadline.
                pass
        return await asyncio.shield(future)

    async def stop(self, session_id=None, *, unattended=False):
        async with self.lock:
            if not self.current or (session_id and self.current['id'] != session_id):
                raise LookupError('Diagnostic session not found')
            if unattended and time.monotonic() < self.viewer_deadline:
                return self.current
            if self.current['state'] in ACTIVE_STATES:
                self.current['state'] = 'stopping'
                self.notify()
                await terminate(self.process)
                await self.task
            return self.current

    async def close(self):
        if self.current:
            await self.stop()
        if self.viewer_task:
            self.viewer_task.cancel()
            await asyncio.gather(self.viewer_task, return_exceptions=True)

    async def stream(self, session_id):
        session = self.current
        if not session or session['id'] != session_id:
            raise LookupError('Diagnostic session not found')
        revision = -1
        while True:
            event = self.changed
            if session['revision'] != revision:
                revision = session['revision']
                yield json.dumps(session, allow_nan=False) + '\n'
            if session['state'] not in ACTIVE_STATES:
                return
            try:
                await asyncio.wait_for(event.wait(), 10)
            except asyncio.TimeoutError:
                yield '\n'


sessions = DiagnosticSessions()
