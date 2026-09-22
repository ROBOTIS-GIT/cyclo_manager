# Jog

Use Jog with leader publishing stopped. The manager coordinates its own Jog and
playback sessions, but does not arbitrate with external publishers. Opening the
page publishes no motion or stop commands. Click **Enable jog** before operating
controls.

## Robot selection and readiness

**Server connected** indicates the Jog WebSocket connection to the manager.
**Robot bringup** comes from the shared server runtime monitor. It checks
configured, running Docker containers and the existing s6 status endpoints for
`ai_worker_bringup` / `open_manipulator_bringup`, then reads `/run/robot_type`.
Each polling pass is followed by a one-second delay; observations older than four
seconds are unavailable. That configured bringup type selects the AI Worker,
OMY or OMX profile. Browser-saved System settings do not select the Jog profile.

Until a single supported bringup is verified, the control area is disabled.
Restart, model change or unavailable status invalidates the current motion
session and disarms the UI. Idle connections can adopt a new runtime profile;
an active session encountering a changed run reports an error and closes.
Reconnect when needed and explicitly enable Jog after bringup recovers. The
server also checks the runtime before publishing, including a final stop.
See [robot profiles](record-play.md#robot-profiles) for generation checks and the
distinction between configured bringup type and actual launch-process detection.

## Controls

- Choose **Joystick** (default) or **Keyboard** in the base input tabs. Switching
  modes stops the current gesture. Only the selected mode accepts movement input.
- In Joystick mode, drag for robot-relative forward/lateral/diagonal translation.
  Distance from the centre sets speed up to a fixed 0.3 m/s, with a 12% dead
  zone. Release to stop. The translation speed slider only applies to Keyboard
  mode; the rotation speed slider applies to both modes. The robot controller
  may still ignore small translation commands below its per-axis deadband.
- Use the rotation buttons in Joystick mode. In Keyboard mode, focus the keyboard
  control area after enabling Jog, then hold W/A/S/D or arrow keys for translation
  and Q/E for rotation; release to stop. Space stops and disables Jog in either
  mode outside editable controls.
- Select a controller group. Joint cards come from bounded, non-mimic position
  joints in `/robot_description`; controller feedback and profile topics determine
  their group. Known topics have labels such as Neck, Lift or Arm + gripper.
  Unmapped joints remain disabled. AI Worker `*_wheel_steer` joints are omitted
  from Joint Jog cards but still appear in **Wheel steering angle** feedback.
- Positions, limits and targets use degrees or mm in the UI and radians or metres
  in ROS. Choose **1 mm / 0.1°**, **10 mm / 1°** (default), **15 mm / 3°**, or
  **20 mm / 5°**. The mm value applies to prismatic joints, including the lift;
  degrees apply to revolute joints. Limits can shorten a move near a boundary.
- Press a joint button to start continuous movement immediately, with no
  tap/hold transition delay. Every update sends measured position plus/minus the
  selected increment, bounded by joint limits, without waiting for arrival.
  Goals are never accumulated from previous targets. Changing the increment
  stops the gesture.
- Each update sends one immediate position point. Releasing the button sends
  the selected joint's latest measured position as the stop target, even after a
  short press. The selected increment is a target offset, not a guaranteed travel
  distance per click. Explicit stop, focus loss, disconnect and input timeout also
  stop the gesture.
- Stop jog, loss of browser focus or a hidden page disables operation. Explicit
  enabling is required again. A hidden tab sends a stop, pauses periodic Jog
  messages and keeps the stopped WebSocket session open. Returning to the tab
  resumes feedback without re-enabling Jog. Actual connection failures require
  **Reconnect**; leaving the Jog page stops its session and closes its connection.

## ROS connection and feedback

The UI sends ordered inputs to `/ws/jog`, keeping at most one unacknowledged input,
normally at 10 Hz. Stop is sent as soon as the preceding input is acknowledged,
avoiding queued motion after release. Responses include server-owned robot status
and cached joint/controller feedback. The UI connects without a robot selection.
The legacy `/ws/jog/{robot_type}` route remains accepted, but its model and old
`topic` / `base_topic` query parameters cannot override the profile.

Connection creation is deferred one timer turn so an immediate development-mode
effect cleanup can cancel it. Leaving the page stops and closes an active
connection immediately. The server finishes its stop attempt before releasing
that session's subscription owners. Other viewers or jobs retain their own owners.
The HTTP `/ros2/cmd_vel` endpoint is a separate direct-publish API; the Jog UI does
not use it, and it does not provide the Jog session/watchdog behavior.

The session subscribes to `/joint_states`, transient-local `/robot_description`,
and discovered `control_msgs/msg/JointTrajectoryControllerState` topics. Joint
motion requires:

- A verified, unchanged bringup generation.
- A revolute/prismatic joint with a position command interface, finite lower/upper
  limits and positive finite velocity limit in URDF. Fixed, continuous and mimic
  joints are excluded; there are no guessed limits.
- Joint position feedback no older than 500 ms, with valid positions for every
  joint in the commanded controller.
- Controller-state feedback no older than two seconds supplying the complete joint
  list. ROS graph subscriber/publisher node identities associate this list with a
  `trajectory_msgs/msg/JointTrajectory` command topic allowed by the profile.
  Missing, ambiguous or incomplete mappings disable control.

The shared `/robot_description` and `/joint_states` sources support one follower
at a time. Namespaced feedback selection, Action-only grippers, TwistStamped and
controllers without JointTrajectoryControllerState are not supported here.

## Command routes

Routes are defined in `cyclo_manager/robot/profiles.py`:

| Profile | JointTrajectory command topics |
|---------|--------------------------------|
| AI Worker except Mobile | `/leader/joystick_controller_{left,right}/joint_trajectory` and `/leader/joint_trajectory_command_broadcaster_{left,right}/joint_trajectory` |
| SH5 / BH5 additions | `/leader/joint_trajectory_command_broadcaster_{left,right}_hand/joint_trajectory` |
| OMY / OMX | `/leader/joint_trajectory` |
| Mobile | None; base only |

Profiles define routes, not joint names or counts. Command-topic remaps require
updating the profile. Controller feedback validates actual joint membership.

Base movement uses `/cmd_vel` (`geometry_msgs/msg/Twist`) for SG2, SH5, F2 and
Mobile profiles when an external Twist subscriber is discovered. OMY, OMX and
stationary AI Worker profiles have no base control. Mobile rejects joint commands
even if feedback includes upper-body joints. Translation vector magnitude is
capped at 0.3 m/s and rotation at 0.6 rad/s. Normal changes are ramped; an explicit
stop publishes zero. The displayed base values are the manager's command values,
not measured odometry.

## Joint targets and held positions

A Jog message contains the **complete joint set of the selected controller**.
The selected joint receives the measured-position offset. Every other joint on
that controller is captured from fresh feedback at press start and held at that
position throughout the press and final stop. This includes grippers regardless
of their names and works with controllers that reject partial joint goals.

Hold updates do not recapture fluctuating gripper or other held-joint feedback.
A new gesture after stopping captures new held positions. Missing or
out-of-range positions block the initial command; joints on separate controllers
are not included. This holds position, not grasp force or an earlier closing
target. A changed controller mapping interrupts the gesture instead of redirecting
its commands.

Each message contains exactly one point with `positions` and
`time_from_start: {sec: 0, nanosec: 0}`. Velocity and acceleration arrays are empty.
No travel duration is assigned, and there are no intermediate points or timed
acceleration/braking profiles. Motion speed and acceleration therefore depend on
the controller and hardware; the manager does not enforce joint speed through
trajectory duration.

While pressed, the selected target is:

```text
clamp(measured position + direction * selected increment, URDF lower, URDF upper)
```

The bound uses the fresh measurement at command generation, not a previous goal
or predicted position. A 3-degree selection commands at most 3 degrees ahead of
that sample. A stalled joint does not accumulate increasingly distant targets.
This bounds commanded position, not physical overshoot or speed. Other controller
joints keep their latched goals. Reaching a target does not end a held gesture;
the next fresh feedback sample supplies the next target. The UI's pending-target
highlight uses a 0.01° or 0.1 mm tolerance, which does not affect command generation.

## Stops and timeouts

Release/stop sends one immediate target at the selected joint's latest measured
position, keeping the other controller joints at their latched goals. Stale
feedback prevents sending an old measured pose. A changed or unavailable bringup
also blocks the old session's final publish and reports an error; the controller
can retain the last joint goal.

During active motion, no input for 400 ms stops commands and closes the session.
Stopped/read-only sessions can wait without that timeout, including while hidden.
The UI's 700 ms feedback timeout pauses while hidden and restarts on return.
Commands waiting more than 250 ms in the ROS bridge queue are discarded. If the
manager or bridge dies, base stopping relies on the robot controller's configured
velocity timeout; the last joint target remains, without further goal updates.

The manager's motion guard excludes concurrent Jog/playback motion across browser
clients. Recording can coexist with Jog. External leaders are outside this guard.
Actual stop response, smoothness and controller interpolation require on-robot
verification. This is a software stop, not a hardware emergency stop or collision
avoidance.

## Code and validation

- `robot/profiles.py` and `robot/runtime.py`: routes and server-owned bringup status.
- `robot/joints.py`, `robot/catalog.py`, `robot/interface.py`: URDF joints, controller
  mapping, shared cached feedback and publication.
- `jog.py`: per-session inputs, targets, held positions and stop state.
- `cyclo_manager_ui/lib/jog.ts`: message types, units, increments and timing.
- `useJogConnection.ts`: ordered WebSocket input and press/release lifecycle.
- `useKeyboardTeleop.ts`: keyboard focus, input and release handling.
- `JointJogCard.tsx` and `JogControls.tsx`: joint display and controls.

From the repository root in the server dependency environment:

```sh
python -m unittest discover -s tests -v
```

Tests use fake feedback and do not send commands to a robot. They cover profile
selection, restart guards, mapping, complete controller goals, held grippers,
limits, stale feedback, continuous movement, stops and connection timeouts.
Run `npm run test:jog` in `cyclo_manager_ui` for mocked browser tests of press/release
ordering, focus loss, page exit and connection timeouts. See
[Code structure](code-structure.md#verification) for UI and host-agent checks.
