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

import {
  getWebSocketBaseUrl,
  isRecord,
  parseJsonMessage,
  setupWebSocketHandlers,
  stringifyMessageData,
  type WebSocketLifecycleOptions,
} from "@/lib/websocketUtils";

type WebSocketErrorMessage = {
  type: "error";
  data: unknown;
};

export type ROS2TopicData = {
  topic?: string;
  msg_type?: string;
  data?: unknown;
  available?: boolean;
  domain_id?: number;
  [key: string]: unknown;
};

export type ROS2WebSocketMessage = WebSocketErrorMessage | {
  type: "data";
  data: ROS2TopicData;
};

export type ROS2TopicWebSocketOptions = WebSocketLifecycleOptions & {
  onMessage?: (data: ROS2TopicData) => void;
};

function toROS2TopicData(data: unknown): ROS2TopicData {
  if (isRecord(data)) {
    return data as ROS2TopicData;
  }
  return { data };
}

function parseROS2TopicMessage(
  event: MessageEvent,
  options: ROS2TopicWebSocketOptions
): void {
  try {
    const message = parseJsonMessage(event.data);

    if (message.type === "data") {
      options.onMessage?.(toROS2TopicData(message.data));
    } else if (message.type === "error") {
      options.onError?.(new Error(stringifyMessageData(message.data)));
    }
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export function createROS2TopicWebSocket(
  topic: string,
  options: ROS2TopicWebSocketOptions = {}
): WebSocket {
  const baseUrl = getWebSocketBaseUrl();
  const wsUrl = `${baseUrl}/ws/ros2/topics/${encodeURIComponent(topic)}`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => parseROS2TopicMessage(event, options);
  setupWebSocketHandlers(ws, options);

  return ws;
}
