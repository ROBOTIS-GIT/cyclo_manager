^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package cyclo_manager
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

1.1.1 (2026-10-07)
------------------
* Added selectable lift/linear arrival tolerance for playback: 1 cm (default), 2 cm or 3 cm.
* Removed URDF position-limit checks for recorded targets and measured positions in Record & Play, including start-pose transitions, repeat returns and held joints. Positions are not clamped; message validation, feedback freshness and finite-value checks, and arrival checks remain in place.
* Reduced Jog and playback publishing delays by waking the ROS executor when bridge requests are queued, instead of waiting for its polling timeout.
* Contributors: Hyungyu Kim

1.1.0 (2026-09-29)
------------------
* Added joint Jog controls for AI Worker, OMY, and OMX, with selectable movement increments and displays of joint positions, targets, and limits.
* Added joystick-based mobile base control with selectable joystick and keyboard modes.
* Added Record & Play for recording joint command topics to rosbags and managing saved recordings, with playback, repetition, automatic start-pose transitions, and arrival tolerance settings. Recording and playback continue after leaving the page.
* Added Files for host file browsing, search, upload, editing, creation, renaming, and deletion, including Git status and diff views.
* Added a dashboard CPU details view with overall usage and per-process CPU and memory usage.
* Added s6-agent APIs for listing services and retrieving all service statuses.
* Changed Jog from browser-timed HTTP commands to a dedicated WebSocket with server-scheduled publishing and active motion stops on input timeout or disconnection.
* Changed Jog robot selection to use the selected container's bringup status and robot type. System and Jog now list running robot containers without inspecting their images.
* Changed ROS subscription management to share subscriptions by connection and job ownership, releasing them only when the last owner leaves so other viewers and jobs remain connected.
* Changed ROS topic HTTP reads to return cached data without creating subscriptions, and removed the HTTP subscribe/unsubscribe endpoints.
* Added retry backoff and persistent error reporting to ROS topic and System status WebSocket observers.
* Changed System robot description loading to an independent one-shot subscription while bringup is running, avoiding stale shared descriptions after bringup restarts.
* Changed camera status checks to use publisher presence without subscribing to image messages.
* Moved host statistics collection to ``cyclo_host_agent``. Dashboard and CPU details summaries now share the average of the latest three one-second CPU samples and refresh every second.
* Changed container startup during repository updates to background jobs with progress logs, including image downloads. Timed-out or cancelled jobs terminate their helper process group instead of remaining in progress.
* Fixed container listing failures when image inspection is unavailable by falling back to the container's saved image information.
* Improved mobile layouts for navigation, file management, terminals, and robot controls.
* Updated DYNAMIXEL Wizard 2 in noVNC and added its documents directory.
* Contributors: Hyungyu Kim

1.0.1 (2026-08-19)
------------------
* Fixed the F1/F2 robot status camera topic to use the head camera topic.
* Contributors: Hyungyu Kim

1.0.0 (2026-08-05)
------------------
* Improved ROS 2 bridge request synchronization with per-request response queues for discovery, subscription, QoS lookup, publishing, and unsubscribe results.
* Changed service log delivery from polling to streaming and refactored related WebSocket and UI code.
* Added support for multiple robot containers, including ``ai_worker`` and ``open_manipulator`` system profiles.
* Added OMY and OMX bringup controls with follower and leader launch argument configuration.
* Added serial port discovery and port selection for Open Manipulator launch arguments.
* Changed Jog robot readiness checks from parsing bringup logs to using robot service status and the selected robot model.
* Added service log file download support with a Download button in the log panel.
* Added s6 agent compatibility checks and update support in Version Management.
* Added Docker image management on the dashboard (list, delete unused images, and prune dangling images).
* Contributors: Hyungyu Kim

0.3.0 (2026-07-09)
------------------
* Added a Jog page for ``ai_worker`` with desktop/mobile controls, keyboard control, speed sliders, robot readiness checks, and repeated ``/cmd_vel`` publishing.
* Added ROS 2 Twist publishing support through the ``/ros2/cmd_vel`` API.
* Added Mobile robot support for ``ai_worker_bringup`` service control and launch argument configuration.
* Refactored ROS 2 integration to a single shared ``Ros2Bridge`` (spin thread + request queue) with centralized topic constants, QoS resolution via rclpy, and ``discovery_topics()`` for topic listing.
* Contributors: Howon Kim, Hyungyu Kim

0.2.1 (2026-07-06)
------------------
* Added a Robot Status panel to the System page.
* Renamed ``physical_ai_server`` references to ``cyclo_intelligence`` across the UI, config, and docs.
* Contributors: Hyungyu Kim

0.2.0 (2026-06-23)
------------------
* Added a dashboard for host status, Docker controls, logs, bashrc editing, and repository updates.
* Added ``cyclo_host_agent`` for host-side git repository updates and ``cyclo_manager`` package updates.
* Added repository update workflow with branch validation, local-change handling, and container stop/start steps.
* Added ``cyclo_manager`` update notification and host-agent-backed update flow from the UI.
* Added a dedicated multi-tab web terminal with persistent ``docker exec`` sessions.
* Moved ROS 2 topics to global ``/ros2`` API and ``/topics`` UI routes.
* Changed configuration to use ``robot_container`` and ``sockets``.
* Updated CLI, packaged Docker Compose files, and images for the new host-agent based workflow.
* Removed old Docker/home pages and legacy in-container update/version endpoints.
* Contributors: Hyungyu Kim

0.1.1 (2026-05-18)
------------------
* Added terminal feature in docker page.
* Change type of input field for initial position yaml file to drop box.
* Contributors: Hyungyu Kim

0.1.0 (2026-04-27)
------------------
* Initial release as **cyclo_manager**
* Contributors: Hyungyu Kim
