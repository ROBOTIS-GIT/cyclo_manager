"""Service endpoints router."""

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from cyclo_manager.state import get_validated_container, get_agent_client
from cyclo_manager.models import (
    ServiceListResponse,
    ServiceInfo,
    ServiceStatusResponse,
    ServiceStatusListResponse,
    ServiceLogsResponse,
    ServiceLogsClearResponse,
    ServiceRunScriptResponse,
    ServiceRunScriptUpdateRequest,
    ServiceActionRequest,
    ServiceControlResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/{container}/services", tags=["services"])


def _get_upstream_error_detail(exc: httpx.HTTPStatusError) -> str:
    """Extract readable error detail from upstream agent HTTP response."""
    try:
        payload = exc.response.json()
        if isinstance(payload, dict):
            return payload.get("error") or payload.get("detail") or exc.response.text
    except Exception:
        pass
    return exc.response.text or str(exc)


def _raise_mapped_service_exception(container: str, exc: Exception) -> None:
    """Map internal/upstream exceptions to accurate API HTTP responses."""
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, httpx.HTTPStatusError):
        upstream_status = exc.response.status_code
        detail = _get_upstream_error_detail(exc)
        raise HTTPException(
            status_code=upstream_status,
            detail=(
                f"Agent error for container '{container}': {detail}"
                if detail
                else f"Agent request failed for container '{container}'"
            ),
        )
    if isinstance(exc, httpx.RequestError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to communicate with agent: {str(exc)}",
        )
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Internal error while processing service request: {str(exc)}",
    )


@router.get("", response_model=ServiceListResponse)
async def list_services(
    container: str = Depends(get_validated_container),
) -> ServiceListResponse:
    """Get list of services for a specific container."""
    try:
        client = get_agent_client(container)
        agent_response = await client.get_services()
        agent_services = agent_response.get("services", [])

        services = [
            ServiceInfo(id=service_id, label=service_id)
            for service_id in agent_services
        ]

    except Exception as e:
        logger.error(f"Failed to get services from agent for container '{container}': {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceListResponse(container=container, services=services)


@router.get("/{service}/status", response_model=ServiceStatusResponse)
async def get_service_status(
    service: str,
    container: str = Depends(get_validated_container),
) -> ServiceStatusResponse:
    """Get status of a specific service in a container."""
    try:
        client = get_agent_client(container)
        agent_response = await client.get_service_status(service)
    except Exception as e:
        logger.error(f"Failed to get service status from agent: {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceStatusResponse(
        container=container,
        service=service,
        service_label=service,
        name=agent_response.get("name", service),
        raw=agent_response.get("raw", ""),
        is_up=agent_response.get("is_up", False),
        pid=agent_response.get("pid"),
        uptime_seconds=agent_response.get("uptime_seconds"),
    )


@router.get("/status", response_model=ServiceStatusListResponse)
async def get_all_services_status(
    container: str = Depends(get_validated_container),
) -> ServiceStatusListResponse:
    """Get status of all services in a container."""
    try:
        client = get_agent_client(container)
        agent_response = await client.get_all_services_status()
        agent_statuses = agent_response.get("statuses", [])
    except Exception as e:
        logger.error(f"Failed to get services status from agent: {e}")
        _raise_mapped_service_exception(container, e)

    statuses: list[ServiceStatusResponse] = []
    for agent_status in agent_statuses:
        service_id = agent_status.get("name", "")

        statuses.append(
            ServiceStatusResponse(
                container=container,
                service=service_id,
                service_label=service_id,
                name=agent_status.get("name", service_id),
                raw=agent_status.get("raw", ""),
                is_up=agent_status.get("is_up", False),
                pid=agent_status.get("pid"),
                uptime_seconds=agent_status.get("uptime_seconds"),
            )
        )

    return ServiceStatusListResponse(container=container, statuses=statuses)


@router.get("/{service}/logs", response_model=ServiceLogsResponse)
async def get_service_logs(
    service: str,
    tail: int = 100,
    container: str = Depends(get_validated_container),
) -> ServiceLogsResponse:
    """Get logs for a service in a container."""
    try:
        client = get_agent_client(container)
        agent_response = await client.get_service_logs(service, tail=tail)
        logger.info(f"Successfully retrieved logs for service '{service}' in container '{container}'")
    except Exception as e:
        logger.error(f"Failed to get service logs from agent: {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceLogsResponse(
        container=container,
        service=service,
        logs=agent_response.get("logs", ""),
        tail=agent_response.get("tail", tail),
        log_path=agent_response.get("log_path"),
    )


@router.delete("/{service}/logs", response_model=ServiceLogsClearResponse)
async def clear_service_logs(
    service: str,
    container: str = Depends(get_validated_container),
) -> ServiceLogsClearResponse:
    """Clear logs for a service in a container."""
    try:
        client = get_agent_client(container)
        agent_response = await client.clear_service_logs(service)
        logger.info(f"Successfully cleared logs for service '{service}' in container '{container}'")
    except Exception as e:
        logger.error(f"Failed to clear service logs from agent: {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceLogsClearResponse(
        container=container,
        service=service,
        message=agent_response.get("message", "Logs cleared successfully"),
        log_path=agent_response.get("log_path"),
    )


@router.get("/{service}/run", response_model=ServiceRunScriptResponse)
async def get_service_run_script(
    service: str,
    container: str = Depends(get_validated_container),
) -> ServiceRunScriptResponse:
    """Get the run script for a service."""
    try:
        client = get_agent_client(container)
        agent_response = await client.get_service_run_script(service)
        logger.info(f"Successfully retrieved run script for service '{service}' in container '{container}'")
    except Exception as e:
        logger.error(f"Failed to get run script from agent: {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceRunScriptResponse(
        container=container,
        service=service,
        path=agent_response.get("path", ""),
        content=agent_response.get("content", ""),
    )


@router.put("/{service}/run", response_model=ServiceRunScriptResponse)
async def update_service_run_script(
    service: str,
    request: ServiceRunScriptUpdateRequest,
    container: str = Depends(get_validated_container),
) -> ServiceRunScriptResponse:
    """Update the run script for a service."""
    if not request.content or not request.content.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content must not be empty",
        )

    try:
        client = get_agent_client(container)
        agent_response = await client.update_service_run_script(service, request.content)
        logger.info(f"Successfully updated run script for service '{service}' in container '{container}'")
    except Exception as e:
        logger.error(f"Failed to update run script via agent: {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceRunScriptResponse(
        container=container,
        service=service,
        path=agent_response.get("path", ""),
        content=agent_response.get("content", ""),
    )


@router.post("/{service}", response_model=ServiceControlResponse)
async def control_service(
    service: str,
    request: ServiceActionRequest,
    container: str = Depends(get_validated_container),
) -> ServiceControlResponse:
    """Control a service (start, stop, or restart)."""
    try:
        client = get_agent_client(container)
        agent_response = await client.control_service(
            service, request.action, request.launch_args, request.robot_type
        )
        logger.info(f"Successfully executed action '{request.action}' on service '{service}' in container '{container}'")
    except Exception as e:
        logger.error(f"Failed to control service via agent: {e}")
        _raise_mapped_service_exception(container, e)

    return ServiceControlResponse(
        container=container,
        service=service,
        action=request.action,
        result=agent_response.get("result", "ok"),
    )
