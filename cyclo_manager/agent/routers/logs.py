"""Router for log management endpoints."""

import logging
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status

from cyclo_manager.agent.utils import strip_ansi_codes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/services", tags=["services"])


@router.get(
    "/{name}/logs",
    summary="Get service logs",
    description="Retrieve logs for a service from s6-overlay log directory",
)
async def get_service_logs(
    name: str, tail: int = 100, strip_ansi: bool = False, cursor: Optional[int] = None
):
    """Get logs for a service.

    Reads logs from /var/log/{service_name}/current (s6-overlay log directory).
    If the log file doesn't exist or the service doesn't have logging enabled,
    returns an appropriate error.

    Args:
        name: Service name.
        tail: Number of log lines to return from the end. Defaults to 100.
            Ignored if cursor is provided.
        strip_ansi: If True, remove ANSI escape codes (color/formatting) from the output.
        cursor: Byte offset in the log file. If provided, returns logs from this offset
            to the end of the file. This is more efficient for streaming logs.

    Returns:
        Dictionary with service name, logs content, tail count (or cursor), and new cursor.

    Raises:
        HTTPException: 404 if service not found or logs unavailable, 500 on other errors.
    """
    # s6-overlay logs are stored in /var/log/{service_name}/current
    log_path = Path(f"/var/log/{name}/current")

    if not log_path.exists():
        # Return empty logs instead of 404 when log file doesn't exist
        logger.debug(f"Log file not found for service '{name}', returning empty logs")
        return {
            "service": name,
            "logs": "",
            "tail": tail if cursor is None else None,
            "cursor": 0,
            "log_path": str(log_path),
        }

    try:
        # If cursor is provided, read from that offset (more efficient for streaming)
        if cursor is not None:
            # Get current file size for validation
            current_size = log_path.stat().st_size

            if cursor < 0:
                cursor = 0
            if cursor > current_size:
                # Cursor is beyond file size (file was truncated or rotated)
                cursor = current_size
                logger.warning(
                    f"Cursor {cursor} is beyond file size {current_size} for service '{name}', resetting to current size"
                )

            # Read from cursor to end of file
            with log_path.open("rb") as f:
                f.seek(cursor)
                logs_bytes = f.read()
                # IMPORTANT: Get the actual position after reading to prevent duplication
                new_cursor = f.tell()
                logs = logs_bytes.decode("utf-8", errors="replace")

            logs = strip_ansi_codes(logs) if strip_ansi else logs

            return {
                "service": name,
                "logs": logs,
                "cursor": new_cursor,
                "log_path": str(log_path),
            }
        else:
            # Fallback to tail command for backward compatibility
            result = subprocess.run(
                ["tail", "-n", str(tail), str(log_path)],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0:
                logger.error(f"Failed to read logs for service '{name}': {result.stderr}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to read log file: {result.stderr}",
                )

            # Get cursor AFTER tail command finishes to be as accurate as possible
            current_size = log_path.stat().st_size
            logs = strip_ansi_codes(result.stdout) if strip_ansi else result.stdout

            return {
                "service": name,
                "logs": logs,
                "tail": tail,
                "cursor": current_size,
                "log_path": str(log_path),
            }

    except subprocess.TimeoutExpired:
        logger.error(f"Timeout reading logs for service '{name}'")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Timeout reading log file",
        )
    except Exception as e:
        logger.error(f"Error reading logs for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read logs: {str(e)}",
        )


@router.delete(
    "/{name}/logs",
    summary="Clear service logs",
    description="Clear (truncate) logs for a service",
)
async def clear_service_logs(name: str):
    """Clear logs for a service.

    Truncates the log file at /var/log/{service_name}/current to clear all logs.
    Note: s6-log will continue writing new logs to this file after clearing.

    Args:
        name: Service name.

    Returns:
        Dictionary with service name and success message.

    Raises:
        HTTPException: 404 if service not found or logs unavailable, 500 on other errors.
    """
    # s6-overlay logs are stored in /var/log/{service_name}/current
    log_path = Path(f"/var/log/{name}/current")

    if not log_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log file not found for service '{name}'. Service may not have logging enabled or log directory doesn't exist.",
        )

    try:
        # Truncate the log file (clear all contents)
        log_path.open("w").close()
        logger.info(f"Successfully cleared logs for service '{name}'")

        return {
            "service": name,
            "message": "Logs cleared successfully",
            "log_path": str(log_path),
        }
    except Exception as e:
        logger.error(f"Error clearing logs for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear logs: {str(e)}",
        )

