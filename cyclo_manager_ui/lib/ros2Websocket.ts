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
  parseWebSocketMessage,
  setupWebSocketHandlers,
  stringifyMessageData,
  type WebSocketLifecycleOptions,
} from "@/lib/websocketUtils";
import type { ROS2TopicDataResponse } from "@/types/api";

type WebSocketErrorMessage = {
  type: "error";
  data: unknown;
};

export type ROS2WebSocketMessage = WebSocketErrorMessage | {
  type: "data";
  data: ROS2TopicDataResponse;
};

export type ROS2TopicWebSocketOptions = WebSocketLifecycleOptions & {
  msgType?: string;
  metadataOnly?: boolean;
  onMessage?: (data: ROS2TopicDataResponse) => void;
};

function toROS2TopicDataResponse(data: unknown): ROS2TopicDataResponse {
  if (
    isRecord(data) &&
    typeof data.topic === "string" &&
    typeof data.msg_type === "string" &&
    typeof data.available === "boolean" &&
    typeof data.domain_id === "number" &&
    "data" in data
  ) {
    return {
      topic: data.topic,
      msg_type: data.msg_type,
      data: data.data,
      available: data.available,
      domain_id: data.domain_id,
    };
  }
  return {
    topic: "",
    msg_type: "",
    data,
    available: false,
    domain_id: 0,
  };
}

function parseROS2TopicMessage(
  event: MessageEvent,
  options: ROS2TopicWebSocketOptions
): void {
  try {
    const message = parseWebSocketMessage(event);

    if (message.type === "data") {
      options.onMessage?.(toROS2TopicDataResponse(message.data));
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
  const query = new URLSearchParams();
  if (options.msgType) query.set("msg_type", options.msgType);
  if (options.metadataOnly) query.set("metadata_only", "true");
  const wsUrl = `${baseUrl}/ws/ros2/topics/${encodeURIComponent(topic)}?${query}`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => parseROS2TopicMessage(event, options);
  setupWebSocketHandlers(ws, options);

  return ws;
}
