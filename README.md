# cyclo_manager

Central control server for ROS2-based robot containers. It integrates with s6-overlay agents and exposes a FastAPI REST API, WebSocket, and web UI.

## Overview

cyclo_manager provides the following through a single API:

- **Container/service control**: List, status, and start/stop/restart services via s6-overlay agents
- **Docker control**: List containers, status, start/stop, and logs
- **ROS2**: Topic subscription and real-time data streaming
- **Real-time logs**: Service log streaming over WebSocket

Each robot container exposes an s6 agent over a Unix Domain Socket; cyclo_manager controls them through these sockets.

## Architecture
```text
┌─────────────────────────────────────────────────────────┐
│  cyclo_manager container                                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  FastAPI REST API (port 8081)                     │  │
│  │  - /containers                                    │  │
│  │  - /{container}/services                          │  │
│  │  - /{container}/services/{svc}/status             │  │
│  │  - /{container}/services/{svc}                    │  │
│  │  - /docker/...                                    │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                          │ (httpx over Unix sockets)    │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Agent Client Pool                                │  │
│  │  - /agents/ai_worker/s6_agent.sock                │  │
│  │  - /agents/<other>/s6_agent.sock                  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          │ (Docker volumes)
                          ▼
                ┌──────────────────────┐
                │   ai_worker          │
                │   (or other robot)   │
                │   container          │
                │                      │
                │  ┌───────────────┐   │
                │  │ s6-agent      │   │
                │  │ HTTP over UDS │   │
                │  └───────────────┘   │
                └──────────────────────┘
```

## Repository structure

```
cyclo_manager/
├── cyclo_manager/              # Backend (FastAPI)
│   ├── api.py
│   ├── routers/        # root, containers, services, docker, ros2, websocket
│   ├── agent_client.py
│   └── ...
├── cyclo_manager_ui/           # Web UI (Next.js)
├── cyclo_manager_cli/          # CLI package (pip install → cyclo_manager up / cyclo_manager down)
├── config.yml          # Default config (containers, sockets, ROS2 topics, etc.)
├── docker-compose.dev.yml  # Development stack (hot reload; repo root)
├── cyclo_manager_cli/cyclo_manager_cli/docker/docker-compose.yml  # Packaged/production-style compose (used by `cyclo_manager up`)
├── requirements.txt
└── README.md
```

## Running cyclo_manager

Install cyclo_manager CLI:
```bash
pip install cyclo-manager
```

Run cyclo_manager:
```bash
cyclo_manager up
```

- Uses the bundled `config/config.yml` by default.
- Use `cyclo_manager up -c /path/to/config.yml` to specify a config file.
- Use `cyclo_manager down` to stop the stack.

See [cyclo_manager_cli/README.md](cyclo_manager_cli/README.md) for more options.

- **containers**: Map of container name → config.
- **socket_path**: Path to the agent UDS as seen by the cyclo_manager process (or container).

## API summary

- **Docs**: `http://localhost:8081/docs` (Swagger), `http://localhost:8081/redoc` (ReDoc)
- **Schema**: `http://localhost:8081/openapi.json`

| Area | Path | Description |
|------|------|-------------|
| Root | `GET /` | API metadata |
| Containers | `GET /containers` | List configured containers |
| Services | `GET /{container}/services` | List services |
| | `GET /{container}/services/{service}/status` | Service status |
| | `POST /{container}/services/{service}` | Control service (up/down/restart) |
| | `GET /{container}/services/{service}/logs` | Get logs |
| Docker | `GET /docker/containers` | List Docker containers |
| | `GET /docker/{name}/status` | Container status |
| | `POST /docker/{name}` | Control container |
| | `GET /docker/{name}/logs` | Container logs |
| ROS2 | `GET /{container}/ros2/topics` | List topics |
| | `GET /{container}/ros2/topics/{topic}` | Topic data |
| WebSocket | `WS /ws/{container}/services/{service}/logs` | Service log streaming |
| | `WS /ws/{container}/ros2/topics/{topic}` | ROS2 topic streaming |

Docker endpoints only work when `/var/run/docker.sock` is accessible; otherwise they return 503.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## License

See the [LICENSE](LICENSE) file.
