# cyclo_manager UI

Next.js web interface for **cyclo_manager** (ROS 2 robot containers, s6 services, Docker, and live ROS topics).

## Features

- **Apps hub** (`/app`): Entry point; links to **Cyclo Manager** (dashboard) and **Cyclo Intelligence** (external UI on port 7080, `http://<host>:7080/`)
- **Dashboard** (`/dashboard`): Host stats, Docker container list (start/stop/restart), logs, bashrc editing, version management (host git repos)
  - System stats and the CPU process list refresh every second. The dashboard and CPU detail summary share the host agent's moving average of the latest three consecutive one-second CPU samples; during startup, the available samples are used. Process rows retain their short 0.2-second measurement window.
- **System** (`/{container}/system`):
  - **AI Worker**: follower `ai_worker_bringup` with **SG2 / BG2 / SH5 / BH5 / F1 / F2 / Mobile**, and LG2 leader `avatar_bringup`
  - **Open Manipulator**: follower `open_manipulator_bringup` with **OMY / OMX**, and OMY-L / OMX-L leader `leader_bringup`
  - **Launch arguments** popup (gear icon): bool/string fields; **Init Position File** as dropdown (model default YAML, `pack_position.yaml`, or custom filename)
  - **Cyclo Intelligence** (`cyclo_intelligence`) and Zenoh daemon controls
  - Live service logs and **3D URDF viewer**: one-shot HTTP URDF lookup with a temporary transient-local subscription (5 s timeout); `/joint_states` via WebSocket. The reusable viewer owns both lifecycles. `descriptionEnabled` gates model requests: System waits for bringup Running, loads once per model/PID, and cancels requests and clears the model when bringup stops or its status is unavailable. `reloadKey` reloads the model on robot/bringup process changes; failed lookups offer Retry while enabled.
  - **Robot Status** panel: one `/ws/ros2/system-status` connection sends battery percentages and camera publisher presence every 2 s. Only battery topics are subscribed automatically. Cameras show **Active** when a publisher exists and **—** otherwise, without subscribing to image messages.
- **Topics** (`/topics`): Discover topics (`GET /ros2/topics`) and stream message JSON via WebSocket (`/ws/ros2/topics/{topic}`); optional **Info** tab (`GET /ros2/topics/{topic}/info`)
- **Jog** (`/{container}/jog`): Uses the same container selection as System. Enable/stop controls, joystick or keyboard base input, and joint buttons that update targets continuously while pressed. Joint-button release leaves the last target in place; explicit stop holds the measured position of an active gesture. The server resolves the selected container's profile; joint metadata comes from URDF and ROS feedback. See [Jog](../docs/jog.md).
- **Record & Play** (`/record-play`): **New recording** selects trajectory topics; **Playback** contains the saved recording list, deletion with confirmation, automatic start-pose transition, speed selection, repetition and stop. Deletion removes the bag and metadata and is available when no recording/playback job is active. Server jobs continue after page navigation. See [Record & Play](../docs/record-play.md).
- **Terminal** (`/terminal`, optional `?container={name}`): Multi-tab xterm.js shells into running containers, process list with kill; links from Dashboard when a container is running
- **Files** (`/files`): Browse/search host files, upload by file picker or drag-and-drop, edit UTF-8 text and inspect diffs; create, rename and delete files/directories, with optional hidden files and unsaved-edit/conflict checks
- **noVNC** (`/novnc`): Start/stop `novnc-server` and open the remote desktop viewer

The flat navigation list is **Dashboard, System, Jog, Record & Play, Topics,
Terminal, noVNC, Files**. It appears as a desktop sidebar or mobile menu on all
routes **except** `/app`. System and Jog select among configured, running robot
containers: one opens directly, multiple offer a choice, and none shows a message.
Both menus use `GET /containers?running=true`, without a second Docker/image list request.
Jog retains the selection in its URL; `/jog` also offers selection for direct visits.
Record & Play opens directly.

## Motion pages

Jog shows **Server connected** and **Robot bringup** separately.
The server chooses an AI Worker, OMY or OMX profile from the container's
`/run/robot_type` and existing s6 bringup status endpoints. Profile detection
requires no s6-agent update. Joint definitions and limits come from URDF, measured
positions from `/joint_states`, and controller membership from controller-state
feedback. Jog routes commands through the profile automatically and has no
command-topic selector. Restart/model changes disarm Jog. The page polls
`GET /{container}/bringup_status` every two seconds while connected; concurrent requests
for the same container share a one-second cache. Only the selected container is
queried. There is no background bringup monitor, and status older than
four seconds cannot authorize Jog motion.
Container selection does not isolate ROS topics. Duplicate publishers on shared
feedback topics and ambiguous controller mappings block Jog commands.

