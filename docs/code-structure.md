# Code structure

The UI keeps route entry points in `cyclo_manager_ui/app`. Feature pages compose
components and hooks; moving a component must not change its connection lifetime,
robot selection, or polling interval.

## Frontend

- `components/files`, `components/system`, `components/dashboard`: feature views.
- `hooks/files`: file browsing/editing/search operations and drag uploads.
- `hooks/system`: selected robot/leader launch settings and service status/control.
- `hooks/dashboard`: robot/host observations and container log/bashrc settings.
- `lib/files`: pure diff, path, and display helpers.
- `lib/api/client.ts`: shared Axios configuration and error translation.
- `lib/api/{services,docker,terminal,host,system,ros2,files}.ts`: endpoint functions.
  Existing consumers can import from `@/lib/api`; the index exports the same API.
- `config/navigation.ts`: the flat menu order and route matching.
- `components/layout/SidebarNavigation.tsx`: shared desktop/mobile menu rendering.
- `hooks/useNavigation.ts`: container checks for System; motion pages open directly and display server runtime status.
- `components/ui/controlStyles.ts`: shared control styles, independent of Jog.
- `hooks/useAnsiConverter.ts`: theme-aware log rendering, including HTML escaping.

Files retains optimistic save checks, unsaved-edit prompts, search debounce and
mobile/desktop interaction differences. System reads saved model settings before
mounting its viewers and updates a model and its launch arguments together.
Dashboard system statistics and CPU process rows poll every second; container
and host-info observations have separate intervals. CPU summaries share the
host agent's moving average of the latest three one-second samples.

## Robot control

- `robot/profiles.py`: bringup types/services, command topics, labels and base support.
- `robot/runtime.py`: lifespan-owned existing service status/type observations and generation guards.
- `robot/joints.py`: bounded position-command joints and limits parsed from URDF.
- `robot/catalog.py`: command topics and controller membership matched by ROS endpoint node identity.
- `robot/interface.py`: shared cached feedback access and command publication.
- `jog.py`: per-connection jog input, targets, controller-wide held positions and stop state.
- `record_play`: bag storage, motion validation/return planning and background jobs.
- `motion_guard.py`: mutual exclusion of Manager Jog and playback motion.
- `ros2_node/bridge.py`: the ROS executor, publishers, subscriptions and cache.
- `subscriptions.py`: explicit subscription ownership and lifetime.

The shared robot interface does not acquire subscriptions. Jog connections and
record/play jobs keep ownership in their existing lifecycle scopes. Constructing
an interface does not publish a command. Profiles choose Jog routes and Record &
Play recommendations; discovery validates actual controller joint membership.
The runtime monitor uses existing s6 status endpoints and Docker reads of
`/run/robot_type`, without new agent endpoints. See [Jog](jog.md) and
[Record & Play](record-play.md) for timing, validation and stop behavior.

## Host agent

`cyclo_manager_cli/cyclo_host_agent` runs as the separately installed systemd
service. `cpu_usage.py` owns continuous CPU sampling; `routers/system_stats.py`
serves statistics and process rows. `routers/files.py` and `routers/repos.py`
handle workspace files and managed repository operations. The manager proxies
these through its host-agent client. Dev API/UI source mounts do not update the
host agent's installed Python package.

## Verification

From the repository root, in environments with the corresponding server or
host-agent dependencies installed:

```sh
python -m unittest discover -s tests -v
PYTHONPATH=cyclo_manager_cli python -m unittest discover -s cyclo_manager_cli/tests -v
```

The first command covers backend motion, recording, subscription and API logic;
the second covers host CPU sampling and shared summaries. They use test doubles,
not live robot commands. They are development checks, not application startup code.

From `cyclo_manager_ui`, run:

```sh
npm ci
npx tsc --noEmit
npm run lint
npm run test:observers
npm run build
```

For UI changes, also check Files editing/search/diff, model-specific System launch
settings, connection cleanup, and Record & Play on desktop and mobile widths.
On-robot motion verification remains separate from these automated checks.
