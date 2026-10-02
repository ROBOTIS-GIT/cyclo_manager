// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Hyungyu Kim

"use client";

import { useEffect, useRef, useState } from "react";
import { createROS2TopicWebSocket, type ROS2TopicWebSocketOptions } from "@/lib/ros2Websocket";
import type { ROS2TopicDataResponse } from "@/types/api";
import { maintainWebSocket, OBSERVER_CONNECTING, type ObserverConnectionState, type ObserverHandle } from "@/lib/websocketUtils";

export function useROS2TopicWebSocket(topic: string | null, options: ROS2TopicWebSocketOptions = {}) {
  const key = JSON.stringify([topic, options.msgType, options.metadataOnly]);
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });
  const handle = useRef<ObserverHandle | null>(null);
  const [result, setResult] = useState<{
    key: string; data: ROS2TopicDataResponse | null; connection: ObserverConnectionState;
  } | null>(null);
  useEffect(() => {
    if (!topic) return;
    const [, msgType, metadataOnly] = JSON.parse(key) as [string, string | undefined, boolean | undefined];
    let active = true;
    let generation = 0;
    let data: ROS2TopicDataResponse | null = null;
    let connection = OBSERVER_CONNECTING;
    const update = () => { if (active) setResult({ key, data, connection }); };
    const dispose = maintainWebSocket(() => {
      const current = ++generation;
      return createROS2TopicWebSocket(topic, {
        msgType, metadataOnly,
        onOpen: () => { if (active && generation === current) callbacks.current.onOpen?.(); },
        onMessage: value => {
          if (!active || generation !== current) return;
          data = value; update(); callbacks.current.onMessage?.(value);
        },
        onClose: event => { if (active && generation === current) callbacks.current.onClose?.(event); },
      });
    }, { onState: value => {
      if (!active) return;
      if (value.error && value.error !== connection.error) callbacks.current.onError?.(new Error(value.error));
      connection = value;
      if (value.status !== "connected") data = null;
      update();
    } });
    handle.current = dispose;
    return () => { active = false; handle.current = null; dispose(); };
  }, [topic, key]);
  const current = result?.key === key ? result : null;
  const connection = topic ? current?.connection ?? OBSERVER_CONNECTING
    : { status: "disconnected" as const, error: null, retryInMs: null };
  return { topicData: current?.data ?? null, status: connection.status,
    error: connection.error, connection, reconnect: () => handle.current?.reconnect() };
}
