"""Lifespan management for FastAPI app."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from cyclo_manager.agent_client import AgentClientPool
from cyclo_manager.config import load_config
from cyclo_manager.docker_client import DockerClient
from cyclo_manager.ros2_node import CycloManagerTopicSubscriber
from cyclo_manager.state import app_state

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app."""
    # Startup
    logger.info("Starting cyclo_manager...")
    try:
        config = load_config()
        app_state.set_config(config)

        client_pool = AgentClientPool(config)
        app_state.set_client_pool(client_pool)

        # Docker client is optional — may fail if socket is not mounted.
        try:
            docker_client = DockerClient()
            logger.info("Docker client initialized successfully")
            app_state.set_docker_client(docker_client)
        except Exception as e:
            logger.warning(
                "Docker client initialization failed (Docker operations will be unavailable): %s", e
            )
            app_state.set_docker_client(None)

        # Initialize ROS2 nodes for all containers (no subscriptions yet).
        domain_id = int(os.getenv("ROS_DOMAIN_ID", "30"))
        for container_name in config.containers:
            try:
                node = CycloManagerTopicSubscriber(
                    container_name=container_name, domain_id=domain_id
                )
                node.start()
                app_state.set_ros2_node(container_name, node)
                logger.info("ROS2 node initialized for container '%s'", container_name)
            except Exception as e:
                logger.warning(
                    "ROS2 node initialization failed for container '%s': %s", container_name, e
                )

        logger.info("cyclo_manager initialized successfully")
    except Exception as e:
        logger.error("Failed to initialize cyclo_manager: %s", e)
        raise

    yield

    # Shutdown
    logger.info("Shutting down cyclo_manager...")

    client_pool = app_state.get_client_pool_or_none()
    if client_pool:
        await client_pool.close_all()

    docker_client = app_state.get_docker_client_or_none()
    if docker_client:
        docker_client.close()

    for container_name, node in app_state.get_ros2_nodes().items():
        try:
            node.stop()
            logger.debug("Stopped ROS2 node for container '%s'", container_name)
        except Exception as e:
            logger.error("Error stopping ROS2 node for container '%s': %s", container_name, e)
    app_state.clear_ros2_nodes()

    logger.info("cyclo_manager shut down")
