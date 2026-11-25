# Hardware diagnostics

The diagnostic worker runs **inside the AI Worker container**, separately from
the s6 agent and Manager server. It needs no running ROS node or bringup. It uses
the installed `ffw_description` Xacro files, the installed
`dynamixel_hardware_interface/param/dxl_model` tables, and DYNAMIXEL SDK Protocol 2.

## Standalone use

Inside the container:

```sh
source /opt/ros/jazzy/setup.bash
source /root/ros2_ws/install/setup.bash
python3 -m cyclo_manager.diagnostics --list-profiles
python3 -m cyclo_manager.diagnostics --profile w1 --inspect
python3 -m cyclo_manager.diagnostics --profile w1 --once
python3 -m cyclo_manager.diagnostics --profile w1 --watch --format ndjson
```

Use one profile per invocation. `--once` is the default. Ctrl+C stops a watch and
returns its ports. Override a system's port with
`--port w1_follower=/dev/serial/by-id/DEVICE` and the host connection baud rate with
`--baud-rate w1_follower=1000000`. These overrides only affect this inspection;
they do not change the Xacro or write device baud-rate registers. Shared physical
ports must resolve to the same baud rate. `--inspect` resolves the description
without opening a port. Profiles include W1/W2, SG2, BG2 rev4, A1/A2,
and LG2. SH5/BH5 require the installed hand description package to expand their
URDF. The HX5 hand preflight reads the controller's `Table Sync Enable` register.
If it is 1, the worker writes 0 to switch to bypass, then verifies the value before
probing each uniquely configured internal motor ID. If it is already 0, no mode
write is needed. Directly responding motors are identified by their real model
and checked for supported error, voltage and temperature registers. Unknown mode,
unsupported model/layout, a failed write or failed verification prevents probing.
A later mode change invalidates the acquired hand readings.

This inspection leaves the hand controller in bypass when it stops. The configured
robot bringup initializes its SyncTable; recovery from every failure or initial
state has not been validated on real hardware. The controller detail view lists
internal IDs and direct readings; top-level counts also include configured hand motors.
The UI prevents starting a check while bringup is running; the standalone CLI
has no such guard. Do not run the check concurrently with another bus owner.

The CLI does **not** check or stop bringup. Stop existing users of the bus before
running it. Port-open success is not evidence that another program is absent.
The cooperative per-device lock only coordinates this diagnostic program and the
updated robot-port-mapper; it cannot exclude an arbitrary external SDK program.

The worker uses PING and READ and one restricted write: setting the known HX5
Table Sync Enable register to 0. It does not write torque, indirect addresses,
limits, or other device settings.
Broadcast ping runs once per bus at startup; expected IDs are also pinged
individually. Additional devices are identified, not automatically read as motors.
Discovery is not proof that every physical device was found, nor a duplicate-ID
detector. Virtual IDs remain configuration-only entries linked to their controller.

## Interpretation

The result separates process state (`starting`, `running`, `completed`, `stopped`,
`failed`) from measured health (`ok`, `warning`, `error`, `unknown`). Overall health
covers expected direct devices, not additional discoveries or excluded systems.
Supported expected sensors/controllers also expose raw board registers (see below).
An unknown model is shown by number; register addresses are never guessed. Missing expected model numbers in
URDF do not imply an identity-match check was performed.

