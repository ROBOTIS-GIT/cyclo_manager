# cyclo_manager

**cyclo_manager** provides **management tools** for ROS 2–based robot stacks. It talks to **s6-overlay agents** in containers over **Unix domain sockets (UDS)**, serves a **FastAPI** REST API and **WebSockets**, and provides a **Next.js** web UI and a **pip-installable CLI** to bring up a Dockerized stack.

---

## Table of contents

- [cyclo\_manager](#cyclo_manager)
  - [Table of contents](#table-of-contents)
  - [Features](#features)
  - [Architecture](#architecture)
  - [Repository layout](#repository-layout)
  - [Configuration](#configuration)
  - [How to run](#how-to-run)
    - [Packaged stack (PyPI + prebuilt images)](#packaged-stack-pypi--prebuilt-images)
  - [API overview](#api-overview)
  - [Security](#security)
  - [Contributing \& license](#contributing--license)

---

## Features

- **s6 services (per configured container)**: List services, read status, start/stop/restart. Optional **launch arguments** and **`robot_type`** (e.g. `sg2`, `bg2`, `sh5`, `bh5` for `ai_worker_bringup`) are passed through to the in-container agent. Service logs (when enabled) are read from **`/var/log/<service_name>/current`** inside the container (s6 log layout); see the agent’s [`logs` router](cyclo_manager/agent/routers/logs.py).
- **Docker** (from the API host): List containers, status, start/stop/restart, and container logs. Requires **Docker socket** access for the API process.
- **ROS 2**: For each configured container, an **rclpy** node discovers topics, aligns with publisher QoS (via `ros2 topic info` where used), caches messages, and supports subscribe/unsubscribe for the UI and WebSockets.
- **Live data**: Service logs and ROS topic payloads over **WebSockets**.
- **Other**: **`GET` / `PUT` `/{container}/bashrc`** to read/update shell init in a container via Docker; **version** checks against PyPI and an optional **update** path for the CLI package; optional **metapackage vs GitHub** version check for `ai_worker` when configured.

Each **logical container** name in YAML maps to an **agent socket path** as seen by cyclo_manager (often under `/agents/...` in the API container).

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  Host / cyclo_manager container (FastAPI, e.g. :8081)        │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  REST + WebSocket                                        ││
│  │  /containers  /{container}/services  /docker  /ros2      ││
│  │  /{container}/bashrc  /version  /ws/...                  ││
│  └──────────────────────────────────────────────────────────┘│
│       │                   │                    │             │
│       │ httpx (UDS HTTP)  │ Docker SDK         │ rclpy       │
│       ▼                    ▼                    ▼            │
│  Agent sockets       docker.sock           ROS_DOMAIN_ID     │
└──────────────────────────────────────────────────────────────┘
        │                                  ▲
        │  UDS (agent socket, bind mount)  │ same domain as robots
        ▼                                  │
┌──────────────────┐            ┌──────────────────┐
│ Robot container  │            │ ROS 2 graph      │
│ (e.g. ai_worker) │────────────│ (topics, nodes)  │
│  s6_agent : UDS  │            └──────────────────┘
└──────────────────┘
```

The **in-container agent** (`cyclo_manager.agent`: FastAPI + s6 client) lives in this repo and runs **inside** each managed container. It is **not** the same process as the host API.

---

## Repository layout

```text
cyclo_manager/
├── cyclo_manager/              # Backend Python package (FastAPI)
│   ├── api.py                  # App entry, CORS, routers
│   ├── agent/                  # s6 agent (runs inside robot containers)
│   ├── routers/                # root, containers, container, services,
│   │                           # docker, ros2, websocket, version
│   ├── agent_client.py         # HTTP client pool → agent UDS
│   ├── docker_client.py
│   ├── ros2_node/              # rclpy subscriber + message helpers
│   ├── config.py, models.py, state.py, lifespan.py
│   ├── Dockerfile, Dockerfile.dev
│   └── requirements.txt
├── cyclo_manager_ui/           # Next.js UI (see cyclo_manager_ui/README*.md)
├── cyclo_manager_cli/          # PyPI package `cyclo-manager` → `cyclo_manager` CLI
│   └── cyclo_manager_cli/docker/docker-compose.yml   # used by `cyclo_manager up`
├── config.yml                  # Example config (repo root; dev compose mount)
├── docker-compose.dev.yml      # Dev: local builds, hot reload
├── novnc/                      # Optional noVNC image (dev compose)
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Configuration

The API loads YAML from **`CONFIG_FILE`** (default `config.yml` in the working directory) unless overridden. The **pip-installed** `cyclo_manager up` command mounts the **bundled** config using **`CYCLO_MANAGER_CONFIG_FILE`** (no separate `-c` override). To use a custom file on the host in development, prefer **`docker-compose.dev.yml`** at the repo root and adjust volume/env there.

**Top-level keys**

- **`containers`**: Map of **name** → **`socket_path`** (agent UDS as seen by the API).
- **`repo_version`** (optional, per target container such as `ai_worker`): GitHub Releases API + path to `package.xml` for **`GET /docker/{name}/version`**.

s6 service names are **not** listed in this file; they come from each agent at runtime.

---

## How to run

### Packaged stack (PyPI + prebuilt images)

```bash
pip install cyclo-manager
cyclo_manager up
```

This starts the API and UI using the bundled Compose file; related images (e.g. Zenoh / noVNC) may be created but not always started by default. **`ROS_DOMAIN_ID`** is not set by the CLI—configure it in the environment (e.g. **`~/.bashrc`**) and restart as needed. CLI commands and details: **[cyclo_manager_cli/README.md](cyclo_manager_cli/README.md)**.


## API overview

Interactive docs: **`http://<host>:8081/docs`**, **`/redoc`**, **`/openapi.json`**.

| Area | Method & path | Notes |
|------|----------------|--------|
| Root | `GET /` | Metadata and doc links |
| Containers (config) | `GET /containers` | Configured names + socket paths |
| Per-container | `GET`, `PUT /{container}/bashrc` | Read/update via Docker |
| Services | `GET /{container}/services` | List |
| | `GET /{container}/services/status` | All statuses |
| | `GET /{container}/services/{service}/status` | One service |
| | `POST /{container}/services/{service}` | `up` / `down` / `restart`; body: `launch_args`, `robot_type` (for `ai_worker_bringup`) |
| | `GET`, `DELETE /{container}/services/{service}/logs` | Read / clear s6 service logs |
| | `GET`, `PUT /{container}/services/{service}/run` | Read / update s6 run script |
| Docker | `GET /docker/containers` | Optional `?all=true` |
| | `GET /docker/{name}/status` | |
| | `POST /docker/{name}` | Start/stop/restart |
| | `GET /docker/{name}/logs` | Docker engine logs (not s6 file logs) |
| | `GET /docker/{name}/version` | Repo vs GitHub (if `repo_version` configured; `ai_worker` only) |
| ROS 2 | `GET /{container}/ros2/topics` | Discovery |
| | `GET /{container}/ros2/topics/{topic}/info` | |
| | `GET /{container}/ros2/topics/{topic}` | Cached payload |
| | `POST .../subscribe`, `POST .../unsubscribe` | |
| Version | `GET /version` | Installed vs PyPI `cyclo-manager` |
| | `POST /version/update` | `pip install -U` + `cyclo_manager` CLI up/down; limited in minimal API images |
| WebSocket | `/ws/{container}/services/{service}/logs` | Log stream |
| | `/ws/{container}/ros2/topics/{topic}` | Topic stream (`topic` may include `/` path segments) |

If the Docker socket is missing or unusable, Docker routes usually return **503**. ROS routes need a working **rclpy** node for that container and a matching **`ROS_DOMAIN_ID`** with your robots.

---

## Security

The API is **unauthenticated** by default. With **`docker.sock`**, it is **highly privileged**. Restrict access (firewall / VPN), tighten **CORS** in production, and treat **`/docs`**, unauthenticated WebSockets, and **`POST /version/update`** as sensitive if exposed.

---

## Contributing & license

- **Contributing**: **[CONTRIBUTING.md](CONTRIBUTING.md)**
- **License**: **[LICENSE](LICENSE)**
