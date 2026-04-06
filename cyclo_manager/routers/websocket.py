"""WebSocket endpoints router."""

import asyncio
import logging
import time
from typing import Any, Optional, Tuple

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosedOK, ConnectionClosedError

from cyclo_manager.routers import ros2 as ros2_router
from cyclo_manager.state import (
    get_config_or_none,
    get_client_pool_or_none,
    get_ros2_node,
)
from cyclo_manager.models import ROS2TopicDataResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# Constants
LOG_POLL_INTERVAL = 0.5  # seconds
SERVICE_STATUS_CHECK_INTERVAL = 1.0  # seconds
ERROR_RETRY_DELAY = 2.0  # seconds
INITIAL_LOG_TAIL = 100
FALLBACK_LOG_TAIL = 10000
# ROS2 topic WebSocket throttling: maximum send rate per topic (Hz)
# Prevents overwhelming WebSocket with high-frequency topics (e.g., 100Hz)
ROS2_TOPIC_MAX_SEND_RATE = 10.0  # Hz (10 messages per second max)


# ============================================================================
# General WebSocket Helper Functions
# ============================================================================

async def _send_websocket_error(websocket: WebSocket, message: str) -> bool:
    """Send error message via WebSocket.

    Returns:
        True if message was sent successfully, False otherwise.
    """
    try:
        await websocket.send_json({"type": "error", "data": message})
        return True
    except (WebSocketDisconnect, RuntimeError, Exception):
        return False


async def _send_websocket_logs(websocket: WebSocket, logs: str) -> bool:
    """Send logs via WebSocket.

    Returns:
        True if message was sent successfully, False otherwise.
    """
    try:
        await websocket.send_json({"type": "logs", "data": logs})
        return True
    except (WebSocketDisconnect, RuntimeError) as e:
        # WebSocket is closed or closing
        return False
    except Exception:
        return False


async def _send_websocket_data(websocket: WebSocket, data: dict) -> bool:
    """Send data message via WebSocket.

    Args:
        websocket: WebSocket connection.
        data: Data dictionary to send.

    Returns:
        True if message was sent successfully, False otherwise.
    """
    try:
        # Check if WebSocket is still connected
        # WebSocketState.CONNECTED = 1
        if websocket.client_state.value != 1:
            logger.debug(f"WebSocket not connected (state: {websocket.client_state.value})")
            return False

        await websocket.send_json({"type": "data", "data": data})
        return True
    except (WebSocketDisconnect, ConnectionClosedOK, ConnectionClosedError, RuntimeError) as e:
        logger.debug(f"Failed to send data message, WebSocket likely closed: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error sending WebSocket data message: {e}", exc_info=True)
        return False


async def _close_websocket_ignoring_error(websocket: WebSocket) -> None:
    """Close WebSocket connection, ignoring any errors.

    This is useful for cleanup in exception handlers where the connection
    may already be closed or in an invalid state.
    """
    try:
        await websocket.close()
    except Exception:
        pass


async def _check_service_status(
    client, service: str, log_service_name: str
) -> Tuple[bool, bool]:
    """Check status of main service and log service.

    Returns:
        Tuple of (service_is_up, log_service_is_up)
    """
    try:
        status_response = await client.get_service_status(service)
        service_is_up = status_response.get("is_up", False)
    except Exception:
        service_is_up = False

    log_service_is_up = True  # Default to True if log service doesn't exist
    try:
        log_status_response = await client.get_service_status(log_service_name)
        log_service_is_up = log_status_response.get("is_up", False)
    except Exception:
        pass  # Log service might not exist, which is fine

    return service_is_up, log_service_is_up


# ============================================================================
# ROS2 WebSocket Helper Functions
# ============================================================================

def _get_topic_msg_type(node: Any, topic: str) -> str:
    """Get message type for a topic (control, discovered, or on-demand).

    Args:
        node: CycloManagerTopicSubscriber instance.
        topic: Topic name.

    Returns:
        Message type string, or empty string if unknown.
    """
    return node.get_topic_msg_type(topic) or ""


