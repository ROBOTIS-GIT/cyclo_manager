"""cyclo_manager version check and update (PyPI + pip + cyclo_manager up)."""

import logging
import shutil
import subprocess

import httpx
from fastapi import APIRouter, HTTPException, status

from cyclo_manager.models import CycloManagerVersionResponse
from cyclo_manager.utils.versioning import is_newer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/version", tags=["version"])


async def _fetch_latest_from_pypi(package_name: str) -> str:
    """Fetch latest version from PyPI JSON API. Returns empty string on failure."""
    url = f"https://pypi.org/pypi/{package_name}/json"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
            return (data.get("info") or {}).get("version", "").strip() or ""
    except Exception as e:
        logger.warning("Failed to fetch PyPI latest for %s: %s", package_name, e)
        return ""


PYPI_PACKAGE = "cyclo-manager"


@router.get("", response_model=CycloManagerVersionResponse)
async def get_cyclo_manager_version() -> CycloManagerVersionResponse:
    """Get current cyclo_manager version and latest from PyPI; report if update is available."""
    from cyclo_manager import __version__ as current_ver

    latest_ver = await _fetch_latest_from_pypi(PYPI_PACKAGE)
    update_available = bool(
        latest_ver and current_ver != "unknown" and is_newer(latest_ver, current_ver)
    )
    return CycloManagerVersionResponse(
        current=current_ver,
        latest=latest_ver or "unknown",
        update_available=update_available,
    )


@router.post("/update")
async def update_cyclo_manager() -> dict:
    """Run pip install -U cyclo-manager, then cyclo_manager down and cyclo_manager up (on host).

    Docker pull happens automatically when cyclo_manager up runs. Requires the API to run
    in a context where pip and cyclo_manager commands are available (e.g. on the host).
    """
    # pip install -U cyclo-manager
    pip_exe = shutil.which("pip3") or shutil.which("pip")
    if not pip_exe:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pip not found; cannot run update",
        )
    try:
        subprocess.run(
            [pip_exe, "install", "-U", PYPI_PACKAGE],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.CalledProcessError as e:
        logger.error("pip install -U %s failed: %s", PYPI_PACKAGE, e.stderr or e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"pip install failed: {e.stderr or str(e)}",
        ) from e
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="pip not found",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="pip install timed out",
        )

    # cyclo_manager down
    cyclo_manager_exe = shutil.which("cyclo_manager")
    if not cyclo_manager_exe:
        logger.warning("cyclo_manager command not found; skipping cyclo_manager down / cyclo_manager up")
        return {"message": "Package updated; run 'cyclo_manager down' and 'cyclo_manager up' manually."}
    try:
        subprocess.run(
            [cyclo_manager_exe, "down"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        logger.warning("cyclo_manager down timed out")
    except Exception as e:
        logger.warning("cyclo_manager down failed: %s", e)

    # cyclo_manager up (runs docker compose up -d internally)
    try:
        subprocess.run(
            [cyclo_manager_exe, "up"],
            check=True,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except subprocess.CalledProcessError as e:
        logger.error("cyclo_manager up failed: %s", e.stderr or e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"cyclo_manager up failed: {e.stderr or str(e)}",
        ) from e
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="cyclo_manager up timed out",
        )

    return {"message": "Update completed; cyclo_manager stack restarted."}
