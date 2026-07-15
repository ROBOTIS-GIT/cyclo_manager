# cyclo_manager

Management stack for ROS 2 robot deployments. cyclo_manager exposes a **FastAPI** control plane, a **Next.js** web UI, and a **pip-installable CLI** that orchestrates Docker containers on the host.

Each managed robot container runs an **s6-overlay agent** (Unix domain socket). cyclo_manager talks to those agents to list and control s6 services, while also using the Docker API for container lifecycle, terminals, and host-level operations via **cyclo_host_agent**.

---

## Components

| Component | Role |
|-----------|------|
| **cyclo_manager** (this repo, API image) | REST + WebSocket API on port **8081** |
| **cyclo_manager_ui** | Web UI on port **3000** |
| **cyclo-manager** (PyPI CLI) | `cyclo_manager up` / `down` / `update`; installs **cyclo_host_agent** systemd service |
| **cyclo_host_agent** | Host-side agent (UDS): git repo updates, `cyclo_manager` package update |
| **In-container agent** (`cyclo_manager.agent`) | FastAPI + s6 client inside each robot container |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  cyclo_manager container (FastAPI :8081)                        │
│  REST / WebSocket ──► agent UDS    Docker SDK ──► docker.sock   │
│                    └──► host_agent UDS (repo / system update)   │
│                    └──► rclpy (ROS_DOMAIN_ID)                     │
└─────────────────────────────────────────────────────────────────┘
         │ UDS (/agents/...)              │
         ▼                                ▼
┌──────────────────┐              ┌──────────────────┐
│ Robot containers │              │ Host             │
│ (e.g. ai_worker) │              │ cyclo_host_agent │
│  s6_agent.sock   │              │  + git repos ~   │
└──────────────────┘              └──────────────────┘
```

Agent socket paths on the host live under `/var/run/robotis/agent_sockets/` and are bind-mounted into the API container as `/agents/`.

---

## Quick start (robot / production)

```bash
pip install cyclo-manager
cyclo_manager up
```

- Starts **cyclo_manager** and **UI** containers from pre-built images.
- Creates (but does not start) **Zenoh** and **noVNC** containers by default.
- Installs **cyclo_host_agent** as a systemd service (runs as the invoking user).

Open **http://127.0.0.1:3000** (UI) and **http://127.0.0.1:8081/docs** (API).

CLI details: **[cyclo_manager_cli/README.md](cyclo_manager_cli/README.md)**

---

## Development

From the repository root:

```bash
docker compose -f docker-compose.dev.yml up
```

- Mounts `./config.yml` and local source for API/UI hot reload.
- Requires agent sockets on the host at `/var/run/robotis/agent_sockets/`.

---

## Configuration

The API reads **`CONFIG_FILE`** (default `config.yml`). The pip CLI mounts the bundled config via **`CYCLO_MANAGER_CONFIG_FILE`** (no `-c` flag).

### Schema

| Key | Description |
|-----|-------------|
| **`robot_container`** | Primary robot Docker container name (e.g. `ai_worker`). Used by the UI for the System page and service bringup. Must be a key in `sockets` (not `host_agent`). |
| **`sockets`** | Map of logical name → agent socket path **as seen inside the API container** (typically under `/agents/...`). Include robot/service containers and `host_agent`. |

s6 **service names** are not listed in config; each in-container agent reports them at runtime.

### Example

```yaml
robot_container: ai_worker

sockets:
  ai_worker: "/agents/ai_worker/s6_agent.sock"
  cyclo_intelligence: "/agents/cyclo_intelligence/s6_agent.sock"
  host_agent: "/agents/host/host_agent.sock"
```

Validation rules (enforced at startup):

- At least one socket entry besides `host_agent`
- `robot_container` must exist in `sockets` and cannot be `host_agent`
- All socket paths must be non-empty strings

Bundled copy for pip installs: `cyclo_manager_cli/cyclo_manager_cli/config/config.yml`

---

## Web UI

| Page | Path | Notes |
|------|------|-------|
| Apps hub | `/app` | Links to Cyclo Manager (dashboard) and Cyclo Intelligence (port 7080) |
| Dashboard | `/dashboard` | Host stats, Docker containers, logs, bashrc, version management (host git repos) |
| System | `/{robot_container}/system` | s6 bringup, launch args, URDF viewer, service logs, robot status (bringup/battery/camera) |
| Topics | `/topics` | ROS 2 topic browser; live data via WebSocket |
| Terminal | `/terminal` | Multi-tab bash into running containers (`?container={name}` optional) |
| noVNC | `/novnc` | Remote display (when `novnc-server` is running) |

The VS Code–style sidebar is shown on all routes except `/app`. The **System** button navigates to `robot_container` from `GET /containers` when that container is running.

UI details: **[cyclo_manager_ui/README_UI.md](cyclo_manager_ui/README_UI.md)**

---

## API overview

Interactive docs: `http://<host>:8081/docs`

