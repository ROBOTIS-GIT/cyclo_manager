"""ZED SDK discovery and color/depth acquisition."""

import ctypes
from pathlib import Path
import sys

from cyclo_manager.diagnostics.camera.monitor import CameraMonitor

_jetson_jpeg = None


def load_sdk():
    try:
        import pyzed.sl as sl
    except ImportError as exc:
        # Some Jetson containers resolve a generic JPEG library first. Supply
        # the missing vendor symbols within this process without changing the OS.
        library = Path('/usr/lib/aarch64-linux-gnu/nvidia/libnvjpeg.so')
        if 'jpeg_set_hardware_acceleration_parameters_enc' not in str(exc) or not library.is_file():
            raise
        global _jetson_jpeg
        _jetson_jpeg = ctypes.CDLL(str(library), mode=ctypes.RTLD_GLOBAL)
        import pyzed.sl as sl
    return sl


def watch_camera(sl, device, record, lock, stop, cv2, frame_directory=None):
    camera = sl.Camera()
    monitor = None
    try:
        config = sl.InitParameters()
        config.set_from_serial_number(device.serial_number)
        config.camera_resolution = sl.RESOLUTION.VGA
        config.camera_fps = 30
        config.depth_mode = sl.DEPTH_MODE.PERFORMANCE
        config.sensors_required = False
        config.sdk_verbose = 0
        config.open_timeout_sec = 5
        result = camera.open(config)
        if result != sl.ERROR_CODE.SUCCESS:
            raise RuntimeError(f'Unable to open ZED color + depth streams: {result}')
        mode = camera.get_camera_information().camera_configuration
        monitor = CameraMonitor(record, lock, {
            view: (mode.resolution.width, mode.resolution.height, mode.fps) for view in ('color', 'depth')
        }, frame_directory, cv2)
        with lock:
            record['view'] = 'Left image'
        images = {'color': sl.Mat(), 'depth': sl.Mat()}
        runtime = sl.RuntimeParameters()
        runtime.enable_depth = True
        while not stop.is_set():
            result = camera.grab(runtime)
            if result != sl.ERROR_CODE.SUCCESS:
                monitor.fail_all(f'No ZED frames for 5 seconds: {result}')
                stop.wait(.1)
                continue
            measured = camera.get_current_fps()
            for view, sdk_view in (('color', sl.VIEW.LEFT), ('depth', sl.VIEW.DEPTH)):
                stream = monitor.streams[view]
                try:
                    result = camera.retrieve_image(images[view], sdk_view)
                    if result != sl.ERROR_CODE.SUCCESS:
                        stream.fail(f'No ZED {view} frames for 5 seconds: {result}')
                        continue
                    stream.observe(camera_fps=measured)
                    if monitor.wants(view):
                        pixels = cv2.cvtColor(images[view].get_data(), cv2.COLOR_BGRA2BGR)
                        monitor.send(view, pixels)
                except Exception as exc:
                    stream.fail(str(exc), immediate=True)
            monitor.update()
    except Exception as exc:
        if monitor:
            monitor.fail_all(str(exc), immediate=True)
        else:
            with lock:
                record.update(state='error', error=str(exc), fps=0, camera_fps=None)
    finally:
        try:
            camera.close()
        except Exception as exc:
            print(f"{record['serial']}: {exc}", file=sys.stderr, flush=True)
