/**
 * WebSocket utilities for real-time log streaming
 */

import { useState, useEffect } from "react";

export type WebSocketMessage = {
  type: "logs" | "error" | "data";
  data: string | any;
};

export type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

export interface UseWebSocketOptions {
  onMessage?: (data: string) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: (event?: CloseEvent) => void;
  reconnect?: boolean;
  reconnectInterval?: number;
}

// Constants
const WS_CLOSE_CODE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  ABNORMAL: 1006,
} as const;

const DEFAULT_WS_PORT = 8081;

/**
 * Get WebSocket URL base
 */
const getWebSocketBaseUrl = (): string => {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;

  if (envUrl) {
    return envUrl.replace(/^http/, "ws");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:${DEFAULT_WS_PORT}`;
  }

  return `ws://localhost:${DEFAULT_WS_PORT}`;
};

/**
 * Handle WebSocket close event
 */
const handleWebSocketClose = (
  event: CloseEvent,
  wsUrl: string,
  options: UseWebSocketOptions
): void => {
  if (event.code === WS_CLOSE_CODE.NORMAL || event.code === WS_CLOSE_CODE.GOING_AWAY) {
    // Normal closure - don't trigger error
    return;
  }

  if (event.code === WS_CLOSE_CODE.ABNORMAL) {
    // Abnormal closure - often false positive in React Strict Mode
    // Don't trigger error callback
    return;
  }

  // Other error codes
  const reason = event.reason ? `, reason: ${event.reason}` : "";
  options.onError?.(new Error(`WebSocket closed unexpectedly: code ${event.code}${reason}`));
};

/**
 * Setup common WebSocket event handlers
 */
const setupWebSocketHandlers = (
  ws: WebSocket,
  wsUrl: string,
  options: UseWebSocketOptions
): void => {
  ws.onopen = () => {
    options.onOpen?.();
  };

  ws.onerror = () => {
    // Error details are in onclose event
    // This is just a placeholder
  };

  ws.onclose = (event) => {
    handleWebSocketClose(event, wsUrl, options);
    options.onClose?.(event);
  };
};

/**
 * Parse WebSocket message
 */
const parseWebSocketMessage = (
  event: MessageEvent,
  options: UseWebSocketOptions
): void => {
  try {
    const message: WebSocketMessage = JSON.parse(event.data);

    if (message.type === "logs") {
      options.onMessage?.(message.data);
    } else if (message.type === "error") {
      const errorMsg = typeof message.data === "string"
        ? message.data
        : JSON.stringify(message.data);
      options.onError?.(new Error(errorMsg));
    }
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error("Unknown error"));
  }
};

/**
 * Create WebSocket connection for service logs
 */
export function createLogsWebSocket(
  container: string,
  service: string,
  options: UseWebSocketOptions = {}
): WebSocket {
  const baseUrl = getWebSocketBaseUrl();
  const wsUrl = `${baseUrl}/ws/${container}/services/${service}/logs`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => parseWebSocketMessage(event, options);
  setupWebSocketHandlers(ws, wsUrl, options);

  return ws;
}

/**
 * Parse ROS2 topic WebSocket message
 */
const parseROS2TopicMessage = (
  event: MessageEvent,
  options: UseWebSocketOptions
): void => {
  try {
    const message: WebSocketMessage = JSON.parse(event.data);

    if (message.type === "data") {
      // message.data is the ROS2TopicDataResponse object
      // Pass it directly as JSON string for onMessage callback
      const dataStr = typeof message.data === "string"
        ? message.data
        : JSON.stringify(message.data);
      options.onMessage?.(dataStr);
    } else if (message.type === "error") {
      const errorMsg = typeof message.data === "string"
        ? message.data
        : JSON.stringify(message.data);
      options.onError?.(new Error(errorMsg));
    }
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error("Unknown error"));
  }
};

/**
 * Create WebSocket connection for ROS2 topic data
 */
export function createROS2TopicWebSocket(
  container: string,
  topic: string,
  options: UseWebSocketOptions = {}
): WebSocket {
  const baseUrl = getWebSocketBaseUrl();
  const wsUrl = `${baseUrl}/ws/${container}/ros2/topics/${encodeURIComponent(topic)}`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => parseROS2TopicMessage(event, options);
  setupWebSocketHandlers(ws, wsUrl, options);

  return ws;
}

/**
 * React hook for ROS2 topic WebSocket
 */
export function useROS2TopicWebSocket(
  container: string | null,
  topic: string | null,
  options: UseWebSocketOptions = {}
) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [topicData, setTopicData] = useState<any>(null);

  useEffect(() => {
    if (!container || !topic) {
      return;
    }

    let isMounted = true;
    setStatus("connecting");

    const websocket = createROS2TopicWebSocket(container, topic, {
      ...options,
      onOpen: () => {
        if (isMounted) {
          setStatus("connected");
    options.onOpen?.();
        }
      },
      onMessage: (data: string) => {
        if (!isMounted) return;
        try {
          const parsed = JSON.parse(data);
          // parsed is the ROS2TopicDataResponse object: {container, topic, msg_type, data, available, domain_id}
          setTopicData(parsed);
          options.onMessage?.(data);
        } catch (e) {
          // If not JSON, use as-is
          options.onMessage?.(data);
        }
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
  }, [container, topic]);

  return { ws, status, topicData } as { ws: WebSocket | null; status: WebSocketStatus; topicData: any };
}

