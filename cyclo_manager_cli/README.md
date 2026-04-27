# cyclo_manager CLI

**PyPI package:** `cyclo-manager`  
**Console command:** `cyclo_manager` (underscore)

This package is a **thin launcher**: it runs **`docker compose`** against a **bundled** [`cyclo_manager_cli/docker/docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml) so you can start the **cyclo_manager API** and **web UI** without cloning the monorepo. Optional services (**Zenoh**, **noVNC**) are **created** but **not started** by default. It can also **`pip install -U`** itself and bring the stack back up.

Implementation: [`cyclo_manager_cli/cli.py`](cyclo_manager_cli/cli.py).

---

## Table of contents

- [cyclo\_manager CLI](#cyclo_manager-cli)
  - [Table of contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Commands](#commands)
  - [Compose: services and behavior](#compose-services-and-behavior)
  - [Config and environment](#config-and-environment)
  - [Bundled `config.yml`](#bundled-configyml)
  - [URLs (packaged stack)](#urls-packaged-stack)
  - [Dependencies](#dependencies)
  - [License](#license)

---

## Prerequisites

- **Docker** with **Compose v2** (`docker compose` — the legacy `docker-compose` binary alone is not enough)
- **Python 3.10+**
- For **`cyclo_manager update`:** **`pip`** or **`pip3`** on `PATH`
- On the **host:** agent sockets are expected under **`/var/run/robotis/agent_sockets`** and are mounted into the API container as **`/agents`** (see the bundled Compose file). Adjust only if you maintain a custom setup.

---

## Install

Install from **PyPI**:

```bash
pip install cyclo-manager
```

If `cyclo_manager` is not on `PATH`, add the user script directory, e.g.:

```bash
export PATH="$HOME/.local/bin:$PATH"
cyclo_manager up
```

If the entry point is still missing:

```bash
python3 -m cyclo_manager_cli.cli --help
python3 -m cyclo_manager_cli.cli up
```

---

## Commands

| Command | Behavior |
|--------|----------|
| `cyclo_manager up` | `docker compose up -d` for **`cyclo_manager`** and **`ui`**, then `docker compose create --no-recreate` for **`rmw_zenoh`** and **`novnc-server`** so those containers **exist** but stay **stopped**. Sets **`CYCLO_MANAGER_CONFIG_FILE`** to the **bundled** [`cyclo_manager_cli/config/config.yml`](cyclo_manager_cli/config/config.yml) (no CLI flag to use another file). |
| `cyclo_manager up --pull` | Runs `docker compose pull` first, then the same as `up`. |
| `cyclo_manager down` | `docker compose down` using the **packaged** compose file. Stops and removes **all** services defined in that file for this Compose project (not only API + UI). |
| `cyclo_manager update` | Runs `cyclo_manager down`, `pip install -U cyclo-manager`, then `cyclo_manager up`. Optional `--pull` is passed through to the final `up`. Requires **`cyclo_manager`** and **`pip`** on `PATH`. |
| `cyclo_manager --help` | Subcommand overview |

---

## Compose: services and behavior

| Compose service | Container name (typical) | `cyclo_manager up` |
|-----------------|-------------------------|--------------------|
| `cyclo_manager` | `cyclo_manager` | **Started** |
| `ui` | `cyclo_manager_ui` | **Started** |
| `rmw_zenoh` | `zenoh_daemon` | **Created only** (start e.g. from the Control UI or `docker start zenoh_daemon`) |
| `novnc-server` | `novnc-server` | **Created only** (start when needed, e.g. `docker start novnc-server`) |

The bundled stack uses **`network_mode: host`** (see the Compose file). Image names and tags (e.g. `robotis/cyclo-manager`, `robotis/cyclo-manager-ui`) are defined in [`cyclo_manager_cli/docker/docker-compose.yml`](cyclo_manager_cli/docker/docker-compose.yml).

---

## Config and environment

- **`CYCLO_MANAGER_CONFIG_FILE`**: set automatically by the CLI to the absolute path of the **bundled** [`cyclo_manager_cli/config/config.yml`](cyclo_manager_cli/config/config.yml) on the host, and consumed by Compose as the mount for `/app/config.yml` in the API container. `up` and `down` both set this.
- **`ROS_DOMAIN_ID`**: **not** set by the CLI. Set DDS domain in each container’s environment (e.g. `~/.bashrc` inside the image) so it matches your robots, then restart as needed.
- For a **custom** config file, different mounts, or local source builds, use the repository’s **`docker-compose.dev.yml`** at the [project root](../README.md#how-to-run) instead of the pip-bundled workflow.

---

## Bundled `config.yml`

Path: [`cyclo_manager_cli/config/config.yml`](cyclo_manager_cli/config/config.yml)

It only defines **which containers cyclo_manager knows about** and the **agent Unix socket path** (as seen from the API process, under `/agents` in the default Compose setup), for example:

- `ai_worker` → `/agents/ai_worker/s6_agent.sock`
- `physical_ai_server` → `/agents/physical_ai_server/s6_agent.sock`

**s6 service names** are **not** listed here; the agent in each container reports them at runtime.

---

## URLs (packaged stack)

With `network_mode: host` and the defaults in Compose:

| What | URL |
|------|-----|
| cyclo_manager API | http://127.0.0.1:8081 |
| OpenAPI (Swagger) | http://127.0.0.1:8081/docs |
| Web UI | http://127.0.0.1:3000 |

---

## Dependencies

The **`cyclo-manager`** package declares **no** Python runtime dependencies in [`pyproject.toml`](pyproject.toml). It invokes **`docker compose`** and, for **`update`**, **`pip`**.

---

## License

SPDX: **Apache-2.0** (see [pyproject.toml](pyproject.toml) and the repository [LICENSE](../LICENSE)).
