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

"""ROS2 QoS profile utilities."""

from __future__ import annotations

from typing import Any

from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy

DEFAULT_QOS_PROFILE: dict[str, Any] = {
    'durability': 'volatile',
    'reliability': 'reliable',
    'depth': 10,
}


def get_default_qos_profile() -> dict[str, Any]:
    """Return the fallback subscriber QoS when publisher info is unavailable."""
    return dict(DEFAULT_QOS_PROFILE)


def resolve_qos_from_publisher_info(publisher_infos: list[Any]) -> dict[str, Any]:
    """
    Build a subscriber QoS dict from discovered publisher endpoint info.

    Durability: VOLATILE if any publisher uses it; TRANSIENT_LOCAL only when all do.
    Reliability: BEST_EFFORT if any publisher uses it.
    """
    if not publisher_infos:
        return get_default_qos_profile()

    result = get_default_qos_profile()
    durabilities = []
    reliabilities = []
    depths: list[int] = []

    for endpoint in publisher_infos:
        qos = endpoint.qos_profile
        durabilities.append(qos.durability)
        reliabilities.append(qos.reliability)
        if qos.history == HistoryPolicy.KEEP_LAST:
            depths.append(qos.depth)

    if any(d == DurabilityPolicy.VOLATILE for d in durabilities):
        result['durability'] = 'volatile'
    elif all(d == DurabilityPolicy.TRANSIENT_LOCAL for d in durabilities):
        result['durability'] = 'transient_local'
        result['depth'] = 1

    if any(r == ReliabilityPolicy.BEST_EFFORT for r in reliabilities):
        result['reliability'] = 'best_effort'

    if depths and result['durability'] != 'transient_local':
        result['depth'] = max(depths)

    return result


def parse_qos_profile(profile: dict[str, Any]) -> QoSProfile:
    """Build QoSProfile from dict (depth, reliability, durability)."""
    depth = profile.get('depth', 10)
    reliability = (
        ReliabilityPolicy.BEST_EFFORT
        if profile.get('reliability') == 'best_effort'
        else ReliabilityPolicy.RELIABLE
    )
    durability = (
        DurabilityPolicy.TRANSIENT_LOCAL
        if profile.get('durability') == 'transient_local'
        else DurabilityPolicy.VOLATILE
    )
    return QoSProfile(
        depth=depth,
        reliability=reliability,
        durability=durability,
        history=HistoryPolicy.KEEP_LAST,
    )
