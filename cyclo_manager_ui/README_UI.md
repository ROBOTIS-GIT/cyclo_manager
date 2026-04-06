# cyclo_manager UI

A modern Next.js web interface for managing ROS2-based robot containers and services.

## Features

- **Container Overview**: View all managed containers with their status
- **Service Management**: Start, stop, and restart services with real-time status updates
- **Service Logs**: View and download service logs with auto-refresh
- **Docker Management**: Manage Docker containers directly from the UI

## Development

### Prerequisites

- Node.js 20+
- npm or yarn

### Setup

```bash
cd cyclo_manager_ui
npm install
```

### Run Development Server

```bash
npm run dev
```

The UI will be available at `http://localhost:3000`.

### Build for Production

```bash
npm run build
npm start
```

## Docker Deployment

The UI is configured to run in a Docker container. Build and run using docker-compose:

```bash
cd ..
docker-compose up -d ui
```

The UI will be available at `http://localhost:3000`.

### Environment Variables

- `NEXT_PUBLIC_API_URL`: cyclo_manager API base URL (default: `http://localhost:8081`)
- `NODE_ENV`: Production/development mode

## Architecture

The UI communicates with the cyclo_manager FastAPI backend via HTTP. When running in Docker:

- If both services use `network_mode: host`, set `NEXT_PUBLIC_API_URL=http://localhost:8081`
- If using a Docker network, set `NEXT_PUBLIC_API_URL=http://cyclo_manager:8081`

## Pages

- `/` - Dashboard with container list
- `/containers/[name]` - Container detail with service list
- `/containers/[name]/services/[service]/logs` - Service logs viewer
- `/docker` - Docker container management
