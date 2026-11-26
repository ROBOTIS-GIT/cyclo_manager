"""Discover RealSense and ZED cameras and check color/depth frame acquisition."""

import argparse
import json
import os
import signal
import sys
import threading
import time


def main(argv=None, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description='Check RealSense and ZED color/depth streams without bringup')
    parser.parse_args(argv)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    # SDK native code can write to stdout. Keep that output out of the JSON pipe.
    output = os.fdopen(os.dup(sys.stdout.fileno()), 'w', buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

    def emit(state, cameras, error=None, discovery_errors=None):
        print(json.dumps(dict(state=state, cameras=cameras, error=error,
                              discovery_errors=discovery_errors or [],
                              updated_at=time.time()), allow_nan=False), file=output, flush=True)

    emit('starting', [])
    try:
        import cv2
        import numpy as np
        records, threads = [], []
        camera_started = {}
        discovering = {'RealSense', 'ZED'}
        discovery_errors = []
        lock = threading.Lock()

        def record_for(serial, name, backend, usb=''):
            record = dict(id=f'{backend}:{serial}', serial=serial, name=name, backend=backend, usb=usb,
                          state='starting', error=None, fps=None, camera_fps=None, last_frame_at=None, frames_received=0)
            with lock:
                records.append(record)
                camera_started[record['id']] = time.monotonic()
            return record

        def add_worker(target, *args):
            with lock:
                if stop.is_set():
                    return
                thread = threading.Thread(target=target, args=args, daemon=True)
                threads.append(thread)
                thread.start()

        directory = os.environ.get('CYCLO_CAMERA_FRAME_DIR')
        def discover_realsense():
            import pyrealsense2 as rs
            from cyclo_manager.diagnostics.camera.realsense import watch_camera
            context = rs.context()
            for device in context.query_devices():
                if stop.is_set():
                    return
                def info(key):
                    return device.get_info(key) if device.supports(key) else ''
                serial = info(rs.camera_info.serial_number)
                record = record_for(serial, info(rs.camera_info.name), 'realsense', info(rs.camera_info.usb_type_descriptor))
                if not serial:
                    with lock:
                        record.update(state='error', error='Camera has no serial number; cannot select it reliably')
                    continue
                add_worker(watch_camera, context, device, record, lock, stop, rs, cv2, np, directory)

        def discover_zed():
            from cyclo_manager.diagnostics.camera.zed import load_sdk, watch_camera
            sl = load_sdk()
            for device in sl.Camera.get_device_list():
                if stop.is_set():
                    return
                serial = str(device.serial_number)
                record = record_for(serial, str(device.camera_model), 'zed')
                add_worker(watch_camera, sl, device, record, lock, stop, cv2, directory)

        def discover(backend, target, optional_modules):
            try:
                target()
            except ModuleNotFoundError as exc:
                if exc.name not in optional_modules:
                    with lock:
                        discovery_errors.append(f'{backend} discovery failed: {exc}')
            except Exception as exc:
                with lock:
                    discovery_errors.append(f'{backend} discovery failed: {exc}')
            finally:
                with lock:
                    discovering.discard(backend)

        add_worker(discover, 'RealSense', discover_realsense, {'pyrealsense2'})
        add_worker(discover, 'ZED', discover_zed, {'pyzed', 'pyzed.sl'})
        while not stop.is_set():
            with lock:
                snapshot = [dict(record) for record in records]
                started = dict(camera_started)
                errors = list(discovery_errors)
                pending = bool(discovering)
            if not snapshot and not pending:
                message = 'No cameras detected. Check the USB connection and power.'
                if errors:
                    message += ' ' + ' '.join(errors)
                emit('failed', [], message, errors)
                return 1
            for camera in snapshot:
                if time.monotonic() - started[camera['id']] > 15:
                    timed_out = {
                        view: dict(stream, state='error',
                                   error=f'{view.title()} stream did not start within 15 seconds',
                                   fps=0, camera_fps=None)
                        for view, stream in camera.get('streams', {}).items()
                        if stream['state'] == 'starting'
                    }
                    if timed_out:
                        # Only change the emitted snapshot; SDK workers can still recover.
                        camera['streams'] = {**camera['streams'], **timed_out}
                        camera.update(state='error', error='; '.join(
                            f'{view.title()}: {stream["error"]}'
                            for view, stream in camera['streams'].items() if stream['state'] == 'error'))
                    elif camera['state'] == 'starting':
                        camera.update(state='error', error='Camera did not start within 15 seconds')
                if camera['state'] == 'streaming' and time.time() - camera['last_frame_at'] > 5:
                    camera.update(state='error', error='No new frames for 5 seconds', fps=0, camera_fps=None)
            emit('running' if snapshot else 'starting', snapshot, discovery_errors=errors)
            stop.wait(1)
        # Bound shutdown even if an SDK is still searching or opening a device.
        deadline = time.monotonic() + 2
        with lock:
            workers = list(threads)
        for thread in workers:
            thread.join(timeout=max(0, deadline - time.monotonic()))
        emit('stopped', [])
        return 0
    except Exception as exc:
        stop.set()
        emit('failed', [], str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
