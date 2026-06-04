# cyclo_manager UI

Next.js web interface for **cyclo_manager** (ROS 2 robot containers, s6 services, Docker, and live ROS topics).

## Features

- **Apps hub** (`/app`): Entry point; links to Cyclo Manager and Physical AI Tools
- **Home** (`/home`): Configured slots (`ai_worker`, `open_manipulator`) with status, Docker control, and logs
- **System** (`/{container}/system`):
  - Follower bringup (`ai_worker_bringup`) with robot model **SG2 / BG2 / SH5 / BH5 / Mobile**
  - **Launch arguments** popup (gear icon): bool/string fields; **Init Position File** as dropdown (model default YAML, `pack_position.yaml`, or custom filename)
  - Leader bringup (`avatar_bringup`), Physical AI Server, Zenoh daemon
  - Live service logs and **3D URDF viewer** (`/robot_description`, `/joint_states`)
- **Topics** (`/{container}/topics`): Discover topics and stream messages via WebSocket
- **Docker** (`/docker`): List containers, start/stop/restart, per-container settings (info, logs, bashrc)
- **Terminal** (`/docker/{name}`): Multi-tab xterm.js shells, process list with kill, **Back** to Docker list
- **noVNC** (`/novnc`): Start/stop `novnc-server` and open the remote desktop viewer

VS Code–style sidebar (System, Topics, Docker, noVNC) is shown on all routes except `/app` and `/home`.

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

Set the API base URL if needed:

```bash
export NEXT_PUBLIC_API_URL=http://127.0.0.1:8081
npm run dev
```

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
| `NEXT_PUBLIC_API_URL` | cyclo_manager API base URL (default in compose: `http://127.0.0.1:8081`) |
| `NODE_ENV` | `development` or `production` |

With **`network_mode: host`**, use `http://127.0.0.1:8081` (or the host IP). On a Docker bridge network, point to the API service hostname instead.

## Architecture

The UI calls the cyclo_manager **REST API** and **WebSockets** (`/ws/...` for service logs and ROS topics; `/docker/{name}/terminal/ws` for terminals). Launch arguments and robot type for bringup are stored in **`localStorage`** per container (and per follower model for `ai_worker`).

Configuration for default launch args lives in **`config/launchArgs.ts`** (edited in the UI popup, not in this file at runtime).

## Pages (summary)

| Path | Description |
|------|-------------|
| `/` | Redirects to `/app` |
| `/app` | Apps hub |
| `/home` | Robot slot overview |
| `/{container}/system` | Control + 3D viewer |
| `/{container}/topics` | Topic list + viewer |
| `/docker` | Docker management |
| `/docker/{name}` | Container terminal + processes |
| `/novnc` | noVNC |

For the full stack and API, see the repository **[README.md](../README.md)**.
