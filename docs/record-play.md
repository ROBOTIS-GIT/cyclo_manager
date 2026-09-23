# Record & Play

Record & Play records selected `trajectory_msgs/msg/JointTrajectory` topics to
MCAP rosbag2 files on the robot. Recording groups come from discovered ROS topics;
known topic names receive recommended labels. Playback uses URDF limits and ROS
joint/controller feedback without Docker, s6 or bringup status checks.

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
complete, consistent joint membership per topic: a bag that
changes a topic's commanded joint set is rejected before any motion.
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

1. Select a recording. The server validates every message against current URDF
   joint names, controller topics and position limits before publishing. All
   selected controller topics must have a matching subscriber before motion.
2. **Play** automatically interpolates from fresh measured positions to each
   topic's first recorded positions. Unrecorded joints on those controllers,
   including shared grippers, are captured once and explicitly held.
3. After feedback confirms arrival at the start pose, messages are streamed at their
   recorded relative times. Header stamps are reset to zero (execute from now);
   point durations are divided by playback rate, velocities multiplied by rate,
   and accelerations multiplied by its square. Existing zero-duration points
   remain zero. Rates are 1× and 0.5×.
4. After the final message and its trajectory duration, fresh feedback must
   reach the final target. For repetitions, the manager returns to the initial
   pose, verifies arrival, and starts the next pass. The repeat count is the
   **total number of passes**; zero means infinite. The bag itself is unchanged.

Return trajectories use quintic position interpolation at approximately 10 Hz,
with zero endpoint slope/acceleration. All selected groups share a duration
calculated from displacement, URDF velocity limits and conservative return
limits (10°/s and 20°/s²; lift 10 mm/s and 20 mm/s²). Duration accounts for quintic
peak speed and acceleration and is limited to 120 seconds. Position commands
have `time_from_start=0`. These bound the generated targets, not the controller's
physical motion. **Arrival tolerance** selects the angular tolerance for each
playback job: 0.5° (default), 1°, 2° or 3°. Linear joints use 1 mm. The same setting
applies to the start pose, repeat returns and final pose, including held joints.
All involved joints must stay within tolerance for 0.3 seconds before proceeding,
even if the initial pose is already within tolerance. An out-of-range observation
restarts that interval. Failure to settle within ten seconds after the planned
interval aborts playback; the error reports the affected joints, targets, measured
positions, errors and tolerances in degrees or millimeters. Joint feedback must be at
most 500 ms old throughout movement. More than 500 ms of playback lag aborts
instead of bursting overdue messages.

The option is sent as `arrival_tolerance_deg` in `POST /record_play/play` and
reported in job status so other browser clients show the running job's setting.
Choose a tolerance that meets the task's accuracy needs and the robot's measured
tracking error across poses and loads. This setting does not depend on the saved
recording's robot label or Docker bringup status.

The return is a joint-space transition, not collision avoidance. For contact or
grasping tasks, record the release and safe return path as part of the motion;
the automatic transition should cover only a suitable remaining pose difference.

## Stops and connections

The UI uses HTTP commands and read-only status polling every 500 ms. A server
worker owns timing, so rendering and polling do not determine trajectory timing.
Recording, preparation, playback and repeat returns continue after page navigation,
browser closure or client disconnection. No browser heartbeat is required. On
return, the page shows the active recording, progress, speed and repeat settings;
any browser can explicitly stop the server job. Infinite repeats continue until
stopped or a robot/server error occurs. Playback monitors fresh joint/controller
feedback, its resolved command routes and unchanged URDF limits.
These checks continue independently of browser connections.

Every topic subscription tracks a set of consumer IDs. A topic viewer owns its
subscriptions for the lifetime of its WebSocket; Jog owns them through its final
stop, and recording/playback jobs own theirs independently of browser lifetime.
The last consumer's departure destroys the ROS subscription and clears its cache.
Duplicate registration or a late disconnect from an older connection cannot
remove another consumer. Disconnect cleanup runs even for static or silent topics.

Record & Play opens a separate `/record_play/watch` WebSocket for catalog
monitoring; closing it releases only the page's subscriptions. HTTP overview,
status and topic reads are read-only. The old global HTTP topic subscribe and
unsubscribe endpoints have been removed. System uses `/ws/ros2/system-status`
for low-rate battery values and camera publisher presence, and
`GET /ros2/robot-description` for one-shot description reads. Camera status is
`Active` when a publisher exists; it never subscribes to image streams.
The Record & Play catalog observer retries connection closures with backoff while
mounted. Topic/System observers also distinguish retryable from terminal errors;
Jog uses explicit Reconnect after connection failures.
A job started without a viewer allows up to two seconds for initial feedback.

