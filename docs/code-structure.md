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
- `hooks/useNavigation.ts`: container checks before opening System or Jog.
- `components/ui/controlStyles.ts`: shared control styles, independent of Jog.
- `hooks/useAnsiConverter.ts`: theme-aware log rendering, including HTML escaping.

Files retains optimistic save checks, unsaved-edit prompts, search debounce and
mobile/desktop interaction differences. System reads saved model settings before
mounting its viewers and updates a model and its launch arguments together.
Dashboard CPU and general status polling retain their separate intervals.

## Robot control

- `robot/joints.py`: bounded commanded joints, URDF parsing and controller topics.
- `robot/interface.py`: shared cached feedback access and command publication.
- `jog.py`: per-connection jog input, targets, gripper retention and stop state.
- `record_play`: bag storage, motion validation/return planning and background jobs.
- `motion_guard.py`: mutual exclusion of Manager Jog and playback motion.
- `ros2_node/bridge.py`: the ROS executor, publishers, subscriptions and cache.
- `subscriptions.py`: explicit subscription ownership and lifetime.

The shared robot interface does not acquire subscriptions. Jog connections and
record/play jobs keep ownership in their existing lifecycle scopes. Constructing
an interface does not publish a command. The refactor preserves subscriber checks,
feedback freshness thresholds, recording durations and stop behavior.

## Verification

From the repository root, run `python -m unittest discover -s tests -v` in the
server's dependency environment. From `cyclo_manager_ui`, run
`npx tsc --noEmit`, `npm run lint`, `npm run test:observers` and `npm run build`.
For UI changes, also check Files editing/search/diff, model-specific System launch
settings, connection cleanup, and Record & Play on desktop and mobile widths.
