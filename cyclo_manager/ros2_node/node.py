"""Container ROS2 node: single rclpy node per container, subscriptions added/removed by page."""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Any, Optional, TypeAlias

import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.subscription import Subscription

from cyclo_manager.ros2_node.message import (
    convert_value_for_json,
    get_message_class,
    message_to_dict,
    parse_qos_profile,
)

logger = logging.getLogger(__name__)

# Fallback msg types when discovery hasn't run (e.g. joint_states, robot_description)
KNOWN_TOPIC_TYPES: dict[str, str] = {
    "/joint_states": "sensor_msgs/msg/JointState",
    "/robot_description": "std_msgs/msg/String",
}
# Topics that never expire (static URDF, etc.)
STATIC_TOPICS = frozenset(["/robot_description"])
# Seconds after which dynamic topic data is considered stale
DYNAMIC_TOPIC_STALE_TIME = 3.0


class RequestKind:
    """Request types for spin thread queue."""

    RUN_DISCOVERY = "run_discovery"
    ADD_TOPIC = "add_topic"
    REMOVE_TOPIC = "remove_topic"


RequestOp: TypeAlias = tuple[str, Any]
TopicCacheEntry: TypeAlias = dict[str, Any]

_rclpy_init_lock = threading.Lock()
_rclpy_initialized = False


def _ensure_rclpy_init() -> None:
    """Initialize rclpy once (thread-safe)."""
    global _rclpy_initialized
    with _rclpy_init_lock:
        if not _rclpy_initialized:
            rclpy.init()
            _rclpy_initialized = True


