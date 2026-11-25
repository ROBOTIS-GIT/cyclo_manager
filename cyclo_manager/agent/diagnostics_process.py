"""Run the standalone worker in the robot container, independent of viewers."""

import asyncio
from collections import deque
import json
import os
from pathlib import Path
import signal
import time
import uuid



ACTIVE_STATES = {'starting', 'running', 'stopping'}


def worker_command(*arguments):
    # Deployment-owned paths, never request-supplied shell fragments. The agent
    # itself need not load ROS; only the standalone child needs package lookup.
    setup = os.environ.get('CYCLO_DIAGNOSTICS_SETUP', '/root/ros2_ws/install/setup.bash')
    script = 'set -e; source "$1" >&2; shift; exec python3 -u -m cyclo_manager.diagnostics "$@"'
    if not Path(setup).is_file():
        raise RuntimeError(f'Robot workspace setup not found: {setup}')
    return ['bash', '-c', script, 'cyclo-diagnostics', setup, *arguments]


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
    def __init__(self):
        self.current = None
        self.process = None
        self.task = None
        self.lock = asyncio.Lock()
        self.changed = asyncio.Event()

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
            self.notify()

    async def stop(self, session_id=None):
        async with self.lock:
            if not self.current or (session_id and self.current['id'] != session_id):
                raise LookupError('Diagnostic session not found')
            if self.current['state'] in ACTIVE_STATES:
                self.current['state'] = 'stopping'
                self.notify()
                await terminate(self.process)
                await self.task
            return self.current

    async def close(self):
        if self.current:
            await self.stop()

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
