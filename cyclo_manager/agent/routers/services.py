"""Router for service management endpoints."""

import logging

from fastapi import APIRouter, HTTPException, status

from cyclo_manager.agent.models import (
    ServiceActionRequest,
    ServiceControlResponse,
    ServiceListResponse,
    ServiceStatus,
    ServiceStatusListResponse,
)
from cyclo_manager.agent.s6_client import (
    control_service,
    get_all_services_status,
    get_service_status,
    list_services,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/services", tags=["services"])


@router.get("", response_model=ServiceListResponse, summary="List all available services")
async def get_services() -> ServiceListResponse:
    """Get list of all available s6 services.

    Returns:
        ServiceListResponse containing a list of service names.

    Raises:
        HTTPException: 500 if service listing fails.
    """
    try:
        services = list_services()
        return ServiceListResponse(services=services)
    except Exception as e:
        logger.error(f"Failed to list services: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list services: {str(e)}",
        )


@router.get(
    "/status",
    response_model=ServiceStatusListResponse,
    summary="Get status of all services",
    description="Get detailed status information for all services in a single request",
)
async def get_all_services_status_endpoint() -> ServiceStatusListResponse:
    """Get status of all services.

    This endpoint is more efficient than calling the individual status endpoint
    for each service, as it processes all services in a single operation.

    Returns:
        ServiceStatusListResponse containing status for all available services.

    Raises:
        HTTPException: 500 if service listing fails.
    """
    try:
        statuses = get_all_services_status()
        return ServiceStatusListResponse(statuses=statuses)
    except Exception as e:
        logger.error(f"Failed to get all services status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get services status: {str(e)}",
        )


@router.get(
    "/{name}/status",
    response_model=ServiceStatus,
    summary="Get service status",
    description="Get detailed status information for a specific service",
)
async def get_service_status_endpoint(name: str) -> ServiceStatus:
    """Get status of a specific service.

    Args:
        name: Service name.

    Returns:
        ServiceStatus with detailed service information.

    Raises:
        HTTPException: 404 if service not found, 500 on other errors.
    """
    try:
        return get_service_status(name)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Service '{name}' not found",
        )
    except Exception as e:
        logger.error(f"Failed to get status for service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get service status: {str(e)}",
        )


@router.post(
    "/{name}",
    response_model=ServiceControlResponse,
    summary="Control a service",
    description="Start, stop, or restart a service",
)
async def control_service_endpoint(
    name: str, request: ServiceActionRequest
) -> ServiceControlResponse:
    """Control a service (start, stop, or restart).

    Args:
        name: Service name.
        request: ServiceActionRequest with action to perform.

    Returns:
        ServiceControlResponse confirming the action.

    Raises:
        HTTPException: 404 if service not found, 400 if action invalid, 500 on other errors.
    """
    try:
        control_service(name, request.action, request.launch_args, request.robot_type)
        return ServiceControlResponse(name=name, action=request.action, result="ok")
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Service '{name}' not found",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.error(f"Failed to control service '{name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to control service: {str(e)}",
        )