async def _poll_and_send_single_topic_data(
    websocket: WebSocket,
    container: str,
    node: Any,
    topic: str,
    last_send_time: float,
    last_sent_data_hash: Optional[int],
    min_interval: float
) -> Tuple[bool, float, Optional[int]]:
    """Poll for single topic data and send if changed (with throttling).

    This is optimized for single-topic WebSocket connections.

    Args:
        websocket: WebSocket connection.
        container: Container name.
        node: CycloManagerTopicSubscriber instance.
        topic: Topic name.
        last_send_time: Last send time for this topic.
        last_sent_data_hash: Last sent data hash for this topic.
        min_interval: Minimum time between sends (throttling).

    Returns:
        Tuple of (connection_alive, new_last_send_time, new_last_sent_data_hash).
    """
    current_time = time.time()
    time_since_last_send = current_time - last_send_time

    if time_since_last_send < min_interval:
        return True, last_send_time, last_sent_data_hash  # Throttled

    # Get latest cached data
    cached_data = node.get_topic_data(topic)
    available = node.is_topic_available(topic)

    if cached_data:
        data = cached_data.get("data")
        # Check if data changed (simple hash comparison)
        data_hash = hash(str(data)) if data is not None else None

        if data_hash != last_sent_data_hash or not available:
            # Data changed or became unavailable, send update
            msg_type = _get_topic_msg_type(node, topic)
            response = ROS2TopicDataResponse(
                container=container,
                topic=topic,
                msg_type=msg_type,
                data=data,
                available=available,
                domain_id=node.domain_id,
            )

            success = await _send_websocket_data(websocket, response.model_dump())
            return success, current_time, data_hash
    elif not available:
        # Topic became unavailable or no data yet
        # Send notification if this is the first check (last_sent_data_hash is None)
        # or if we had data before (last_sent_data_hash is not None)
        if last_sent_data_hash is None:
            # First time checking - send initial unavailable status
            msg_type = _get_topic_msg_type(node, topic)
            response = ROS2TopicDataResponse(
                container=container,
                topic=topic,
                msg_type=msg_type,
                data=None,
                available=False,
                domain_id=node.domain_id,
            )

            success = await _send_websocket_data(websocket, response.model_dump())
            return success, current_time, -1  # Use -1 as sentinel value to indicate unavailable status sent
        elif last_sent_data_hash != -1:
            # We had data before, now it's unavailable - send notification
            msg_type = _get_topic_msg_type(node, topic)
            response = ROS2TopicDataResponse(
                container=container,
                topic=topic,
                msg_type=msg_type,
                data=None,
                available=False,
                domain_id=node.domain_id,
            )

            success = await _send_websocket_data(websocket, response.model_dump())
            return success, current_time, -1
        # If last_sent_data_hash is -1, we already sent unavailable status, don't send again
        return True, last_send_time, last_sent_data_hash

    return True, last_send_time, last_sent_data_hash  # No change


