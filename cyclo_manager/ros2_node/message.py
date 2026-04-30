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

"""ROS2 message conversion and QoS utilities."""

import importlib
import logging
import math
from typing import Any, Callable

from rclpy.qos import QoSProfile, DurabilityPolicy, HistoryPolicy, ReliabilityPolicy

try:
    from rosidl_runtime_py import get_message_class
except ImportError:

    def get_message_class(type_str: str):  # type: ignore[misc]
        """Resolve message class from 'pkg/msg/Name' (e.g. Humble has no get_message_class)."""
        parts = type_str.split("/")
        if len(parts) != 3 or parts[1] != "msg":
            return None
        pkg, _, name = parts
        try:
            mod = importlib.import_module(f"{pkg}.msg")
            return getattr(mod, name)
        except (ImportError, AttributeError):
            return None


logger = logging.getLogger(__name__)


def convert_value_for_json(obj: Any) -> Any:
    """Convert a value to JSON-serializable form (handles NaN, numpy arrays, ROS2 msgs)."""
    if obj is None:
        return None
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (str, int, bool)):
        return obj
    if hasattr(obj, "tolist"):
        try:
            return convert_value_for_json(obj.tolist())
        except Exception:
            return str(obj)
    if isinstance(obj, (list, tuple)):
        return [convert_value_for_json(x) for x in obj]
    if hasattr(obj, "get_fields_and_field_types"):
        result = {}
        for k in obj.get_fields_and_field_types().keys():
            try:
                v = getattr(obj, k, None)
                result[k] = convert_value_for_json(v)
            except Exception:
                result[k] = None
        return result
    if hasattr(obj, "__dict__"):
        result = {}
        for k, v in obj.__dict__.items():
            if k.startswith("_"):
                continue
            result[k] = convert_value_for_json(v)
        return result
    return str(obj)


def message_to_dict(msg: Any, convert_nested: Callable[[Any], Any]) -> Any:
    """Convert ROS2 message to dict using the given nested value converter."""
    if msg is None:
        return None
    try:
        if hasattr(msg, "get_fields_and_field_types"):
            result = {}
            for key in msg.get_fields_and_field_types().keys():
                try:
                    value = getattr(msg, key, None)
                    result[key] = convert_nested(value)
                except Exception:
                    result[key] = None
            return result
        if hasattr(msg, "__dict__"):
            result = {}
            for key, value in msg.__dict__.items():
                if key.startswith("_"):
                    continue
                if hasattr(value, "tolist") and hasattr(value, "shape"):
                    try:
                        result[key] = value.tolist()
                    except Exception:
                        result[key] = str(value)
                elif hasattr(value, "__dict__") or isinstance(value, (list, tuple)):
                    result[key] = convert_nested(value)
                else:
                    result[key] = value
            return result
        return str(msg)
    except Exception as e:
        logger.warning("Failed to convert message to dict: %s", e)
        return str(msg)


def parse_qos_profile(profile: dict[str, Any]) -> QoSProfile:
    """Build QoSProfile from dict (depth, reliability, durability)."""
    depth = profile.get("depth", 10)
    reliability = (
        ReliabilityPolicy.BEST_EFFORT
        if profile.get("reliability") == "best_effort"
        else ReliabilityPolicy.RELIABLE
    )
    durability = (
        DurabilityPolicy.TRANSIENT_LOCAL
        if profile.get("durability") == "transient_local"
        else DurabilityPolicy.VOLATILE
    )
    return QoSProfile(
        depth=depth,
        reliability=reliability,
        durability=durability,
        history=HistoryPolicy.KEEP_LAST,
    )
