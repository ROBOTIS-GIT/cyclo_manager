# Record & Play

Record & Play records selected `trajectory_msgs/msg/JointTrajectory` topics to
MCAP rosbag2 files on the robot. It supports neck, lift, arms with their grippers,
and hands when those commanded groups exist in `/robot_description`. Mobile-only
bringup has no joint playback. The manager's robot selection must match the bag.

## Storage and deployment

Both compose files mount `${HOME}/cyclo_manager_ros_bags` on the host at
`/cyclo_manager_ros_bags` in the manager container. `HOME` is resolved when
compose runs. `RECORDINGS_DIR` points the server to that container-side path.
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

Choose **New recording**, enter a name, select groups and start recording while
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
physical motion. Arrival tolerance is 0.5° or 1 mm; failure to arrive within ten
seconds after the planned interval aborts playback. Joint feedback must be at
most 500 ms old throughout movement. More than 500 ms of playback lag aborts
instead of bursting overdue messages.

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
stopped or a robot/server error occurs. Bringup is independently monitored by the
server while a job is active, with a three-second health timeout.

Every topic subscription tracks a set of consumer IDs. A topic viewer owns its
subscriptions for the lifetime of its WebSocket; Jog owns them through its final
stop, and recording/playback jobs own theirs independently of browser lifetime.
The last consumer's departure destroys the ROS subscription and clears its cache.
Duplicate registration or a late disconnect from an older connection cannot
remove another consumer. Disconnect cleanup runs even for static or silent topics.

Record & Play opens a separate `/record-play/watch/{robot}` WebSocket for catalog
monitoring; closing it releases only the page's subscriptions. HTTP overview,
status and topic reads are read-only. The old global HTTP topic subscribe and
unsubscribe endpoints have been removed. System availability monitoring uses
metadata-only topic WebSockets to avoid sending camera payloads to the browser.
Viewers reconnect after a connection closes while their component is mounted.
A job started without a viewer allows up to two seconds for initial feedback.

Stop interrupts playback, preparation or return and replaces pending targets
with fresh measured positions on every involved controller. If feedback is
stale or publishing fails, the UI reports an error; the controller can retain
its last target. Server shutdown also requests stop before closing the bridge.
This is a software stop, not a hardware emergency stop. There is no automatic
motion resumption after a server restart, stop or completion. Reconnecting only
observes the job that is already running; it does not start a new job.

## Validation

`python -m unittest discover -s tests -v` covers filesystem IDs, recording
capture/finalization, validation before publishing, rate scaling, held joints,
quintic transitions, finite/infinite loops, stops, ownership, feedback/bringup
failures and HTTP validation with fake robot feedback. A separate integration
check should write/read a temporary MCAP using the installed ROS packages.
On-robot verification of follower behavior and return paths is required before
using recordings for unattended motion.
