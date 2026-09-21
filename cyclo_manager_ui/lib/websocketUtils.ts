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

// The payload consumer and recovery listener share one decode per browser event.
// Weak keys let large payloads be collected when dispatch completes.
const decodedMessages = new WeakMap<MessageEvent, Record<string, unknown>>();
export function parseWebSocketMessage(event: MessageEvent): Record<string, unknown> {
  const cached = decodedMessages.get(event);
  if (cached) return cached;
  const message = parseJsonMessage(event.data);
  decodedMessages.set(event, message);
  return message;
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


export type ObserverConnectionState = {
  status: WebSocketStatus;
  error: string | null;
  retryInMs: number | null;
};
export const OBSERVER_CONNECTING: ObserverConnectionState = {
  status: "connecting", error: null, retryInMs: null,
};
export type ObserverHandle = (() => void) & { reconnect: () => void };

/** Retry transient failures; only an explicit subscription acknowledgement resets backoff. */
export function maintainWebSocket(connect: () => WebSocket, options: {
  onState?: (state: ObserverConnectionState) => void;
} = {}): ObserverHandle {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let detach = () => {};
  let failures = 0;
  let lastError: string | null = null;
  const report = (status: WebSocketStatus, retryInMs: number | null = null) => {
    if (!disposed) options.onState?.({ status, error: lastError, retryInMs });
  };
  const schedule = () => {
    if (disposed) return;
    const base = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
    const delay = Math.round(Math.min(30000, base * (0.8 + Math.random() * 0.4)));
    clearTimeout(timer);
    timer = setTimeout(open, delay);
    report("disconnected", delay);
  };
  const open = () => {
    if (disposed) return;
    timer = undefined;
    report("connecting");
    let current: WebSocket;
    try { current = connect(); }
    catch (error) {
      lastError = error instanceof Error ? error.message : "Connection failed";
      schedule(); return;
    }
    // Also covers synchronous re-entry from a custom connector.
    if (disposed) { current.close(1000, "Observer disposed"); return; }
    socket = current;
    let retryable = true;
    let failureReceived = false;
    const onMessage = (event: MessageEvent) => {
      if (disposed || socket !== current) return;
      try {
        const message = parseWebSocketMessage(event);
        if (message.type === "ready" && !failureReceived) {
          failures = 0; lastError = null;
          report("connected");
        } else if (message.type === "error") {
          failureReceived = true;
          retryable = message.retryable !== false;
          lastError = typeof message.data === "string" ? message.data : "Subscription failed";
          report("error");
          if (!retryable) current.close(1000, "Subscription rejected");
        }
      } catch { /* Payload validation belongs to the specific observer. */ }
    };
    const onClose = (event: CloseEvent) => {
      if (disposed || socket !== current) return;
      detach(); socket = undefined;
      lastError ??= event.reason || "Connection lost.";
      const terminal = [1002, 1003, 1007, 1008, 1009, 1010, 4400, 4401, 4403, 4409].includes(event.code);
      if (!retryable || terminal) { report("error"); return; }
      schedule();
    };
    current.addEventListener("message", onMessage);
    current.addEventListener("close", onClose);
    detach = () => {
      current.removeEventListener("message", onMessage);
      current.removeEventListener("close", onClose);
    };
  };
  const closeCurrent = () => {
    clearTimeout(timer); timer = undefined;
    detach();
    const previous = socket; socket = undefined;
    previous?.close(1000, "Observer disposed");
  };
  open();
  const dispose = () => { disposed = true; closeCurrent(); };
  return Object.assign(dispose, { reconnect: () => {
    if (disposed) return;
    closeCurrent(); failures = 0; open();
  } });
}
