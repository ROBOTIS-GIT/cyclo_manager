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
import pwd
import shutil
import socket
import subprocess
import sys

PYPI_PACKAGE = 'cyclo-manager'
HOST_AGENT_SERVICE = 'cyclo_host_agent'
HOST_AGENT_SOCKET = '/var/run/robotis/agent_sockets/host/host_agent.sock'
HOST_AGENT_SOCKET_DIR = '/var/run/robotis/agent_sockets/host'

# `cyclo_manager up` starts these Containers immediately.
COMPOSE_SERVICES_UP = ('cyclo_manager', 'ui')
# These get `docker compose create` only (stopped); start from UI or `docker start`.
COMPOSE_SERVICES_CREATE_ONLY = ('rmw_zenoh', 'novnc-server')
DISABLED_LOGIN_SHELLS = {'', '/bin/false', '/sbin/nologin', '/usr/sbin/nologin'}


def _docker_dir() -> Path:
    return Path(__file__).resolve().parent / 'docker'


def _config_dir() -> Path:
    return Path(__file__).resolve().parent / 'config'


def _packaged_config_path() -> Path:
    """Path to the bundled config (config/config.yml). Used for cyclo_manager up/down."""
    return _config_dir() / 'config.yml'


def _sudo_cmd(args: list[str]) -> list[str]:
    """Return args prefixed with sudo when the current process is not already root."""
    if os.geteuid() == 0:
        return args
    return ['sudo', *args]


def _user_home(user: str) -> Path:
    """Return a user's home directory from passwd, with a conservative fallback."""
    try:
        return Path(pwd.getpwnam(user).pw_dir)
    except KeyError:
        if user == 'root':
            return Path('/root')
        return Path(f'/home/{user}')


def _has_normal_login_user() -> bool:
    """Return True when the host has a non-root login user."""
    for account in pwd.getpwall():
        if account.pw_name == 'root':
            continue
        if account.pw_uid < 1000 or account.pw_uid >= 65534:
            continue
        if account.pw_shell in DISABLED_LOGIN_SHELLS:
            continue
        return True
    return False


def _host_agent_workspace(user: str, user_home: Path) -> Path:
    """Return the workspace path the host agent should scan for git repositories."""
    configured_workspace = os.environ.get('CYCLO_HOST_AGENT_WORKSPACE')
    if configured_workspace:
        return Path(configured_workspace).expanduser()
    data_docker = Path('/data/docker')
    if user == 'root' and data_docker.is_dir():
        return data_docker
    return user_home


def _resolve_service_user() -> tuple[str, Path] | None:
    """
    Return (username, home) for the host agent systemd service.

    Uses SUDO_USER when cyclo_manager up is invoked via sudo so the agent runs
    as the login user (required for git repo scans under ~/...).
    """
    sudo_user = os.environ.get('SUDO_USER')
    if sudo_user:
        return sudo_user, _user_home(sudo_user)
    user = os.environ.get('USER') or pwd.getpwuid(os.getuid()).pw_name
    if user == 'root':
        if not _has_normal_login_user():
            print(
                'Info: root-only device detected; cyclo_host_agent will run as root.',
                file=sys.stderr,
            )
            return 'root', Path('/root')
        print(
            'Error: cyclo_manager up must run as a normal user (e.g. robotis), not root.',
            file=sys.stderr,
        )
        return None
    return user, Path.home()


def _setup_socket_dir(user: str) -> bool:
    """
    Ensure the host agent UDS directory exists and is owned by the service user.

    Only host/ is chowned so other agent sockets under agent_sockets/ are untouched.
    Removes a stale socket file (e.g. left by a previous root-owned service).
    """
    print(f'  [1/3] Creating socket directory {HOST_AGENT_SOCKET_DIR}...')
    try:
        subprocess.run(
            _sudo_cmd(['mkdir', '-p', HOST_AGENT_SOCKET_DIR]),
            check=True,
            capture_output=True,
        )
        print(f'  [2/3] Setting ownership to {user}:{user}...')
        subprocess.run(
            _sudo_cmd(['chown', f'{user}:{user}', HOST_AGENT_SOCKET_DIR]),
            check=True,
            capture_output=True,
        )
        print('  [3/3] Removing stale socket file (if any)...')
        subprocess.run(
            _sudo_cmd(['rm', '-f', HOST_AGENT_SOCKET]),
            check=True,
            capture_output=True,
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f'Failed to set up host agent socket directory: {e}', file=sys.stderr)
        return False


