^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package cyclo_manager
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

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
