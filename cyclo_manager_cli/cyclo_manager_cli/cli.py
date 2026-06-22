#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Author: Hyungyu Kim

"""
CLI for pip-installed cyclo_manager_cli.

Commands: cyclo_manager up, cyclo_manager down, cyclo_manager update.
Launches cyclo_manager server and UI via Docker.
"""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

PYPI_PACKAGE = 'cyclo-manager'
HOST_AGENT_SERVICE = 'cyclo_host_agent'
HOST_AGENT_SOCKET = '/var/run/robotis/agent_sockets/host/host_agent.sock'

# `cyclo_manager up` starts these immediately.
COMPOSE_SERVICES_UP = ('cyclo_manager', 'ui')
# These get `docker compose create` only (stopped); start from UI or `docker start`.
COMPOSE_SERVICES_CREATE_ONLY = ('rmw_zenoh', 'novnc-server')


def _docker_dir() -> Path:
    return Path(__file__).resolve().parent / 'docker'


def _config_dir() -> Path:
    return Path(__file__).resolve().parent / 'config'


def _packaged_config_path() -> Path:
    """Path to the bundled config (config/config.yml). Used for cyclo_manager up/down."""
    return _config_dir() / 'config.yml'


def _check_host_agent() -> bool:
    """Return True if the cyclo_host_agent service is already active."""
    result = subprocess.run(
        ['systemctl', 'is-active', f'{HOST_AGENT_SERVICE}.service'],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0



def _create_host_agent() -> int:
    """
    Write cyclo_host_agent systemd service unit file and enable it.

    Runs as a persistent service (Restart=always); systemd starts it at boot
    and restarts it automatically if it exits unexpectedly.
    """
    agent_exe = shutil.which('cyclo_host_agent')
    if not agent_exe:
        print(
            'Warning: cyclo_host_agent not found in PATH. '
            'Run `pip install cyclo-manager` and retry.',
            file=sys.stderr,
        )
        return 1

    user_home = Path.home()
    service_content = f"""\
[Unit]
Description=Cyclo Host Agent
After=network.target

[Service]
Type=simple
ExecStart={agent_exe}
Environment=HOME={user_home}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""

    service_file = f'/etc/systemd/system/{HOST_AGENT_SERVICE}.service'

    print(f'Installing {HOST_AGENT_SERVICE} systemd service (requires sudo)...')
    try:
        subprocess.run(
            ['sudo', 'tee', service_file],
            input=service_content.encode(),
            capture_output=True,
            check=True,
        )
        subprocess.run(['sudo', 'systemctl', 'daemon-reload'], check=True)
        subprocess.run(['sudo', 'systemctl', 'enable', '--now', f'{HOST_AGENT_SERVICE}.service'], check=True)
        print('Host agent service installed and started.')
        return 0
    except subprocess.CalledProcessError as e:
        print(f'Failed to install host agent service: {e}', file=sys.stderr)
        return 1
    except FileNotFoundError:
        print('sudo not found. Install the host agent service manually.', file=sys.stderr)
        return 1


def cmd_up(args: argparse.Namespace) -> int:
    """Start API + UI; create zenoh and noVNC containers without starting them."""
    if not _check_host_agent():
        if _create_host_agent() != 0:
            print('Warning: Failed to install host agent service.')

    config_path = _packaged_config_path()
    if not config_path.is_file():
        print(f'Bundled config not found: {config_path}', file=sys.stderr)
        return 1
    compose_path = _docker_dir() / 'docker-compose.yml'
    if not compose_path.is_file():
        print(f'Compose file not found: {compose_path}', file=sys.stderr)
        return 1
    env = os.environ.copy()
    env['CYCLO_MANAGER_CONFIG_FILE'] = str(config_path)
    base = ['docker', 'compose', '-f', str(compose_path)]
    try:
        if args.pull:
            subprocess.run([*base, 'pull'], env=env, check=True)
        subprocess.run([*base, 'up', '-d', *COMPOSE_SERVICES_UP], env=env, check=True)
        subprocess.run(
            [*base, 'create', '--no-recreate', *COMPOSE_SERVICES_CREATE_ONLY],
            env=env,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        return e.returncode
    except FileNotFoundError:
        print(
            'Docker not found. Install Docker and ensure "docker compose" is available.',
            file=sys.stderr,
        )
        return 1
    print(
        'cyclo_manager stack is up (API + UI running; '
        'zenoh_daemon + novnc-server created, not started).',
    )
    return 0


def cmd_down(args: argparse.Namespace) -> int:
    """Stop cyclo_manager server, cyclo_manager_ui, and zenoh daemon (docker compose down)."""
    compose_path = _docker_dir() / 'docker-compose.yml'
    if not compose_path.is_file():
        print(f'Compose file not found: {compose_path}', file=sys.stderr)
        return 1
    env = os.environ.copy()
    env['CYCLO_MANAGER_CONFIG_FILE'] = str(_packaged_config_path())
    cmd = [
        'docker',
        'compose',
        '-f',
        str(compose_path),
        'down',
    ]
    try:
        subprocess.run(cmd, env=env, check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode
    except FileNotFoundError:
        print(
            'Docker not found. Install Docker and ensure "docker compose" is available.',
            file=sys.stderr,
        )
        return 1

    service_file = f'/etc/systemd/system/{HOST_AGENT_SERVICE}.service'
    try:
        subprocess.run(['sudo', 'systemctl', 'disable', '--now', f'{HOST_AGENT_SERVICE}.service'], check=True)
        subprocess.run(['sudo', 'rm', '-f', service_file], check=True)
        subprocess.run(['sudo', 'systemctl', 'daemon-reload'], check=True)
    except subprocess.CalledProcessError:
        pass
    except FileNotFoundError:
        pass

    print('cyclo_manager server, cyclo_manager_ui, and zenoh daemon are down.')
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    """Down containers, pip install -U cyclo-manager, then up again."""
    cyclo_manager_exe = shutil.which('cyclo_manager')
    if not cyclo_manager_exe:
        print('cyclo_manager command not found in PATH.', file=sys.stderr)
        return 1
    pip_exe = shutil.which('pip3') or shutil.which('pip')
    if not pip_exe:
        print('pip not found; cannot update package.', file=sys.stderr)
        return 1

    print('Stopping containers (cyclo_manager down)...')
    try:
        subprocess.run([cyclo_manager_exe, 'down'], check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode

    print(f'Updating {PYPI_PACKAGE} (pip install -U)...')
    try:
        subprocess.run(
            [pip_exe, 'install', '-U', PYPI_PACKAGE],
            check=True,
            timeout=120,
        )
    except subprocess.CalledProcessError as e:
        print(f'pip install -U {PYPI_PACKAGE} failed.', file=sys.stderr)
        return e.returncode
    except subprocess.TimeoutExpired:
        print('pip install timed out.', file=sys.stderr)
        return 1

    print('Starting containers (cyclo_manager up)...')
    up_args = [cyclo_manager_exe, 'up']
    if getattr(args, 'pull', False):
        up_args.append('--pull')
    try:
        subprocess.run(up_args, check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode

    print('cyclo_manager update completed.')
    return 0


def main() -> int:
    """Parse CLI arguments and run the selected subcommand."""
    parser = argparse.ArgumentParser(
        prog='cyclo_manager',
        description=(
            'cyclo_manager CLI: launch cyclo_manager server and UI containers. '
            'Services run via Docker images.'
        ),
    )
    sub = parser.add_subparsers(dest='command', help='Commands')

    up_parser = sub.add_parser('up', help='Start cyclo_manager stack (docker compose)')
    up_parser.add_argument(
        '--pull',
        action='store_true',
        help='Pull all service images before create/up',
    )
    up_parser.set_defaults(func=cmd_up)

    down_parser = sub.add_parser('down', help='Stop all stack containers (docker compose down)')
    down_parser.set_defaults(func=cmd_down)

    update_parser = sub.add_parser(
        'update',
        help='Down containers, pip install -U cyclo-manager, then up again',
    )
    update_parser.add_argument(
        '--pull',
        action='store_true',
        help='Always pull images when running cyclo_manager up',
    )
    update_parser.set_defaults(func=cmd_update)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 0
    return args.func(args)
