# Jog

Use Jog with leader publishing stopped. There is no leader/Jog arbitration;
only one operator should use this page at a time. Opening the page does not
publish motion or stop commands. Click **Enable jog** before operating controls.

**Server connected** indicates the Jog WebSocket connection to the manager.
The separate **Robot bringup** status checks `ai_worker_bringup` every 2 seconds.
Until bringup is running, or when its status cannot be read, the entire control
area is disabled. Detecting a stopped or unavailable bringup stops and disables
Jog while keeping the server connection open. Enable Jog again after bringup
returns to running.

- Choose **Joystick** (default) or **Keyboard** in the base input tabs. Switching
  modes stops the current gesture. Only the selected mode accepts movement input.
- In Joystick mode, drag for robot-relative forward/lateral/diagonal translation.
  Distance from the centre sets speed up to a fixed 0.3 m/s, with a 12% dead
  zone. Release to stop. The translation speed slider only applies to Keyboard
  mode; the rotation speed slider applies to both modes. The robot controller
  may still ignore small translation commands below its per-axis deadband.
- Use the rotation buttons in Joystick mode. In Keyboard mode, hold W/A/S/D or
  arrow keys for translation and Q/E for rotation; release to stop.
  Space stops and disables Jog in either mode outside editable controls.
- Select neck/lift, either arm, grippers or hands. Available groups are built
  from commanded, non-mimic joints in `/robot_description`. Joint positions,
  limits and targets use degrees or mm in the UI and radians or metres in ROS.
- Choose the joint increment from the dropdown: **1 mm / 0.1°**, **10 mm / 1°**
  (default), **15 mm / 3°**, or **20 mm / 5°**. The mm value applies to the lift and the degree
  value to rotational joints. Limits can shorten a move at the end of a joint's range.
- Tap a joint button for one step. Keep it pressed for 350 ms to switch to
  continuous movement. Every hold update sends measured position plus/minus the
  selected increment, bounded by joint limits, without waiting for arrival.
  Goals are never accumulated from previous targets. Changing the increment
  stops the gesture.
- Both taps and holds send one immediate position point. Release of a hold
  sends the latest measured position as the stop target. A tap leaves its goal
  intact until fresh feedback confirms arrival, which completes local tracking
  without publishing another command. Explicit stop, focus loss, disconnect and
  input timeout still interrupt a pending step.
- Stop jog, loss of browser focus or a hidden page disables operation. Explicit
  enabling is required again. A hidden tab sends a stop, pauses periodic Jog
  messages, and keeps the stopped WebSocket session open. Returning to the tab
  resumes feedback without re-enabling Jog. Actual connection failures still
  require **Reconnect**; leaving the Jog page closes its connection.

## ROS connection

The manager handles `/ws/jog/{robot_type}` in order. The UI keeps at most one
unacknowledged input, normally at 10 Hz; stop is sent as soon as the preceding
input is acknowledged. This avoids queued motion after releasing a control.
The UI waits for the browser's saved robot selection before connecting.
Connection creation is deferred one timer turn so an immediate development-mode
effect cleanup can cancel it. Leaving the page still stops and closes an active
connection immediately. The server stops the session on disconnect without
trying to close an already disconnected WebSocket again.
The existing HTTP `/ros2/cmd_vel` API also accepts optional `linear_y`.

The manager subscribes to `/joint_states` and transient-local
`/robot_description`. Joint motion requires feedback no older than 500 ms,
finite position/velocity limits, and a matching position command interface in
the URDF. Missing data disables joint controls; there are no guessed limits.

Movement uses `/cmd_vel` (`geometry_msgs/msg/Twist`). Swerve is enabled for the
previously supported SG2, SH5, F2 and Mobile models. Mobile bringup supports only
base jog: the joint panel is disabled and the server rejects joint commands,
even if cached robot description and feedback include upper-body joints.
The maximum vector magnitude
is 0.3 m/s and rotation is capped at 0.6 rad/s. Normal input changes are ramped;
an explicit stop publishes zero.

