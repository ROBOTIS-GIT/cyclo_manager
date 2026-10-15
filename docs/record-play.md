# Record & Play

Record & Play records selected `trajectory_msgs/msg/JointTrajectory` topics to
MCAP rosbag2 files on the robot. Recording groups come from discovered ROS topics;
known topic names receive recommended labels. Playback uses URDF limits and ROS
joint feedback without Docker, s6 or bringup status checks. Playback takes command
topics and joint membership directly from the bag. Automatic start-pose moves,
repeat returns, arrival checks and stop holds use only recorded direct controller
inputs. These inputs are identified once from graph endpoints: the subscribing
node also publishes `JointTrajectoryControllerState`. No controller-state messages
are subscribed to or awaited, and multiple state topics do not make an input ambiguous.

## Storage and deployment

Both compose files mount `${HOME}/cyclo_manager_ros_bags` on the host at
`/cyclo_manager_ros_bags` in the manager container. `HOME` is resolved when
compose runs. `RECORDINGS_DIR` points the server to that container-side path;
without the variable, the server also defaults to `/cyclo_manager_ros_bags`.
Recreating or updating a container does not remove mounted files.

Each recording has a generated directory ID; the display name is never used as
a filesystem path:

```text
~/cyclo_manager_ros_bags/<id>/
  recording.json       # name, model, groups, topics, counts and date
  bag/
    metadata.yaml
    *.mcap
```

The Dockerfiles explicitly install `ros-jazzy-rosbag2-py` and
`ros-jazzy-rosbag2-storage-mcap`. Rebuild the manager image and recreate its
container to apply the dependency/mount changes. Existing development containers
do not gain a bind mount from source hot reload. Do not record important data
until the mount is applied. Recording JSON is atomically published only after
the writer closes successfully and at least one selected topic has received messages.
Incomplete bags remain on disk for diagnosis but are not listed for playback;
they are not automatically resumed after a restart.

## Recording

Choose **New recording**, enter a name, select discovered trajectory topics and
click **recording start** while
the leader or Jog supplies commands. Incoming messages are captured by ROS
subscription callbacks, queued (up to 2,000 messages) and written by a worker;
the UI does not poll joint values to manufacture a recording. Capture intervals
use a monotonic clock anchored to wall time. Queue overflow, write errors or
less than 256 MiB free disk space fail the recording explicitly. ROS transport
loss before receipt cannot be detected by this recorder.

**stop and save** drains received messages, closes the bag and adds it to the
library. Recording continues when leaving the page; another page can stop/save
the server's active recording. Only groups/topics that received messages are
listed and replayed. Selected groups with no messages are noted as excluded in
the recording details. Completely empty captures cannot be replayed. Use
consistent joint membership on each direct controller input: a bag that changes
that input's commanded joint set is rejected before any motion. Other recorded
trajectory topics may change their joint lists.
Current Jog commands include the complete selected controller joint set, so Jog
captures can be replayed when they satisfy the same validation. Older partial-joint
captures that change membership within one topic still fail this check.

The saved recording list is inside **Playback**. Expanding **Topic** in a recording
group shows the actual ROS topic name. Publisher presence is informational and
does not prevent starting a capture.

Use **Delete** beside a saved recording and confirm deletion to permanently remove
its rosbag files and metadata from storage. Stop/save the active recording or stop
playback before deleting recordings. Deletion does not require robot feedback.
Incomplete captures are not shown in this list.

## Playback and repetition

Stop leader publishing before playing. There is no leader control
arbitration. Manager Jog and playback mutually exclude active motion, and only
one Record & Play job can run across browser clients. Recording may coexist
with Jog because it only observes commands.

1. Select a recording. The server validates every message's structure, finite
   values and timing. Direct controller input joint names must have usable URDF
   limits. At least one recorded direct input must be identifiable for automatic
   transitions; other topics need not match controllers. Recorded
   positions are neither rejected nor clamped against URDF position limits.
   Publishers are acquired without waiting for subscriber connections.
2. **Play** automatically interpolates from fresh measured positions to each
   direct controller input's first recorded positions. Reference/intermediate
   topics are excluded from this generated motion. Only recorded joints are commanded; no
   unrecorded joints or grippers are added. Partial joint goals must be supported
   by the receiving controller when the bag contains only part of its joint set.
3. After feedback confirms arrival at the start pose, messages from **all recorded
   topics**, including reference/intermediate topics, are streamed at their
   recorded relative times. Header stamps are reset to zero (execute from now);
   point durations are divided by playback rate, velocities multiplied by rate,
   and accelerations multiplied by its square. Existing zero-duration points
   remain zero. Rates are 1× and 0.5×.
