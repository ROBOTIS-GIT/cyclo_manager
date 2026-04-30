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

"""CLI for pip-installed cyclo_manager_cli: cyclo_manager up, cyclo_manager down, cyclo_manager update. Launches cyclo_manager server and UI via Docker."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

PYPI_PACKAGE = "cyclo-manager"

# `cyclo_manager up` starts these immediately.
COMPOSE_SERVICES_UP = ("cyclo_manager", "ui")
# These get `docker compose create` only (stopped); start from UI or `docker start` when needed.
COMPOSE_SERVICES_CREATE_ONLY = ("rmw_zenoh", "novnc-server")


def _docker_dir() -> Path:
    return Path(__file__).resolve().parent / "docker"


def _config_dir() -> Path:
    return Path(__file__).resolve().parent / "config"


def _packaged_config_path() -> Path:
    """Path to the bundled config (config/config.yml). Used for cyclo_manager up/down."""
    return _config_dir() / "config.yml"


def cmd_up(args: argparse.Namespace) -> int:
    """Run docker compose: start API + UI; create zenoh + noVNC containers without starting them."""
    config_path = _packaged_config_path()
    if not config_path.is_file():
        print(f"Bundled config not found: {config_path}", file=sys.stderr)
        return 1
    compose_path = _docker_dir() / "docker-compose.yml"
    if not compose_path.is_file():
        print(f"Compose file not found: {compose_path}", file=sys.stderr)
        return 1
    env = os.environ.copy()
    env["CYCLO_MANAGER_CONFIG_FILE"] = str(config_path)
    base = ["docker", "compose", "-f", str(compose_path)]
    try:
        if args.pull:
            subprocess.run([*base, "pull"], env=env, check=True)
        subprocess.run([*base, "up", "-d", *COMPOSE_SERVICES_UP], env=env, check=True)
        subprocess.run(
            [*base, "create", "--no-recreate", *COMPOSE_SERVICES_CREATE_ONLY],
            env=env,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        return e.returncode
    except FileNotFoundError:
        print(
            "Docker not found. Install Docker and ensure 'docker compose' is available.",
            file=sys.stderr,
        )
        return 1
    print("cyclo_manager stack is up (API + UI running; zenoh_daemon + novnc-server created, not started).")
    return 0


def cmd_down(args: argparse.Namespace) -> int:
    """Stop cyclo_manager server, cyclo_manager_ui, and zenoh daemon (docker compose down)."""
    compose_path = _docker_dir() / "docker-compose.yml"
    if not compose_path.is_file():
        print(f"Compose file not found: {compose_path}", file=sys.stderr)
        return 1
    env = os.environ.copy()
    env["CYCLO_MANAGER_CONFIG_FILE"] = str(_packaged_config_path())
    cmd = [
        "docker",
        "compose",
        "-f",
        str(compose_path),
        "down",
    ]
    try:
        subprocess.run(cmd, env=env, check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode
    except FileNotFoundError:
        print(
            "Docker not found. Install Docker and ensure 'docker compose' is available.",
            file=sys.stderr,
        )
        return 1
    print("cyclo_manager server, cyclo_manager_ui, and zenoh daemon are down.")
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    """Down containers, pip install -U cyclo-manager, then up again."""
    cyclo_manager_exe = shutil.which("cyclo_manager")
    if not cyclo_manager_exe:
        print("cyclo_manager command not found in PATH.", file=sys.stderr)
        return 1
    pip_exe = shutil.which("pip3") or shutil.which("pip")
    if not pip_exe:
        print("pip not found; cannot update package.", file=sys.stderr)
        return 1

    print("Stopping containers (cyclo_manager down)...")
    try:
        subprocess.run([cyclo_manager_exe, "down"], check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode

    print(f"Updating {PYPI_PACKAGE} (pip install -U)...")
    try:
        subprocess.run(
            [pip_exe, "install", "-U", PYPI_PACKAGE],
            check=True,
            timeout=120,
        )
    except subprocess.CalledProcessError as e:
        print(f"pip install -U {PYPI_PACKAGE} failed.", file=sys.stderr)
        return e.returncode
    except subprocess.TimeoutExpired:
        print("pip install timed out.", file=sys.stderr)
        return 1

    print("Starting containers (cyclo_manager up)...")
    up_args = [cyclo_manager_exe, "up"]
    if getattr(args, "pull", False):
        up_args.append("--pull")
    try:
        subprocess.run(up_args, check=True)
    except subprocess.CalledProcessError as e:
        return e.returncode

    print("cyclo_manager update completed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="cyclo_manager",
        description="cyclo_manager CLI: launch cyclo_manager server and UI containers. Services run via Docker images.",
    )
    sub = parser.add_subparsers(dest="command", help="Commands")

    up_parser = sub.add_parser("up", help="Start cyclo_manager stack (docker compose)")
    up_parser.add_argument(
        "--pull",
        action="store_true",
        help="Pull all service images before create/up",
    )
    up_parser.set_defaults(func=cmd_up)

    down_parser = sub.add_parser("down", help="Stop all stack containers (docker compose down)")
    down_parser.set_defaults(func=cmd_down)

    update_parser = sub.add_parser(
        "update",
        help="Down containers, pip install -U cyclo-manager, then up again",
    )
    update_parser.add_argument(
        "--pull",
        action="store_true",
        help="Always pull images when running cyclo_manager up",
    )
    update_parser.set_defaults(func=cmd_update)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 0
    return args.func(args)
