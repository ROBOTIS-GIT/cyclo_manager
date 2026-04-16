# cyclo_manager

Central **control plane** for ROS 2–based robot stacks. It talks to **s6-overlay agents** inside containers over **Unix domain sockets**, exposes a **FastAPI** REST API and **WebSockets**, and ships a **Next.js** web UI plus a **pip-installable CLI** that starts the Dockerized stack.

## What it does

- **Service control**: List s6 services, read status/logs, start/stop/restart; optional **launch arguments** and **`robot_type`** (e.g. `sg2`, `bg2`, `sh5`, `bh5` for `ai_worker_bringup`) forwarded to the in-container agent.
- **Docker**: List containers, status, start/stop, logs (requires **Docker socket** access from the API process).
- **ROS 2**: Per configured container, an **rclpy** subscriber node lists topics, matches publisher QoS (`ros2 topic info`), caches messages, and supports subscribe/unsubscribe used by the UI and WebSockets.
- **Live streams**: Service logs and ROS topic data over WebSockets.
- **Extras**: **`GET`/`PUT /{container}/bashrc`** (edit shell init inside a container via Docker), **version** check against PyPI and optional **update** flow for the CLI package.

Each **logical container** name in config maps to an **agent socket path** (as seen by cyclo_manager, often under `/agents/...` inside the API container).

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Host / cyclo_manager container (FastAPI, e.g. :8081)         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  REST + WebSocket                                     │  │
│  │  /containers  /{container}/services  /docker  /ros2   │  │
│  │  /{container}/bashrc  /version  /ws/...               │  │
│  └───────────────────────────────────────────────────────┘  │
│       │                    │                    │             │
│       │ httpx (UDS HTTP)   │ Docker SDK        │ rclpy       │
│       ▼                    ▼                    ▼             │
│  Agent sockets       docker.sock           ROS_DOMAIN_ID    │
└─────────────────────────────────────────────────────────────┘
        │                                   ▲
        │  volumes / network                │ same domain as robots
        ▼                                   │
┌──────────────────┐              ┌──────────────────┐
│ Robot container  │              │ ROS 2 graph      │
│ (e.g. ai_worker) │──────────────│ (topics, nodes)  │
│  s6_agent : UDS  │              └──────────────────┘
└──────────────────┘
```

The **in-container agent** (`cyclo_manager.agent`: FastAPI + `s6_client`) ships in the same repository; it is run **inside** each managed container and is **not** the same process as the host API.

## Repository layout

```text
cyclo_manager/
├── cyclo_manager/                 # Backend Python package (FastAPI)
│   ├── api.py                     # App entry, CORS, routers
│   ├── agent/                     # s6 agent (runs inside robot containers)
│   ├── routers/                   # root, containers, container, services,
│   │                              # docker, ros2, websocket, version
│   ├── agent_client.py            # Pool of HTTP clients → agent UDS
│   ├── docker_client.py
│   ├── ros2_node/                 # rclpy subscriber + message helpers
│   ├── config.py, models.py, state.py, lifespan.py
│   ├── Dockerfile, Dockerfile.dev
│   └── requirements.txt
├── cyclo_manager_ui/                # Next.js UI
├── cyclo_manager_cli/               # PyPI package `cyclo-manager` → `cyclo_manager` CLI
│   └── cyclo_manager_cli/docker/docker-compose.yml   # Images used by `cyclo_manager up`
├── config.yml                       # Example config (repo root; dev compose mount)
├── docker-compose.dev.yml           # Dev stack: local builds, hot reload
├── novnc/                           # Optional noVNC image build context (dev compose)
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Configuration

YAML is loaded from **`CONFIG_FILE`** inside the API process (default `config.yml` in the working directory). The **pip-installed** `cyclo_manager up` always mounts the **bundled** package config via **`CYCLO_MANAGER_CONFIG_FILE`** (no `-c` override). For a different file on the host, use **`docker-compose.dev.yml`** from the repo root.

Top-level keys:

- **`containers`**: map of **name** → **`socket_path`** (agent UDS as seen by the API).
- **`repo_version`** (optional, per container): GitHub release API + path to `package.xml` for **GET `/docker/{name}/version`** style checks.

Services inside a container are **not** listed in this file; they are reported by each **s6 agent**.

## How to run

### Packaged stack (PyPI CLI + prebuilt images)

```bash
pip install cyclo-manager
cyclo_manager up
```

Starts the API and UI via the bundled Compose file; creates Zenoh/noVNC containers without starting them by default. **`ROS_DOMAIN_ID`** is not passed by the CLI—set it per container (e.g. **`~/.bashrc`**) and restart. Commands and service names: **[cyclo_manager_cli/README.md](cyclo_manager_cli/README.md)**.

### From source (development)

From the **repository root**:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Mounts backend and UI source for reload, uses root **`config.yml`**, and expects agent sockets under **`/var/run/robotis/agent_sockets`** on the host (mapped to `/agents` in the API container). Adjust paths in `docker-compose.dev.yml` and `config.yml` to match your machine.

UI dev details: **cyclo_manager_ui** (e.g. `README_UI.md` / package README).

## API overview

Interactive docs: **`http://<host>:8081/docs`**, **`/redoc`**, **`/openapi.json`**.

| Area | Method & path | Notes |
|------|----------------|--------|
| Root | `GET /` | Metadata + doc links |
| Configured containers | `GET /containers` | From YAML (names + socket paths) |
| Per-container shell | `GET`, `PUT /{container}/bashrc` | Docker exec / archive |
| Services | `GET /{container}/services` | List |
| | `GET /{container}/services/status` | All statuses |
| | `GET /{container}/services/{service}/status` | One service |
| | `POST /{container}/services/{service}` | `up` / `down` / `restart`; body: `launch_args`, `robot_type` (for `ai_worker_bringup`) |
| | `GET`, `DELETE /{container}/services/{service}/logs` | Read / clear logs |
| | `GET`, `PUT /{container}/services/{service}/run` | s6 run script |
| Docker | `GET /docker/containers` | Optional `?all=true` |
| | `GET /docker/{name}/status` | |
| | `POST /docker/{name}` | Start/stop/restart |
| | `GET /docker/{name}/logs` | |
| | `GET /docker/{name}/version` | Repo vs GitHub release (if configured) |
| ROS 2 | `GET /{container}/ros2/topics` | Discovery |
| | `GET /{container}/ros2/topics/{topic}/info` | |
| | `GET /{container}/ros2/topics/{topic}` | Cached payload |
| | `POST .../subscribe`, `POST .../unsubscribe` | |
| Version | `GET /version` | Current vs PyPI `cyclo-manager` |
| | `POST /version/update` | `pip install -U` + CLI down/up (host must have `pip` / `cyclo_manager`; limited usefulness inside a minimal API container) |
| WebSocket | `/ws/{container}/services/{service}/logs` | Log stream |
| | `/ws/{container}/ros2/topics/{topic}` | Topic stream (`topic` may contain slashes) |

If the Docker socket is unavailable, Docker routes typically return **503**. ROS routes require a healthy **rclpy** node for that container (same **`ROS_DOMAIN_ID`** as your robots).

## Security note

The API is **not authenticated** by default and, with **`docker.sock`** mounted, is highly privileged. Restrict network access (firewall/VPN), tighten **CORS** for production, and treat **`/docs`** and **`POST /version/update`** as sensitive if exposed.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## License

See **[LICENSE](LICENSE)**.
