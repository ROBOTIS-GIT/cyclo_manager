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

import { useEffect, useState } from "react";
import {
  createROS2TopicWebSocket,
  type ROS2TopicWebSocketOptions,
} from "@/lib/ros2Websocket";
import type { ROS2TopicDataResponse } from "@/types/api";
import type { WebSocketStatus } from "@/lib/websocketUtils";

export function useROS2TopicWebSocket(
  topic: string | null,
  options: ROS2TopicWebSocketOptions = {}
) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [topicData, setTopicData] = useState<ROS2TopicDataResponse | null>(null);

  useEffect(() => {
    if (!topic) {
      return;
    }

    let isMounted = true;
    setStatus("connecting");

    const websocket = createROS2TopicWebSocket(topic, {
      ...options,
      onOpen: () => {
        if (isMounted) {
          setStatus("connected");
          options.onOpen?.();
        }
      },
      onMessage: (data: ROS2TopicDataResponse) => {
        if (!isMounted) return;
        setTopicData(data);
        options.onMessage?.(data);
      },
      onError: (error: Error) => {
        if (isMounted) {
          setStatus("error");
          options.onError?.(error);
        }
      },
      onClose: () => {
        if (isMounted) {
          setStatus("disconnected");
          options.onClose?.();
        }
      },
    });

    setWs(websocket);

    return () => {
      isMounted = false;
      if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
        websocket.close(1000, "Component unmounting");
      }
      setWs(null);
      setStatus("disconnected");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  return { ws, status, topicData };
}
