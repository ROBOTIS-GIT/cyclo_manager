"""CLI for pip-installed cyclo_manager_cli: cyclo_manager up, cyclo_manager down, cyclo_manager update. Launches cyclo_manager server and UI via Docker."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

PYPI_PACKAGE = "cyclo-manager"


def _docker_dir() -> Path:
    return Path(__file__).resolve().parent / "docker"


def _config_dir() -> Path:
    return Path(__file__).resolve().parent / "config"


def _packaged_config_path() -> Path:
    """Path to the bundled config (config/config.yml). Used by default for cyclo_manager up."""
    return _config_dir() / "config.yml"


def cmd_up(args: argparse.Namespace) -> int:
    """Run docker compose with packaged compose file (cyclo_manager server + UI containers)."""
    if args.config is None:
        config_path = _packaged_config_path()
    else:
        config_path = Path(args.config).expanduser().resolve()
        if not config_path.exists():
            config_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(_packaged_config_path(), config_path)
            print(f"Created default config at {config_path}", file=sys.stderr)
        if not config_path.is_file():
            print(f"Config file not found: {config_path}", file=sys.stderr)
            return 1
    compose_path = _docker_dir() / "docker-compose.yml"
    if not compose_path.is_file():
        print(f"Compose file not found: {compose_path}", file=sys.stderr)
        return 1
    env = os.environ.copy()
    env["CYCLO_MANAGER_CONFIG_FILE"] = str(config_path)
    env["ROS_DOMAIN_ID"] = str(args.ros_domain_id)
    cmd = [
        "docker",
        "compose",
        "-f",
        str(compose_path),
        "up",
        "-d",
    ]
    if args.pull:
        cmd.insert(-1, "--pull")
        cmd.insert(-1, "always")
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
    print("cyclo_manager server, cyclo_manager_ui, and zenoh daemon are up.")
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
    if getattr(args, "config", None) is not None:
        up_args.extend(["-c", str(args.config)])
    if getattr(args, "pull", False):
        up_args.append("--pull")
    if getattr(args, "ros_domain_id", None) is not None:
        up_args.extend(["-r", str(args.ros_domain_id)])
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

    up_parser = sub.add_parser(
        "up", help="Start cyclo_manager server, cyclo_manager_ui, and zenoh daemon (docker compose)"
    )
    up_parser.add_argument(
        "-c",
        "--config",
        metavar="PATH",
        help="Config file path (default: use bundled config from package)",
    )
    up_parser.add_argument(
        "-r",
        "--ros-domain-id",
        type=int,
        default=30,
        metavar="ID",
        help="ROS2 domain ID for cyclo_manager server (default: 30)",
    )
    up_parser.add_argument(
        "--pull",
        action="store_true",
        help="Always pull images before starting",
    )
    up_parser.set_defaults(func=cmd_up)

    down_parser = sub.add_parser(
        "down", help="Stop cyclo_manager server, cyclo_manager_ui, and zenoh daemon (docker compose down)"
    )
    down_parser.set_defaults(func=cmd_down)

    update_parser = sub.add_parser(
        "update",
        help="Down containers, pip install -U cyclo-manager, then up again",
    )
    update_parser.add_argument(
        "-c",
        "--config",
        metavar="PATH",
        help="Config file path for cyclo_manager up (default: use bundled config)",
    )
    update_parser.add_argument(
        "-r",
        "--ros-domain-id",
        type=int,
        default=30,
        metavar="ID",
        help="ROS2 domain ID for cyclo_manager up (default: 30)",
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