@router.websocket("/ws/{container}/services/{service}/logs")
async def websocket_service_logs(websocket: WebSocket, container: str, service: str):
    """WebSocket endpoint for streaming service logs in real-time."""
    await websocket.accept()
    logger.info(f"WebSocket connection established for {container}/{service} logs")

    # Track if we've sent initial logs via fallback for this connection
    # This prevents sending duplicate logs when fallback is used1
    fallback_logs_sent = False

    try:
        # Validate configuration
        config = get_config_or_none()
        if config is None:
            await _send_websocket_error(websocket, "Configuration not loaded")
            await _close_websocket_ignoring_error(websocket)
            return

        if container not in config.containers:
            await _send_websocket_error(websocket, f"Container '{container}' not found")
            await _close_websocket_ignoring_error(websocket)
            return

        # Get client pool
        client_pool = get_client_pool_or_none()
        if client_pool is None:
            await _send_websocket_error(websocket, "Agent client pool not initialized")
            await _close_websocket_ignoring_error(websocket)
            return

        client = client_pool.get_client(container)
        if client is None:
            await _send_websocket_error(
                websocket, f"Agent client for container '{container}' not available"
            )
            await _close_websocket_ignoring_error(websocket)
            return

        # Initial log fetch - get initial cursor
        cursor: Optional[int] = None
        try:
            agent_response = await client.get_service_logs(service, INITIAL_LOG_TAIL)
            initial_logs = agent_response.get("logs", "")
            # Get cursor from response - it should always be present
            cursor = agent_response.get("cursor")

            # If cursor is None, log warning and try to get cursor from file size
            if cursor is None:
                logger.warning(
                    f"Initial cursor is None for {container}/{service}, "
                    f"response: {list(agent_response.keys())}"
                )
                # Try to use fallback to get cursor
                try:
                    fallback_response = await client.get_service_logs(service, FALLBACK_LOG_TAIL)
                    cursor = fallback_response.get("cursor")
                    if cursor is not None:
                        logger.info(
                            f"Got cursor from fallback for {container}/{service}: {cursor}"
                        )
                    else:
                        logger.error(
                            f"Cursor still None after fallback for {container}/{service}"
                        )
                        cursor = 0
                except Exception:
                    cursor = 0

            if initial_logs:
                if not await _send_websocket_logs(websocket, initial_logs):
                    return  # Connection broken

            # IMPORTANT: After sending initial logs, refresh cursor to current file size
            # to prevent duplicate logs. The initial cursor was set when fetching tail logs,
            # but new logs might have been added between fetching and sending.
            # By refreshing the cursor after sending, we ensure the polling loop starts
            # from the correct position without duplicates.
            if cursor is not None:
                try:
                    # Read with current cursor to get updated cursor (will return empty logs if no new logs)
                    refresh_response = await client.get_service_logs(service, 0, cursor)
                    refreshed_cursor = refresh_response.get("cursor")
                    if refreshed_cursor is not None:
                        cursor = refreshed_cursor
                        logger.debug(
                            f"Refreshed cursor for {container}/{service} after initial logs: "
                            f"{cursor}"
                        )
                except Exception as refresh_error:
                    # If refresh fails, keep the original cursor
                    logger.debug(
                        f"Failed to refresh cursor for {container}/{service}: {refresh_error}"
                    )
        except Exception as e:
            logger.error(
                f"Failed to fetch initial logs for {container}/{service}: {e}",
                exc_info=True
            )
            if not await _send_websocket_error(
                websocket, f"Failed to fetch initial logs: {str(e)}"
            ):
                return  # Connection broken
            cursor = 0  # Start from beginning

        # Poll for new logs using cursor
        log_service_name = f"{service}-log"
        last_service_status_check = 0.0
        service_is_up = True  # Assume service is up initially
        log_service_is_up = True

        while True:
            try:
                await asyncio.sleep(LOG_POLL_INTERVAL)

                # Check service status periodically
                current_time = time.time()
                if current_time - last_service_status_check >= SERVICE_STATUS_CHECK_INTERVAL:
                    service_is_up, log_service_is_up = await _check_service_status(
                        client, service, log_service_name
                    )
                    last_service_status_check = current_time

                # # Skip log fetching if both services are down
                # if not service_is_up and not log_service_is_up:
                #     await asyncio.sleep(ERROR_RETRY_DELAY)
                #     continue

                # Fetch new logs using cursor
                if cursor is not None:
                    try:
                        agent_response = await client.get_service_logs(service, INITIAL_LOG_TAIL, cursor)
                        new_logs = agent_response.get("logs", "")
                        new_cursor = agent_response.get("cursor", cursor)

                        if new_logs and (service_is_up or log_service_is_up):
                            if not await _send_websocket_logs(websocket, new_logs):
                                logger.info(f"WebSocket disconnected for {container}/{service}")
                                break
                            cursor = new_cursor
                        else:
                            # Update cursor even if no new logs (file might have been truncated)
                            cursor = new_cursor
                    except Exception as fetch_error:
                        logger.error(
                            f"Failed to fetch logs for {container}/{service}: {fetch_error}",
                            exc_info=True
                        )
                        await asyncio.sleep(ERROR_RETRY_DELAY)
                        continue
                else:
                    # Fallback: cursor not available - use tail method and get cursor from response
                    # IMPORTANT: Only use fallback to get cursor, then switch to cursor-based method
                    logger.warning(
                        f"Cursor not available for {container}/{service}, using fallback method to get cursor"
                    )
                    try:
                        agent_response = await client.get_service_logs(service, FALLBACK_LOG_TAIL)
                        current_logs = agent_response.get("logs", "")
                        new_cursor = agent_response.get("cursor")

                        # If we got a cursor, use it for next iteration (switch to cursor-based method)
                        if new_cursor is not None:
                            cursor = new_cursor
                            logger.info(
                                f"Got cursor from fallback method for {container}/{service}: {cursor}, "
                                f"switching to cursor-based method"
                            )
                            # Only send logs on first fallback use (when cursor was None)
                            # Track this per connection to avoid duplicates
                            if not fallback_logs_sent:
                                if current_logs:
                                    if not await _send_websocket_logs(websocket, current_logs):
                                        logger.info(f"WebSocket disconnected for {container}/{service}")
                                        break
                                fallback_logs_sent = True
                            # Don't send logs again - we'll use cursor-based method next time
                        else:
                            logger.error(
                                f"Failed to get cursor from fallback method for {container}/{service}"
                            )
                            # Wait longer before retrying
                            await asyncio.sleep(ERROR_RETRY_DELAY * 2)
                            continue
                    except Exception as fetch_error:
                        logger.error(
                            f"Failed to fetch logs for {container}/{service}: {fetch_error}",
                            exc_info=True
                        )
                        await asyncio.sleep(ERROR_RETRY_DELAY)
                        continue

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for {container}/{service}")
                break
            except Exception as e:
                logger.error(
                    f"Unexpected error in log polling loop for {container}/{service}: {e}",
                    exc_info=True
                )
                if not await _send_websocket_error(websocket, f"Error streaming logs: {str(e)}"):
                    break
                await asyncio.sleep(ERROR_RETRY_DELAY)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected normally for {container}/{service}")
    except Exception as e:
        logger.error(f"Unexpected WebSocket error for {container}/{service}: {e}", exc_info=True)
        await _close_websocket_ignoring_error(websocket)


