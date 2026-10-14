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

from dataclasses import dataclass, field
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
from rclpy.duration import Duration
from rclpy.executors import SingleThreadedExecutor
from rclpy.guard_condition import GuardCondition
from rclpy.node import Node
from rclpy.publisher import Publisher
from rclpy.subscription import Subscription

logger = logging.getLogger(__name__)

RCLPY_NODE_NAME = 'cyclo_manager'
PUBLISHER_RELEASE_ACK_BUDGET = 0.1


class RequestKind:
    """Request types for spin thread queue."""

    MOTION_GRAPH = 'motion_graph'
    INSPECT_PUBLISHERS = 'inspect_publishers'
    RUN_DISCOVERY = 'run_discovery'
    ACQUIRE_SUBSCRIPTION = 'acquire_subscription'
    RELEASE_SUBSCRIPTIONS = 'release_subscriptions'
    PUBLISH_TOPIC = 'publish_topic'
    ACQUIRE_PUBLISHERS = 'acquire_publishers'
    RELEASE_PUBLISHERS = 'release_publishers'
    READ_RETAINED = 'read_retained'


RequestPayload: TypeAlias = tuple[Any, queue.Queue[Any]]
RequestOp: TypeAlias = tuple[str, RequestPayload]
TopicCacheEntry: TypeAlias = dict[str, Any]


