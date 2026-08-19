^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package cyclo_manager
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

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