@router.websocket("/ws/{container}/ros2/topics/{topic:path}")
async def websocket_ros2_topic_data(websocket: WebSocket, container: str, topic: str):
    """WebSocket endpoint for streaming single ROS2 topic data in real-time.

    This endpoint uses one WebSocket connection per topic. Each connection
    streams data for only the specified topic.
    """
    await websocket.accept()
    logger.info(f"WebSocket connection established for {container}/ros2/{topic}")

    try:
        node = get_ros2_node(container)
        if node is None:
            config = get_config_or_none()
            error_msg = (
                f"Container '{container}' not found"
                if config is None or container not in config.containers
                else f"ROS2 node for container '{container}' is not available."
            )
            await _send_websocket_error(websocket, error_msg)
            await _close_websocket_ignoring_error(websocket)
            return
        if topic not in node.list_topics():
            await _send_websocket_error(
                websocket, f"Topic '{topic}' not found for container '{container}'"
            )
            await _close_websocket_ignoring_error(websocket)
            return

        msg_type = node.get_topic_msg_type(topic)
        if msg_type:
            qos_profile = ros2_router._get_topic_publisher_qos(container, topic, node)
            node.add_topic_subscription(topic, msg_type, qos_profile=qos_profile)
            # Give TRANSIENT_LOCAL callback time to receive the last message (DDS is async)
            if qos_profile.get("durability") == "transient_local":
                for _ in range(5):
                    await asyncio.sleep(0.1)
                    if node.get_topic_data(topic):
                        break

        last_send_time: float = 0.0
        last_sent_data_hash: Optional[int] = None
        min_interval = 1.0 / ROS2_TOPIC_MAX_SEND_RATE
        initial_send_done = False

        try:
            cached_data = node.get_topic_data(topic)
            available = node.is_topic_available(topic)

            if cached_data:
                data = cached_data.get("data")
                data_hash = hash(str(data)) if data is not None else None
                msg_type = _get_topic_msg_type(node, topic)
                response = ROS2TopicDataResponse(
                    container=container,
                    topic=topic,
                    msg_type=msg_type,
                    data=data,
                    available=available,
                    domain_id=node.domain_id,
                )
                if await _send_websocket_data(websocket, response.model_dump()):
                    last_send_time = time.time()
                    last_sent_data_hash = data_hash
                    initial_send_done = True
            elif not available:
                msg_type = _get_topic_msg_type(node, topic)
                response = ROS2TopicDataResponse(
                    container=container,
                    topic=topic,
                    msg_type=msg_type,
                    data=None,
                    available=False,
                    domain_id=node.domain_id,
                )
                if await _send_websocket_data(websocket, response.model_dump()):
                    last_send_time = time.time()
                    last_sent_data_hash = -1
                    initial_send_done = True

            while True:
                await asyncio.sleep(min(LOG_POLL_INTERVAL, min_interval))

                connection_alive, new_last_send_time, new_last_sent_data_hash = (
                    await _poll_and_send_single_topic_data(
                        websocket, container, node, topic,
                        last_send_time, last_sent_data_hash, min_interval
                    )
                )

                if not connection_alive:
                    logger.info(f"WebSocket disconnected for {container}/ros2/{topic}")
                    return

                # Update state
                last_send_time = new_last_send_time
                last_sent_data_hash = new_last_sent_data_hash

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected for {container}/ros2/{topic}")
        except Exception as e:
            logger.error(f"Error in WebSocket loop for {container}/ros2/{topic}: {e}")

    except HTTPException as e:
        await _send_websocket_error(websocket, e.detail or "Unknown error")
        await _close_websocket_ignoring_error(websocket)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for {container}/ros2/{topic}")
    except Exception as e:
        logger.error(f"WebSocket error for {container}/ros2/{topic}: {e}", exc_info=True)
        await _close_websocket_ignoring_error(websocket)

