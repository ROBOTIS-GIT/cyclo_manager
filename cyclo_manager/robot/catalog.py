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

"""Discover motion inputs from ROS endpoint ownership and controller feedback."""

import time

from cyclo_manager.robot.profiles import GROUPS

TRAJECTORY_TYPE = 'trajectory_msgs/msg/JointTrajectory'
STATE_TYPE = 'control_msgs/msg/JointTrajectoryControllerState'



def catalog(bridge, subscriptions=None):
    """Subscribe only to controller feedback; trajectory payloads are recorded on demand."""
    graph = bridge.motion_graph()
    states = {}
    for topic, info in graph.items():
        if info['type'] != STATE_TYPE or len(info['publishers']) != 1:
            continue
        if subscriptions is not None:
            subscriptions.subscribe(topic, STATE_TYPE)
        cached = bridge.get_topic_data(topic)
        if not cached or time.time() - cached['received_at'] > 2:
            continue
        names = cached['data'].get('joint_names', [])
        if names and len(set(names)) == len(names) and all(isinstance(n, str) for n in names):
            states[topic] = names
    result = []
    for topic, info in graph.items():
        if info['type'] != TRAJECTORY_TYPE:
            continue
        matches = [names for state, names in states.items()
                   if set(info['subscribers']) & set(graph[state]['publishers'])]
        # Multiple state sources are ambiguous even when a topic name looks familiar.
        names = matches[0] if len(matches) == 1 else []
        recommended = GROUPS.get(topic)
        result.append({'id': topic, 'topic': topic,
                       'label': recommended[1] if recommended else topic,
                       'alias': recommended[0] if recommended else None,
                       'recommended': bool(recommended), 'joints': names,
                       'subscribed': bool(info['subscribers']),
                       'receiving': bool(info['publishers'])})
    return sorted(result, key=lambda item: (not item['recommended'], item['topic']))


def base_topics(bridge):
    """Twist inputs with an external subscriber, without robot-name assumptions."""
    return sorted(topic for topic, info in bridge.motion_graph().items()
                  if info['type'] == 'geometry_msgs/msg/Twist' and info['subscribers'])
