"""RealSense color and depth acquisition."""

import sys

from cyclo_manager.diagnostics.camera.monitor import CameraMonitor


def stream_profiles(device, rs, stream, formats):
    profiles = []
    for sensor in device.query_sensors():
        for profile in sensor.get_stream_profiles():
            if profile.stream_type() == stream and profile.format() in formats:
                profiles.append(profile.as_video_stream_profile())
    return sorted(profiles, key=lambda p: (
        p.width() > 640 or p.height() > 480, abs(p.fps() - 30),
        abs(p.width() * p.height() - 424 * 240), p.format() != formats[0]))


def stream_configuration(device, rs, pipeline, serial):
    colors = stream_profiles(device, rs, rs.stream.color, (rs.format.bgr8, rs.format.rgb8))
    depths = stream_profiles(device, rs, rs.stream.depth, (rs.format.z16,))
    if not colors or not depths:
        raise RuntimeError('Camera does not expose both color and depth streams')
    wrapper = rs.pipeline_wrapper(pipeline)
    # Prefer matching modes before trying profiles that require sensor conversion.
    # D405 derives color from its depth sensor, so mismatched modes cannot run together.
    pairs = [(color, depth) for color in colors for depth in depths]
    pairs.sort(key=lambda pair: (
        (pair[0].width(), pair[0].height(), pair[0].fps()) !=
        (pair[1].width(), pair[1].height(), pair[1].fps()),
        colors.index(pair[0]), depths.index(pair[1])))
    for color, depth in pairs:
        config = rs.config()
        config.enable_device(serial)
        for stream, profile in ((rs.stream.color, color), (rs.stream.depth, depth)):
            config.enable_stream(stream, profile.width(), profile.height(), profile.format(), profile.fps())
        if config.can_resolve(wrapper):
            return config, color, depth
    raise RuntimeError('No compatible color + depth stream configuration is available')


def watch_camera(context, device, record, lock, stop, rs, cv2, np, frame_directory=None):
    pipeline = rs.pipeline(context)
    started = False
    monitor = None
    try:
        config, color_profile, depth_profile = stream_configuration(device, rs, pipeline, record['serial'])
        pipeline.start(config)
        started = True
        profiles = {'color': color_profile, 'depth': depth_profile}
        monitor = CameraMonitor(record, lock, {
            view: (p.width(), p.height(), p.fps()) for view, p in profiles.items()
        }, frame_directory, cv2)
        colorizer = rs.colorizer()
        previous = {}
        while not stop.is_set():
            try:
                frames = pipeline.wait_for_frames(1000)
            except RuntimeError as exc:
                monitor.fail_all(f'No new frames for 5 seconds: {exc}')
                stop.wait(.1)
                continue
            for view, frame in (('color', frames.get_color_frame()), ('depth', frames.get_depth_frame())):
                stream = monitor.streams[view]
                try:
                    if not frame or frame.get_frame_number() == previous.get(view):
                        stream.fail(f'No new {view} frames for 5 seconds')
                        continue
                    previous[view] = frame.get_frame_number()
                    try:
                        timestamp = frame.get_timestamp()
                    except RuntimeError:
                        timestamp = None
                    stream.observe(number=frame.get_frame_number(), timestamp=timestamp)
                    if monitor.wants(view):
                        if view == 'depth':
                            pixels = np.asanyarray(colorizer.colorize(frame).get_data())
                            pixels = cv2.cvtColor(pixels, cv2.COLOR_RGB2BGR)
                        else:
                            pixels = np.asanyarray(frame.get_data())
                            if color_profile.format() == rs.format.rgb8:
                                pixels = cv2.cvtColor(pixels, cv2.COLOR_RGB2BGR)
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
        if started:
            try:
                pipeline.stop()
            except Exception as exc:
                print(f"{record['serial']}: {exc}", file=sys.stderr, flush=True)
