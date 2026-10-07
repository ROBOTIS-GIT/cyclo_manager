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
import { getWebSocketBaseUrl, maintainWebSocket, parseWebSocketMessage, isRecord, OBSERVER_CONNECTING, type ObserverConnectionState, type ObserverHandle } from "@/lib/websocketUtils";

type Telemetry = { batteries: Record<string, number | null>; cameras: Record<string, boolean | null> };
const EMPTY: Telemetry = { batteries: {}, cameras: {} };

export function useSystemTelemetry(battery: string[], camera: string[], enabled: boolean) {
  const key = JSON.stringify({ battery, camera, enabled });
  const handle = useRef<ObserverHandle | null>(null);
  const [result, setResult] = useState<{ key: string; data: Telemetry; connection: ObserverConnectionState } | null>(null);
  useEffect(() => {
    const config = JSON.parse(key) as { battery: string[]; camera: string[]; enabled: boolean };
    if (!config.enabled) return;
    let active = true;
    let generation = 0;
    let data = EMPTY;
    let connection = OBSERVER_CONNECTING;
    const update = () => { if (active) setResult({ key, data, connection }); };
    const latest = (value: Telemetry) => { data = value; update(); };
    const query = new URLSearchParams();
    config.battery.forEach(topic => query.append("battery", topic));
    config.camera.forEach(topic => query.append("camera", topic));
    const dispose = maintainWebSocket(() => {
      const current = ++generation;
      const ws = new WebSocket(`${getWebSocketBaseUrl()}/ws/ros2/system-status?${query}`);
      ws.onmessage = event => {
        if (!active || generation !== current) return;
        try {
          const message = parseWebSocketMessage(event);
          if (message.type !== "data" || !isRecord(message.data)) return;
          const { batteries, cameras } = message.data;
          if (!isRecord(batteries) || !isRecord(cameras)) return;
          const data: Telemetry = { batteries: {}, cameras: {} };
          config.battery.forEach(topic => {
            const value = batteries[topic];
            data.batteries[topic] = typeof value === "number" && Number.isFinite(value) ? value : null;
          });
          config.camera.forEach(topic => {
            data.cameras[topic] = typeof cameras[topic] === "boolean" ? cameras[topic] : null;
          });
          latest(data);
        } catch { /* Ignore malformed status frames. */ }
      };
      return ws;
    }, { onState: value => {
      connection = value;
      if (value.status !== "connected") data = EMPTY;
      update();
    } });
    handle.current = dispose;
    return () => { active = false; handle.current = null; dispose(); };
  }, [key]);
  const current = result?.key === key ? result : null;
  return { ...(current?.data ?? EMPTY), connection: current?.connection ?? OBSERVER_CONNECTING,
    reconnect: () => handle.current?.reconnect() };
}