4. After the final message and its trajectory duration, fresh feedback must
   reach the final targets of the direct controller inputs. For repetitions, the manager returns to the initial
   pose, verifies arrival, and starts the next pass. The repeat count is the
   **total number of passes**; zero means infinite. The bag itself is unchanged.

Current feedback used to calculate return transitions
must be present and finite, but is not rejected or clamped against URDF position
limits. This also applies when holding the current pose after stop. Arrival checks remain enabled;
if the controller limits a recorded target and cannot reach it within the selected
tolerance, playback can stop with an arrival timeout.

Return trajectories use quintic position interpolation at approximately 10 Hz,
with zero endpoint slope/acceleration. All selected groups share a duration
calculated from displacement, URDF velocity limits and conservative return
limits (10°/s and 20°/s²; lift 10 mm/s and 20 mm/s²). Duration accounts for quintic
peak speed and acceleration and is limited to 120 seconds. Position commands
have `time_from_start=0`. These bound the generated targets, not the controller's
physical motion. **Arrival tolerance** selects the angular tolerance for each
playback job: 0.5° (default), 1°, 2° or 3°.
The two hand command topics
`/leader/joint_trajectory_command_broadcaster_left_hand/joint_trajectory` and
`/leader/joint_trajectory_command_broadcaster_right_hand/joint_trajectory`
are exempt from position-error arrival checks. Other topics retain the selected
tolerances, including topics that contain finger joints. Hand feedback must still
be present, finite and fresh. Generated hand moves and recorded targets are
unchanged: the pre-move check still includes hands so a hand-only displacement
does not skip the start or return movement. **Lift / linear tolerance** selects
1 cm (default), 2 cm or 3 cm for linear joints. These settings apply to the start
pose, repeat returns and final pose for joints recorded on direct controller inputs.
All non-exempt joints must stay within tolerance for 0.3 seconds before proceeding,
even if the initial pose is already within tolerance. An out-of-range observation
restarts that interval. Failure to settle within ten seconds after the planned
interval aborts playback; the error reports the affected joints, targets, measured
positions, errors and tolerances in degrees or millimeters. Preparation, return
transitions, arrival checks and stop holds require joint feedback no older than
500 ms and an unchanged robot description. During bag streaming (including waiting
for the final trajectory duration), feedback and robot-description checks
are not repeated. Feedback loss or description changes are therefore checked at the
next arrival, return or stop stage, not during message replay. Feedback subscriptions
remain active for those stages. Cancellation, publish failures and the 500 ms
playback-lag cutoff still interrupt streaming. Playback does not wait for subscriber
matching during preparation or check it on each publish. Losing a subscriber
alone does not fail publishing or stop the replay clock. Overdue commands are not
burst after the lag cutoff. The initial 0.3-second arrival confirmation does not
guarantee that a newly created command publisher has matched its receivers.
Messages sent before matching may be missed; initial delivery is not guaranteed
when a playback job creates new publishers.

Replay prepares serialized ROS messages directly from MCAP, rebasing header stamps
and scaling timing/derivatives without a dictionary/deep-copy/reconstruction cycle.
The complete bag is still validated before motion. Each pass opens the reader and
prepares its first message before starting the replay clock. Later read/prepare
delays still count toward the 500 ms lag cutoff. A lag error includes the cycle,
topic, scheduled offset, actual lag, previous publish wait and current read/prepare
time. Messages are not dropped or merged to catch up. UI progress updates are
limited to 10 Hz independently of command frequency.

The options are sent as `arrival_tolerance_deg` and `arrival_tolerance_cm` in
`POST /record_play/play` and reported in job status so other browser clients show
the running job's settings.
Choose a tolerance that meets the task's accuracy needs and the robot's measured
tracking error across poses and loads. This setting does not depend on the saved
recording's robot label or Docker bringup status.

The return is a joint-space transition, not collision avoidance. For contact or
grasping tasks, record the release and safe return path as part of the motion;
the automatic transition should cover only a suitable remaining pose difference.

## Stops and connections

The UI uses HTTP commands and read-only status polling every 500 ms. A server
worker owns timing, so rendering and polling do not determine trajectory timing.
Bridge requests share a FIFO queue on the ROS spin thread. A guard condition wakes
the executor when a request is queued, so publishing does not wait for the idle
spin timeout. Each publish still waits for its bridge result; long-running queued
operations can still delay playback, and the 500 ms playback-lag cutoff remains.
Recording, preparation, playback and repeat returns continue after page navigation,
browser closure or client disconnection. No browser heartbeat is required. On
return, the page shows the active recording, progress, speed and repeat settings;
any browser can explicitly stop the server job. Infinite repeats continue until
stopped or an error occurs. Preparation, return, arrival and stop stages validate
fresh joint feedback and an unchanged robot description
independently of browser connections. Bag streaming skips these repeated checks.