Stop interrupts playback, preparation or return and replaces pending targets
with fresh measured positions on every involved controller. If feedback is
stale or publishing fails, the UI reports an error; the controller can retain
its last target. Server shutdown also requests stop before closing the bridge.
This is a software stop, not a hardware emergency stop. There is no automatic
motion resumption after a server restart, stop or completion. Reconnecting only
observes the job that is already running; it does not start a new job.

## Code organization

`robot/joints.py` parses commanded URDF limits. `robot/catalog.py` resolves controller
joint membership by matching JointTrajectory subscribers to controller-state publishers.
`robot/interface.py` reads shared bridge caches, checks feedback freshness and
resolved routes, and publishes commands through an optional guard used by Jog. It does not
register subscriptions or run a motion loop. Jog adds
its per-connection command state through `JogSession`; Record & Play uses the
same robot interface directly, with subscription lifetimes owned by its jobs.
`record_play/motion.py` validates bags and computes transitions from joint
definitions without depending on Jog state or publishing commands.

## Validation

`python -m unittest discover -s tests -v` covers filesystem IDs, recording
capture/finalization, deletion and active-job protection, validation before
publishing, rate scaling, held joints,
quintic transitions, finite/infinite loops, stops, ownership, feedback/discovery
failures and HTTP validation with fake robot feedback. A separate integration
check should write/read a temporary MCAP using the installed ROS packages.
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
  not enable control. Jog restricts discovery to its profile topics; playback uses
  the stored recording topics to resolve alternatives.
- Known command topic names are marked Recommended. Recording lists all discovered
  `JointTrajectory` topics, even without URDF or incoming messages. Publisher detection
  does not subscribe to trajectory payloads; recording subscribes only to selected topics.
- Jog publishes a complete controller joint set. The selected joint gets a measured
  offset; other joints are latched at press start, including grippers with arbitrary
  names. This also supports controllers that reject partial joint goals.
- AI Worker profiles hide `*_wheel_steer` joints from Joint Jog cards. Their measured
  angles remain in Wheel steering angle; OMY/OMX and other unassigned joints are unchanged.
- Playback validates against current URDF and discovered command routes; the old
  metadata `robot` label is informational. All existing saved recordings remain listed.
  Controller membership/routes and URDF must remain unchanged during playback.
- Base control requires both profile support and a discovered `geometry_msgs/msg/Twist`
  subscriber on the profile base topic. OMY/OMX and stationary AI Worker models have no base controls.
- This version uses `/robot_description` and `/joint_states` in the manager's ROS
  domain. Multiple robots must not publish conflicting feedback on those same topics.
  Choosing namespaced feedback sources, Action-only grippers, TwistStamped inputs,
  and controllers without JointTrajectoryControllerState are outside this version.

New clients use `/ws/jog?container={container}` and `/record_play/watch`.
Jog state and `GET /{container}/bringup_status`
include `robot` status fields (`ready`, `model`, `container`, `generation`, `reason`);
the GET returns those fields directly. Record & Play overview exposes controller
feedback availability without a bringup status. Legacy model-suffixed WebSocket
routes remain accepted but also require the container query parameter; their model
suffix cannot select the Jog profile. Record & Play request
`robot` fields are metadata only and default to `ros`. Old Jog `topic`/`base_topic`
query parameters do not override profile routes. Playback no longer takes a
bringup `generation`; it validates the bag against current ROS feedback and routes.

## Robot profiles

- `robot/profiles.py` defines routes for AI Worker SG2/BG2/SH5/BH5/F1/F2/mobile,
  OMY and OMX. Profiles contain no joint names, joint counts or limits. Custom Jog
  remaps require updating the profile; manual recording/playback topics still
  resolve through controller feedback.
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
  discovered command topics; playback requires fresh joint/controller feedback,
  valid URDF limits, unambiguous command routes and controller subscribers. Changes
  to Docker/s6 status alone do not stop playback.
- Jog verifies its cached bringup status before publishing. A changed or unavailable run also blocks the final
  pose-hold publish, to avoid sending an old session's goals to a different robot.
  The error is reported; the last target or controller base timeout then applies.
