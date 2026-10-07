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

"""HTTP error mapping helpers."""

from fastapi import HTTPException, status
import httpx


def proxy_error(exc: Exception, upstream_name: str = 'upstream service') -> HTTPException:
    """Map upstream HTTP/client errors to FastAPI HTTP exceptions."""
    if isinstance(exc, httpx.RequestError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'{upstream_name} unreachable: {exc}',
        )
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            payload = exc.response.json()
            detail = payload.get('detail', str(exc)) if isinstance(payload, dict) else str(exc)
        except Exception:
            detail = exc.response.text or str(exc)
        return HTTPException(status_code=exc.response.status_code, detail=detail)
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