| Area | Method & path | Notes |
|------|----------------|-------|
| Root | `GET /` | API metadata |
| Config | `GET /containers` | Configured containers + `robot_container` |
| | `GET /containers/agents/status` | Container s6 agent version compatibility |
| | `POST /containers/{container}/agent/update` | Git pull agent code and restart the container |
| System | `GET /system/info`, `GET /system/status` | Hostname, internet, CPU/memory/disk |
| Services | `GET /{container}/services` | List s6 services |
| | `GET /{container}/services/status` | All statuses |
| | `POST /{container}/services/{service}` | `up` / `down` / `restart`; optional `launch_args`, `robot_type` |
| | `GET /{container}/services/{service}/logs/download`, `DELETE /{container}/services/{service}/logs` | s6 log files |
| | `GET`, `PUT /{container}/services/{service}/run` | s6 run script |
| Container | `GET`, `PUT /{container}/bashrc` | Via `docker exec` |
| Docker | `GET /docker/containers` | Optional `?all=true` |
| | `GET /docker/{name}/status` | |
| | `POST /docker/{name}` | start / stop / restart |
| | `GET /docker/{name}/logs` | Engine logs |
| | `GET /docker/{name}/top` | Process list |
| | `DELETE /docker/{name}/processes/{pid}` | Signal process |
| Terminal | `WebSocket /terminal/{name}/ws` | PTY bash; optional `session_id` query param |
| | `DELETE /terminal/{name}/{session_id}` | Kill session |
| ROS 2 | `GET /ros2/topics` | Run discovery; list topics with availability |
| | `GET /ros2/topics/{topic}` | Latest cached message (JSON); on-demand subscribe if needed |
| | `GET /ros2/topics/{topic}/available` | Cheap liveness check (no JSON conversion of payload) |
| | `GET /ros2/topics/{topic}/info` | `ros2 topic info -v` output |
| | `POST /ros2/topics/{topic}/subscribe` | Subscribe; optional `{"msg_type": "..."}` body |
| | `POST /ros2/topics/{topic}/unsubscribe` | Remove subscription |
| Host | `GET /host/repos/updates` | Managed `ROBOTIS-GIT/*` repos on host |
| | `POST /host/repos/{name}/update` | git pull workflow |
| | `POST /host/update` | `pip install -U cyclo-manager` + `docker compose pull` + stack restart |
| Version | `GET /version` | Installed vs PyPI `cyclo-manager` |
| WebSocket | `/ws/{container}/services/{service}/logs` | Live s6 logs |
| | `/ws/ros2/topics/{topic}` | Live topic data (see below) |

**ROS 2 WebSocket behavior:** On connect, the API resolves the topic message type (known types, discovery, or existing subscription), calls `add_topic_subscription` if needed, then polls the in-memory cache and pushes `{topic, msg_type, data, available}` when data changes (throttled). The Topics UI uses this path without a prior REST subscribe. Disconnecting the WebSocket does not unsubscribe; use `POST /ros2/topics/{topic}/unsubscribe` or page cleanup.

Docker routes return **503** if `docker.sock` is unavailable. ROS routes require a running **rclpy** node and matching **`ROS_DOMAIN_ID`**.

---

## Repository layout

```text
cyclo_manager/
├── cyclo_manager/           # FastAPI backend + in-container agent
├── cyclo_manager_ui/        # Next.js UI
├── cyclo_manager_cli/       # PyPI package (cyclo-manager)
├── config.yml               # Dev / example config
├── docker-compose.dev.yml
└── README.md
```

---

## Security

The API is **unauthenticated** by default and mounts **`docker.sock`** (high privilege). Restrict network access, tighten **CORS** in production, and treat `/docs`, WebSockets, and `/host/*` as sensitive when exposed.

---

## Contributing & license

- **[CONTRIBUTING.md](CONTRIBUTING.md)**
- **[LICENSE](LICENSE)** (Apache-2.0)
