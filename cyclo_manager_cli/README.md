# cyclo_manager CLI

**PyPI package:** `cyclo-manager`  
**Console commands:** `cyclo_manager` (underscore), `cyclo-manager` (hyphen)  
**Host agent:** `cyclo_host_agent` (installed by the package, run via systemd)

This package is the **pip-installable launcher** for the cyclo_manager stack on a robot host. It is intended for production robots that run the pre-built Docker images. It:

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
- [Recording storage](#recording-storage)
- [Configuration](#configuration)
- [Agent sockets on the host](#agent-sockets-on-the-host)
- [Environment variables](#environment-variables)
- [URLs (packaged stack)](#urls-packaged-stack)
- [Custom config and development](#custom-config-and-development)
- [Dependencies](#dependencies)
- [License](#license)

---

## Prerequisites

- **Docker** with **Compose v2** (`docker compose`; the legacy `docker-compose` binary alone is not enough)
- **Python 3.10+**
- **systemd**: required for the managed `cyclo_host_agent.service`
- **`sudo`** — required on normal-user hosts to install the host agent systemd unit, socket directory permissions, and sudoers rules
- For **`cyclo_manager update`:** **`pip`** or **`pip3`** on `PATH`
- **Root shell handling** — `cyclo_manager up` rejects direct root execution when a normal login user exists. On root-only devices, the host agent is installed as root.
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

The CLI also has an internal `refresh-host-agent` subcommand. It is used by the sudoers rule and should normally not be invoked by users directly.

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
| sudoers | `/etc/sudoers.d/cyclo_manager` (`cp`, `udevadm` for container setup scripts; `refresh-host-agent` CLI subcommand for package-update refresh; skipped on root-only devices) |

The API container reaches it at `/agents/host/host_agent.sock` (see bundled `config.yml`).

**Responsibilities:**

- List managed **ROBOTIS-GIT** git repositories in the configured workspace.
- Check update availability from remote tags and local `package.xml` versions.
- Update repos on allowed branches (`main`, `jazzy`) using stash or reset workflows.
- Stop/start a repo's `docker/container.sh` helper during an update when requested by the UI.
- Run Cyclo Manager package updates from the UI by delegating to `cyclo_manager update`.
- Provide host CPU/memory/disk statistics and process information. CPU summaries
  share a background sampler's average of the latest three one-second samples.
- Serve the Files UI's browsing, filename search, upload, text editing, Git diff
  and file/directory management operations under the configured workspace.

`cyclo_manager up` installs the `refresh-host-agent` CLI subcommand into sudoers. It is registered as `sys.executable -m cyclo_manager_cli.cli refresh-host-agent` with `SETENV`, so UI-triggered updates can pass the current `PYTHONPATH` to sudo and do not depend on `PATH`. The command is idempotent and refreshes the socket directory, sudoers file, systemd unit, and service state after package upgrades.

Repository scanning and the Files UI use `CYCLO_HOST_AGENT_WORKSPACE` when set. Otherwise they use the service user's home directory, except root-only devices with `/data/docker`, where `/data/docker` is used automatically. Only repositories whose `origin` remote belongs to `ROBOTIS-GIT` are returned by the repo list/update endpoints.

---

## Compose services

Defined in [`cyclo_manager_cli/docker/docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml). All services use **`network_mode: host`**.

| Compose service | Container name | `cyclo_manager up` | Image in this checkout |
|-----------------|----------------|--------------------|-----------------|
| `cyclo_manager` | `cyclo_manager` | **Started** | `robotis/cyclo-manager:1.1.0` |
| `ui` | `cyclo_manager_ui` | **Started** | `robotis/cyclo-manager-ui:1.1.0` |
| `rmw_zenoh` | `zenoh_daemon` | **Created only** | `robotis/zenoh-daemon:latest` |
| `novnc-server` | `novnc-server` | **Created only** | `robotis/novnc-server:latest` |

Start optional containers from the UI or manually, e.g. `docker start zenoh_daemon`.

---

## Recording storage

The packaged stack and dev compose both mount:

```yaml
- ${HOME}/cyclo_manager_ros_bags:/cyclo_manager_ros_bags
```

Compose resolves `${HOME}` on the host at invocation time. The API container uses
`RECORDINGS_DIR=/cyclo_manager_ros_bags`, which is also the server default when the
variable is absent. The host directory is independent of
`CYCLO_HOST_AGENT_WORKSPACE`; each recording stores its metadata and MCAP bag under
its generated ID. Container recreation, `down` and package updates preserve this
bind-mounted data. Applying a new mount requires container recreation.

Recording and playback run in the API container using `rosbag2_py` and the MCAP
storage plugin included in the manager image. They are not host-agent jobs.
See [Record & Play](../docs/record-play.md) for capture, repeat playback and stops.

---

## Configuration

The CLI always mounts the **bundled** config into the API container. There is **no** `-c` / `--config` flag on the pip CLI.

**Bundled path:** [`cyclo_manager_cli/config/config.yml`](cyclo_manager_cli/config/config.yml)

The API reads it as `CONFIG_FILE=/app/config.yml` inside the container.

### Schema

| Key | Description |
|-----|-------------|
| **`supported_robot_containers`** | Containers eligible for System navigation and server-side motion profile detection (e.g. `ai_worker`, `open_manipulator`). Each must be a key in `sockets` and cannot be `host_agent`. |
| **`sockets`** | Map of logical name → agent **Unix socket path as seen inside the API container** (under `/agents/...`). Include robot/service containers and `host_agent`. |

s6 **service names** are defined in the manager's System/motion profiles, not in
this config. Motion detection checks the existing individual status endpoints for
`ai_worker_bringup` and `open_manipulator_bringup`, then reads `/run/robot_type`
inside the selected container through Docker. This needs no new s6-agent endpoint.

### Example (bundled default)

```yaml
supported_robot_containers:
  - ai_worker
  - open_manipulator

sockets:
  ai_worker: "/agents/ai_worker/s6_agent.sock"
  open_manipulator: "/agents/open_manipulator/s6_agent.sock"
  cyclo_intelligence: "/agents/cyclo_intelligence/s6_agent.sock"
  host_agent: "/agents/host/host_agent.sock"
```

To use a different config layout, mounts, or local source builds, use the repository’s **`docker-compose.dev.yml`** — see [Custom config and development](#custom-config-and-development).

---

## Agent sockets on the host

On the host, sockets typically live under:

```text
/var/run/robotis/agent_sockets/
├── ai_worker/s6_agent.sock
├── open_manipulator/s6_agent.sock
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
| **`CYCLO_HOST_AGENT_WORKSPACE`** | User or CLI-generated systemd unit | Workspace scanned by `cyclo_host_agent` for managed git repositories and used as the Files UI/API root |
| **`HOSTNAME`** | CLI (default: machine hostname) | Passed to API as `HOST_HOSTNAME` |
| **`CONFIG_FILE`** | Compose (`/app/config.yml`) | Path inside the API container |
| **`HOME`** | Host environment used by Compose | Selects the host `${HOME}/cyclo_manager_ros_bags` bind-mount directory |
| **`RECORDINGS_DIR`** | Compose (`/cyclo_manager_ros_bags`) | Server-side recording directory inside the API container; same default without the variable |
| **`ROS_DOMAIN_ID`** | Manager image shell startup (`30`); not set by CLI | Must match the robot; the manager image configures it in `/root/.bashrc`, which the API startup sources |
| **`RMW_IMPLEMENTATION`** | Manager image shell startup (`rmw_zenoh_cpp`) | ROS middleware used by the manager; requires a reachable Zenoh router |
| **`NEXT_PUBLIC_API_URL`** | UI dev/build environment | Browser API address; production bundles embed it at build time, so a compose runtime value does not reconfigure a prebuilt UI |

---

## URLs (packaged stack)

With `network_mode: host` and default ports:

| What | URL |
|------|-----|
| Web UI | http://127.0.0.1:3000 |
| cyclo_manager API | http://127.0.0.1:8081 |
| OpenAPI (Swagger) | http://127.0.0.1:8081/docs |

These loopback URLs apply on the robot host. From another device, use the robot's
hostname/IP and a browser-reachable API URL. Both compose files contain a UI
runtime value of `http://127.0.0.1:8081`; it takes effect in development, while a
production bundle uses its build-time value or hostname fallback. See the
[UI API address guide](../cyclo_manager_ui/README_UI.md#api-address).

---

## Custom config and development

The pip workflow is intended for **production robots** with pre-built images.

For development (local API/UI source, custom `config.yml`, hot reload):

```bash
# From repository root
docker compose -f docker-compose.dev.yml up
```

The dev compose command starts all defined services and does not install the host
agent. API/UI source mounts do not update the Python code used by the separately
installed `cyclo_host_agent.service`; install the updated CLI package and refresh
that service when testing host-agent changes.

See the [root README](../README.md#development).

---

## Dependencies

Python dependencies declared in [`pyproject.toml`](pyproject.toml):

| Package | Used by |
|---------|---------|
| **fastapi** | `cyclo_host_agent` HTTP API |
| **uvicorn** | `cyclo_host_agent` server |
| **psutil** | Host CPU sampler, memory/disk statistics and process inspection |

The **`cyclo_manager`** CLI itself uses only the Python standard library plus **`subprocess`** calls to **`docker compose`**, **`pip`**, **`systemctl`**, and **`sudo`**.

Runtime **outside** Python:

- **Docker** + **Compose v2**
- **systemd** (host agent service)
- Pre-built **Docker images** referenced in the bundled compose file

---

## License

SPDX: **Apache-2.0** (see [pyproject.toml](pyproject.toml) and the repository [LICENSE](../LICENSE)).
