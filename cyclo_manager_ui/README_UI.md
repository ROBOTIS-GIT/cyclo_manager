# cyclo_manager UI

Next.js web interface for **cyclo_manager** (ROS 2 robot containers, s6 services, Docker, and live ROS topics).

## Features

- **Apps hub** (`/app`): Entry point; links to **Cyclo Manager** (dashboard) and **Cyclo Intelligence** (external UI on port 7080, `http://<host>:7080/`)
- **Dashboard** (`/dashboard`): Host stats, Docker container list (start/stop/restart), logs, bashrc editing, version management (host git repos)
  - System stats and the CPU process list refresh every second. The dashboard and CPU detail summary share the host agent's moving average of the latest three consecutive one-second CPU samples; during startup, the available samples are used. Process rows retain their short 0.2-second measurement window.
- **System** (`/{container}/system`):
  - Follower bringup (`ai_worker_bringup`) with robot model **SG2 / BG2 / SH5 / BH5 / F1 / F2 / Mobile**
  - **Launch arguments** popup (gear icon): bool/string fields; **Init Position File** as dropdown (model default YAML, `pack_position.yaml`, or custom filename)
  - Leader bringup (`avatar_bringup`), **Cyclo Intelligence** (`cyclo_intelligence`), Zenoh daemon
  - Live service logs and **3D URDF viewer**: one-shot HTTP URDF lookup with a temporary transient-local subscription (5 s timeout); `/joint_states` via WebSocket. The reusable viewer owns both lifecycles. `reloadKey` reloads the model on robot/bringup process changes; failed lookups offer Retry.
  - **Robot Status** panel: one `/ws/ros2/system-status` connection sends battery percentages and camera publisher presence every 2 s. Only battery topics are subscribed automatically. Camera **Check frame** briefly subscribes for a new frame (3 s timeout), returns metadata only, then releases its owner. Publisher presence is not proof of frame delivery; check results include the last check time.
- **Topics** (`/topics`): Discover topics (`GET /ros2/topics`) and stream message JSON via WebSocket (`/ws/ros2/topics/{topic}`); optional **Info** tab (`GET /ros2/topics/{topic}/info`)
- **Terminal** (`/terminal`, optional `?container={name}`): Multi-tab xterm.js shells into running containers, process list with kill; links from Dashboard when a container is running
- **Files** (`/files`): Browse and edit UTF-8 text files on the robot host under the host agent file root (create, rename, delete; hidden files optional)
- **noVNC** (`/novnc`): Start/stop `novnc-server` and open the remote desktop viewer

The VS Code–style sidebar (Dashboard, System, Topics, Terminal, Files, noVNC) is shown on all routes **except** `/app`.

## Development

### Prerequisites

- Node.js 20+
- npm
- cyclo_manager API running (e.g. `http://127.0.0.1:8081`)

### Setup

```bash
cd cyclo_manager_ui
npm install
```

### Run development server

```bash
npm run dev
```

Open **http://localhost:3000** (redirects to `/app`).

Set the API base URL only when the UI and API are not on the same host (e.g. UI on your PC, API on the robot):

```bash
export NEXT_PUBLIC_API_URL=http://127.0.0.1:8081
npm run dev
```

When unset, the UI uses `window.location.hostname:8081` for REST and WebSocket calls, which is correct for opening the UI on the robot host (e.g. `http://ffw-snpr48a1050.local:3000`).

### Build for production

```bash
npm run build
npm start
```

## Docker deployment

With the repo root **`docker-compose.dev.yml`**:

```bash
docker compose -f docker-compose.dev.yml up -d ui
```

Or use the packaged stack via **`cyclo_manager up`** (prebuilt `robotis/cyclo-manager-ui` image). See **[cyclo_manager_cli/README.md](../cyclo_manager_cli/README.md)**.

### Environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Optional cyclo_manager API base URL. Omit on the robot so the browser targets the same hostname as the UI (`:8081`). |
| `NODE_ENV` | `development` or `production` |

With **`network_mode: host`**, the default hostname-based URL resolves to `http://<host>:8081`. On a Docker bridge network, set `NEXT_PUBLIC_API_URL` to the API service hostname instead.

## Architecture

The UI calls the cyclo_manager **REST API** and **WebSockets**:

| Use | Endpoint |
|-----|----------|
| Service logs | `WebSocket /ws/{container}/services/{service}/logs` |
| ROS topic data | `WebSocket /ws/ros2/topics/{topic}` — each connection acquires a subscription owner, receives `ready` after registration, then receives cached JSON when data changes; disconnect releases only its owner |
| Robot description | `GET /ros2/robot-description?topic=/robot_description` — temporary subscription, released on completion, timeout or disconnect |
| System telemetry | `WebSocket /ws/ros2/system-status?battery=...&camera=...` — repeated query parameters, battery subscriptions only; camera graph inspection |
| Camera frame check | `POST /ros2/camera/check` with `{ "topic": "..." }` — waits for a newly received compressed frame; does not serialize image data |
| Container terminal | `WebSocket /terminal/{name}/ws?session_id=...` |
| Host files | `GET /host/files/tree`, `GET /host/files/read`, `POST /host/files/write`, etc. |

Launch arguments and robot type for bringup are stored in **`localStorage`** per container (and per follower model for `ai_worker`).

Configuration for default launch args lives in **`config/launchArgs.ts`** (edited in the UI popup, not in this file at runtime).

## Pages (summary)

| Path | Description |
|------|-------------|
| `/` | Redirects to `/app` |
| `/app` | Apps hub (Cyclo Manager / Cyclo Intelligence on port 7080) |
| `/dashboard` | Host + Docker management, repo updates |
| `/{container}/system` | Bringup, 3D viewer, robot status |
| `/topics` | ROS 2 topic list + live viewer |
| `/terminal` | Multi-tab container shells |
| `/files` | Host file browser and text editor |
| `/novnc` | noVNC |

For the full stack and API, see the repository **[README.md](../README.md)**.

### Observer recovery

Topic and System status observers receive a `ready` frame after subscriptions
are registered, even before any ROS messages arrive. Only this acknowledgement
resets reconnect backoff and clears the last error; transport open does not.
Temporary failures retry at approximately 1, 2, 4, 8, 16, then at most 30 seconds
with jitter. Structured errors carry `code` and `retryable`; invalid topics/types
and type conflicts stop automatic retries (close 1008), while temporary bridge
or subscription failures retry (close 1013). Connection state and the last error
are displayed separately. Reconnect triggers an immediate attempt; errors remain
until readiness is acknowledged. Unmount cancels retries and closes the socket.

## Code organization

See [Code structure](../docs/code-structure.md) for feature hooks/components, the
shared API client, navigation, robot-control boundaries and validation commands.