Record & Play shows **Server connected** and **Controller feedback**, recommends
known command topic names and also lists other
discovered `JointTrajectory` topics. Expand **Topic** in a group to see its ROS
name. Recording needs neither bringup nor an active publisher. Playback requires
fresh joint/controller feedback, valid URDF limits and verified controller routing,
without Docker/s6 bringup checks. Stop remains available when feedback is unavailable,
although publishing a pose hold still requires valid feedback and unchanged routes.
Playback **Arrival tolerance** offers 0.5° (default), 1°, 2° and 3° for angular joints;
linear joints use 1 mm. Start, repeat-return and final poses require 0.3 seconds
continuously within tolerance. While a job is active, the selector shows the server's
setting and cannot be changed. Timeout errors include joint targets and measured errors.
See [motion profiles](../docs/record-play.md#robot-profiles) for supported types and
runtime checks.

## Development

### Prerequisites

- Node.js 24 (the version used by the Dockerfiles)
- npm
- cyclo_manager API running (e.g. `http://127.0.0.1:8081`)

### Setup

```bash
cd cyclo_manager_ui
npm ci
```

### Run development server

```bash
npm run dev
```

Open **http://localhost:3000** (redirects to `/app`).

### API address

REST and WebSocket connections originate in the **browser**. With no
`NEXT_PUBLIC_API_URL` value, the client uses the page's protocol and hostname with
port `8081`. For example, opening `http://robot.local:3000` targets
`http://robot.local:8081`; an HTTPS page targets HTTPS/WSS and needs a suitably
configured API endpoint.

If the API is on a different host or port, set an address reachable from the
browser before starting the development server. For example, for a robot at
`192.168.6.2`:

```bash
export NEXT_PUBLIC_API_URL=http://192.168.6.2:8081
npm run dev
```

`127.0.0.1` refers to the device running the browser. A Docker service name is
normally resolvable only inside Docker, so it is not a browser API address.
For a bridge-network deployment, expose the API port and use the host's
browser-reachable address or a reverse proxy.

Both compose files currently specify `NEXT_PUBLIC_API_URL=http://127.0.0.1:8081`
for the UI service. In **dev compose**, remove that entry or override it with an
empty string to use the browser hostname, or set the robot's reachable API URL;
recreate the UI container after changing its environment. Exporting a value in
the host shell alone does not override that literal compose setting.

### Build for production

```bash
npm run build
npm start
```

`NEXT_PUBLIC_API_URL` is embedded in the browser bundle at build time. Set it
before `npm run build` if needed. Setting it only for `npm start`, or only in the
runtime environment of a prebuilt Docker image, does not change that bundle.
The production Dockerfile does not pass the compose runtime value into its
builder, so the bundle uses the hostname fallback unless a value is supplied
during the build (for example through a build-time `.env.production` file).

## Docker deployment

From the repository root, using **`docker-compose.dev.yml`**:

```bash
docker compose -f docker-compose.dev.yml up -d ui
```

Or use the packaged stack via **`cyclo_manager up`** (prebuilt `robotis/cyclo-manager-ui` image). See **[cyclo_manager_cli/README.md](../cyclo_manager_cli/README.md)**.

### Environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Optional browser-reachable API URL; empty/unset uses the page protocol and hostname on port 8081. Read during dev startup or production build; see [API address](#api-address). |
| `NODE_ENV` | `development` or `production` |

## Architecture

The UI calls the cyclo_manager **REST API** and **WebSockets**:

| Use | Endpoint |
|-----|----------|
| System/Jog selection | `GET /containers?running=true` — supported running robot containers, without image inspection |
| Service logs | `WebSocket /ws/{container}/services/{service}/logs` |
| ROS topic data | `WebSocket /ws/ros2/topics/{topic}` — each connection acquires a subscription owner, receives `ready` after registration, then receives cached JSON when data changes; disconnect releases only its owner |
| Robot description | `GET /ros2/robot-description?topic=/robot_description` — temporary subscription, released on completion, timeout or disconnect |
| System telemetry | `WebSocket /ws/ros2/system-status?battery=...&camera=...` — repeated query parameters, battery subscriptions only; camera graph inspection |
| Jog | `WebSocket /ws/jog?container={container}` — operator intent refreshed at 10 Hz, server ROS publishing at 20 Hz, independent status at about 10 Hz; closes on page unmount or container change |
| Jog bringup | `GET /{container}/bringup_status` — page-owned polling every 2 s, no overlapping requests; per-container observations expire after 4 s |
| Recording catalog | `WebSocket /record-play/watch` — scoped subscriptions for the page; closing it does not stop a recording/playback job |
| Record & Play status | `GET /record-play` for catalog/library/controller feedback about every 2 s, `GET /record-play/status` for job status every 500 ms |
| Record & Play commands | `POST /record-play/record`, `/record-play/play`, `/record-play/stop` |
| Delete saved recording | `DELETE /record-play/recordings/{recording_id}` — permanently remove bag files and metadata; an active recording/playback job returns a conflict |
| Container terminal | `WebSocket /terminal/{name}/ws?session_id=...` |
| Host files | `GET /host/files/tree`, `/read`, `/search`, `/diff`; `POST /host/files/write`, `/create`, `/rename`, `/upload`; `DELETE /host/files` |

System launch arguments and selected robot/leader types are stored in
**`localStorage`**. These configure bringup requests; they do not select the
Jog profile, which comes from the server's request-driven running-robot observation.
Record & Play uses ROS topics and feedback directly.

Configuration for default launch args lives in **`config/launchArgs.ts`** (edited in the UI popup, not in this file at runtime).

## Pages (summary)

| Path | Description |
|------|-------------|
| `/` | Redirects to `/app` |
| `/app` | Apps hub (Cyclo Manager / Cyclo Intelligence on port 7080) |
| `/dashboard` | Host + Docker management, repo updates |
| `/{container}/system` | Bringup, 3D viewer, robot status |
| `/{container}/jog` | Base teleoperation and measured-position joint jogging for the selected container |
| `/jog` | Resolve one running robot or ask the user to choose before opening Jog |
| `/record-play` | Record trajectory topics, saved recording library and repeated playback |
| `/topics` | ROS 2 topic list + live viewer |
| `/terminal` | Multi-tab container shells |
| `/files` | Host file browsing, search, upload, editing and diff |
| `/novnc` | noVNC |

For the full stack and API, see the repository **[README.md](../README.md)**.

## Observer recovery

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
