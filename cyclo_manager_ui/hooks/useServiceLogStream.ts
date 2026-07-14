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

import { useCallback, useEffect, useRef, useState } from "react";
import { clearServiceLogs } from "@/lib/api";
import { createLogsWebSocket } from "@/lib/logWebsocket";

const LOG_UPDATE_DEBOUNCE_MS = 200;
const RECONNECT_DELAY_MS = 3000;
const WS_CLOSE_CODE_NORMAL = 1000;
const WS_CLOSE_CODE_GOING_AWAY = 1001;
const MAX_LOG_LINES = 5000;

type UseServiceLogStreamResult = {
  lines: string[];
  error: string | null;
  isConnected: boolean;
  isClearing: boolean;
  clearLogs: () => Promise<void>;
};

function trimLogLines(lines: string[]): string[] {
  return lines.length <= MAX_LOG_LINES ? lines : lines.slice(-MAX_LOG_LINES);
}

export function useServiceLogStream(
  container: string,
  service: string
): UseServiceLogStreamResult {
  const [lines, setLines] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const pendingRef = useRef<string>("");
  const partialLineRef = useRef<string>("");
  const logUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEmptyLogsRef = useRef(true);

  const flushPending = useCallback(() => {
    const raw = partialLineRef.current + pendingRef.current;
    pendingRef.current = "";

    const parts = raw.split("\n");
    if (raw.endsWith("\n")) {
      partialLineRef.current = "";
    } else {
      partialLineRef.current = parts.pop() ?? "";
    }

    if (parts.length === 0) {
      return;
    }

    setLines((prev) => trimLogLines([...prev, ...parts]));
  }, []);

  const connectWebSocket = useCallback(() => {
    if (!isMountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.close(WS_CLOSE_CODE_NORMAL, "Reconnecting");
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setError(null);
    setIsConnected(false);
    shouldReconnectRef.current = true;
    setLines([]);
    pendingRef.current = "";
    partialLineRef.current = "";
    isEmptyLogsRef.current = true;

    try {
      const ws = createLogsWebSocket(container, service, {
        onMessage: (data: string) => {
          if (!isMountedRef.current) return;

          if (data.length === 0) {
            setIsConnected(true);
            return;
          }

          pendingRef.current += data;

          if (isEmptyLogsRef.current) {
            flushPending();
            isEmptyLogsRef.current = false;
            setIsConnected(true);
          } else {
            if (logUpdateTimeoutRef.current) {
              clearTimeout(logUpdateTimeoutRef.current);
            }
            logUpdateTimeoutRef.current = setTimeout(() => {
              if (!isMountedRef.current) return;
              flushPending();
            }, LOG_UPDATE_DEBOUNCE_MS);
          }
        },
        onError: (err: Error) => {
          if (!isMountedRef.current) return;
          setError(err.message);
          setIsConnected(false);

          if (err.message.includes("stopped") || err.message.includes("both stopped")) {
            shouldReconnectRef.current = false;
          }
        },
        onOpen: () => {
          if (!isMountedRef.current) return;
          setIsConnected(true);
          setError(null);
        },
        onClose: (event?: CloseEvent) => {
          if (!isMountedRef.current) return;
          setIsConnected(false);

          const shouldReconnect =
            isMountedRef.current &&
            wsRef.current === ws &&
            shouldReconnectRef.current &&
            event?.code !== WS_CLOSE_CODE_NORMAL &&
            event?.code !== WS_CLOSE_CODE_GOING_AWAY;

          if (shouldReconnect) {
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current && shouldReconnectRef.current) {
                connectWebSocket();
              }
            }, RECONNECT_DELAY_MS);
          }
        },
      });

      wsRef.current = ws;
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to connect to WebSocket");
    }
  }, [container, service, flushPending]);

  const clearLogs = useCallback(async () => {
    setIsClearing(true);
    setError(null);

    try {
      await clearServiceLogs(container, service);
      if (!isMountedRef.current) return;

      setLines([]);
      pendingRef.current = "";
      partialLineRef.current = "";
      isEmptyLogsRef.current = true;
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to clear logs");
    } finally {
      if (isMountedRef.current) {
        setIsClearing(false);
      }
    }
  }, [container, service]);

  useEffect(() => {
    isMountedRef.current = true;
    shouldReconnectRef.current = true;
    isEmptyLogsRef.current = true;
    connectWebSocket();

    return () => {
      isMountedRef.current = false;
      shouldReconnectRef.current = false;

      if (wsRef.current) {
        wsRef.current.close(WS_CLOSE_CODE_NORMAL, "Component unmounting");
        wsRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (logUpdateTimeoutRef.current) {
        clearTimeout(logUpdateTimeoutRef.current);
        logUpdateTimeoutRef.current = null;
      }

      pendingRef.current = "";
      partialLineRef.current = "";
    };
  }, [connectWebSocket]);

  return {
    lines,
    error,
    isConnected,
    isClearing,
    clearLogs,
  };
}
