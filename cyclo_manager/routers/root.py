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

"""Root endpoint router."""

from fastapi import APIRouter

router = APIRouter(tags=["root"])


@router.get(
    "/",
    summary="API Information",
    description="Get API information and links to documentation",
    response_description="API metadata and documentation links",
)
async def root():
    """Root endpoint with API information and documentation links.

    Returns:
        API metadata including version and links to interactive documentation.
    """
    return {
        "message": "cyclo_manager API",
        "version": "0.1.0",
        "docs": {
            "swagger_ui": "/docs",
            "redoc": "/redoc",
            "openapi_schema": "/openapi.json",
        },
        "description": "Unified REST API for managing ROS2-based robot containers",
    }

