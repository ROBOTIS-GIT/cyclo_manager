"""Pydantic models for agent API."""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class ServiceActionRequest(BaseModel):
    """Request body for service control actions."""

    action: Literal["up", "down", "restart"] = Field(
        ...,
        description="Action to perform on the service",
        examples=["restart"],
    )
    launch_args: dict[str, str] | None = Field(
        None,
        description="Launch arguments for ros2 launch (used for up/restart)",
    )
    robot_type: str | None = Field(
        None,
        description="Required for ai_worker_bringup up/restart. Must be 'sg2' or 'bg2'.",
    )


class ServiceStatus(BaseModel):
    """Service status response."""

    name: str = Field(..., description="Service name")
    raw: str = Field(..., description="Raw s6-svstat output")
    is_up: bool = Field(..., description="Whether service is running")
    pid: Optional[int] = Field(None, description="Process ID if running")
    uptime_seconds: Optional[int] = Field(None, description="Uptime in seconds if running")


class ServiceListResponse(BaseModel):
    """Response for GET /services."""

    services: list[str] = Field(..., description="List of available service names")


class ServiceStatusListResponse(BaseModel):
    """Response for GET /services/status."""

    statuses: list[ServiceStatus] = Field(..., description="List of service statuses")


class ServiceControlResponse(BaseModel):
    """Response for POST /services/{name}."""

    name: str = Field(..., description="Service name")
    action: Literal["up", "down", "restart"] = Field(..., description="Action that was performed")
    result: str = Field(default="ok", description="Result of the action")


class ErrorResponse(BaseModel):
    """Error response model."""

    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Additional error details")


class ServiceRunScriptResponse(BaseModel):
    """Response for GET /services/{name}/run."""

    service: str = Field(..., description="Service name")
    path: str = Field(..., description="Filesystem path to the service run script")
    content: str = Field(..., description="Contents of the run script")


class ServiceRunScriptUpdateRequest(BaseModel):
    """Request body for updating a service run script."""

    content: str = Field(..., description="New contents of the run script")