Playback owns its command publishers for the entire job, including the initial
move, every repeat return and final arrival check. Repeats reuse the same publishers;
infinite repeats retain them until cancellation or failure. Completion, cancellation
or failure releases ownership after any required stop/hold publish. Jog sessions
may share these publishers, so destruction occurs only after the last owner leaves.
Recording alone does not create command publishers.

Shared topic subscriptions track a set of consumer IDs. A topic viewer owns its
subscriptions for the lifetime of its WebSocket; Jog owns them through its final
stop, and recording/playback jobs own theirs independently of browser lifetime.
The last consumer's departure destroys the ROS subscription and clears its cache.
Duplicate registration or a late disconnect from an older connection cannot
remove another consumer. Disconnect cleanup runs even for static or silent topics.

Record & Play uses HTTP polling for its topic catalog and job status. Opening the
page creates no feedback subscriptions; playback jobs own their joint-state and
robot-description subscriptions. The former `/record_play/watch` endpoint and
controller-feedback availability field have been removed. HTTP overview,
status and topic reads are read-only. The old global HTTP topic subscribe and
unsubscribe endpoints have been removed. System uses `/ws/ros2/system-status`
for low-rate battery values and camera publisher presence, and
`GET /ros2/robot-description` for one-shot description reads through independent
temporary transient-local subscriptions. These reads bypass the shared cache and
release only their temporary subscription after completion, timeout or disconnect.
Camera status is
`Active` when a publisher exists; it never subscribes to image streams.
Topic/System observers distinguish retryable from terminal errors;
Jog uses explicit Reconnect after connection failures.
A job started without a viewer allows up to two seconds for initial feedback.

Stop interrupts playback, preparation or return and replaces pending targets
with fresh measured positions on the recorded direct controller inputs only. If feedback is
stale or publishing fails, the UI reports an error; the controller can retain
its last target. Server shutdown also requests stop before closing the bridge.
This is a software stop, not a hardware emergency stop. There is no automatic
motion resumption after a server restart, stop or completion. Reconnecting only
observes the job that is already running; it does not start a new job.

## Code organization

`robot_interface/urdf_joints.py` parses commanded URDF limits.
`robot_interface/controller_discovery.py` lists trajectory topics for recording and
resolves Jog controller membership by matching subscribers to controller-state publishers.
Playback uses endpoint identities only to select direct inputs for generated motion;
it does not read state messages or require a unique state source.
`robot_interface/motion_interface.py` reads shared bridge caches, checks feedback freshness and
publishes commands through an optional guard used by Jog. Playback disables controller
discovery. The interface does not register subscriptions or run a motion loop. Jog adds
its per-connection command state through `JogSession`; Record & Play uses the
same robot interface directly, with subscription lifetimes owned by its jobs.
`record_play/motion.py` validates bags and computes transitions from joint
definitions without depending on Jog state or publishing commands.

## Validation

Verify recording, playback, deletion, repeat transitions and stop behavior on the
target environment. Check MCAP writing and reading using the installed ROS packages.
On-robot verification of follower behavior and return paths is required before
using recordings for unattended motion.

## ROS discovery and supported interfaces

- Joint cards come from bounded revolute/prismatic position-command joints in
  `/robot_description`; fixed and mimic joints are excluded. Measurements come from
  `/joint_states`. Joint names and counts are not hardcoded in profiles.
- ROS graph discovery finds `JointTrajectory` inputs and
  `JointTrajectoryControllerState` feedback. Matching subscriber/publisher node
  identities accounts for remapped command topics. Fresh controller feedback supplies
  the complete joint list. Missing, duplicate, incomplete, or ambiguous mappings do
  not enable Jog control. Jog restricts discovery to its profile topics.
  Playback does not use this state-message-based membership discovery. It uses
  endpoint identities once to identify direct controller inputs for generated motion
  and arrival checks; recorded joint names supply their membership. All bag topics
  are streamed, including those without a matching controller or subscriber.
- Known command topic names are marked Recommended. Recording lists all discovered
  `JointTrajectory` topics, even without URDF or incoming messages. Publisher detection
  does not subscribe to trajectory payloads; recording subscribes only to selected topics.
- Jog publishes a complete controller joint set. The selected joint gets a measured
  offset; other joints are latched at press start, including grippers with arbitrary
  names. This also supports controllers that reject partial joint goals.
