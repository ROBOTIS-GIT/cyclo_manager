# cyclo_manager UI

Next.js web interface for **cyclo_manager** (ROS 2 robot containers, s6 services, Docker, and live ROS topics).

## Features

- **Apps hub** (`/app`): Entry point; links to **Cyclo Manager** (dashboard) and **Cyclo Intelligence** (external UI on port 7080, `http://<host>:7080/`)
- **Dashboard** (`/dashboard`): Host stats, Docker container list (start/stop/restart), logs, bashrc editing, version management (host git repos)
- **System** (`/{container}/system`):
  - Follower bringup (`ai_worker_bringup`) with robot model **SG2 / BG2 / SH5 / BH5**
  - **Launch arguments** popup (gear icon): bool/string fields; **Init Position File** as dropdown (model default YAML, `pack_position.yaml`, or custom filename)
  - Leader bringup (`avatar_bringup`), **Cyclo Intelligence** (`cyclo_intelligence`), Zenoh daemon
  - Live service logs and **3D URDF viewer** (`/robot_description`, `/joint_states` via WebSocket)
  - **Robot Status** panel: bringup state, left/right battery percentage (WebSocket on `/ai_worker/battery/{left,right}/state`), and head/wrist camera activity (`GET /ros2/topics/{topic}/available` polling)
- **Topics** (`/topics`): Discover topics (`GET /ros2/topics`) and stream message JSON via WebSocket (`/ws/ros2/topics/{topic}`); optional **Info** tab (`GET /ros2/topics/{topic}/info`)
- **Terminal** (`/terminal`, optional `?container={name}`): Multi-tab xterm.js shells into running containers, process list with kill; links from Dashboard when a container is running
- **noVNC** (`/novnc`): Start/stop `novnc-server` and open the remote desktop viewer

The VS Code–style sidebar (Dashboard, System, Topics, Terminal, noVNC) is shown on all routes **except** `/app`.

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
| ROS topic data | `WebSocket /ws/ros2/topics/{topic}` — on connect the API resolves the message type, subscribes if needed, then polls its cache and pushes JSON when data changes |
| Container terminal | `WebSocket /terminal/{name}/ws?session_id=...` |

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
| `/novnc` | noVNC |

For the full stack and API, see the repository **[README.md](../README.md)**.
