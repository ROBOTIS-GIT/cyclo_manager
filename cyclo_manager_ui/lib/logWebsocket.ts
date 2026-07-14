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
  parseJsonMessage,
  setupWebSocketHandlers,
  stringifyMessageData,
  type WebSocketLifecycleOptions,
} from "@/lib/websocketUtils";

type WebSocketErrorMessage = {
  type: "error";
  data: unknown;
};

export type LogWebSocketMessage = WebSocketErrorMessage | {
  type: "logs";
  data: unknown;
};

export type LogWebSocketOptions = WebSocketLifecycleOptions & {
  onMessage?: (data: string) => void;
};

function parseLogWebSocketMessage(
  event: MessageEvent,
  options: LogWebSocketOptions
): void {
  try {
    const message = parseJsonMessage(event.data);

    if (message.type === "logs") {
      const logs = stringifyMessageData(message.data);
      options.onMessage?.(logs);
    } else if (message.type === "error") {
      options.onError?.(new Error(stringifyMessageData(message.data)));
    }
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error("Unknown error"));
  }
}

export function createLogsWebSocket(
  container: string,
  service: string,
  options: LogWebSocketOptions = {}
): WebSocket {
  const baseUrl = getWebSocketBaseUrl();
  const wsUrl = `${baseUrl}/ws/${container}/services/${service}/logs`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => parseLogWebSocketMessage(event, options);
  setupWebSocketHandlers(ws, options);

  return ws;
}
