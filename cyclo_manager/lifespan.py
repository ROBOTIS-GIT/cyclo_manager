"""Lifespan management for FastAPI app."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from cyclo_manager.agent_client import AgentClientPool
from cyclo_manager.config import load_config
from cyclo_manager.docker_client import DockerClient
from cyclo_manager.state import (
    set_config,
    set_client_pool,
    set_docker_client,
    set_ros2_node,
    get_client_pool,
    get_docker_client,
    get_ros2_nodes,
    clear_ros2_nodes,
)
from cyclo_manager.ros2_node import CycloManagerTopicSubscriber

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app.

    Loads configuration and initializes agent client pool and Docker client on startup.
    Cleans up on shutdown.
    """
    # Startup
    logger.info("Starting cyclo_manager...")
    try:
        config = load_config()
        set_config(config)

        client_pool = AgentClientPool(config)
        set_client_pool(client_pool)

        # Initialize Docker client (optional - may fail if socket not available)
        try:
            docker_client = DockerClient()
            logger.info("Docker client initialized successfully")
            set_docker_client(docker_client)
        except Exception as e:
            logger.warning(f"Docker client initialization failed (Docker operations will be unavailable): {e}")
            set_docker_client(None)

        # Initialize ROS2 nodes for all containers (no subscriptions yet)
        domain_id = int(os.getenv("ROS_DOMAIN_ID", "30"))
        for container_name in config.containers:
            try:
                node = CycloManagerTopicSubscriber(container_name=container_name, domain_id=domain_id)
                node.start()
                set_ros2_node(container_name, node)
                logger.info("ROS2 node initialized for container '%s'", container_name)
            except Exception as e:
                logger.warning("ROS2 node initialization failed for container '%s': %s", container_name, e)

        logger.info("cyclo_manager initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize cyclo_manager: {e}")
        raise

    yield

    # Shutdown
    logger.info("Shutting down cyclo_manager...")
    client_pool = get_client_pool()
    if client_pool:
        await client_pool.close_all()

    docker_client = get_docker_client()
    if docker_client:
        docker_client.close()

    # Stop all ROS2 nodes
    nodes = get_ros2_nodes()
    for container_name, node in nodes.items():
        try:
            node.stop()
            logger.debug("Stopped ROS2 node for container '%s'", container_name)
        except Exception as e:
            logger.error("Error stopping ROS2 node for container '%s': %s", container_name, e)
    clear_ros2_nodes()

    logger.info("cyclo_manager shut down")

