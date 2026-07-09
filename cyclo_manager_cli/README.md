# cyclo_manager CLI

**PyPI package:** `cyclo-manager`  
**Console commands:** `cyclo_manager` (underscore), `cyclo-manager` (hyphen)  
**Host agent:** `cyclo_host_agent` (installed by the package, run via systemd)

This package is the **pip-installable launcher** for the cyclo_manager stack on a robot host. It:

1. Runs **`docker compose`** against a **bundled** [`cyclo_manager_cli/docker/docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml) to start the **API** and **web UI** containers.
2. Installs and maintains **`cyclo_host_agent`** as a **systemd** service for host-level operations (git repo updates, `cyclo_manager` package update from the UI).
3. Can **`pip install -U`** itself and bring the Docker stack back up.

Implementation: [`cyclo_manager_cli/cli.py`](cyclo_manager_cli/cli.py), [`cyclo_host_agent/`](cyclo_host_agent/).

For the full monorepo (API source, UI source, dev compose), see the [repository root README](../README.md).

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Commands](#commands)
- [What `cyclo_manager up` does](#what-cyclo_manager-up-does)
- [Host agent (`cyclo_host_agent`)](#host-agent-cyclo_host_agent)
- [Compose services](#compose-services)
- [Configuration](#configuration)
- [Agent sockets on the host](#agent-sockets-on-the-host)
- [Environment variables](#environment-variables)
- [URLs (packaged stack)](#urls-packaged-stack)
- [Custom config and development](#custom-config-and-development)
- [Dependencies](#dependencies)
- [License](#license)

---

## Prerequisites

- **Docker** with **Compose v2** (`docker compose` — the legacy `docker-compose` binary alone is not enough)
- **Python 3.10+**
- **`sudo`** — required to install the host agent systemd unit, socket directory permissions, and sudoers rules
- For **`cyclo_manager update`:** **`pip`** or **`pip3`** on `PATH`
- **Do not run as root** — the host agent runs as the invoking user (or `SUDO_USER` when using `sudo cyclo_manager up`). Running as root is rejected.
- **Agent sockets** on the host under `/var/run/robotis/agent_sockets/` (robot containers and host agent). The bundled Compose file bind-mounts this tree into the API container as `/agents/`.

---

## Install

From **PyPI**:

```bash
pip install cyclo-manager
```

If `cyclo_manager` is not on `PATH`, add the user script directory:

```bash
export PATH="$HOME/.local/bin:$PATH"
cyclo_manager up
```

If the entry point is missing:

```bash
python3 -m cyclo_manager_cli.cli --help
python3 -m cyclo_manager_cli.cli up
```

---

## Commands

| Command | Behavior |
|--------|----------|
| `cyclo_manager up` | Install/refresh **cyclo_host_agent** (systemd unit, socket dir, sudoers), then `docker compose up -d` for **API + UI**, then `docker compose create --no-recreate` for **Zenoh** and **noVNC** (created but **not started**). Sets **`CYCLO_MANAGER_CONFIG_FILE`** to the bundled config. |
| `cyclo_manager up --pull` | `docker compose pull` first, then the same as `up`. |
| `cyclo_manager down` | **Tear down host agent** (stop/disable service, remove unit, sudoers, socket dir), then `docker compose down` for all services in the bundled compose file. |
| `cyclo_manager update` | `docker compose down` (containers only — **host agent stays installed**), `pip install -U cyclo-manager`, **`docker compose pull`**, then `docker compose up` + create optional services, then **refresh host agent** (unit, socket, sudoers). |
| `cyclo_manager update --no-pull` | Same as `update`, but skip image pull (use locally cached images). |
| `cyclo_manager --help` | Subcommand overview |

**`down` vs `update`:** `down` removes the host agent entirely. `update` only stops Docker containers, upgrades the pip package, restarts the stack, and refreshes the host agent — it does **not** call `cyclo_manager down`.

---

## What `cyclo_manager up` does

Three phases:

```text
[1/3] Setting up host agent     → systemd unit, socket ownership, sudoers
[2/3] Starting containers       → cyclo_manager (API) + ui
[3/3] Creating (not starting)   → zenoh_daemon + novnc-server
```

Open **http://127.0.0.1:3000** (UI) and **http://127.0.0.1:8081/docs** (API).

---

## Host agent (`cyclo_host_agent`)

The pip package installs a small **FastAPI** server that listens on a **Unix domain socket** on the host:

| Item | Path |
|------|------|
| Socket | `/var/run/robotis/agent_sockets/host/host_agent.sock` |
| systemd unit | `cyclo_host_agent.service` |
| sudoers | `/etc/sudoers.d/cyclo_manager` (`cp`, `udevadm` for container setup scripts) |

The API container reaches it at `/agents/host/host_agent.sock` (see bundled `config.yml`).

**Responsibilities:**

- List and update **`~/ROBOTIS-GIT/*`** git repositories (Version Management in the UI)
- Run **`cyclo_manager update`** when triggered from the UI (`POST /host/update`)

`cyclo_manager up` and `cyclo_manager update` both call `_ensure_host_agent()`, which is idempotent — safe to run after upgrades or user changes.

---

## Compose services

Defined in [`cyclo_manager_cli/docker/docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml). All services use **`network_mode: host`**.

| Compose service | Container name | `cyclo_manager up` | Image (example) |
|-----------------|----------------|--------------------|-----------------|
| `cyclo_manager` | `cyclo_manager` | **Started** | `robotis/cyclo-manager:0.3.0` |
| `ui` | `cyclo_manager_ui` | **Started** | `robotis/cyclo-manager-ui:0.3.0` |
| `rmw_zenoh` | `zenoh_daemon` | **Created only** | `robotis/zenoh-daemon:latest` |
| `novnc-server` | `novnc-server` | **Created only** | `robotis/novnc-server:latest` |

Start optional containers from the UI or manually, e.g. `docker start zenoh_daemon`.

---

## Configuration

The CLI always mounts the **bundled** config into the API container. There is **no** `-c` / `--config` flag on the pip CLI.

**Bundled path:** [`cyclo_manager_cli/config/config.yml`](cyclo_manager_cli/config/config.yml)

The API reads it as `CONFIG_FILE=/app/config.yml` inside the container.

### Schema

| Key | Description |
|-----|-------------|
| **`robot_container`** | Primary robot Docker container name (e.g. `ai_worker`). Used by the UI System page and service bringup. Must be a key in `sockets` and cannot be `host_agent`. |
| **`sockets`** | Map of logical name → agent **Unix socket path as seen inside the API container** (under `/agents/...`). Include robot/service containers and `host_agent`. |

s6 **service names** are not listed in config; each in-container agent reports them at runtime.

### Example (bundled default)

```yaml
robot_container: ai_worker

sockets:
  ai_worker: "/agents/ai_worker/s6_agent.sock"
  cyclo_intelligence: "/agents/cyclo_intelligence/s6_agent.sock"
  host_agent: "/agents/host/host_agent.sock"
```

### Validation (API startup)

- At least one socket entry besides `host_agent`
- `robot_container` must exist in `sockets`
- All socket paths must be non-empty strings

To use a different config layout, mounts, or local source builds, use the repository’s **`docker-compose.dev.yml`** — see [Custom config and development](#custom-config-and-development).

---

## Agent sockets on the host

On the host, sockets typically live under:

```text
/var/run/robotis/agent_sockets/
├── ai_worker/s6_agent.sock
├── cyclo_intelligence/s6_agent.sock
└── host/host_agent.sock          ← created by cyclo_manager up
```

The bundled compose file mounts the parent directory:

```yaml
- /var/run/robotis/agent_sockets:/agents
```

So `/agents/ai_worker/s6_agent.sock` in config corresponds to the host path above.

---

## Environment variables

| Variable | Set by | Purpose |
|----------|--------|---------|
| **`CYCLO_MANAGER_CONFIG_FILE`** | CLI (`up`, `down`, `update`) | Absolute path to bundled `config.yml` on the host; mounted into the API container |
| **`HOSTNAME`** | CLI (default: machine hostname) | Passed to API as `HOST_HOSTNAME` |
| **`CONFIG_FILE`** | Compose (`/app/config.yml`) | Path inside the API container |
| **`ROS_DOMAIN_ID`** | **Not** set by CLI | Set inside robot containers (e.g. `~/.bashrc`) so DDS matches your fleet |

---

## URLs (packaged stack)

With `network_mode: host` and default ports:

| What | URL |
|------|-----|
| Web UI | http://127.0.0.1:3000 |
| cyclo_manager API | http://127.0.0.1:8081 |
| OpenAPI (Swagger) | http://127.0.0.1:8081/docs |

---

## Custom config and development

The pip workflow is intended for **production robots** with pre-built images.

For development (local API/UI source, custom `config.yml`, hot reload):

```bash
# From repository root
docker compose -f docker-compose.dev.yml up
```

See the [root README](../README.md#development).

---

## Dependencies

Python dependencies declared in [`pyproject.toml`](pyproject.toml):

| Package | Used by |
|---------|---------|
| **fastapi** | `cyclo_host_agent` HTTP API |
| **uvicorn** | `cyclo_host_agent` server |
| **psutil** | Host agent / system utilities |

The **`cyclo_manager`** CLI itself uses only the Python standard library plus **`subprocess`** calls to **`docker compose`**, **`pip`**, **`systemctl`**, and **`sudo`**.

Runtime **outside** Python:

- **Docker** + **Compose v2**
- **systemd** (host agent service)
- Pre-built **Docker images** referenced in the bundled compose file

---

## License

SPDX: **Apache-2.0** (see [pyproject.toml](pyproject.toml) and the repository [LICENSE](../LICENSE)).
