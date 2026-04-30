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

"""FastAPI application for s6-overlay agent service management API."""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from cyclo_manager.agent.models import ErrorResponse
from cyclo_manager.agent.routers import logs, scripts, services

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="s6 Agent API",
    description="""
    REST API for managing s6-overlay services within a container.

    This agent provides endpoints to list, check status, and control
    s6-overlay services running in the container.
    """,
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """Custom exception handler for HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(error=exc.detail or "Unknown error").model_dump(),
    )

@app.get("/", tags=["root"])
async def root():
    """Root endpoint."""
    return {"message": "s6 Agent API", "version": "0.1.0"}

# Include routers
app.include_router(services.router)
app.include_router(logs.router)
app.include_router(scripts.router)
