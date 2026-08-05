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

export type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

export type WebSocketLifecycleOptions = {
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: (event?: CloseEvent) => void;
};

const WS_CLOSE_CODE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  ABNORMAL: 1006,
} as const;

const DEFAULT_WS_PORT = 8081;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function stringifyMessageData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data) ?? "";
}

export function parseJsonMessage(data: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed)) {
    throw new Error("Invalid WebSocket message");
  }
  return parsed;
}

export function getWebSocketBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;

  if (envUrl) {
    return envUrl.replace(/^http/, "ws");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:${DEFAULT_WS_PORT}`;
  }

  return `ws://localhost:${DEFAULT_WS_PORT}`;
}

function handleWebSocketClose(
  event: CloseEvent,
  options: WebSocketLifecycleOptions
): void {
  if (event.code === WS_CLOSE_CODE.NORMAL || event.code === WS_CLOSE_CODE.GOING_AWAY) {
    return;
  }

  if (event.code === WS_CLOSE_CODE.ABNORMAL) {
    return;
  }

  const reason = event.reason ? `, reason: ${event.reason}` : "";
  options.onError?.(new Error(`WebSocket closed unexpectedly: code ${event.code}${reason}`));
}

export function setupWebSocketHandlers(
  ws: WebSocket,
  options: WebSocketLifecycleOptions
): void {
  ws.onopen = () => {
    options.onOpen?.();
  };

  ws.onerror = () => {
    // Error details are reported by the close event.
  };

  ws.onclose = (event) => {
    handleWebSocketClose(event, options);
    options.onClose?.(event);
  };
}