class CycloManagerTopicSubscriber:
    """
    cyclo_manager topic subscriber: one rclpy node per container.
    Node and spin thread start in start(); subscriptions added/removed via add/remove_topic_subscription.
    Requests go through _request_queue and are processed by the spin thread.
    """

    def __init__(self, container_name: str, domain_id: int = 30):
        self.container_name = container_name
        self.domain_id = domain_id
        self._node: Optional[Node] = None
        self._executor: Optional[SingleThreadedExecutor] = None
        self._spin_thread: Optional[threading.Thread] = None
        self._topics_transient_local: set[str] = set()
        self._is_running = False
        self._lock = threading.Lock()

        self._subs: dict[str, Subscription] = {}
        self._msg_cache: dict[str, TopicCacheEntry] = {}
        self._discovered_topics: dict[str, list[str]] = {}
        self._topic_msg_types: dict[str, str] = {}

        self._request_queue: queue.Queue[RequestOp] = queue.Queue()
        self._request_available = threading.Event()

    def start(self) -> None:
        if self._is_running:
            return
        _ensure_rclpy_init()
        self._node = Node(
            f"cyclo_manager_ros2_{self.container_name}",
            allow_undeclared_parameters=True,
        )
        self._executor = SingleThreadedExecutor()
        self._executor.add_node(self._node)
        self._is_running = True
        self._spin_thread = threading.Thread(
            target=self._spin_loop,
            daemon=True,
            name=f"ros2-spin-{self.container_name}",
        )
        self._spin_thread.start()
        logger.info(
            "ROS2 node started for container '%s' (domain_id=%s)",
            self.container_name,
            self.domain_id,
        )

    def stop(self) -> None:
        if not self._is_running:
            return
        self._is_running = False
        if self._spin_thread and self._spin_thread.is_alive():
            self._spin_thread.join(timeout=5.0)
        self._remove_all_subscriptions()
        if self._node:
            self._node.destroy_node()
            self._node = None
        self._executor = None
        with self._lock:
            self._clear_runtime_state()
        logger.info("ROS2 node stopped for container '%s'", self.container_name)

    def _spin_loop(self) -> None:
        while self._is_running and self._executor and self._node:
            try:
                self._process_request()
            except Exception as e:
                logger.debug("Request process error: %s", e)
            try:
                self._executor.spin_once(timeout_sec=0.1)
            except Exception as e:
                if self._is_running:
                    logger.debug("Spin once error: %s", e)

    def _process_request(self) -> None:
        """Process requests from queue (run from spin thread)."""
        processed = False
        try:
            while True:
                op = self._request_queue.get_nowait()
                processed = True
                kind, payload = op
                if kind == RequestKind.RUN_DISCOVERY:
                    self._handle_run_discovery()
                elif kind == RequestKind.ADD_TOPIC:
                    topic, msg_type, qos_profile = payload
                    self._handle_add_topic(topic, msg_type, qos_profile)
                elif kind == RequestKind.REMOVE_TOPIC:
                    topic = payload
                    self._handle_remove_topic(topic)
        except queue.Empty:
            pass
        if processed:
            self._request_available.set()

    def _handle_run_discovery(self) -> None:
        try:
            names_and_types = self._node.get_topic_names_and_types()  # type: ignore[union-attr]
            with self._lock:
                self._discovered_topics = dict(names_and_types)
        except Exception as e:
            logger.warning("Discovery failed for %s: %s", self.container_name, e)

    def _handle_add_topic(self, topic: str, msg_type: str, qos_profile: dict) -> None:
        with self._lock:
            if topic in self._subs:
                return
        sub = self._create_sub(topic, msg_type, qos_profile)
        if sub:
            with self._lock:
                self._subs[topic] = sub
                self._topic_msg_types[topic] = msg_type
                if qos_profile.get("durability") == "transient_local":
                    self._topics_transient_local.add(topic)
            logger.info(
                "ROS2 subscribe: container=%s topic=%s msg_type=%s",
                self.container_name,
                topic,
                msg_type,
            )

    def _handle_remove_topic(self, topic: str) -> None:
        with self._lock:
            sub = self._subs.pop(topic, None)
            self._topic_msg_types.pop(topic, None)
            self._topics_transient_local.discard(topic)
        if sub and self._node:
            self._node.destroy_subscription(sub)
            logger.info(
                "ROS2 unsubscribe: container=%s topic=%s",
                self.container_name,
                topic,
            )

    def _create_sub(
        self,
        topic: str,
        msg_type: str,
        qos_profile: Optional[dict] = None,
    ) -> Optional[Subscription]:
        if not self._node:
            return None
        msg_class = get_message_class(msg_type)
        if msg_class is None:
            logger.error("Unknown message type: %s", msg_type)
            return None

        def callback(msg: Any) -> None:
            with self._lock:
                self._msg_cache[topic] = {"raw_message": msg, "received_at": time.time()}

        profile = qos_profile or {}
        qos = parse_qos_profile(profile)
        return self._node.create_subscription(msg_class, topic, callback, qos)

    def _clear_runtime_state(self) -> None:
        """Clear in-memory topic/runtime caches."""
        self._msg_cache.clear()
        self._discovered_topics.clear()
        self._topic_msg_types.clear()
        self._topics_transient_local.clear()

    def _remove_all_subscriptions(self) -> None:
        if not self._node:
            return
        with self._lock:
            all_subs = list(self._subs.items())
            self._subs.clear()
        for topic, sub in all_subs:
            try:
                self._node.destroy_subscription(sub)
            except Exception as e:
                logger.warning("Error destroying sub %s: %s", topic, e)

    def _enqueue_and_wait(
        self,
        op: RequestOp,
        timeout: float = 5.0,
    ) -> None:
        """Enqueue request and wait until processed."""
        self._request_available.clear()
        self._request_queue.put(op)
        processed = self._request_available.wait(timeout=timeout)
        if not processed:
            logger.warning(
                "Request processing timeout for container '%s': op=%s",
                self.container_name,
                op[0],
            )

    def _resolve_topic_msg_type_locked(self, topic: str) -> str:
        """Resolve message type for topic. Requires caller to hold self._lock."""
        return (
            KNOWN_TOPIC_TYPES.get(topic)
            or self._topic_msg_types.get(topic)
            or (self._discovered_topics.get(topic) or [""])[0]
        )

    def _is_cached_valid(self, topic: str, cached: TopicCacheEntry) -> bool:
        """Return True if cached data is still valid (not stale)."""
        is_static = topic in STATIC_TOPICS or topic in self._topics_transient_local
        if is_static:
            return True
        received_at = cached.get("received_at")
        if received_at is None:
            return True
        return (time.time() - received_at) <= DYNAMIC_TOPIC_STALE_TIME

    def add_topic_subscription(
        self,
        topic: str,
        msg_type: str,
        qos_profile: Optional[dict] = None,
    ) -> bool:
        with self._lock:
            if topic in self._subs:
                return True
        self._enqueue_and_wait(
            (RequestKind.ADD_TOPIC, (topic, msg_type, qos_profile or {}))
        )
        with self._lock:
            return topic in self._subs

    def remove_topic_subscription(self, topic: str) -> None:
        self._enqueue_and_wait((RequestKind.REMOVE_TOPIC, topic))

    def get_topic_data(self, topic: str) -> Optional[dict[str, Any]]:
        with self._lock:
            cached = self._msg_cache.get(topic)
            if cached is None:
                return None
            if not self._is_cached_valid(topic, cached):
                del self._msg_cache[topic]
                return None
            raw = cached.get("raw_message")
            if raw is None:
                return None
            data = message_to_dict(raw, convert_value_for_json)
            return {"data": data, "received_at": cached.get("received_at")}

    def list_topics(self) -> list[str]:
        """All known topics: KNOWN_TOPIC_TYPES + discovered + subscribed."""
        with self._lock:
            names = (
                set(KNOWN_TOPIC_TYPES.keys())
                | set(self._discovered_topics.keys())
                | set(self._subs.keys())
            )
        return list(names)

    def get_topic_msg_type(self, topic: str) -> Optional[str]:
        """Message type for topic (known fallback, discovered, or subscribed)."""
        with self._lock:
            msg_type = self._resolve_topic_msg_type_locked(topic)
        return msg_type or None

    def is_topic_available(self, topic: str) -> bool:
        data = self.get_topic_data(topic)
        return data is not None

    def request_discovery(self) -> None:
        """Enqueue discovery request; spin thread will run get_topic_names_and_types."""
        self._request_available.clear()
        self._request_queue.put((RequestKind.RUN_DISCOVERY, None))

    def wait_discovery(self, timeout: float = 2.0) -> None:
        """Wait until request queue is drained (includes discovery if enqueued)."""
        processed = self._request_available.wait(timeout=timeout)
        if not processed:
            logger.warning(
                "Discovery wait timed out for container '%s' (timeout=%.1fs)",
                self.container_name,
                timeout,
            )

    def _build_topic_status_locked(
        self,
        topic: str,
        current_time: float,
    ) -> dict[str, Any]:
        """Build topic status entry. Requires caller to hold self._lock."""
        cached = self._msg_cache.get(topic)
        available = False
        received_at = None
        seconds_since = None

        if cached:
            received_at = cached.get("received_at")
            if received_at is not None:
                seconds_since = current_time - received_at
                if self._is_cached_valid(topic, cached):
                    available = True
                else:
                    del self._msg_cache[topic]

        return {
            "available": available,
            "msg_type": self._resolve_topic_msg_type_locked(topic),
            "subscribed": topic in self._subs,
            "received_at": received_at,
            "seconds_since_last_message": seconds_since,
        }

    def get_all_topics_status(self) -> dict[str, dict[str, Any]]:
        """Run discovery once, then return status for all known topics."""
        self.request_discovery()
        self.wait_discovery(timeout=2.0)
        current_time = time.time()
        with self._lock:
            all_topics = set(self._discovered_topics.keys()) | set(self._subs.keys())
            return {
                topic: self._build_topic_status_locked(topic, current_time)
                for topic in all_topics
            }
