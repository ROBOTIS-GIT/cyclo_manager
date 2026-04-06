^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package cyclo_manager
^^^^^^^^^^^^^^^^^^^^^^^^^^^

0.1.3 (2026-02-25)
------------------
* **Config**: Removed unused service label (``services``) feature - service ID is used directly as UI label
* **Config**: ``robot_version`` renamed to ``repo_version``; ``config.containers.ai_worker.repo_version`` with ``owner``, ``repo``, ``current_version_file``
* **Packaged Docker Compose**: cyclo_manager, cyclo_manager_ui, zenoh_daemon, novnc-server; config via ``CYCLO_MANAGER_CONFIG_FILE``
* **cyclo_manager**: Central control server for ROS2-based robot containers; integrates with s6-overlay agents and exposes FastAPI REST API, WebSocket, and web UI
* **cyclo_manager API**: ``GET /docker/{container}/version`` - get current and latest GitHub release version for ai_worker (config: ``config.containers.ai_worker.repo_version``)
* **cyclo_manager CLI**: ``cyclo_manager up`` / ``cyclo_manager down`` to start/stop cyclo_manager stack (server, UI, Zenoh daemon, noVNC); ``cyclo_manager up -c PATH`` for config, ``-r/--ros-domain-id`` for ROS2 domain ID, ``--pull`` for image pull
* **cyclo_manager server**: Docker control (list containers, status, start/stop, logs) when Docker socket is available
* **cyclo_manager server**: ROS2 topic subscription and real-time data streaming via Zenoh; configurable topics and domain ID via ``ROS_DOMAIN_ID``
* **cyclo_manager server**: Service log streaming over WebSocket; GET/DELETE logs API (truncate log file in container)
* **cyclo_manager server (FastAPI)**: Container and service control via agents over Unix Domain Sockets; list/status and start/stop/restart of s6 services
* **cyclo_manager UI**: Control page per container with Robot/Leader/Physical AI Server/Zenoh Daemon toolbar; icon-only Bringup, Stop, Log, Settings; single visible log panel at a time
* **cyclo_manager UI**: Launch arguments popups for Robot/Leader; real-time service logs with Clear (backend truncate); 3D viewer for ROS2 topics
* **cyclo_manager UI**: Physical AI Server label opens port 80 in new tab; Topics page; noVNC link; theme toggle
* **cyclo_manager UI (Home)**: ai_worker version update display - compare current version (parsed from container ``package.xml``) with GitHub releases/latest; "Update available" badge; 3-step update guide modal on badge click
* **cyclo_manager UI (Next.js)**: Home page with configured container slots (e.g. ai_worker, open_manipulator); Docker management page for all containers
