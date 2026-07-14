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

"""Pydantic models for cyclo_manager API and configuration."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ServiceInfo(BaseModel):
    """Service information from configuration."""

    id: str = Field(  # noqa: A003
        ...,
        description='Service identifier (matches s6 service name)',
        examples=['ai_worker_bringup'],
    )
    label: str = Field(
        ..., description='Human-readable service label', examples=['AI Worker Bringup']
    )


class SystemConfig(BaseModel):
    """Root configuration model."""

    robot_container: str = Field(
        default='ai_worker',
        description='Name of the robot container managed by cyclo_manager',
    )
    sockets: dict[str, str] = Field(
        default_factory=dict,
        description='Map of container/service names to their Unix domain socket paths',
    )

    @property
    def container_sockets(self) -> dict[str, str]:
        """Socket paths for all containers (excludes host_agent)."""
        return {k: v for k, v in self.sockets.items() if k != 'host_agent'}

    @property
    def host_agent_socket(self) -> str:
        """Socket path for the host agent."""
        return self.sockets.get('host_agent', '/agents/host/host_agent.sock')

    @model_validator(mode='after')
    def validate_config(self) -> 'SystemConfig':
        containers = self.container_sockets
        if not containers:
            raise ValueError(
                'sockets must include at least one container entry (besides host_agent)',
            )
        if not self.robot_container.strip():
            raise ValueError('robot_container must not be empty')
        if self.robot_container == 'host_agent':
            raise ValueError('robot_container cannot be host_agent')
        if self.robot_container not in containers:
            raise ValueError(
                f"robot_container '{self.robot_container}' must be a key in sockets "
                f'(excluding host_agent); available: {sorted(containers)}',
            )
        for name, path in self.sockets.items():
            if not name.strip():
                raise ValueError('sockets keys must not be empty')
            if not str(path).strip():
                raise ValueError(f"sockets['{name}'] must not be empty")
        return self


# API Request/Response Models


class ServiceActionRequest(BaseModel):
    """Request body for service control actions."""

    action: Literal['up', 'down', 'restart'] = Field(
        ...,
        description='Action to perform on the service',
        examples=['restart'],
    )
    launch_args: dict[str, str] | None = Field(
        None,
        description='Launch arguments for ros2 launch (used for up/restart)',
    )
    robot_type: str | None = Field(
        None,
        description=(
            'Required for ai_worker_bringup up/restart. '
            'One of: sg2, bg2, sh5, bh5, mobile.'
        ),
    )


class ConfiguredContainerInfo(BaseModel):
    """Container information for API responses (from config)."""

    name: str = Field(..., description='Container name', examples=['ai_worker'])
    socket_path: str = Field(
        ..., description='Path to agent socket', examples=['/agents/ai_worker/s6_agent.sock']
    )


class ConfiguredContainerListResponse(BaseModel):
    """Response for GET /containers."""

    containers: list[ConfiguredContainerInfo] = Field(..., description='List of known containers')
    robot_container: str = Field(..., description='Name of the robot container')


class ServiceListResponse(BaseModel):
    """Response for GET /containers/{container}/services."""

    container: str = Field(..., description='Container name')
    services: list[ServiceInfo] = Field(..., description='List of services in the container')


class ServiceStatusResponse(BaseModel):
    """
    Response for GET /containers/{container}/services/{service}/status.

    This wraps the agent's service status response with container/service metadata.
    """

    container: str = Field(..., description='Container name')
    service: str = Field(..., description='Service ID')
    service_label: Optional[str] = Field(None, description='Service label from config')
    # Agent response fields (from agent's /services/{name}/status)
    name: str = Field(..., description='Service name (from agent)')
    raw: str = Field(..., description='Raw s6-svstat output')
    is_up: bool = Field(..., description='Whether service is running')
    pid: Optional[int] = Field(None, description='Process ID if running')
    uptime_seconds: Optional[int] = Field(None, description='Uptime in seconds if running')


class ServiceStatusListResponse(BaseModel):
    """
    Response for GET /containers/{container}/services/status.

    Returns status for all services in a container in a single request.
    """

    container: str = Field(..., description='Container name')
    statuses: list[ServiceStatusResponse] = Field(..., description='List of service statuses')


class ServiceControlResponse(BaseModel):
    """Response for POST /containers/{container}/services/{service}."""

    container: str = Field(..., description='Container name')
    service: str = Field(..., description='Service ID')
    action: Literal['up', 'down', 'restart'] = Field(..., description='Action that was performed')
    result: str = Field(default='ok', description='Result of the action')


class ErrorResponse(BaseModel):
    """Error response model."""

    error: str = Field(..., description='Error message')
    detail: Optional[str] = Field(None, description='Additional error details')


# Docker Container Models


class DockerContainerInfo(BaseModel):
    """Docker container information."""

    id: str = Field(..., description='Container ID', examples=['abc123def456'])  # noqa: A003
    name: str = Field(..., description='Container name', examples=['ai_worker'])
    status: str = Field(..., description='Container status', examples=['running'])
    image: str = Field(..., description='Container image', examples=['robotis/ai-worker:latest'])
    created: str = Field(..., description='Container creation timestamp')


class DockerContainerStatus(BaseModel):
    """Detailed Docker container status."""

    id: str = Field(..., description='Container ID')  # noqa: A003
    name: str = Field(..., description='Container name')
    status: str = Field(..., description='Container status')
    state: str = Field(..., description='Container state (running, stopped, etc.)')
    running: bool = Field(..., description='Whether container is running')
    restarting: bool = Field(..., description='Whether container is restarting')
    paused: bool = Field(..., description='Whether container is paused')
    image: str = Field(..., description='Container image')
    created: str = Field(..., description='Container creation timestamp')
    started_at: Optional[str] = Field(None, description='Container start timestamp')
    finished_at: Optional[str] = Field(None, description='Container finish timestamp')
    exit_code: Optional[int] = Field(None, description='Container exit code if stopped')


class DockerContainerListResponse(BaseModel):
    """Response for GET /docker/containers."""

    containers: list[DockerContainerInfo] = Field(..., description='List of Docker containers')


class DockerContainerActionRequest(BaseModel):
    """Request body for Docker container control actions."""

    action: Literal['start', 'stop', 'restart'] = Field(
        ...,
        description='Action to perform on the container',
        examples=['restart'],
    )
    timeout: Optional[int] = Field(
        default=10, description='Timeout in seconds for stop/restart actions', examples=[10]
    )


class DockerContainerActionResponse(BaseModel):
    """Response for Docker container control actions."""

    name: str = Field(..., description='Container name')
    action: Literal['start', 'stop', 'restart'] = Field(
        ..., description='Action that was performed'
    )
    result: str = Field(default='ok', description='Result of the action')


class DockerContainerLogsResponse(BaseModel):
    """Response for GET /docker/containers/{name}/logs."""

    container: str = Field(..., description='Container name')
    logs: str = Field(..., description='Container logs')
    tail: int = Field(..., description='Number of log lines returned')


class DockerTopResponse(BaseModel):
    """Response for GET /docker/{name}/top."""

    container: str = Field(..., description='Container name')
    titles: list[str] = Field(..., description='Column names from docker top')
    processes: list[list[str]] = Field(..., description='Process rows')


class CycloManagerVersionResponse(BaseModel):
    """Response for GET /version (cyclo_manager server/CLI version from PyPI)."""

    current: str = Field(..., description='Current cyclo_manager version (API __version__)')
    latest: str = Field(..., description='Latest version from PyPI')
    pypi_available: bool = Field(..., description='Whether the latest PyPI version was fetched')
    update_available: bool = Field(..., description='Whether an update is available')


class ServiceLogsClearResponse(BaseModel):
    """Response for DELETE /containers/{container}/services/{service}/logs."""

    container: str = Field(..., description='Container name')
    service: str = Field(..., description='Service ID')
    message: str = Field(..., description='Success message')
    log_path: Optional[str] = Field(None, description='Path to log file in container')


class ServiceRunScriptResponse(BaseModel):
    """Response for GET /containers/{container}/services/{service}/run."""

    container: str = Field(..., description='Container name')
    service: str = Field(..., description='Service ID')
    path: str = Field(..., description='Filesystem path to the service run script')
    content: str = Field(..., description='Contents of the run script')


class ServiceRunScriptUpdateRequest(BaseModel):
    """Request body for updating a service run script."""

    content: str = Field(..., description='New contents of the run script')


class BashrcResponse(BaseModel):
    """Response for GET /{container}/bashrc."""

    container: str = Field(..., description='Container name')
    path: str = Field(..., description='Path to bashrc file in container')
    content: str = Field(..., description='Contents of ~/.bashrc')


class BashrcUpdateRequest(BaseModel):
    """Request body for PUT /{container}/bashrc."""

    content: str = Field(..., description='New contents of ~/.bashrc')


# ROS2 Plugin Models


class ROS2TopicDataResponse(BaseModel):
    """Response for GET /ros2/topics/{topic}."""

    topic: str = Field(..., description='ROS2 topic name', examples=['/robot_description'])
    msg_type: str = Field(..., description='Message type', examples=['std_msgs/msg/String'])
    data: Optional[Any] = Field(
        None, description='Latest message data if available'
    )
    available: bool = Field(..., description='Whether topic data is available')
    domain_id: int = Field(..., description='ROS2 domain ID used')


class ROS2TopicStatus(BaseModel):
    """Status information for a ROS2 topic."""

    topic: str = Field(..., description='Topic name')
    msg_type: str = Field(..., description='Message type')
    available: bool = Field(..., description='Whether topic has received data')
    subscribed: bool = Field(..., description='Whether subscription is active')


class ROS2TopicsListResponse(BaseModel):
    """Response for GET /ros2/topics."""

    domain_id: int = Field(..., description='ROS2 domain ID')
    topics: list[ROS2TopicStatus] = Field(..., description='List of topic statuses')


class ROS2SubscribeRequest(BaseModel):
    """Request body for POST /ros2/topics/{topic}/subscribe."""

    msg_type: Optional[str] = Field(
        None, description='Message type (e.g. sensor_msgs/msg/JointState)'
    )


class ROS2TwistPublishRequest(BaseModel):
    """Request body for POST /ros2/cmd_vel."""

    linear_x: float = Field(
        0.0,
        description='Forward/backward velocity in m/s',
        examples=[0.3],
    )
    angular_z: float = Field(
        0.0,
        description='Yaw angular velocity in rad/s',
        examples=[0.6],
    )
    topic: str = Field('/cmd_vel', description='Twist topic to publish')


class RobotInfoResponse(BaseModel):
    """Response for GET /system/info."""

    hostname: str
    os_info: Optional[str] = None
    ip_address: Optional[str] = None
    internet_connected: bool = False


class SystemStatsResponse(BaseModel):
    """Response for GET /system/status."""

    cpu_percent: float
    memory_used_mb: int
    memory_total_mb: int
    disk_used_gb: float
    disk_total_gb: float
    uptime_seconds: int
    temperature_celsius: Optional[float] = None