- AI Worker profiles hide `*_wheel_steer` joints from Joint Jog cards. Their measured
  angles remain in Wheel steering angle; OMY/OMX and other unassigned joints are unchanged.
- Playback validates direct-input joint names against the current URDF; the old
  metadata `robot` label is informational. All existing saved recordings remain listed.
  The robot description is pinned at preparation and checked again during return,
  arrival and stop stages, rather than on every replayed message. The direct-input
  selection is kept for the job; it is not rediscovered during replay. A bag with
  no identifiable direct controller inputs cannot perform automatic transitions.
- Base control requires both profile support and a discovered `geometry_msgs/msg/Twist`
  subscriber on the profile base topic. OMY/OMX and stationary AI Worker models have no base controls.
- This version uses `/robot_description` and `/joint_states` in the manager's ROS
  domain. Multiple robots must not publish conflicting feedback on those same topics.
  Choosing namespaced feedback sources, Action-only grippers and TwistStamped inputs
  are outside this version. Jog requires JointTrajectoryControllerState messages.
  Playback only needs its publisher endpoint to identify direct controller inputs.

Jog clients use `/ws/jog?container={container}`; Record & Play uses HTTP.
Jog state and `GET /{container}/bringup_status`
include `robot` status fields (`ready`, `model`, `container`, `generation`, `reason`);
the GET returns those fields directly. Record & Play overview lists recording
choices and saved bags without a controller-feedback or bringup status. The Jog profile is selected from
the required container query parameter and its bringup status. Record & Play request
`robot` fields are metadata only and default to `ros`. Old Jog `topic`/`base_topic`
query parameters do not override profile routes. Playback no longer takes a
bringup `generation`; it validates the bag against the URDF and uses joint feedback for transitions.

## Robot profiles

- `robot_interface/command_profiles.py` defines routes for AI Worker SG2/BG2/SH5/BH5/F1/F2/mobile,
  OMY and OMX. Profiles contain no joint names, joint counts or limits. Custom Jog
  remaps require updating the profile; recording discovers trajectory topics and
  playback uses recorded topics directly.
- Jog uses the same container selection as System and keeps it in `/{container}/jog`.
  Connected pages request `GET /{container}/bringup_status` every two seconds. There is no
  always-running bringup task; with no requests, there are no Docker/s6 observations.
  A one-second cache per container coalesces concurrent requests. Each refresh checks
  only the selected supported container with one filtered Docker API call, without
  inspecting images, and queries that container's existing s6-agent
  `GET /services/{name}/status` endpoint for `ai_worker_bringup` and
  `open_manipulator_bringup`; 404 means that service is not installed. No service-list
  endpoint is required. Leader services do not select a follower profile.
  If an older agent returns `pid: null`, the manager reads the PID from its `raw`
  s6 status text, including the `up (pid N pgid N)` format.
- The manager reads that container's existing `/run/robot_type` using Docker exec
  (`cat /run/robot_type`) on first observation, process/container changes, uptime
  reset or recovery after unavailable/stale status. It reuses the type while that
  process stays unchanged. The type selects the Jog profile and must match the
  bringup service family. Missing/unknown types keep Jog disabled.
  Browser-saved settings do not select the Jog profile.
- This reads the **configured bringup type**, not the actual launch command. The
  setting is written before starting/restarting bringup; if it is changed without
  restarting the service, it may differ from the running robot. Apply type changes
  by restarting bringup. Actual launch-process identification is deferred.
- Existing s6-agent deployments work unchanged: no new endpoint or agent update is
  required. Only the manager implementation changes.
- Container ID, service PID and type changes, observed uptime resets, and recovery
  after unavailable status invalidate the current Jog generation. Status
  older than four seconds, service failures and multiple bringups within the selected
  container disable Jog. Other containers are not polled. The Jog ROS guard blocks
  commands when shared `/robot_description` or `/joint_states` topics have multiple
  publishers; controller discovery also rejects ambiguous mappings. Selecting a
  container does not isolate ROS topics. This is polled readiness, not hardware interlocking.
- Record & Play does not use this profile/status service. Recording needs only
  discovered command topics; playback preparation requires fresh joint
  feedback, valid URDF limits and identifiable recorded direct controller inputs
  for automatic transitions. It does not await state messages or subscriber matching.
  Bag streaming skips per-publish feedback/description checks.
  Changes to Docker/s6 status alone do not stop playback.
- Jog verifies its cached bringup status before publishing. A changed or unavailable run also blocks the final
  pose-hold publish, to avoid sending an old session's goals to a different robot.
  The error is reported; the last target or controller base timeout then applies.
