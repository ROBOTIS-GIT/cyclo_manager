#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Author: Hyungyu Kim

"""FastAPI application for cyclo_manager unified REST API."""

import logging

from cyclo_manager import __version__
from cyclo_manager.lifespan import lifespan
from cyclo_manager.models import ErrorResponse
from cyclo_manager.routers import (
    container,
    containers,
    docker,
    host,
    root,
    ros2,
    services,
    system,
    terminal,
    version,
    websocket_logs,
    websocket_ros2,
)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
# Suppress noisy httpx per-request logs (HTTP Request: GET ... 200 OK)
logging.getLogger('httpx').setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

app = FastAPI(
    title='cyclo_manager API',
    description="""
    REST API backend for cyclo_manager.

    Central control plane for ROS2-based robot containers managed with
    s6-overlay. Each container runs an agent over a Unix domain socket;
    the cyclo_manager web UI consumes this API over HTTP.

    ## Capabilities

    * Configured container listing and per-container settings (bashrc)
    * s6-overlay service list, status, control, logs, and run scripts
    * Docker container list, status, control, logs, and process management
    * ROS2 topic discovery, subscription, streaming, and cmd_vel publish
    * WebSocket streaming for service logs and ROS2 topic data
    * Interactive terminal sessions inside Docker containers
    * Host system and robot info; cyclo_manager version check
    * ROS2 workspace repo management via the host agent (clone, update, branch)

    ## API docs

    * Swagger UI: `/docs`
    * ReDoc: `/redoc`
    * OpenAPI schema: `/openapi.json`
    """,
    version=__version__,
    lifespan=lifespan,
    docs_url='/docs',
    redoc_url='/redoc',
    openapi_url='/openapi.json',
)

# Add CORS middleware to allow requests from the UI
app.add_middleware(
    CORSMiddleware,
    # In production, replace with specific origins like ['http://localhost:3000']
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Include routers
app.include_router(root.router)
app.include_router(system.router)
app.include_router(containers.router)
app.include_router(container.router)
app.include_router(services.router)
app.include_router(version.router)
app.include_router(docker.router)
app.include_router(terminal.router)
app.include_router(ros2.router)
app.include_router(websocket_logs.router)
app.include_router(websocket_ros2.router)
app.include_router(host.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """Handle HTTP exceptions with a custom JSON error response."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(error=exc.detail or 'Unknown error').model_dump(),
    )
