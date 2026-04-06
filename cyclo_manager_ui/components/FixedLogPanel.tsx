"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import LogViewer from "./LogViewer";
import { createLogsWebSocket } from "@/lib/websocket";
import { clearServiceLogs } from "@/lib/api";

interface FixedLogPanelProps {
  container: string;
  service: string;
  onClose: () => void;
}

const LOG_UPDATE_DEBOUNCE_MS = 200;
const RECONNECT_DELAY_MS = 3000;
const WS_CLOSE_CODE_NORMAL = 1000;
const WS_CLOSE_CODE_GOING_AWAY = 1001;
const MAX_LOG_LINES = 1000; // Maximum number of log lines to keep in memory

export default function FixedLogPanel({
  container,
  service,
  onClose,
}: FixedLogPanelProps) {
  const [logs, setLogs] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearLoading, setClearLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const pendingLogsRef = useRef<string>("");
  const logUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isEmptyLogsRef = useRef(true);

  // Limit log lines to prevent memory issues
  const limitLogLines = useCallback((logText: string): string => {
    if (!logText) return logText;

    const lines = logText.split('\n');
    if (lines.length <= MAX_LOG_LINES) {
      return logText;
    }

    // Keep only the most recent MAX_LOG_LINES
    const recentLines = lines.slice(-MAX_LOG_LINES);
    return recentLines.join('\n');
  }, []);

  // WebSocket connection
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

    try {
      const ws = createLogsWebSocket(container, service, {
        onMessage: (data: string) => {
          if (!isMountedRef.current) return;

          pendingLogsRef.current += data;

          if (isEmptyLogsRef.current) {
            setLogs(limitLogLines(pendingLogsRef.current));
            pendingLogsRef.current = "";
            isEmptyLogsRef.current = false;
            setIsConnected(true);
          } else {
            if (logUpdateTimeoutRef.current) {
              clearTimeout(logUpdateTimeoutRef.current);
            }
            logUpdateTimeoutRef.current = setTimeout(() => {
              if (!isMountedRef.current) return;
              if (pendingLogsRef.current) {
                setLogs((prevLogs) => {
                  const newLogs = prevLogs + pendingLogsRef.current;
                  pendingLogsRef.current = "";
                  return limitLogLines(newLogs);
                });
              }
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

      if (pendingLogsRef.current) {
        setLogs((prevLogs) => limitLogLines(prevLogs + pendingLogsRef.current));
        pendingLogsRef.current = "";
      }
    };
  }, [connectWebSocket]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: "100%",
        backgroundColor: "var(--vscode-editor-background)",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          backgroundColor: "var(--vscode-titleBar-activeBackground)",
          borderBottom: "1px solid var(--vscode-panel-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "12px",
              fontWeight: "500",
              color: "var(--vscode-foreground)",
            }}
          >
            {service} Logs
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={async () => {
              setClearLoading(true);
              setError(null);
              try {
                await clearServiceLogs(container, service);
                setLogs("");
                pendingLogsRef.current = "";
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to clear logs");
              } finally {
                setClearLoading(false);
              }
            }}
            disabled={clearLoading}
            style={{
              background: "none",
              border: "none",
              color: "var(--vscode-foreground)",
              cursor: clearLoading ? "not-allowed" : "pointer",
              fontSize: "12px",
              padding: "4px 8px",
              borderRadius: "2px",
              opacity: clearLoading ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!clearLoading) e.currentTarget.style.backgroundColor = "var(--vscode-toolbar-hoverBackground)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {clearLoading ? "Clearing…" : "Clear"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--vscode-foreground)",
              cursor: "pointer",
              fontSize: "16px",
              padding: "0 4px",
              lineHeight: "1",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--vscode-toolbar-hoverBackground)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        position: "relative",
        minHeight: 0,
        display: "flex",
        flexDirection: "column"
      }}>
        {error && (
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: "rgba(244, 135, 113, 0.1)",
              color: "var(--vscode-errorForeground)",
              fontSize: "12px",
              flexShrink: 0,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <LogViewer logs={logs} autoScroll={true} className="h-full" />
        </div>
      </div>
    </div>
  );
}
