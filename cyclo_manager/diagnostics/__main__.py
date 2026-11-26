"""Select a diagnostic worker without loading the other worker's dependencies."""

import argparse


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog='python3 -m cyclo_manager.diagnostics',
        description='Run robot hardware or camera diagnostics without bringup.')
    checks = parser.add_subparsers(dest='check', required=True)
    checks.add_parser('robot', add_help=False, help='Check DYNAMIXEL devices and boards')
    checks.add_parser('camera', add_help=False, help='Check RealSense and ZED streams')
    args, remaining = parser.parse_known_args(argv)
    if args.check == 'robot':
        from .robot.__main__ import main as run
    else:
        from .camera.__main__ import main as run
    return run(remaining, prog=f'{parser.prog} {args.check}')


if __name__ == '__main__':
    raise SystemExit(main())
