# cyclo_manager CLI

cyclo_manager CLI is a pip-installable launcher for the cyclo_manager stack. It starts the cyclo_manager server, web UI, Zenoh daemon, and noVNC server as Docker containers using a single command.

## Prerequisites

- **Docker** with **Docker Compose** (v2)
- Python 3.10+

## Installation

From the `cyclo_manager_cli` directory:

```bash
pip install .
```

Or install from a wheel:

```bash
python -m build --wheel
pip install dist/cyclo_manager-*.whl
```

If the `cyclo_manager` command is not found, add the pip scripts directory to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To make it permanent (e.g. on Linux):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

Alternatively, run via Python module:

```bash
python3 -m cyclo_manager_cli.cli up
```

## Commands

| Command | Description |
|--------|-------------|
| `cyclo_manager up` | Start API + web UI; create Zenoh + noVNC containers **without** starting them (start later from UI or `docker start`) |
| `cyclo_manager up -c /path/to/config.yml` | Start with a custom config file (creates a copy from the bundled config if the path does not exist) |
| `cyclo_manager up -r 35` | Set ROS2 domain ID (default: 30) |
| `cyclo_manager up --pull` | Pull images before starting |
| `cyclo_manager down` | Stop all cyclo_manager stack containers |
| `cyclo_manager --help` | Show help |

## What runs

Running `cyclo_manager up` (from the packaged `docker-compose.yml`):

- **Started immediately:** **cyclo_manager** (FastAPI API), **cyclo_manager_ui** (Next.js)
- **Created but not started:** **rmw_zenoh** (`zenoh_daemon`), **novnc-server** — images are pulled (with `--pull`), containers exist so you can start them from the Control UI or `docker start zenoh_daemon` / `docker start novnc-server` when needed.

The CLI passes the config path via `CYCLO_MANAGER_CONFIG_FILE` and optionally `ROS_DOMAIN_ID` (e.g. `cyclo_manager up -r 35`).

## Config

By default, `cyclo_manager up` uses the bundled config at `cyclo_manager_cli/cyclo_manager_cli/config/config.yml`. It defines:

- **containers** – Container names and agent socket paths (e.g. `ai_worker`, `physical_ai_server`)

Use `-c /path/to/config.yml` to supply your own file. If the file does not exist, the CLI copies the bundled config to that path and then uses it.

## Access

After `cyclo_manager up`:

- **API**: http://127.0.0.1:8081  
  - Docs: http://127.0.0.1:8081/docs  
- **UI**: http://127.0.0.1:3000

## Running from the repository

To run cyclo_manager from the repo root (e.g. for development) without the CLI:

```bash
# From repository root
docker compose -f docker-compose.dev.yml up -d
```

This uses the root `config.yml` and mounts agent sockets from `/var/run/robotis/agent_sockets`. See the main [README](../README.md) for architecture and API details.
