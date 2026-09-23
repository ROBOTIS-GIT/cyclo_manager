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
| **cyclo_host_agent** | Host-side agent (UDS): system/CPU statistics, files, ROBOTIS-GIT repo updates and `cyclo_manager` package updates |
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

On the robot host, open **http://127.0.0.1:3000** (UI) and **http://127.0.0.1:8081/docs** (API).
From another device, use the robot's hostname or IP. The browser must also be able
to reach the API; see [UI API address configuration](cyclo_manager_ui/README_UI.md#api-address).

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
- Unlike the pip launcher, this command starts all services in the dev compose file.
- The dev UI currently sets `NEXT_PUBLIC_API_URL=http://127.0.0.1:8081`.
  For access from another device, override it as described in the
  [UI guide](cyclo_manager_ui/README_UI.md#api-address).

The dev compose file does not install or reload the host agent. Host statistics,
file operations and repo updates use the separately installed `cyclo_host_agent`
service. Backend/UI hot reload does not update that service's Python installation.

---

## Configuration

The API reads **`CONFIG_FILE`** (default `config.yml`). The pip CLI sets **`CYCLO_MANAGER_CONFIG_FILE`** to its bundled config and mounts that file into the API container as `/app/config.yml`. The pip CLI has no `-c` / `--config` flag; use the dev compose file for custom local mounts.

### Schema

| Key | Description |
|-----|-------------|
| **`supported_robot_containers`** | Containers eligible for System/Jog selection and Jog profile detection (e.g. `ai_worker`, `open_manipulator`). Each must be a key in `sockets` (not `host_agent`). |
| **`sockets`** | Map of logical name → agent socket path **as seen inside the API container** (typically under `/agents/...`). Include robot/service containers and `host_agent`. |

s6 **service names** are not listed in config. System profiles define the service
names used by the UI; the Jog status GET checks the existing agent status endpoints
for `ai_worker_bringup` and `open_manipulator_bringup`.

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

### ROS and recording storage

The manager Dockerfiles configure `ROS_DOMAIN_ID=30` and
`RMW_IMPLEMENTATION=rmw_zenoh_cpp` in the shell startup file used by the API.
The manager and robot must use compatible ROS settings and a reachable Zenoh router.

Both compose files persist recordings with
`${HOME}/cyclo_manager_ros_bags:/cyclo_manager_ros_bags` and set
`RECORDINGS_DIR=/cyclo_manager_ros_bags`. `HOME` is resolved on the host when Compose
runs. Without `RECORDINGS_DIR`, the server also defaults to `/cyclo_manager_ros_bags`.
Container recreation preserves bags in the mounted host directory. See
[Record & Play storage](docs/record-play.md#storage-and-deployment) for the file layout
and required ROS bag packages.

---

## Web UI

| Page | Path | Notes |
|------|------|-------|
| Apps hub | `/app` | Links to Cyclo Manager (dashboard) and Cyclo Intelligence (port 7080) |
| Dashboard | `/dashboard` | Host stats, Docker containers/images, logs, bashrc, version management (host git repos + s6 agent compatibility) |
| System | `/{container}/system` | s6 bringup, launch args, URDF viewer, streaming service logs (download/clear), robot status |
| Jog | `/{container}/jog` | Selected container's profile + dynamic URDF/controller feedback; `/jog` opens container selection |
| Record & Play | `/record-play` | Record trajectory topics to rosbag2/MCAP; playback with start-pose transition, speed selection and repeat returns |
| Topics | `/topics` | ROS 2 topic browser; live data via WebSocket |
| Terminal | `/terminal` | Multi-tab bash into running containers (`?container={name}` optional) |
| Files | `/files` | Host file browser, search, uploads, text editing and diff (scoped to host agent file root; see Security) |
| noVNC | `/novnc` | Remote display (when `novnc-server` is running) |

The desktop sidebar and mobile menu share a flat navigation list on all routes
except `/app`. The **System** and **Jog** buttons use `GET /containers?running=true`
to get configured, running robot containers in one lightweight request: one match opens directly,
multiple matches offer a choice, and no match reports that no robot container is
running. Jog keeps the selected container in its URL and queries only its bringup
status on demand. Record & Play opens directly and uses ROS feedback and controller
routes independently of bringup status.

Dashboard system statistics and the CPU process list refresh every second. Their
CPU summaries use the same host-agent average of the latest three one-second
samples; individual process rows use a separate 0.2-second measurement window.

[Jog](docs/jog.md) covers controls, command routing and stop behavior.
[Record & Play](docs/record-play.md) covers capture, playback, repetition and storage.
Recording and playback continue after leaving that page; leaving Jog stops its
session. Stop leader publishing before Jog or playback: the manager coordinates
its own motion sessions, but does not arbitrate with external publishers.

UI details: **[cyclo_manager_ui/README_UI.md](cyclo_manager_ui/README_UI.md)**

---

## API overview

Interactive docs: `http://<host>:8081/docs`

| Area | Method & path | Notes |
|------|----------------|-------|
| Root | `GET /` | API metadata |
| Config | `GET /containers` | Supported robot containers; `?running=true` returns only running candidates for System/Jog without image inspection |
| | `GET /containers/agents/status` | Container s6 agent version compatibility |
| | `POST /containers/{container}/agent/update` | Checkout agent code to the manager version and restart the container |
| System | `GET /system/info`, `GET /system/status`, `GET /system/processes` | Hostname, internet, CPU/memory/disk, top processes |
| | `GET /system/serial-ports` | Serial device candidates from the host `/dev` tree |
| Services | `GET /{container}/services/{service}/status` | Single s6 service status |
| | `POST /{container}/services/{service}` | `up` / `down` / `restart`; optional `launch_args`, `robot_type` (AI Worker: SG2/BG2/SH5/BH5/F1/F2/Mobile; Open Manipulator: OMY/OMX) |
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
| | `GET /ros2/topics/{topic}` | Latest cached message (JSON); read-only |
| | `GET /ros2/topics/{topic}/available` | Cheap liveness check (no JSON conversion of payload) |
| | `GET /ros2/topics/{topic}/info` | `ros2 topic info -v` output |
| | `GET /ros2/robot-description` | One-shot URDF; optional `topic` (default `/robot_description`); transient-local subscription released after receipt or 5 s timeout |
| | `POST /ros2/cmd_vel` | Publish Twist (`linear_x`, `linear_y`, `angular_z`; optional `topic`); separate from the Jog session API |
| Jog | `GET /{container}/bringup_status` | Selected container's bringup/profile status; Jog pages poll every 2 s, requests for the same container share a 1 s cache |
| Record & Play | `GET /record-play` | Shared job state, discovered trajectory groups, saved recordings, controller feedback availability and storage path |
| | `GET /record-play/status` | Read-only job status |
| | `POST /record-play/record` | Start recording selected topics; bringup and active publishers are not required |
| | `POST /record-play/play` | Validate ROS feedback, controller routes and bag, move to start pose, then play at 1× or 0.5×; `repeats` is total passes, 0 for infinite |
| | `POST /record-play/stop` | Stop/save the active job; optional owner-scoped request |
| Host | `GET /host/repos`, `GET /host/repos/updates` | Managed host git repos |
| | `GET /host/repos/{name}/branch`, `GET /host/repos/{name}/status` | Branch check and local-change status |
| | `POST /host/repos/{name}/update` | git pull workflow |
| | `POST /host/repos/{name}/container/stop`, `.../start` | Stop/start related containers during update |
| | `GET /host/repos/{name}/container/start/status` | Poll container helper startup progress |
| | `POST /host/update` | Start one-click `cyclo_manager` package update through the host agent |
| | `GET /host/update/status` | Poll package update phase, output, and error |
| | `GET /host/version` | Running `cyclo_host_agent` package version |
| | `GET /host/files/tree` | List one directory under the host file root; optional `?path=` and `?show_hidden=true` |
| | `GET /host/files/read` | Read a UTF-8 text file (`?path=`) |
| | `GET /host/files/diff` | Git diff for a file (`?path=`) |
| | `GET /host/files/search` | Search filenames under `path`; requires `query`, optional `show_hidden` and `limit` |
| | `POST /host/files/write` | Save a text file; optional `expected_modified` for conflict detection |
| | `POST /host/files/create` | Create a file or directory |
| | `POST /host/files/rename` | Rename a file or directory |
| | `POST /host/files/upload` | Upload raw file bytes; `filename` and destination directory `path` query parameters, optional `overwrite` |
| | `DELETE /host/files` | Delete a file or directory; optional `?recursive=true` for folders |
| Version | `GET /version` | Installed vs PyPI `cyclo-manager`; optional `?check_latest=false` |
| WebSocket | `/ws/{container}/services/{service}/logs` | Live s6 logs (agent NDJSON stream → browser) |
| | `/ws/ros2/topics/{topic}` | Live topic data (see below) |
| | `/ws/ros2/system-status` | Repeated `battery` and `camera` query parameters; battery percentages and camera publisher presence every 2 s; no camera image subscriptions |
| | `/ws/jog?container={container}` | Ordered Jog input and feedback bound to the selected container; profile resolved by the server |
| | `/record-play/watch` | Own the page's catalog/feedback subscriptions; job status is read over HTTP |

**Jog robot selection:** The existing container router's `GET /{container}/bringup_status` checks only the selected
container's existing s6 service status and
reads `/run/robot_type` through Docker when a bringup process is first observed or
changes. It reuses the type while that process remains unchanged. There is no
background bringup monitor; requests use a lightweight Docker list without image
inspection. The type selects the AI Worker, OMY or OMX command routes. Record & Play
uses discovered trajectory topics and ROS feedback without Docker/s6 status checks;
known topics receive recommendations. No s6-agent update or new agent endpoint is
required. Joint names, position limits and
controller membership come from URDF and ROS feedback. Only one running follower
is supported on the shared feedback namespace. Legacy model-suffixed motion
WebSocket routes remain accepted with a required `container` query parameter;
model suffixes cannot override the server's profile. Each container has its own
status cache, so other browser selections cannot change an existing Jog target.
Container selection does not isolate ROS traffic; Jog rejects multiple publishers
on shared feedback topics and ambiguous controller mappings.
See [motion profiles](docs/record-play.md#robot-profiles).

**Service logs:** Live logs are streamed over WebSocket (not polled). Opening a new browser session re-tails recent lines from the agent, then follows new output. Download returns the current `/var/log/{service}/current` file with ANSI codes removed.

**ROS 2 WebSocket behavior:** Each connection registers a unique subscription owner after resolving the topic message type (known types, discovery, or existing subscription). Connections share one ROS subscription and cache per topic. The API pushes `{topic, msg_type, data, available}` when data changes (throttled); `metadata_only=true` sends availability without payloads. Disconnecting releases only that connection's ownership. The ROS subscription and cache are removed when the last owner leaves. `GET /ros2/topics/{topic}` only reads the cache; the former REST subscribe/unsubscribe endpoints have been removed.

**Observer recovery:** Topic and System status sockets send `ready` after successful subscription setup, even without ROS data. Only `ready` clears the last error and resets backoff. Structured errors include `code` and `retryable`: invalid requests/types and type conflicts stop automatic retries (close 1008); temporary failures retry (close 1013). Retries use jittered 1, 2, 4, 8, 16, then at most 30-second delays. UI observers retain the error and offer Reconnect; leaving the page cancels retries.

**HTTP observations:** For the one-shot robot-description read, invalid topics and
subscription type conflicts return **400**, temporary subscription or bridge
failures return **503**, and timeout returns **504**. Its temporary owner is
released on completion, failure, timeout or disconnect. Camera status uses ROS
graph publisher presence via the System status WebSocket; there is no camera
frame-check endpoint or image subscription. Publisher presence does not prove
that frames are being delivered.

Docker routes return **503** if `docker.sock` is unavailable. ROS routes require a running **rclpy** node and matching **`ROS_DOMAIN_ID`**.

---

## Repository layout

```text
cyclo_manager/
├── cyclo_manager/           # FastAPI backend + in-container agent
├── cyclo_manager_ui/        # Next.js UI
├── cyclo_manager_cli/       # PyPI package (cyclo-manager)
├── docs/                    # Jog, Record & Play and code structure
├── tests/                   # Backend regression tests
├── config.yml               # Dev / example config
├── docker-compose.dev.yml
└── README.md
```

See [Code structure](docs/code-structure.md) for module responsibilities and
backend, host-agent and UI validation commands.

---

## Security

The API is **unauthenticated** by default and mounts **`docker.sock`** (high privilege). Restrict network access, tighten **CORS** in production, and treat `/docs`, WebSockets, and `/host/*` as sensitive when exposed.

**Host file API (`/host/files/*`):** Proxied to `cyclo_host_agent` and can read, write, create, rename, upload, and delete files under the configured host agent workspace (`CYCLO_HOST_AGENT_WORKSPACE`). By default this is the host agent service user's home directory, except root-only devices with `/data/docker`, where `/data/docker` is used automatically. Treat this as full access to that directory tree when the UI or API is reachable.

---

## Contributing & license

- **[CONTRIBUTING.md](CONTRIBUTING.md)**
- **[LICENSE](LICENSE)** (Apache-2.0)
