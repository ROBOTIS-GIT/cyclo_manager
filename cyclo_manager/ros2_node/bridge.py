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

"""ROS2 bridge: FastAPI to ROS2 topics via rclpy (subscribe, publish, cache)."""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Any, Optional, TypeAlias

from cyclo_manager.ros2_node.constants import (
    DYNAMIC_TOPIC_STALE_TIME,
    KNOWN_TOPIC_QOS_PRESETS,
    KNOWN_TOPIC_TYPES,
    STATIC_TOPICS,
)
from cyclo_manager.ros2_node.message import (
    convert_value_for_json,
    get_message_class,
    message_to_dict,
)
from cyclo_manager.ros2_node.qos import (
    get_default_qos_profile,
    parse_qos_profile,
    resolve_qos_from_publisher_info,
)
from cyclo_manager.subscriptions import SubscriptionError
import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.publisher import Publisher
from rclpy.subscription import Subscription

logger = logging.getLogger(__name__)

RCLPY_NODE_NAME = 'cyclo_manager'


class RequestKind:
    """Request types for spin thread queue."""

    INSPECT_PUBLISHERS = 'inspect_publishers'
    RUN_DISCOVERY = 'run_discovery'
    ACQUIRE_SUBSCRIPTION = 'acquire_subscription'
    RELEASE_SUBSCRIPTIONS = 'release_subscriptions'
    PUBLISH_TOPIC = 'publish_topic'
    PREPARE_JOG = 'prepare_jog'
    CHECK_JOG = 'check_jog'


RequestPayload: TypeAlias = tuple[Any, queue.Queue[Any]]
RequestOp: TypeAlias = tuple[str, RequestPayload]
TopicCacheEntry: TypeAlias = dict[str, Any]

_rclpy_init_lock = threading.Lock()
_rclpy_initialized = False


def _ensure_rclpy_init() -> None:
    """Initialize rclpy once per process (thread-safe)."""
    global _rclpy_initialized
    with _rclpy_init_lock:
        if not _rclpy_initialized:
            if not rclpy.ok():
                rclpy.init()
            _rclpy_initialized = True


