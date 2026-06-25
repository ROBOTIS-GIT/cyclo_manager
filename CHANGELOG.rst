^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package cyclo_manager
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

0.2.0 (2026-06-23)
------------------
* **Configuration:** Replaced ``containers`` / ``host_agent`` layout with ``robot_container`` and ``sockets``; validated at API startup.
* **Host agent:** Added ``cyclo_host_agent`` (systemd + Unix socket) for host git repo management and ``cyclo_manager`` package updates.
* **CLI:** ``cyclo_manager up`` installs/refreshes the host agent; ``cyclo_manager update`` upgrades the pip package and Docker stack; ``cyclo_manager down`` removes the host agent and stops all stack containers.
* **Version management (UI):** Dashboard page to check and update ``ROBOTIS-GIT`` repositories on the host (branch-aware update wizard).
* **Package update (UI):** Banner and modal to run ``cyclo_manager update`` when a newer ``cyclo-manager`` release is on PyPI.
* **Terminal:** In-browser multi-tab bash into running containers (persistent sessions, WebSocket PTY).
* **Dashboard:** Unified home for host stats, Docker containers, version management, and quick actions.
* **System page:** Uses ``robot_container`` from config for navigation and s6 bringup controls.
* **API:** Added ``/host/*`` (repo updates, package update proxy), ``/system/*`` (host stats), and ``GET /version`` (installed vs PyPI); removed per-container Docker image version endpoint.
* **Removed:** Host reboot and shutdown from API and UI.
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
