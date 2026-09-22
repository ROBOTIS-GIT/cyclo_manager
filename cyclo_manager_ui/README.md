# cyclo_manager UI

Next.js web UI for Cyclo Manager: robot bringup, Jog, Record & Play, ROS topics,
Docker/host management, terminals and files, with desktop and mobile layouts.

- [UI guide](README_UI.md): features, development, API address configuration and deployment.
- [Stack README](../README.md): installation, configuration and API overview.
- [Jog](../docs/jog.md): controls, robot profiles, feedback and stop behavior.
- [Record & Play](../docs/record-play.md): recording storage, playback and repetition.
- [Code structure](../docs/code-structure.md): modules and validation commands.

From this directory, with Node.js 24 and the manager API available:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. If the API is on a different host, configure its
[browser-reachable address](README_UI.md#api-address) before starting the UI.
