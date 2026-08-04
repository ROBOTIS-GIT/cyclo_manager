# cyclo_manager

Management stack for ROS 2 robot deployments. cyclo_manager exposes a **FastAPI** control plane, a **Next.js** web UI, and a **pip-installable CLI** that orchestrates Docker containers on the robot host.

Each managed robot container runs an **s6-overlay agent** (Unix domain socket). cyclo_manager talks to those agents to list and control s6 services, while also using the Docker API for container lifecycle, terminals, and host-level operations via **cyclo_host_agent**.

---

## Components

| Component | Role |
|-----------|------|
| **cyclo_manager** (this repo, API image) | REST + WebSocket API on port **8081** |
| **cyclo_manager_ui** | Web UI on port **3000** |
| **cyclo-manager** (PyPI CLI) | `cyclo_manager up` / `down` / `update`; installs and refreshes the **cyclo_host_agent** systemd service |
| **cyclo_host_agent** | Host-side agent (UDS): ROBOTIS-GIT repo updates and `cyclo_manager` package updates |
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
- Installs **cyclo_host_agent** as a systemd service. On normal-user hosts, it runs as the invoking login user; on root-only devices, it runs as root.

Open **http://127.0.0.1:3000** (UI) and **http://127.0.0.1:8081/docs** (API).

CLI details: **[cyclo_manager_cli/README.md](cyclo_manager_cli/README.md)**

---

## Development

From the repository root:

```bash
docker compose -f docker-compose.dev.yml up
```

- Mounts `./config.yml` and local source for API/UI hot reload.
- Builds the API/UI from local source; Zenoh/noVNC use the compose definitions in this repository.
- Requires agent sockets on the host at `/var/run/robotis/agent_sockets/`.

---

## Configuration

The API reads **`CONFIG_FILE`** (default `config.yml`). The pip CLI sets **`CYCLO_MANAGER_CONFIG_FILE`** to its bundled config and mounts that file into the API container as `/app/config.yml`. The pip CLI has no `-c` / `--config` flag; use the dev compose file for custom local mounts.

### Schema

| Key | Description |
|-----|-------------|
| **`supported_robot_containers`** | Robot Docker container names that can open the System page (e.g. `ai_worker`, `open_manipulator`). Each must be a key in `sockets` (not `host_agent`). |
| **`sockets`** | Map of logical name → agent socket path **as seen inside the API container** (typically under `/agents/...`). Include robot/service containers and `host_agent`. |

s6 **service names** are not listed in config; each in-container agent reports them at runtime.

### Example

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

Bundled copy for pip installs: `cyclo_manager_cli/cyclo_manager_cli/config/config.yml`

---

## Web UI

| Page | Path | Notes |
|------|------|-------|
| Apps hub | `/app` | Links to Cyclo Manager (dashboard) and Cyclo Intelligence (port 7080) |
| Dashboard | `/dashboard` | Host stats, Docker containers/images, logs, bashrc, version management (host git repos + s6 agent compatibility) |
| System | `/{container}/system` | s6 bringup, launch args, URDF viewer, streaming service logs (download/clear), robot status |
| Jog | `/jog` | `/cmd_vel` teleop for supported robot models (SG2, SH5, F2, Mobile) |
| Topics | `/topics` | ROS 2 topic browser; live data via WebSocket |
| Terminal | `/terminal` | Multi-tab bash into running containers (`?container={name}` optional) |
| noVNC | `/novnc` | Remote display (when `novnc-server` is running) |

The VS Code–style sidebar is shown on all routes except `/app`. The **System** button uses `supported_robot_containers` from `GET /containers`: one entry opens that System page directly, and multiple entries ask the user to choose.

UI details: **[cyclo_manager_ui/README_UI.md](cyclo_manager_ui/README_UI.md)**

---

## API overview

Interactive docs: `http://<host>:8081/docs`

| Area | Method & path | Notes |
|------|----------------|-------|
| Root | `GET /` | API metadata |
| Config | `GET /containers` | Supported robot containers for the System page |
| | `GET /containers/agents/status` | Container s6 agent version compatibility |
| | `POST /containers/{container}/agent/update` | Checkout agent code to the manager version and restart the container |
| System | `GET /system/info`, `GET /system/status` | Hostname, internet, CPU/memory/disk |
| | `GET /system/serial-ports` | Serial device candidates from the host `/dev` tree |
| Services | `GET /{container}/services/{service}/status` | Single s6 service status |
| | `POST /{container}/services/{service}` | `up` / `down` / `restart`; optional `launch_args`, `robot_type` (AI Worker: SG2/BG2/SH5/BH5/F1/F2/Mobile) |
| | `GET /{container}/services/{service}/logs/download` | Download current s6 log file (ANSI stripped) |
| | `DELETE /{container}/services/{service}/logs` | Truncate s6 log file |
| Container | `GET`, `PUT /{container}/bashrc` | Via `docker exec` |
| Docker | `GET /docker/containers` | Optional `?all=true` |
| | `GET /docker/images` | List images with size, tags, and container usage |
| | `POST /docker/images/prune` | Remove dangling images |
| | `DELETE /docker/images/{image_id}` | Delete an unused image |
| | `POST /docker/{name}` | start / stop / restart |
| | `GET /docker/{name}/logs` | Engine logs; optional `?tail=100` |
| | `GET /docker/{name}/top` | Process list |
| | `DELETE /docker/{name}/processes/{pid}` | Signal process; optional `?signal=SIGTERM` |
| Terminal | `WebSocket /terminal/{name}/ws` | PTY bash; optional `session_id` query param |
| | `DELETE /terminal/{name}/{session_id}` | Kill session |
| ROS 2 | `GET /ros2/topics` | Run discovery; list topics with availability |
| | `GET /ros2/topics/{topic}` | Latest cached message (JSON); on-demand subscribe if needed |
| | `GET /ros2/topics/{topic}/available` | Cheap liveness check (no JSON conversion of payload) |
| | `GET /ros2/topics/{topic}/info` | `ros2 topic info -v` output |
| | `POST /ros2/topics/{topic}/subscribe` | Subscribe; optional `{"msg_type": "..."}` body |
| | `POST /ros2/topics/{topic}/unsubscribe` | Remove subscription |
| | `POST /ros2/cmd_vel` | Publish Twist (`linear_x`, `angular_z`; optional `topic`) |
| Host | `GET /host/repos`, `GET /host/repos/updates` | Managed host git repos |
| | `GET /host/repos/{name}/branch`, `GET /host/repos/{name}/status` | Branch check and local-change status |
| | `POST /host/repos/{name}/update` | git pull workflow |
| | `POST /host/repos/{name}/container/stop`, `.../start` | Stop/start related containers during update |
| | `POST /host/update` | Start one-click `cyclo_manager` package update through the host agent |
| | `GET /host/update/status` | Poll package update phase, output, and error |
| | `GET /host/version` | Running `cyclo_host_agent` package version |
| Version | `GET /version` | Installed vs PyPI `cyclo-manager`; optional `?check_latest=false` |
| WebSocket | `/ws/{container}/services/{service}/logs` | Live s6 logs (agent NDJSON stream → browser) |
| | `/ws/ros2/topics/{topic}` | Live topic data (see below) |

**Service logs:** Live logs are streamed over WebSocket (not polled). Opening a new browser session re-tails recent lines from the agent, then follows new output. Download returns the current `/var/log/{service}/current` file with ANSI codes removed.

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