Motors report model-specific error registers, voltage and supported temperatures.
Y-series inverter and motor temperatures are separate. Judgments use limits read
from the device, not a claim that its configuration matches a manufacturer rating.
The 5°C temperature warning margin is a diagnostic policy, configurable in the CLI
with `--temperature-margin`; it is not a device-generated fault. Unsupported error
decoders retain the nonzero raw code rather than assigning an incorrect meaning.
The explicit decoders follow ROBOTIS's
[Y-series Error Code table](https://emanual.robotis.com/docs/en/dxl/y/ym070-210-b001-rh/#error-code153)
and [X-series Hardware Error Status table](https://emanual.robotis.com/docs/en/dxl/x/xh430-v350/#hardware-error-status70).

Expected boards use an explicit READ allowlist for model IDs 536/600 (SensorXEL
joystick), 537 (FFW G40 IMU), 601 (FFW G10 LED) and 602 (FFW G10 RCU). The installed
`cyclo_manager/diagnostics/boards.yaml` lists supported model numbers and permitted
field names; the installed model table supplies their addresses and sizes. The
model number must resolve to the configured model name in `dynamixel.model`.
Invalid or duplicate YAML settings fail startup rather than enabling unintended
reads. The agent installation requires PyYAML from `requirements-agent.txt`.
Missing,
duplicate, or invalid scalar definitions are skipped individually and reported;
unknown models remain identification-only. Additional discoveries are not read.
Common fields are Error_Code, firmware major/minor and Millis. RCU adds E-stop,
system/connection states, board temperature and uptime counters; IMU adds its
timestamp and raw inertial channels; joystick adds button/axes/acceleration; LED
adds raw RGB/brightness/mode settings. No control registers are written.

Board health uses the configured zero/nonzero policy: a successfully read
`Error_Code` of zero is `ok`; a nonzero code is `error`, without assigning
unverified bit meanings. Protocol hardware alerts still produce `error`.
Failed reads, missing codes, unsupported layouts and stale UI readings do not
produce a healthy verdict. The UI also applies this policy to fresh raw codes
from older workers. Other board values remain `raw`: enum polarity and physical
units are not inferred from names. The RCU subordinate motor connection fields are skipped because the upstream
model file repeats the same name for all three, so they cannot be identified by name.
Subordinate motor telemetry is not read. IMU timestamp changes are observed; an
unchanged timestamp for at least five seconds is shown as an observation, not a
sensor-failure verdict. Failed reads/PING invalidate cached board data and activity.
The device UI hides stale values and separates raw board codes from motor decoders.
These are additional fields; existing stored sessions need a new run to
collect board telemetry after updating the worker in the AI Worker container.

Failed reads keep the last successful measurement and its timestamp, marked
`read_error`. The UI hides these as current measurements; live values older than
three seconds are stale. Unknown/unread required motor fields cannot produce an
OK verdict. In watch mode, each physical port has one worker that owns and
serializes its serial transactions. Different ports run independently. From the
first responding device onward, due refreshes are interleaved with identification
of the remaining devices; there is no global initial-scan barrier. An unidentified
or nonresponding device gets one PING attempt per turn, with failed devices
eligible for retry after five seconds. At most four overdue refreshes precede
the next pending probe, so discovery cannot starve on a busy bus. Known devices
become eligible for another read one second after their previous check completes.
This is not a guaranteed real-time frequency; shared-bus traffic and timeouts can
delay reads. A disconnected serial port is closed; restart the diagnostic session
after reconnecting it. The one-shot CLI retains three initial PING attempts.

Exit codes: 0 = completed checks OK/warning, 1 = failed/incomplete checks,
2 = configuration/runtime failure. Watch mode prints a final snapshot on signal.

## Manager integration

Open **Diagnostics**, select the AI Worker container and one robot model, review
the per-system ports, then start. The UI checks both AI Worker bringup services
and disables starting while either is up or their status is unknown. System's UI
also disables bringup starts during a diagnostic session. These are UI guards,
not server/API/CLI enforcement; service control code remains unchanged.

The visual diagnostic page shows response counts, attention items and inspected
ports. Select a motor ID on the robot illustration to
inspect its voltage, temperatures, error registers and last response. The list
view supports name/ID/model search and body-region or attention filters. The top
configuration panel shows an inline type selector with the inspection action beside
it, its Xacro source immediately
below, then an inspection list with inspection actions. Each row combines the
expected device counts for that connection, port, baud rate and edit controls.
The inspection list uses compact inline controls, with one line per connection
and no column headers. Counts include only configured direct targets, excluding
virtual devices and additional discoveries. The
inspection action remains beside the type selector. Readable group labels and original system names
remain in the per-connection detail table. Change reveals both editable
fields; Restore defaults restores both Xacro values. Overrides apply only to the
next inspection and editing is disabled while diagnostics run. Baud rates must be
positive integers; unsupported SDK/adapter speeds surface as connection failures.
The Detail button beside Change opens a floating, scrollable table of configured
names, IDs and kinds without resizing the settings panel. It contains no caption
or system footer; outside clicks and Escape dismiss it. Configured model numbers are omitted
from this UI; model-mismatch checks remain unchanged. Inactive scope comes from the selected profile preview, not a saved
session; edits update the planned connection settings immediately. Live scope uses the running session
configuration and excludes additional discoveries from expected device counts.
There is no separate summary card. A compact line above the robot map shows the
inspection state, responding device count and a clickable attention count. Clicking
attention opens the filtered device list and clears any previous search. Results remain
visible while stopping. Once the worker stops, the page clears measurements, errors,
additional discoveries and filters, and returns configured devices to an uninspected
state. The selected type, port overrides and baud rates remain. Polling or reopening
the page does not restore completed results; revision metadata rejects late live updates.
Delayed live updates are labelled explicitly. Temperature readings remain in device details. The robot map
opens device details on the right; sensors/controllers, other motors and additional
discoveries have separate selectable trays below the image. Narrow layouts stack
the communication fields and device details. Raw registers remain available in
expandable device-detail panels; the bottom scope and excluded-device panel is omitted.
Live and not-yet-inspected states are explicitly distinguished; failed or stale reads
are never presented as fresh values. Worker startup/runtime failures still show their
error message, while completed measurement data is not displayed.

The header uses one inspection-in-progress state from the first snapshot. Device
markers remain pending until checked, then update continuously as replies arrive.
There is no phase transition that resets counts or temporarily exempts old readings
from expiration. A live measurement older than three seconds is stale, even if
another device or field is still responding. Explicit read failures and hardware
errors appear immediately. The UI does not modify measurement timestamps or treat
missing readings as valid. Map markers, response counts, device lists and motor/board
details share this rule. New scheduling applies to workers started after deployment;
an already running worker is not automatically restarted by updating the UI.

Port failures are shown prominently below the compact status line with the failed paths,
a plain-language cause, expandable original errors and a shortcut to port settings.
Devices behind a failed port are unconfirmed, not diagnosed as faulty motors.
Their repeated errors are omitted from the separate device attention panel.
Response, identification, hardware errors, voltage and temperature remain available
in device details rather than a separate preflight checklist.

The image is a schematic location guide, not a live pose or an exact rendering
of every model. `diagnosticView.ts` maps reviewed AI Worker motor names/IDs to
body regions. Only devices present in the selected configuration are drawn.
Leader models use a separate arm schematic; base devices, boards, unrecognized
devices and additional discoveries appear as selectable cards. Additional
discoveries never inherit a motor location from the ID alone. Selection keys
include the physical port so identical IDs on separate buses stay distinct.

The agent starts the same CLI in a child process, sources
`CYCLO_DIAGNOSTICS_SETUP` (default `/root/ros2_ws/install/setup.bash`), and retains
the current session. Closing a browser or restarting the Manager proxy does not
stop the worker. Reconnecting reads the existing session and subscribes to it.
Stop explicitly before bringup. Agent shutdown or loss of its parent pipe stops
the worker. An unresponsive worker is terminated and its session marked failed.
Agent/container restarts do not automatically restart diagnostics. The current
session and last summary are memory-only at the agent. The page only exposes live
results while the check is running. There is no
time-series database or unlimited log buffer.

Public Manager endpoints:

- `GET /{container}/diagnostics/profiles`
- `GET /{container}/diagnostics/profiles/{profile}` (configuration preview)
- `POST /{container}/diagnostics/sessions` with `{"profile":"w1","ports":{}}`
- `GET /{container}/diagnostics/sessions/current`
- `POST /{container}/diagnostics/sessions/{id}/stop`
- `WS /ws/{container}/diagnostics/{id}` (`ready`, then `snapshot` events)

The agent exposes equivalent HTTP routes without the container prefix and an
NDJSON `GET /diagnostics/sessions/{id}/stream`. Stream subscribers never own the worker lifetime.
Only one managed session runs per container. A direct CLI session is independently
managed in its terminal; it is not adopted by the UI.

## Deployment and checks

Update the Manager backend, UI **and the copy of `cyclo_manager` in the AI Worker
image**. Updating only the Manager container does not update `/opt/cyclo_manager`
inside the robot container. The AI Worker image already clones the Manager repo;
build it with `--build-arg CYCLO_MANAGER_REF=<published-commit-containing-diagnostics>`
and use the corresponding updated `robot_port_mapper.py`. Both AI Worker Dockerfiles check that the port mapper can import its diagnostic lock
at build time. Unpublished local
changes must first be made available to that checkout before building a release.
Older agents produce an update-required message. Existing
robot description and SDK installations are reused; only their environment must
be loaded for the child. No hardware-interface code changes are required.

```sh
# From the cyclo_manager repository, with requirements-agent.txt and httpx installed:
python3 -m unittest discover -s tests -p 'test_diagnostics*.py' -v
# From cyclo_manager_ui, with Node >=20.9:
npm ci
npx tsc --noEmit
npm run lint
npm run build
```

Tests cover discovery/expected-list comparison, missing and unknown devices,
virtual IDs, multi-bus addressing, unit conversion and X/Y faults, stale reads,
port failures, packet alert handling, duplicate diagnostics, stream disconnects,
malformed worker output and process cleanup. Watch scheduler tests also cover
refreshing during discovery, probe fairness, delayed retries and recovery,
independent ports, per-port ownership, ordered snapshots and cancellation cleanup.
Real-device checks should use a
stopped robot and verify CLI/UI parity, reconnect behavior and port release.

### Verification on 2026-11-18

- Python: 15 tests passed; UI type check, lint and production build passed
  (lint retains five existing warnings outside the changed diagnostic files).
- All profiles supported at the time expanded successfully. This verified
  configuration resolution, not each model's hardware.
- W1, AI Worker image 2.3.4, both bringups down: standalone CLI and the UI-managed
  watch identified 19/19 expected motors with no reported errors. Voltage and
  supported temperatures were within the limits read from those devices.
- UI navigation away and back preserved the same live session. Explicit stop
  released the port; host `fuser` reported no owner. Duplicate managed jobs and
  duplicate CLI access to the same bus were rejected.
- An absent A1 leader port produced an unknown/incomplete result. A managed
  worker with its parent input pipe closed exited as stopped.

Hardware testing used an isolated agent socket inside the AI Worker container,
a separate Manager backend and a local UI. Production services/images were not
replaced. A1/A2/LG2 and SH5/BH5 hardware were not connected for this verification.

Board telemetry extension verification (2026-11-19):
- 23 Python tests passed, including raw zero/nonzero codes, repeated RCU field
  names, unknown/changed model layouts, read/PING failure invalidation, timestamp
  observations, packet alerts and model changes.
- Component-render checks covered raw/zero presentation, stale/offline/failed
  reads, stored results and board-specific labels; four board detail views were
  visually checked with explicitly labeled synthetic data.
- UI lint, TypeScript and production build passed.
- The temporary review worker in the robot's AI Worker container was updated.
  All five allowlisted model IDs matched its installed model tables. No board
  serial reads or new diagnostic sessions were started for this verification;
  physical firmware behavior and error-bit definitions remain unverified.

Baud-rate override validation: 26 diagnostic unit tests pass, including CLI validation,
worker argument forwarding, transport configuration, default preservation and shared-port
conflict rejection. Agent request validation rejects zero, negatives, fractions,
booleans and string baud values.