def _install_sudoers(user: str) -> bool:
    """
    Write sudoers rules for cyclo_manager.

    Grant NOPASSWD for udev operations and the root-only host-agent refresh command.
    """
    if not sys.executable:
        print(
            'Python executable is unknown. '
            'Run `pip install cyclo-manager` and retry.',
            file=sys.stderr,
        )
        return False

    print('  Installing sudoers rules (cp, udevadm, host-agent refresh command)...')
    sudoers_content = (
        f'{user} ALL=(ALL) NOPASSWD: /usr/bin/cp, '
        f'/usr/bin/udevadm control --reload-rules, '
        f'/usr/bin/udevadm trigger, '
        'SETENV: '
        f'{sys.executable} -m cyclo_manager_cli.cli refresh-host-agent\n'
    )
    sudoers_file = '/etc/sudoers.d/cyclo_manager'
    try:
        subprocess.run(
            _sudo_cmd(['tee', sudoers_file]),
            input=sudoers_content.encode(),
            capture_output=True,
            check=True,
        )
        subprocess.run(
            _sudo_cmd(['chmod', '440', sudoers_file]),
            check=True,
            capture_output=True,
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f'Failed to install sudoers file: {e}', file=sys.stderr)
        return False


def _ensure_host_agent(restart_no_block: bool = False) -> int:
    """
    Install or refresh cyclo_host_agent: systemd unit, socket dir, and service start.

    Idempotent — safe to run on every `cyclo_manager up` (fixes upgraded units and
    socket ownership after switching away from a root-owned service).
    """
    account = _resolve_service_user()
    if account is None:
        return 1

    user, user_home = account
    workspace_path = _host_agent_workspace(user, user_home)
    agent_exec_start = f'{sys.executable} -m cyclo_host_agent.main' if sys.executable else None
    if not agent_exec_start:
        print(
            'Warning: Python executable is unknown. '
            'Run `pip install cyclo-manager` and retry.',
            file=sys.stderr,
        )
        return 1

    if not _setup_socket_dir(user):
        return 1

    if user != 'root' and not _install_sudoers(user):
        return 1

    service_content = f"""\
[Unit]
Description=Cyclo Host Agent
After=network.target

[Service]
Type=simple
User={user}
Group={user}
RuntimeDirectory=robotis/agent_sockets/host
RuntimeDirectoryMode=0755
ExecStart={agent_exec_start}
Environment=HOME={user_home}
Environment=CYCLO_HOST_AGENT_WORKSPACE={workspace_path}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""

    service_file = f'/etc/systemd/system/{HOST_AGENT_SERVICE}.service'

    print(f'Setting up {HOST_AGENT_SERVICE} systemd service (user={user})...')
    try:
        print(f'  Writing unit file to {service_file}...')
        subprocess.run(
            _sudo_cmd(['tee', service_file]),
            input=service_content.encode(),
            capture_output=True,
            check=True,
        )
        print('  Running systemctl daemon-reload...')
        subprocess.run(
            _sudo_cmd(['systemctl', 'daemon-reload']),
            check=True,
            capture_output=True,
        )
        print(f'  Enabling {HOST_AGENT_SERVICE}...')
        subprocess.run(
            _sudo_cmd(['systemctl', 'enable', f'{HOST_AGENT_SERVICE}.service']),
            check=True,
            capture_output=True,
        )
        print(f'  Starting {HOST_AGENT_SERVICE}...')
        restart_cmd = ['systemctl', 'restart', f'{HOST_AGENT_SERVICE}.service']
        if restart_no_block:
            restart_cmd.insert(1, '--no-block')
        subprocess.run(
            _sudo_cmd(restart_cmd),
            check=True,
            capture_output=True,
        )
        print(f'  {HOST_AGENT_SERVICE} is running.')
        return 0
    except subprocess.CalledProcessError as e:
        print(f'Failed to install host agent service: {e}', file=sys.stderr)
        return 1
    except FileNotFoundError:
        print(
            'Required command not found. Install the host agent service manually.',
            file=sys.stderr,
        )
        return 1


def _refresh_host_agent_after_update() -> int:
    """Refresh host agent with the sudoers-registered cyclo_manager command when possible."""
    if os.geteuid() == 0:
        return _ensure_host_agent(restart_no_block=True)
    if not sys.executable:
        print(
            'Python executable is unknown; falling back to setup.',
            file=sys.stderr,
        )
        return _ensure_host_agent() if sys.stdin.isatty() else 1

    refresh_command = [sys.executable, '-m', 'cyclo_manager_cli.cli', 'refresh-host-agent']
    print(f'Refreshing host agent with sudo command: {" ".join(refresh_command)}')
    pythonpath = os.pathsep.join(dict.fromkeys(path for path in sys.path if path))
    try:
        subprocess.run(['sudo', '-n', f'PYTHONPATH={pythonpath}', *refresh_command], check=True)
        return 0
    except subprocess.CalledProcessError as e:
        if sys.stdin.isatty():
            print(
                'Warning: sudo refresh command failed; falling back to interactive setup.',
                file=sys.stderr,
            )
            return _ensure_host_agent()
        print(f'Host-agent refresh command failed: {e}', file=sys.stderr)
        return e.returncode
    except FileNotFoundError:
        if sys.stdin.isatty():
            return _ensure_host_agent()
        print('sudo not found; cannot refresh host agent service.', file=sys.stderr)
        return 1


def cmd_refresh_host_agent(args: argparse.Namespace) -> int:
    """Refresh the host agent from sudoers after a package update."""
    if os.geteuid() != 0:
        print('cyclo_manager refresh-host-agent must run as root.', file=sys.stderr)
        return 1
    return _ensure_host_agent(restart_no_block=True)


def cmd_up(args: argparse.Namespace) -> int:
    """Start API + UI; create zenoh and noVNC containers without starting them."""
    print('--- cyclo_manager up ---')

    print('[1/3] Setting up host agent...')
    if _ensure_host_agent() != 0:
        print('Warning: Failed to install host agent service.', file=sys.stderr)

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
    env.setdefault('HOSTNAME', socket.gethostname())
    base = ['docker', 'compose', '-f', str(compose_path)]
    try:
        if args.pull:
            print('[2/3] Pulling latest images...')
            subprocess.run([*base, 'pull'], env=env, check=True)
        print(f'[2/3] Starting containers: {", ".join(COMPOSE_SERVICES_UP)}...')
        subprocess.run([*base, 'up', '-d', *COMPOSE_SERVICES_UP], env=env, check=True)
        print(f'[3/3] Creating (not starting): {", ".join(COMPOSE_SERVICES_CREATE_ONLY)}...')
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


def _teardown_host_agent() -> None:
    """Stop and remove the host agent service, unit file, sudoers, and socket dir."""
    print(f'Tearing down {HOST_AGENT_SERVICE}...')
    steps = [
        (
            _sudo_cmd(['systemctl', 'stop', f'{HOST_AGENT_SERVICE}.service']),
            'stop service',
        ),
        (
            _sudo_cmd(['systemctl', 'disable', f'{HOST_AGENT_SERVICE}.service']),
            'disable service',
        ),
        (
            _sudo_cmd(['rm', '-f', f'/etc/systemd/system/{HOST_AGENT_SERVICE}.service']),
            'remove unit file',
        ),
        (_sudo_cmd(['systemctl', 'daemon-reload']), 'daemon-reload'),
        (_sudo_cmd(['rm', '-f', '/etc/sudoers.d/cyclo_manager']), 'remove sudoers'),
        (_sudo_cmd(['rm', '-rf', HOST_AGENT_SOCKET_DIR]), 'remove socket dir'),
    ]
    for cmd, desc in steps:
        print(f'  {desc}...')
        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except subprocess.CalledProcessError:
            print(f'  Warning: failed to {desc}.', file=sys.stderr)


def cmd_down(args: argparse.Namespace) -> int:
    """Stop cyclo_manager server, cyclo_manager_ui, and zenoh daemon (docker compose down)."""
    print('--- cyclo_manager down ---')

    _teardown_host_agent()

    compose_path = _docker_dir() / 'docker-compose.yml'
    if not compose_path.is_file():
        print(f'Compose file not found: {compose_path}', file=sys.stderr)
        return 1
    env = os.environ.copy()
    env['CYCLO_MANAGER_CONFIG_FILE'] = str(_packaged_config_path())
    env.setdefault('HOSTNAME', socket.gethostname())
    cmd = [
        'docker',
        'compose',
        '-f',
        str(compose_path),
        'down',
    ]
    print('Stopping Docker containers (docker compose down)...')
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

    print('cyclo_manager is down.')
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    """Bring containers down, pip install -U, bring containers back up, restart host agent."""
    pip_exe = shutil.which('pip3') or shutil.which('pip')
    if not pip_exe:
        print('pip not found; cannot update package.', file=sys.stderr)
        return 1

    compose_path = _docker_dir() / 'docker-compose.yml'
    if not compose_path.is_file():
        print(f'Compose file not found: {compose_path}', file=sys.stderr)
        return 1
    env = os.environ.copy()
    env['CYCLO_MANAGER_CONFIG_FILE'] = str(_packaged_config_path())
    env.setdefault('HOSTNAME', socket.gethostname())
    base = ['docker', 'compose', '-f', str(compose_path)]

    print('Stopping containers...')
    try:
        subprocess.run([*base, 'down'], env=env, check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode
    except FileNotFoundError:
        print('Docker not found.', file=sys.stderr)
        return 1

    print(f'Updating {PYPI_PACKAGE} (pip install -U)...')
    try:
        subprocess.run([pip_exe, 'install', '-U', PYPI_PACKAGE], check=True, timeout=120)
    except subprocess.CalledProcessError as e:
        print(f'pip install -U {PYPI_PACKAGE} failed.', file=sys.stderr)
        return e.returncode
    except subprocess.TimeoutExpired:
        print('pip install timed out.', file=sys.stderr)
        return 1

    if not getattr(args, 'no_pull', False):
        print('Pulling latest images...')
        try:
            subprocess.run([*base, 'pull'], env=env, check=True)
        except subprocess.CalledProcessError as e:
            print(
                f'Warning: docker compose pull failed (exit {e.returncode}); '
                'continuing with cached images.',
                file=sys.stderr,
            )

    print('Starting containers...')
    try:
        subprocess.run([*base, 'up', '-d', *COMPOSE_SERVICES_UP], env=env, check=True)
        subprocess.run(
            [*base, 'create', '--no-recreate', *COMPOSE_SERVICES_CREATE_ONLY],
            env=env,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        return e.returncode

    print('Refreshing host agent (unit, socket, sudoers)...')
    if _refresh_host_agent_after_update() != 0:
        print('Warning: Failed to refresh host agent service.', file=sys.stderr)
        return 1

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
        help='Down containers, pip install -U cyclo-manager, pull images, then up again',
    )
    update_parser.add_argument(
        '--no-pull',
        action='store_true',
        help='Skip docker compose pull before starting containers (use cached images only)',
    )
    update_parser.set_defaults(func=cmd_update)

    refresh_parser = sub.add_parser(
        'refresh-host-agent',
        help='Refresh cyclo_host_agent service after package update',
    )
    refresh_parser.set_defaults(func=cmd_refresh_host_agent)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == '__main__':
    raise SystemExit(main())
