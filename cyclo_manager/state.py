"""Global state management and FastAPI dependencies for cyclo_manager."""

from typing import Optional
from fastapi import HTTPException, status

from cyclo_manager.agent_client import AgentClient, AgentClientPool
from cyclo_manager.config import SystemConfig
from cyclo_manager.docker_client import DockerClient
from cyclo_manager.ros2_node import CycloManagerTopicSubscriber

# Global state (private)
_config: Optional[SystemConfig] = None
_client_pool: Optional[AgentClientPool] = None
_docker_client: Optional[DockerClient] = None
_ros2_nodes: dict[str, CycloManagerTopicSubscriber] = {}


# State setters (for lifespan.py)
def set_config(config: SystemConfig):
    """Set the global configuration."""
    global _config
    _config = config


def set_client_pool(pool: AgentClientPool):
    """Set the global client pool."""
    global _client_pool
    _client_pool = pool


def set_docker_client(client: Optional[DockerClient]):
    """Set the global Docker client."""
    global _docker_client
    _docker_client = client


def set_ros2_node(container_name: str, node: CycloManagerTopicSubscriber):
    """Set a ROS2 node for a container."""
    global _ros2_nodes
    _ros2_nodes[container_name] = node


def get_ros2_nodes() -> dict[str, CycloManagerTopicSubscriber]:
    """Get all ROS2 nodes."""
    return _ros2_nodes


def clear_ros2_nodes():
    """Clear all ROS2 nodes."""
    global _ros2_nodes
    _ros2_nodes.clear()


# FastAPI Dependencies (for endpoints)
def get_config() -> SystemConfig:
    """Get loaded configuration.

    Returns:
        SystemConfig instance.

    Raises:
        HTTPException: If configuration is not loaded.
    """
    if _config is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Configuration not loaded",
        )
    return _config


def get_client_pool() -> AgentClientPool:
    """Get agent client pool.

    Returns:
        AgentClientPool instance.

    Raises:
        HTTPException: If client pool is not initialized.
    """
    if _client_pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent client pool not initialized",
        )
    return _client_pool


def get_docker_client() -> DockerClient:
    """Get Docker client.

    Returns:
        DockerClient instance.

    Raises:
        HTTPException: If Docker client is not available.
    """
    if _docker_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Docker client not available. Ensure Docker socket is mounted.",
        )
    return _docker_client


def get_agent_client(container_name: str) -> AgentClient:
    """Get agent client for a container.

    Args:
        container_name: Name of the container.

    Returns:
        AgentClient instance.

    Raises:
        HTTPException: If container not found or client unavailable.
    """
    config = get_config()
    if container_name not in config.containers:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Container '{container_name}' not found",
        )

    client_pool = get_client_pool()
    client = client_pool.get_client(container_name)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Agent client for container '{container_name}' not available",
        )
    return client


# WebSocket helpers (return None instead of raising HTTPException)
def get_config_or_none() -> Optional[SystemConfig]:
    """Get config without raising HTTPException (for WebSocket handlers).

    Returns:
        SystemConfig if available, None otherwise.
    """
    return _config


def get_client_pool_or_none() -> Optional[AgentClientPool]:
    """Get client pool without raising HTTPException (for WebSocket handlers).

    Returns:
        AgentClientPool if available, None otherwise.
    """
    return _client_pool


def get_ros2_node(container_name: str) -> Optional[CycloManagerTopicSubscriber]:
    """Get ROS2 node for a container.

    Args:
        container_name: Name of the container.

    Returns:
        CycloManagerTopicSubscriber if available, None otherwise.
    """
    if _config is None or container_name not in _config.containers:
        return None
    return _ros2_nodes.get(container_name)

