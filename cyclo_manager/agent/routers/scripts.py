"""Router for service run script management endpoints."""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/services", tags=["services"])


@router.get(
    "/{name}/run",
    summary="Get service run script",
    description="Read the s6-overlay service 'run' script for editing",
)
async def get_service_run_script(name: str):
    """Get the run script for a service.

    Reads the run script from /etc/s6-overlay/s6-rc.d/{service_name}/run.
    This is the script that s6-overlay executes to start the service.

    Args:
        name: Service name.

    Returns:
        Dictionary with service name, script path, and content.

    Raises:
        HTTPException: 404 if service/script not found, 500 on other errors.
    """
    # s6-overlay run scripts are in /etc/s6-overlay/s6-rc.d/{service_name}/run
    run_path = Path(f"/etc/s6-overlay/s6-rc.d/{name}/run")

    if not run_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run script not found for service '{name}' at {run_path}. Service may not exist or run script is missing.",
        )

    try:
        content = run_path.read_text(encoding="utf-8")
        return {
            "service": name,
            "path": str(run_path),
            "content": content,
        }
    except Exception as e:
        logger.error(f"Failed to read run script for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read run script: {str(e)}",
        )


@router.put(
    "/{name}/run",
    summary="Update service run script",
    description="Update the s6-overlay service 'run' script",
)
async def update_service_run_script(name: str, request: dict):
    """Update the run script for a service.

    Writes new content to /etc/s6-overlay/s6-rc.d/{service_name}/run.
    Note: Changes take effect after service restart.

    Args:
        name: Service name.
        request: Dictionary with 'content' key containing new script content.

    Returns:
        Dictionary with service name, script path, and updated content.

    Raises:
        HTTPException: 400 if content is invalid, 404 if service not found, 500 on write errors.
    """
    content = request.get("content")
    if not content or not isinstance(content, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content must be a non-empty string",
        )

    # s6-overlay run scripts are in /etc/s6-overlay/s6-rc.d/{service_name}/run
    run_path = Path(f"/etc/s6-overlay/s6-rc.d/{name}/run")

    if not run_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run script not found for service '{name}' at {run_path}. Service may not exist or run script is missing.",
        )

    try:
        # Write new content to the run script
        run_path.write_text(content, encoding="utf-8")
        # Make sure it's executable
        run_path.chmod(0o755)

        logger.info(f"Successfully updated run script for service '{name}'")
        return {
            "service": name,
            "path": str(run_path),
            "content": content,
        }
    except Exception as e:
        logger.error(f"Failed to write run script for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write run script: {str(e)}",
        )

