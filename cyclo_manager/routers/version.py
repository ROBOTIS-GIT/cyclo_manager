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

"""cyclo_manager version check endpoint."""

import logging

from cyclo_manager.models import CycloManagerVersionResponse
from cyclo_manager.utils.versioning import is_newer
from fastapi import APIRouter
import httpx

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/version', tags=['version'])


async def _fetch_latest_from_pypi(package_name: str) -> str:
    """Fetch latest version from PyPI JSON API. Returns empty string on failure."""
    url = f'https://pypi.org/pypi/{package_name}/json'
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            return (data.get('info') or {}).get('version', '').strip() or ''
    except Exception as e:
        logger.warning('Failed to fetch PyPI latest for %s: %s', package_name, e)
        return ''


PYPI_PACKAGE = 'cyclo-manager'


@router.get('', response_model=CycloManagerVersionResponse)
async def get_cyclo_manager_version() -> CycloManagerVersionResponse:
    """Get current cyclo_manager version and latest from PyPI; report if update is available."""
    from cyclo_manager import __version__ as current_ver

    latest_ver = await _fetch_latest_from_pypi(PYPI_PACKAGE)
    update_available = bool(
        latest_ver and current_ver != 'unknown' and is_newer(latest_ver, current_ver)
    )
    return CycloManagerVersionResponse(
        current=current_ver,
        latest=latest_ver or 'unknown',
        update_available=update_available,
    )


