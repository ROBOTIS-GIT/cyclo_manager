"""CLI entry point. stdout is machine-readable when --format ndjson is used."""

import argparse
import json
import signal
import sys
import threading

from cyclo_manager.diagnostics.robot.profiles import PROFILES, list_profiles, package_share, resolve_profile


def main(argv=None, prog=None):
    parser = argparse.ArgumentParser(prog=prog, description='DYNAMIXEL preflight (HX5 hand checks switch to bypass; no bringup)')
    parser.add_argument('--profile', choices=PROFILES)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--once', action='store_true')
    mode.add_argument('--watch', action='store_true')
    parser.add_argument('--list-profiles', action='store_true')
    parser.add_argument('--inspect', action='store_true', help='Resolve configuration without opening ports')
    parser.add_argument('--port', action='append', default=[], metavar='SYSTEM=/dev/DEVICE')
    parser.add_argument('--baud-rate', action='append', default=[], metavar='SYSTEM=BAUD')
    parser.add_argument('--format', choices=['text', 'ndjson'], default='text')
    parser.add_argument('--temperature-margin', type=float, default=5.0)
    parser.add_argument('--managed', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    try:
        if args.list_profiles:
            print(json.dumps(dict(profiles=list_profiles())), flush=True)
            return 0
        if not args.profile:
            parser.error('--profile is required')
        if not 0 <= args.temperature_margin <= 30:
            parser.error('--temperature-margin must be between 0 and 30 °C')
        overrides = {}
        for value in args.port:
            system, sep, port = value.partition('=')
            if not sep or not system or system in overrides:
                parser.error('--port must be a unique SYSTEM=/dev/DEVICE assignment')
            overrides[system] = port
        baud_rates = {}
        for value in args.baud_rate:
            system, sep, baud = value.partition('=')
            if not sep or not system or system in baud_rates or not baud.isascii() or not baud.isdigit() or int(baud) <= 0:
                parser.error('--baud-rate must be a unique SYSTEM=positive_integer assignment')
            baud_rates[system] = int(baud)
        config = resolve_profile(args.profile, overrides, baud_rates)
        if args.inspect:
            print(json.dumps(dict(**config)), flush=True)
            return 0
        from cyclo_manager.diagnostics.robot.registers import Catalog
        from cyclo_manager.diagnostics.robot.runner import Runner
        catalog = Catalog(package_share('dynamixel_hardware_interface') / 'param/dxl_model')

        def emit(snapshot):
            if args.format == 'ndjson':
                print(json.dumps(snapshot, allow_nan=False), flush=True)
            elif snapshot['state'] in {'completed', 'stopped'}:
                print(json.dumps(snapshot, indent=2, ensure_ascii=False), flush=True)
            else:
                summary = snapshot['summary']
                print(f"{snapshot['state']}: {summary['responding']}/{summary['expected']} expected, "
                      f"{summary['additional']} additional, {summary['errors']} errors", flush=True)
        runner = Runner(config, catalog, stop, emit, temperature_margin=args.temperature_margin)
        if args.managed:
            def parent_pipe():
                try:
                    while line := sys.stdin.buffer.readline(4096):
                        try:
                            runner.submit_calibration(json.loads(line))
                        except (ValueError, TypeError) as exc:
                            print(f'Calibration request rejected: {exc}', file=sys.stderr, flush=True)
                finally:
                    stop.set()
            threading.Thread(target=parent_pipe, daemon=True).start()
        return runner.run(args.watch)
    except BrokenPipeError:
        return 130
    except Exception as exc:
        print(json.dumps(dict(state='failed', error=str(exc))), flush=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
