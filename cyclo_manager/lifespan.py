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

"""Lifespan management for FastAPI app."""

import asyncio
from contextlib import asynccontextmanager, suppress
import logging
import os

from cyclo_manager.agent_client import AgentClientPool
from cyclo_manager.config import load_config
from cyclo_manager.docker_client import DockerClient
from cyclo_manager.host_agent_client import HostAgentClient
from cyclo_manager.record_play.service import RecordPlayService
from cyclo_manager.ros2_node import Ros2Bridge
from cyclo_manager.state import app_state
from cyclo_manager.robot.runtime import RobotRuntime
from cyclo_manager.terminal_session_manager import TerminalSessionManager
from fastapi import FastAPI

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app."""
    runtime_task = None
    # Startup
    logger.info('Starting cyclo_manager...')
    try:
        config = load_config()
        app_state.set_config(config)

        client_pool = AgentClientPool(config)
        app_state.set_client_pool(client_pool)

        # Docker client is optional — may fail if socket is not mounted.
        try:
            docker_client = DockerClient()
            logger.info('Docker client initialized successfully')
            app_state.set_docker_client(docker_client)
        except Exception as e:
            logger.warning(
                'Docker client initialization failed '
                '(Docker operations will be unavailable): %s',
                e,
            )
            app_state.set_docker_client(None)

        app_state.set_terminal_session_manager(TerminalSessionManager())
        logger.info('Terminal session manager initialized')

        # Host agent client is optional — may not be running in dev or first boot.
        try:
            host_agent_client = HostAgentClient(config.host_agent_socket)
            app_state.set_host_agent_client(host_agent_client)
            logger.info(
                'Host agent client initialized (socket: %s)', config.host_agent_socket
            )
        except Exception as e:
            logger.warning(
                'Host agent client initialization failed '
                '(system stats and repo management will be unavailable): %s',
                e,
            )
            app_state.set_host_agent_client(None)

        # Initialize shared ROS2 bridge (no subscriptions yet).
        domain_id = int(os.getenv('ROS_DOMAIN_ID', '30'))
        try:
            bridge = Ros2Bridge(domain_id=domain_id)
            bridge.start()
            app_state.set_ros2_bridge(bridge)
        except Exception as e:
            logger.warning('ROS2 bridge initialization failed: %s', e)

        app_state.robot_runtime = RobotRuntime(
            app_state.get_docker_client_or_none(), client_pool,
            config.supported_robot_containers)
        runtime_task = asyncio.create_task(app_state.robot_runtime.monitor())

        if app_state.get_ros2_bridge_or_none():
            try:
                app_state.record_play = RecordPlayService(
                    app_state.get_ros2_bridge_or_none(),
                    os.getenv('RECORDINGS_DIR', '/cyclo_manager_ros_bags'),
                    runtime=app_state.robot_runtime)
            except Exception:
                logger.exception('Record & Play storage initialization failed')

        logger.info('cyclo_manager initialized successfully')
    except Exception as e:
        logger.error('Failed to initialize cyclo_manager: %s', e)
        raise

    try:
        yield
    finally:
        if app_state.record_play:
            await asyncio.to_thread(app_state.record_play.close)
            app_state.record_play = None
        if runtime_task:
            runtime_task.cancel()
            with suppress(asyncio.CancelledError):
                await runtime_task
        app_state.robot_runtime = None

    # Shutdown
    logger.info('Shutting down cyclo_manager...')

    client_pool = app_state.get_client_pool_or_none()
    if client_pool:
        await client_pool.close_all()

    docker_client = app_state.get_docker_client_or_none()
    if docker_client:
        docker_client.close()

    host_agent_client = app_state.get_host_agent_client_or_none()
    if host_agent_client:
        await host_agent_client.async_close()

    ros2_bridge = app_state.get_ros2_bridge_or_none()
    if ros2_bridge:
        try:
            ros2_bridge.stop()
            logger.debug('Stopped ROS2 bridge')
        except Exception as e:
            logger.error('Error stopping ROS2 bridge: %s', e)
    app_state.clear_ros2_bridge()

    terminal_session_manager = app_state.get_terminal_session_manager_or_none()
    if terminal_session_manager:
        try:
            terminal_session_manager.close_all()
        except Exception as e:
            logger.error('Error closing terminal sessions: %s', e)

    logger.info('cyclo_manager shut down')