@dataclass
class RetainedRead:
    """A bounded, independent subscription that never reads or changes shared caches."""

    topic: str
    msg_type: str
    deadline: float
    cancelled: threading.Event
    response: queue.Queue[Any] = field(default_factory=lambda: queue.Queue(maxsize=1))

    def active(self) -> bool:
        return not self.cancelled.is_set() and time.monotonic() < self.deadline


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
        self._request_guard: Optional[GuardCondition] = None
        self._spin_thread: Optional[threading.Thread] = None
        self._topics_transient_local: set[str] = set()
        self._is_running = False
        self._lock = threading.Lock()

        self._subs: dict[str, Subscription] = {}
        self._pubs: dict[str, Publisher] = {}
        self._publisher_users: dict[str, set[str]] = {}
        self._publisher_types: dict[str, str] = {}
        self._msg_cache: dict[str, TopicCacheEntry] = {}
        self._discovered_topics: dict[str, list[str]] = {}
        self._message_listeners: dict[str, set] = {}
        self._subscription_users: dict[str, set[str]] = {}
        self._subscription_types: dict[str, str] = {}
        self._retained_reads: list[tuple[Subscription, RetainedRead]] = []

        self._motion_graph_cache = {}
        self._motion_graph_at = 0.0
        self._motion_graph_lock = threading.Lock()

        self._request_queue: queue.Queue[RequestOp] = queue.Queue()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        if self._spin_thread and self._spin_thread.is_alive():
            if self._is_running:
                return
            raise RuntimeError('ROS2 bridge is still stopping.')
        if self._is_running:
            return
        _ensure_rclpy_init()
        self._rclpy_node = Node(
            RCLPY_NODE_NAME,
            allow_undeclared_parameters=True,
        )
        self._executor = SingleThreadedExecutor()
        # Wake spin_once when requests arrive; dispatch stays in the spin loop.
        self._request_guard = self._rclpy_node.create_guard_condition(lambda: None)
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
        if not self._is_running and self._rclpy_node is None:
            return
        with self._lock:
            self._is_running = False
        self._wake_requests()
        if self._spin_thread and self._spin_thread.is_alive():
            if self._spin_thread is threading.current_thread():
                return  # The spin loop's finally block owns resource destruction.
            self._spin_thread.join(timeout=5.0)
            if self._spin_thread.is_alive():
                raise RuntimeError('ROS2 spin thread is still stopping; cleanup is deferred.')
        elif self._spin_thread is None:
            self._destroy_ros_resources()

    def _destroy_ros_resources(self) -> None:
        """Destroy endpoints after the spin loop exits, on its owning thread."""
        try:
            while True:
                kind, (_, response) = self._request_queue.get_nowait()
                result = (SubscriptionError('ROS bridge stopped.')
                          if kind == RequestKind.READ_RETAINED else False)
                response.put_nowait(result)
        except queue.Empty:
            pass
        self._remove_all_subscriptions()
        self._remove_all_publishers()
        with self._lock:
            # Serialize with trigger() before destroy_node destroys the guard.
            self._request_guard = None
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

    def read_retained(self, topic: str, msg_type: str, timeout: float,
                      cancelled: threading.Event) -> dict[str, Any] | None:
        """Wait off the ROS thread for a fresh retained delivery, not an old cache entry."""
        if not self._is_running:
            raise SubscriptionError('ROS bridge unavailable.')
        request = RetainedRead(topic, msg_type, time.monotonic() + timeout, cancelled)
        with self._lock:
            if not self._is_running:
                raise SubscriptionError('ROS bridge unavailable.')
            self._request_queue.put((RequestKind.READ_RETAINED, (request, request.response)))
        self._wake_requests()
        try:
            while request.active() and self._is_running:
                try:
                    result = request.response.get(
                        timeout=min(.05, max(0, request.deadline - time.monotonic())))
                except queue.Empty:
                    continue
                if isinstance(result, Exception):
                    raise result
                return message_to_dict(result, convert_value_for_json)
            return None
        finally:
            cancelled.set()

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

    def publish_jog(self, topic: str, msg_type: str, data: dict[str, Any],
                    owner_id: str) -> bool:
        """Never execute a command after its owner closes or its queue deadline expires."""
        if not self._is_running:
            return False
        return self._enqueue_request(
            RequestKind.PUBLISH_TOPIC,
            (topic, msg_type, data, owner_id, time.monotonic() + 0.25),
            timeout=0.5,
        ) is True

    def acquire_publishers(self, topics: list[tuple[str, str]], owner_id: str) -> bool:
        """Register a consumer and allow discovery before its first command."""
        if not self._is_running:
            return False
        return self._enqueue_request(
            RequestKind.ACQUIRE_PUBLISHERS,
            (topics, owner_id, time.monotonic() + 5.0),
        ) is True

    def release_publishers(self, owner_id: str) -> bool:
        """Remove publishers only after their last consumer leaves."""
        if not self._is_running:
            return False
        return self._enqueue_request(RequestKind.RELEASE_PUBLISHERS, owner_id) is True

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

    def motion_graph(self):
        """Cache lightweight graph inspection; never read graph APIs from HTTP threads."""
        with self._motion_graph_lock:
            if time.monotonic() - self._motion_graph_at >= 2:
                self._motion_graph_cache = self._enqueue_request(
                    RequestKind.MOTION_GRAPH, timeout=0.3) or {}
                self._motion_graph_at = time.monotonic()
            return self._motion_graph_cache

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
        try:
            while self._is_running and self._executor and self._rclpy_node:
                try:
                    self._cleanup_retained_reads()
                    self._process_request()
                except Exception as e:
                    logger.debug('Request process error: %s', e)
                if not self._is_running:
                    break
                try:
                    self._executor.spin_once(timeout_sec=0.1)
                except Exception as e:
                    if self._is_running:
                        logger.debug('Spin once error: %s', e)
        finally:
            with self._lock:
                self._is_running = False
            self._destroy_ros_resources()

    def _process_request(self) -> None:
        """Process requests from queue (run from spin thread)."""
        try:
            while self._is_running:
                kind, payload = self._request_queue.get_nowait()
                request_payload, response_queue = payload
                if kind == RequestKind.READ_RETAINED:
                    try:
                        self._handle_read_retained(request_payload)
                    except Exception as exc:
                        response_queue.put_nowait(exc)
                    # The subscription callback responds after the executor spins.
                    continue
                elif kind == RequestKind.MOTION_GRAPH:
                    try:
                        result = self._inspect_motion_graph()
                    except Exception:
                        logger.exception('Motion graph inspection failed')
                        result = {}
                elif kind == RequestKind.INSPECT_PUBLISHERS:
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
                elif kind == RequestKind.ACQUIRE_PUBLISHERS:
                    topics, owner_id, deadline = request_payload
                    try:
                        result = time.monotonic() < deadline and self._handle_acquire_publishers(
                            topics, owner_id)
                    except Exception as exc:
                        logger.warning('Publisher acquisition failed: %s', exc)
                        result = False
                elif kind == RequestKind.RELEASE_PUBLISHERS:
                    try:
                        result = self._handle_release_publishers(request_payload)
                    except Exception as exc:
                        logger.warning('Publisher release failed: %s', exc)
                        result = False
                elif kind == RequestKind.PUBLISH_TOPIC:
                    topic, msg_type, data, owner_id, deadline = request_payload
                    try:
                        result = time.monotonic() < deadline and self._handle_publish_topic(
                            topic, msg_type, data, owner_id)
                    except Exception as exc:
                        logger.warning('Publish request failed: topic=%s error=%s', topic, exc)
                        result = False
                else:
                    logger.warning('Unknown request type: op=%s', kind)
                    result = None
                response_queue.put(result)
        except queue.Empty:
            pass

    def _wake_requests(self) -> None:
        """Interrupt the ROS wait without dispatching node operations on callers."""
        with self._lock:
            if self._request_guard is not None:
                self._request_guard.trigger()

    def _enqueue_request(
        self,
        kind: str,
        payload: Any = None,
        timeout: float = 5.0,
    ) -> Any:
        """Enqueue request and wait for its response value."""
        response_queue: queue.Queue[Any] = queue.Queue(maxsize=1)
        with self._lock:
            if not self._is_running:
                return None
            self._request_queue.put((kind, (payload, response_queue)))
        self._wake_requests()
        try:
            return response_queue.get(timeout=timeout)
        except queue.Empty:
            logger.warning('Request processing timeout: op=%s', kind)
            return None

    # ------------------------------------------------------------------
    # Spin thread — request handlers
    # ------------------------------------------------------------------

    def _handle_read_retained(self, request: RetainedRead) -> None:
        if not request.active() or not self._rclpy_node:
            return
        with self._lock:
            existing_type = self._subscription_types.get(request.topic)
        if existing_type and existing_type != request.msg_type:
            raise SubscriptionError(
                f'Topic {request.topic} already uses {existing_type}.', 'type_conflict', False)
        try:
            msg_class = get_message_class(request.msg_type)
        except (ValueError, ImportError, AttributeError):
            msg_class = None
        if msg_class is None:
            raise SubscriptionError(
                f'Unsupported message type: {request.msg_type}.', 'invalid_message_type', False)

        def receive(message):
            if request.active():
                try:
                    request.response.put_nowait(message)
                except queue.Full:
                    pass

        qos = parse_qos_profile({
            'reliability': 'reliable', 'durability': 'transient_local', 'depth': 1})
        try:
            subscription = self._rclpy_node.create_subscription(
                msg_class, request.topic, receive, qos)
        except Exception as exc:
            raise SubscriptionError(f'Cannot subscribe to {request.topic}: {exc}') from exc
        self._retained_reads.append((subscription, request))

    def _cleanup_retained_reads(self, all_reads: bool = False) -> None:
        remaining = []
        for subscription, request in self._retained_reads:
            if all_reads or not request.active():
                request.cancelled.set()
                try:
                    self._rclpy_node.destroy_subscription(subscription)
                except Exception as exc:
                    logger.warning('Cannot destroy retained read for %s: %s', request.topic, exc)
            else:
                remaining.append((subscription, request))
        self._retained_reads = remaining

    def _inspect_motion_graph(self):
        types = {'trajectory_msgs/msg/JointTrajectory',
                 'control_msgs/msg/JointTrajectoryControllerState', 'geometry_msgs/msg/Twist'}
        result = {}

        def endpoints(items):
            return [f'{item.node_namespace.rstrip("/")}/{item.node_name}' for item in items
                    if item.node_name != RCLPY_NODE_NAME]

        for topic, topic_types in self._rclpy_node.get_topic_names_and_types():
            if len(topic_types) != 1 or (
                topic_types[0] not in types
                and topic not in ('/joint_states', '/robot_description')
            ):
                continue
            result[topic] = {
                'type': topic_types[0],
                'publishers': endpoints(self._rclpy_node.get_publishers_info_by_topic(topic)),
                'subscribers': endpoints(self._rclpy_node.get_subscriptions_info_by_topic(topic)),
            }
        return result

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

    def _handle_acquire_publishers(self, topics, owner_id):
        for topic, msg_type in topics:
            if topic in self._pubs:
                if self._publisher_types[topic] != msg_type:
                    raise ValueError(f'Conflicting publisher message type for {topic}.')
            else:
                msg_class = get_message_class(msg_type)
                if msg_class is None or not self._rclpy_node:
                    return False
                self._pubs[topic] = self._rclpy_node.create_publisher(msg_class, topic, 5)
                self._publisher_types[topic] = msg_type
                self._publisher_users[topic] = set()
            self._publisher_users[topic].add(owner_id)
        return True

    def _handle_release_publishers(self, owner_id):
        success = True
        ack_deadline = time.monotonic() + PUBLISHER_RELEASE_ACK_BUDGET
        for topic, users in list(self._publisher_users.items()):
            users.discard(owner_id)
            if users:
                continue
            pub = self._pubs[topic]
            # Share one ACK budget across all topics so cleanup cannot stall other owners.
            try:
                remaining = max(0.0, ack_deadline - time.monotonic())
                if not pub.wait_for_all_acked(Duration(seconds=remaining)):
                    logger.warning('Final publish acknowledgement timed out: %s', topic)
            except Exception as exc:
                logger.warning('Cannot wait for publisher %s: %s', topic, exc)
            try:
                self._rclpy_node.destroy_publisher(pub)
            except Exception as exc:
                logger.warning('Cannot destroy publisher %s: %s', topic, exc)
                success = False
                continue
            del self._pubs[topic]
            del self._publisher_types[topic]
            del self._publisher_users[topic]
        return success

    def _owned_publisher(self, topic, msg_type, owner_id):
        if (owner_id in self._publisher_users.get(topic, ())
                and self._publisher_types.get(topic) == msg_type):
            return self._pubs.get(topic)
        return None

    def _handle_publish_topic(
        self,
        topic: str,
        msg_type: str,
        data: dict[str, Any],
        owner_id: str,
    ) -> bool:
        if not self._rclpy_node:
            return False
        msg_class = get_message_class(msg_type)
        if msg_class is None:
            logger.error('Unknown message type for publish: %s', msg_type)
            return False

        pub = self._owned_publisher(topic, msg_type, owner_id)
        if pub is None:
            logger.warning('Publisher unavailable for topic: %s', topic)
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
        self._cleanup_retained_reads(all_reads=True)
        with self._lock:
            all_subs = list(self._subs.items())
            self._subs.clear()
        for topic, sub in all_subs:
            try:
                self._rclpy_node.destroy_subscription(sub)
            except Exception as e:
                logger.warning('Error destroying sub %s: %s', topic, e)

    def _remove_all_publishers(self) -> None:
        """Clear publisher state on the spin thread after request processing ends."""
        if not self._rclpy_node:
            return
        pubs = list(self._pubs.items())
        self._pubs.clear()
        self._publisher_users.clear()
        self._publisher_types.clear()
        for topic, pub in pubs:
            try:
                self._rclpy_node.destroy_publisher(pub)
            except Exception as e:
                logger.warning('Error destroying publisher %s: %s', topic, e)
