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
  Distance from the centre sets speed, with a 12% dead zone. Release to stop.
- Use the rotation buttons in Joystick mode. In Keyboard mode, hold W/A/S/D or
  arrow keys for translation and Q/E for rotation; release to stop.
  Space stops and disables Jog in either mode outside editable controls.
- Select neck/lift, either arm, grippers or hands. Available groups are built
  from commanded, non-mimic joints in `/robot_description`. Joint positions,
  limits and targets use degrees or mm in the UI and radians or metres in ROS.
- Choose the joint increment from the dropdown: **1 mm / 0.1°**, **10 mm / 1°**
  (default), or **20 mm / 2°**. The mm value applies to the lift and the degree
  value to rotational joints. Limits can shorten a move at the end of a joint's range.
- Tap a joint button for one step. Keep it pressed for 350 ms to repeat goals
  using the selected increment relative to fresh measured position. The next
  goal is sent only after the previous trajectory duration has elapsed and
  feedback reaches its target (within 0.1 mm or 0.01°). Input heartbeats do not
  replace a step still in progress. Release to
  stop continuous movement. Changing the increment stops the current gesture.
- A tap sends one trajectory and leaves its goal intact after the nominal
  duration. Fresh feedback reaching the target completes local tracking without
  publishing a hold. Explicit stop, focus loss, disconnect and input timeout
  still interrupt a step while it is pending.
- Stop jog, loss of browser focus or a hidden page disables operation. Explicit
  enabling is required again. A hidden tab sends a stop, pauses periodic Jog
  messages, and keeps the stopped WebSocket session open. Returning to the tab
  resumes feedback without re-enabling Jog. Actual connection failures still
  require **Reconnect**; leaving the Jog page closes its connection.

## ROS connection

The manager handles `/ws/jog/{robot_type}` in order. The UI keeps at most one
unacknowledged input, normally at 10 Hz; stop is sent as soon as the preceding
input is acknowledged. This avoids queued motion after releasing a control.
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
topics. A single joint is sent using the partial-joint support in the follower
controllers (lift has only one joint). No bringup/remapping changes are needed.

Each goal starts from fresh measured position, never an accumulated UI target.
The nominal speed ceiling is 0.15 rad/s or 0.01 m/s, further limited by the URDF.
Both tap and hold use the selected fixed increment and clamp to joint bounds.
The trajectory duration is at least 250 ms and increases with distance and
the nominal speed limit rather than shrinking the requested increment. With
the default lift ceiling, a normal 10 mm step takes 1.5 seconds. This duration
uses the zero-end-velocity cubic estimate `1.5 * distance / speed`; actual
controller interpolation and tracking still require robot verification.
Goals end at zero velocity. A release during a hold with fresh feedback replaces the
goal with a hold at the measured position; without fresh feedback no old pose
is sent, and the last short trajectory finishes. This is a software stop, not
a hardware emergency stop or collision-aware motion planner.

During active motion, no input for 400 ms stops commands and closes the session.
Stopped/read-only sessions can wait for input without that timeout, including
while the browser tab is hidden. A socket disconnect still stops active commands.
The UI's 700 ms feedback timeout is paused while hidden and restarts on return.
Commands waiting more than 250 ms in the ROS bridge queue are discarded.
If the manager/ROS bridge itself dies, the base relies on the robot controller's
configured `cmd_vel_timeout` (currently 1 second in the SG2 configuration);
joint motion is limited to the last trajectory's selected increment.

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
