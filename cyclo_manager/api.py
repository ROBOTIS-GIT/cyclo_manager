"""FastAPI application for cyclo_manager unified REST API."""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cyclo_manager.lifespan import lifespan
from cyclo_manager.models import ErrorResponse
from cyclo_manager.routers import (
    root,
    containers,
    container,
    services,
    version,
    docker,
    ros2,
    websocket,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
# Suppress noisy httpx per-request logs (HTTP Request: GET ... 200 OK)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="cyclo_manager API",
    description="""
    Unified REST API for managing ROS2-based robot containers using s6-overlay.

    This API provides a centralized control plane to manage services across multiple
    robot containers. Each container runs an agent that exposes s6-overlay service
    management via Unix Domain Sockets.

    ## Features

    * List all managed containers
    * List services within each container
    * Get real-time service status
    * Control services (start, stop, restart)
    * Docker container management (list, status, control, logs)
    * ROS2 topic subscription and monitoring

    ## Documentation

    * **Swagger UI**: Available at `/docs` (interactive API testing)
    * **ReDoc**: Available at `/redoc` (alternative documentation)
    * **OpenAPI Schema**: Available at `/openapi.json`
    """,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    tags_metadata=[
        {
            "name": "root",
            "description": "Root endpoint and API information",
        },
        {
            "name": "containers",
            "description": "Operations related to container management. List and inspect containers.",
        },
        {
            "name": "services",
            "description": "Operations related to service management. List services, check status, and control services (start/stop/restart).",
        },
        {
            "name": "docker",
            "description": "Docker container management operations. List containers, get status, control containers, and view logs.",
        },
        {
            "name": "ros2",
            "description": "ROS2 topic operations. Subscribe to ROS2 topics using zenoh_ros2_sdk.",
        },
        {
            "name": "container",
            "description": "Container-level operations (bashrc, etc.).",
        },
        {
            "name": "version",
            "description": "cyclo_manager version check (PyPI) and update (pip + cyclo_manager up).",
        },
    ],
)

# Add CORS middleware to allow requests from the UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins like ["http://localhost:3000"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(root.router)
app.include_router(containers.router)
app.include_router(container.router)
app.include_router(services.router)
app.include_router(version.router)
app.include_router(docker.router)
app.include_router(ros2.router)
app.include_router(websocket.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """Custom exception handler for HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(error=exc.detail or "Unknown error").model_dump(),
    )