Joint commands use `trajectory_msgs/msg/JointTrajectory` on the existing
`/leader/joint_trajectory_command_broadcaster_{left,right}/joint_trajectory`,
`/leader/joystick_controller_{left,right}/joint_trajectory` and hand broadcaster
topics. Partial-joint support is used in the follower controllers (lift has
only one joint). When jogging an arm that shares its controller with a gripper,
the first command captures the gripper's fresh measured position and includes
that same explicit position goal in the single point for the initial command,
subsequent hold updates and final stop.
It does not recapture fluctuating gripper feedback on each update. A new tap
or a new gesture after stopping captures a new position. Missing or invalid
gripper feedback blocks the initial arm command. Grippers on separate controllers
are not included. This holds position, not grasp force or an earlier closing
target; it does not arbitrate with other publishers. No bringup/remapping changes
are needed.

Each message contains exactly one point with `positions` and
`time_from_start: {sec: 0, nanosec: 0}`. Velocity and acceleration arrays are
left empty. The ROS duration field still exists, but no travel duration is
assigned. There are no intermediate points, inherited trajectory velocities,
or timed acceleration/braking profiles. Actual motion speed and acceleration
therefore depend on the robot controller and hardware configuration; the
manager does not enforce a joint speed limit through trajectory duration.

For both taps and holds, the selected joint target is
`clamp(measured position + direction * selected increment, URDF lower, URDF upper)`.
The bound uses the fresh feedback sample at command generation, not the previous
goal or a predicted position. For example, a 3-degree selection never commands
that joint more than 3 degrees ahead of that sample. Repeated samples from a
stalled joint do not accumulate larger targets. This is a command position
bound, not a guarantee against physical overshoot or a speed limit. The latched
gripper goal is kept separately so feedback jitter cannot change it.

Release/stop sends a single immediate target at the latest measured position.
Stale feedback causes no old pose to be sent; the last bounded position target
remains in the controller. Actual motion, stop response, smoothness at the
normally 10 Hz update rate and the gripper fix still require on-robot
verification. This is a software stop, not a hardware emergency stop or
collision-aware motion planner.

During active motion, no input for 400 ms stops commands and closes the session.
Stopped/read-only sessions can wait for input without that timeout, including
while the browser tab is hidden. A socket disconnect still stops active commands.
The UI's 700 ms feedback timeout is paused while hidden and restarts on return.
Commands waiting more than 250 ms in the ROS bridge queue are discarded.
If the manager/ROS bridge itself dies, the base relies on the robot controller's
configured `cmd_vel_timeout` (currently 1 second in the SG2 configuration);
the last joint goal remains within the selected increment of its originating
feedback sample, without further goal updates.

## Code organization

Implementation is split by responsibility:

- `cyclo_manager/jog.py`: session state, feedback checks and separate idle,
  base and joint command handlers. Joint metadata has no unused `speed` field;
  finite positive URDF velocity validation is retained.
- `cyclo_manager_ui/lib/jog.ts`: WebSocket types, increment options, timing,
  completion tolerances and display conversion. Increment values and tolerances
  must stay aligned with the server constants.
- `useJogConnection.ts`: ordered WebSocket messages and tap/hold lifecycle.
- `useKeyboardTeleop.ts`: keyboard input and release/focus handling.
- `JointJogCard.tsx` and `JogControls.tsx`: joint display and shared controls.

## Validation

With backend dependencies installed, from the repository root:

```sh
python -m unittest discover -s tests -v
```

Tests use a fake ROS bridge: they never send commands to a robot. They cover
limits, stale feedback, relative goals, release, input timeout/disconnect,
invalid commands and step completion. Type-check and lint the UI with its
normal TypeScript and ESLint tools. Actual robot motion and controller
interpolation need on-robot verification with the leader stopped.
