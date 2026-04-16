# cyclo_manager CLI

`cyclo-manager` is a small **pip-installable CLI** that brings up the cyclo_manager stack using **Docker Compose v2**. It runs the packaged [`docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml): starts the API and web UI, **creates** (but does not start) optional Zenoh and noVNC containers, and can **self-update** via PyPI.

The console script name is **`cyclo_manager`** (underscore).

## Prerequisites

- **Docker** with **Compose v2** (`docker compose`, not only legacy `docker-compose`)
- **Python 3.10+**
- For **`cyclo_manager update`**: **`pip`** / **`pip3`** on `PATH`

## Installation

Build and install a wheel (package name on PyPI / `pyproject.toml` is **`cyclo-manager`**):

```bash
python -m build --wheel
pip install dist/cyclo_manager-*.whl
```

If `cyclo_manager` is not found, add the user scripts directory to `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

After install, use the CLI by name:

```bash
cyclo_manager --help
cyclo_manager up
```

(If the script is still missing from `PATH`, you can run the same subcommands via `python3 -m cyclo_manager_cli.cli`, e.g. `python3 -m cyclo_manager_cli.cli up`.)

## Commands

| Command | What it does |
|--------|----------------|
| `cyclo_manager up` | `docker compose up -d` for **`cyclo_manager`** and **`ui`**; then `docker compose create --no-recreate` for **`rmw_zenoh`** and **`novnc-server`** so those containers exist but stay **stopped**. Always mounts the **bundled** [`config/config.yml`](config/config.yml) (no custom `-c` path). |
| `cyclo_manager up --pull` | Runs `docker compose pull` before up/create |
| `cyclo_manager down` | `docker compose down` for the **packaged** compose file (stops/removes containers for that project) |
| `cyclo_manager update` | Runs `cyclo_manager down`, then `pip install -U cyclo-manager`, then `cyclo_manager up` again (optional `--pull` is forwarded to `up`) |
| `cyclo_manager --help` | Top-level help |

Implementation reference: [`cyclo_manager_cli/cli.py`](cyclo_manager_cli/cli.py).

### Compose services vs container names

| Compose service | Typical container name | `up` behavior |
|-----------------|------------------------|---------------|
| `cyclo_manager` | `cyclo_manager` | Started |
| `ui` | `cyclo_manager_ui` | Started |
| `rmw_zenoh` | `zenoh_daemon` | **Created only** (start from Control UI or `docker start zenoh_daemon`) |
| `novnc-server` | `novnc-server` | **Created only** (start when needed, e.g. `docker start novnc-server`) |

### Environment passed into Compose

- **`CYCLO_MANAGER_CONFIG_FILE`**: absolute path to the **bundled** YAML on the host ([`config/config.yml`](config/config.yml)). `up` and `down` both set this when invoking Compose.

**`ROS_DOMAIN_ID`** is **not** set by the CLI. Use each container’s **`~/.bashrc`** (or image defaults) and restart containers so DDS matches your robots. For a custom config mount or host dev workflow, use the repository **`docker-compose.dev.yml`** instead of the pip CLI.

## Bundled config

Default file: [`cyclo_manager_cli/config/config.yml`](cyclo_manager_cli/config/config.yml).

It lists **managed containers** and **agent Unix socket paths** (host paths mounted under `/agents` in the API container), for example:

- `ai_worker` → `/agents/ai_worker/s6_agent.sock`
- `physical_ai_server` → `/agents/physical_ai_server/s6_agent.sock`

Service names inside each container come from the agent, not from this file.

## URLs (packaged compose, `network_mode: host`)

After `cyclo_manager up`:

| Service | URL |
|---------|-----|
| cyclo_manager API | http://127.0.0.1:8081 |
| OpenAPI docs | http://127.0.0.1:8081/docs |
| Web UI | http://127.0.0.1:3000 |

Images and tags are defined in [`docker/docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml) (e.g. `robotis/cyclo-manager`, `robotis/cyclo-manager-ui`).

## Development from the repository root

To run against **local** images and mounts (not the pip-bundled compose), use the root compose and config — see the main [project README](../README.md) and `docker-compose.dev.yml`.

## Dependencies

The CLI package itself declares **no** Python dependencies (`pyproject.toml`); it shells out to **`docker compose`** and optionally **`pip`**.