class Ros2Bridge:
    """
    Bridge between cyclo_manager API and ROS2 topics.

    Wraps an rclpy Node on a background spin thread. Subscriptions are added
    and removed according to their registered subscription owners. Node operations
    go through _request_queue and are processed on the spin thread.

    Method layout:
      - Lifecycle: start / stop
      - Public API: subscribe, publish, read cache, discovery
      - Spin thread: request queue dispatch and rclpy handlers
      - Internals: cache validity, msg_type resolution, cleanup

    """

    def __init__(self, domain_id: int = 30):
        self.domain_id = domain_id
        self._rclpy_node: Optional[Node] = None
        self._executor: Optional[SingleThreadedExecutor] = None
        self._spin_thread: Optional[threading.Thread] = None
        self._topics_transient_local: set[str] = set()
        self._is_running = False
        self._lock = threading.Lock()

        self._subs: dict[str, Subscription] = {}
        self._pubs: dict[tuple[str, str], Publisher] = {}
        self._msg_cache: dict[str, TopicCacheEntry] = {}
        self._discovered_topics: dict[str, list[str]] = {}
        self._message_listeners: dict[str, set] = {}
        self._subscription_users: dict[str, set[str]] = {}
        self._subscription_types: dict[str, str] = {}

        self._request_queue: queue.Queue[RequestOp] = queue.Queue()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        if self._is_running:
            return
        _ensure_rclpy_init()
        self._rclpy_node = Node(
            RCLPY_NODE_NAME,
            allow_undeclared_parameters=True,
        )
        self._executor = SingleThreadedExecutor()
        self._executor.add_node(self._rclpy_node)
        self._is_running = True
        self._spin_thread = threading.Thread(
            target=self._spin_loop,
            daemon=True,
            name='ros2-spin-cyclo_manager',
        )
        self._spin_thread.start()
        logger.info('ROS2 bridge started (domain_id=%s)', self.domain_id)

    def stop(self) -> None:
        if not self._is_running:
            return
        self._is_running = False
        if self._spin_thread and self._spin_thread.is_alive():
            self._spin_thread.join(timeout=5.0)
        self._remove_all_subscriptions()
        self._remove_all_publishers()
        if self._rclpy_node:
            self._rclpy_node.destroy_node()
            self._rclpy_node = None
        self._executor = None
        with self._lock:
            self._clear_runtime_state()
        logger.info('ROS2 bridge stopped')

    # ------------------------------------------------------------------
    # Public API — subscribe / unsubscribe
    # ------------------------------------------------------------------

    def acquire_subscription(self, topic, msg_type, owner_id, qos_profile=None) -> bool:
        """Register one consumer; all consumers of a topic share one ROS subscription."""
        if not self._is_running:
            return False
        result = self._enqueue_request(
            RequestKind.ACQUIRE_SUBSCRIPTION,
            (topic, msg_type, owner_id, qos_profile, time.monotonic() + 5.0),
        )
        if isinstance(result, SubscriptionError):
            raise result
        return result is True

    def release_subscriptions(self, owner_id) -> bool:
        """Release only this consumer, including acquires already queued by it."""
        if not self._is_running:
            return False
        return self._enqueue_request(RequestKind.RELEASE_SUBSCRIPTIONS, owner_id) is True

    def add_message_listener(self, topic: str, callback) -> None:
        """Observe every received message; callbacks must not block the ROS thread."""
        with self._lock:
            self._message_listeners.setdefault(topic, set()).add(callback)

    def remove_message_listener(self, topic: str, callback) -> None:
        """Detach a recorder without removing another consumer's subscription."""
        with self._lock:
            listeners = self._message_listeners.get(topic, set())
            listeners.discard(callback)
            if not listeners:
                self._message_listeners.pop(topic, None)

    # ------------------------------------------------------------------
    # Public API — publish
    # ------------------------------------------------------------------

    def publish_twist(
        self,
        topic: str,
        linear_x: float,
        angular_z: float,
        linear_y: float = 0.0,
    ) -> bool:
        if not self._is_running:
            return False
        data = {
            'linear': {'x': linear_x, 'y': linear_y, 'z': 0.0},
            'angular': {'x': 0.0, 'y': 0.0, 'z': angular_z},
        }
        return (
            self._enqueue_request(
                RequestKind.PUBLISH_TOPIC,
                (topic, 'geometry_msgs/msg/Twist', data),
            )
            is True
        )

    def publish_jog(self, topic: str, msg_type: str, data: dict[str, Any]) -> bool:
        """Never execute a jog command that sat in the spin queue too long."""
        if not self._is_running:
            return False
        return self._enqueue_request(
            RequestKind.PUBLISH_TOPIC,
            (topic, msg_type, data, time.monotonic() + 0.25),
            timeout=0.5,
        ) is True

    def prepare_jog_publishers(self, topics: list[tuple[str, str]]) -> bool:
        """Allow DDS discovery before the first single-step command, without moving."""
        return self._enqueue_request(RequestKind.PREPARE_JOG, topics) is True

    def jog_publishers_ready(self, topics: list[tuple[str, str]]) -> bool:
        """Check all destination subscribers before starting multi-controller motion."""
        return self._enqueue_request(RequestKind.CHECK_JOG, topics, timeout=0.5) is True

    # ------------------------------------------------------------------
    # Public API — read cache / topic metadata
    # ------------------------------------------------------------------

    def get_topic_data(self, topic: str) -> Optional[dict[str, Any]]:
        with self._lock:
            cached = self._msg_cache.get(topic)
            if cached is None:
                return None
            if not self._is_cached_valid(topic, cached):
                del self._msg_cache[topic]
                return None
            raw = cached.get('raw_message')
            received_at = cached.get('received_at')
            if raw is None:
                return None
        data = message_to_dict(raw, convert_value_for_json)
        return {'data': data, 'received_at': received_at}

    def get_topic_msg_type(self, topic: str) -> Optional[str]:
        """Message type for topic (known fallback or discovered)."""
        with self._lock:
            msg_type = self._resolve_topic_msg_type_locked(topic)
        return msg_type or None

    def is_topic_receiving(self, topic: str) -> bool:
        """
        Cheaply check whether fresh data has been received for a topic.

        Unlike get_topic_data(), this never converts the cached message to a
        dict, so it's safe to poll frequently even for large payloads (e.g. compressed
        images).
        """
        with self._lock:
            cached = self._msg_cache.get(topic)
            if cached is None:
                return False
            return self._is_cached_valid(topic, cached)

    # ------------------------------------------------------------------
    # Public API — discovery
    # ------------------------------------------------------------------

    def inspect_publishers(self, topics: list[str]) -> dict[str, bool] | None:
        """Inspect graph endpoints without subscribing to their message streams."""
        if not self._is_running:
            return None
        return self._enqueue_request(RequestKind.INSPECT_PUBLISHERS, topics, timeout=2.0)

    def run_discovery(self, timeout: float = 2.0) -> bool:
        """Run topic discovery on the spin thread and wait until finished."""
        return (
            self._enqueue_request(
                RequestKind.RUN_DISCOVERY,
                None,
                timeout=timeout,
            )
            is True
        )

    def discovery_topics(self) -> dict[str, dict[str, Any]]:
        """Run discovery once, then return status for discovered topics only."""
        self.run_discovery(timeout=2.0)
        with self._lock:
            return {
                topic: self._build_topic_status_locked(topic)
                for topic in self._discovered_topics
            }

    # ------------------------------------------------------------------
    # Spin thread — loop and request dispatch
    # ------------------------------------------------------------------

    def _spin_loop(self) -> None:
        while self._is_running and self._executor and self._rclpy_node:
            try:
                self._process_request()
            except Exception as e:
                logger.debug('Request process error: %s', e)
            try:
                self._executor.spin_once(timeout_sec=0.1)
            except Exception as e:
                if self._is_running:
                    logger.debug('Spin once error: %s', e)

    def _process_request(self) -> None:
        """Process requests from queue (run from spin thread)."""
        try:
            while True:
                kind, payload = self._request_queue.get_nowait()
                request_payload, response_queue = payload
                if kind == RequestKind.INSPECT_PUBLISHERS:
                    try:
                        result = {topic: self._rclpy_node.count_publishers(topic) > 0
                                  for topic in request_payload}
                    except Exception:
                        logger.exception('Publisher inspection failed')
                        result = None
                elif kind == RequestKind.RUN_DISCOVERY:
                    result = self._handle_run_discovery()
                elif kind == RequestKind.ACQUIRE_SUBSCRIPTION:
                    topic, msg_type, owner_id, qos_profile, deadline = request_payload
                    try:
                        result = time.monotonic() < deadline and self._handle_acquire_subscription(
                            topic, msg_type, owner_id, qos_profile)
                    except SubscriptionError as exc:
                        result = exc
                    except Exception as e:
                        logger.warning('Subscribe request failed: topic=%s error=%s', topic, e)
                        result = False
                elif kind == RequestKind.RELEASE_SUBSCRIPTIONS:
                    try:
                        result = self._handle_release_subscriptions(request_payload)
                    except Exception as e:
                        logger.warning('Subscription release failed: %s', e)
                        result = False
                elif kind in (RequestKind.PREPARE_JOG, RequestKind.CHECK_JOG):
                    try:
                        publishers = [self._get_or_create_publisher(topic, msg_type)
                                      for topic, msg_type in request_payload]
                        result = all(pub is not None and (
                            kind == RequestKind.PREPARE_JOG
                            or self._has_external_subscriber(topic, pub))
                            for (topic, _), pub in zip(request_payload, publishers))
                    except Exception as e:
                        logger.warning('Jog publisher preparation failed: %s', e)
                        result = False
                elif kind == RequestKind.PUBLISH_TOPIC:
                    topic, msg_type, data, *deadline = request_payload
                    try:
                        result = (
                            self._handle_publish_topic(
                                topic, msg_type, data, require_subscriber=bool(deadline))
                            if not deadline or time.monotonic() < deadline[0]
                            else False
                        )
                    except Exception as e:
                        logger.warning(
                            'Publish request failed: topic=%s msg_type=%s error=%s',
                            topic,
                            msg_type,
                            e,
                        )
                        result = False
                else:
                    logger.warning('Unknown request type: op=%s', kind)
                    result = None
                response_queue.put(result)
        except queue.Empty:
            pass

    def _enqueue_request(
        self,
        kind: str,
        payload: Any = None,
        timeout: float = 5.0,
    ) -> Any:
        """Enqueue request and wait for its response value."""
        response_queue: queue.Queue[Any] = queue.Queue(maxsize=1)
        self._request_queue.put((kind, (payload, response_queue)))
        try:
            return response_queue.get(timeout=timeout)
        except queue.Empty:
            logger.warning('Request processing timeout: op=%s', kind)
            return None

    # ------------------------------------------------------------------
    # Spin thread — request handlers
    # ------------------------------------------------------------------

    def _handle_run_discovery(self) -> bool:
        try:
            names_and_types = self._rclpy_node.get_topic_names_and_types(
            )  # type: ignore[union-attr]
            with self._lock:
                self._discovered_topics = dict(names_and_types)
            return True
        except Exception as e:
            logger.warning('Discovery failed: %s', e)
            return False

    def _handle_acquire_subscription(self, topic, msg_type, owner_id, qos_profile=None) -> bool:
        with self._lock:
            if topic in self._subs:
                if self._subscription_types[topic] != msg_type:
                    raise SubscriptionError(
                        f'Conflicting message type for {topic}.', 'type_conflict', False)
                self._subscription_users[topic].add(owner_id)
                return True
        # Resolve QoS in the ROS thread, without nesting requests onto its own queue.
        profile = dict(KNOWN_TOPIC_QOS_PRESETS.get(topic) or qos_profile
                       or self._handle_get_publisher_qos(topic))
        sub = self._create_sub(topic, msg_type, profile)
        if not sub:
            return False
        with self._lock:
            self._subs[topic] = sub
            self._subscription_users[topic] = {owner_id}
            self._subscription_types[topic] = msg_type
            if profile.get('durability') == 'transient_local':
                self._topics_transient_local.add(topic)
        logger.info('ROS2 subscribe: topic=%s msg_type=%s', topic, msg_type)
        return True

    def _handle_release_subscriptions(self, owner_id) -> bool:
        with self._lock:
            empty = []
            for topic, users in self._subscription_users.items():
                users.discard(owner_id)
                if not users:
                    empty.append(topic)
        for topic in empty:
            self._handle_remove_subscription(topic)
        return True

    def _handle_get_publisher_qos(self, topic: str) -> dict[str, Any]:
        if not self._rclpy_node:
            return get_default_qos_profile()
        try:
            publisher_infos = self._rclpy_node.get_publishers_info_by_topic(topic)
        except Exception as e:
            logger.warning(
                'Publisher QoS lookup failed: topic=%s error=%s',
                topic,
                e,
            )
            return get_default_qos_profile()
        return resolve_qos_from_publisher_info(publisher_infos)

    def _handle_remove_subscription(self, topic: str) -> bool:
        with self._lock:
            if self._subscription_users.get(topic):
                return False
            sub = self._subs.pop(topic, None)
            self._subscription_users.pop(topic, None)
            self._subscription_types.pop(topic, None)
            self._topics_transient_local.discard(topic)
            self._msg_cache.pop(topic, None)
        if sub is None:
            return True
        if sub and self._rclpy_node:
            self._rclpy_node.destroy_subscription(sub)
            logger.info('ROS2 unsubscribe: topic=%s', topic)
            return True
        return False

    def _get_or_create_publisher(self, topic: str, msg_type: str):
        pub_key = (topic, msg_type)
        with self._lock:
            pub = self._pubs.get(pub_key)
        if pub is None and self._rclpy_node:
            msg_class = get_message_class(msg_type)
            if msg_class is None:
                return None
            pub = self._rclpy_node.create_publisher(msg_class, topic, 5)
            with self._lock:
                self._pubs[pub_key] = pub
        return pub

    def _handle_publish_topic(
        self,
        topic: str,
        msg_type: str,
        data: dict[str, Any],
        require_subscriber: bool = False,
    ) -> bool:
        if not self._rclpy_node:
            return False
        msg_class = get_message_class(msg_type)
        if msg_class is None:
            logger.error('Unknown message type for publish: %s', msg_type)
            return False

        pub = self._get_or_create_publisher(topic, msg_type)
        if pub is None or (require_subscriber and not self._has_external_subscriber(topic, pub)):
            logger.warning('No subscriber matched for jog topic: %s', topic)
            return False

        try:
            msg = msg_class()
            if msg_type == 'trajectory_msgs/msg/JointTrajectory':
                # Nested message arrays need actual JointTrajectoryPoint instances.
                from rosidl_runtime_py.set_message import set_message_fields
                set_message_fields(msg, data)
            else:
                self._populate_message(msg, data)
            pub.publish(msg)
            return True
        except Exception as e:
            logger.warning(
                'ROS2 publish failed: topic=%s msg_type=%s error=%s',
                topic,
                msg_type,
                e,
            )
            return False

    def _has_external_subscriber(self, topic, publisher):
        """Do not count this bridge's recorder/cache subscription as a motion receiver."""
        if not self._rclpy_node or publisher.get_subscription_count() == 0:
            return False
        own = (self._rclpy_node.get_name(), self._rclpy_node.get_namespace())
        return any((endpoint.node_name, endpoint.node_namespace) != own
                   for endpoint in self._rclpy_node.get_subscriptions_info_by_topic(topic))

    # ------------------------------------------------------------------
    # Spin thread — rclpy helpers
    # ------------------------------------------------------------------

    def _create_sub(
        self,
        topic: str,
        msg_type: str,
        qos_profile: Optional[dict] = None,
    ) -> Optional[Subscription]:
        if not self._rclpy_node:
            return None
        try:
            msg_class = get_message_class(msg_type)
        except (ValueError, ImportError, AttributeError):
            msg_class = None
        if msg_class is None:
            raise SubscriptionError(
                f'Unsupported message type: {msg_type}.', 'invalid_message_type', False)

        def callback(msg: Any) -> None:
            timestamp = time.time_ns()
            with self._lock:
                if self._subs.get(topic) is not subscription:
                    return
                self._msg_cache[topic] = {'raw_message': msg, 'received_at': timestamp / 1e9}
                listeners = tuple(self._message_listeners.get(topic, ()))
            for listener in listeners:
                try:
                    listener(topic, msg, timestamp)
                except Exception:
                    logger.exception('Message listener failed for %s', topic)

        profile = qos_profile or {}
        qos = parse_qos_profile(profile)
        subscription = self._rclpy_node.create_subscription(msg_class, topic, callback, qos)
        return subscription

    def _populate_message(self, msg: Any, values: dict[str, Any]) -> None:
        for key, value in values.items():
            current = getattr(msg, key, None)
            if isinstance(value, dict) and hasattr(current, 'get_fields_and_field_types'):
                self._populate_message(current, value)
            else:
                setattr(msg, key, value)

    # ------------------------------------------------------------------
    # Internals — cache and topic resolution
    # ------------------------------------------------------------------

    def _resolve_topic_msg_type_locked(self, topic: str) -> str:
        """Resolve message type for topic. Requires caller to hold self._lock."""
        return (
            self._subscription_types.get(topic)
            or KNOWN_TOPIC_TYPES.get(topic)
            or (self._discovered_topics.get(topic) or [''])[0]
        )

    def _is_cached_valid(self, topic: str, cached: TopicCacheEntry) -> bool:
        """Return True if cached data is still valid (not stale)."""
        is_static = topic in STATIC_TOPICS or topic in self._topics_transient_local
        if is_static:
            return True
        received_at = cached.get('received_at')
        if received_at is None:
            return True
        return (time.time() - received_at) <= DYNAMIC_TOPIC_STALE_TIME

    def _build_topic_status_locked(self, topic: str) -> dict[str, Any]:
        """Build topic status entry. Requires caller to hold self._lock."""
        cached = self._msg_cache.get(topic)
        available = False

        if cached:
            if self._is_cached_valid(topic, cached):
                available = True
            else:
                del self._msg_cache[topic]

        return {
            'available': available,
            'msg_type': self._resolve_topic_msg_type_locked(topic),
            'subscribed': topic in self._subs,
        }

    # ------------------------------------------------------------------
    # Internals — cleanup
    # ------------------------------------------------------------------

    def _clear_runtime_state(self) -> None:
        """Clear in-memory topic/runtime caches."""
        self._msg_cache.clear()
        self._discovered_topics.clear()
        self._topics_transient_local.clear()
        self._message_listeners.clear()
        self._subscription_users.clear()
        self._subscription_types.clear()

    def _remove_all_subscriptions(self) -> None:
        if not self._rclpy_node:
            return
        with self._lock:
            all_subs = list(self._subs.items())
            self._subs.clear()
        for topic, sub in all_subs:
            try:
                self._rclpy_node.destroy_subscription(sub)
            except Exception as e:
                logger.warning('Error destroying sub %s: %s', topic, e)

    def _remove_all_publishers(self) -> None:
        if not self._rclpy_node:
            return
        with self._lock:
            pubs = list(self._pubs.items())
            self._pubs.clear()
        for (topic, _msg_type), pub in pubs:
            try:
                self._rclpy_node.destroy_publisher(pub)
            except Exception as e:
                logger.warning('Error destroying publisher %s: %s', topic, e)
