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

import { MAX_LOG_LINES } from "@/lib/logBuffer";
import { getWebSocketBaseUrl, parseJsonMessage } from "@/lib/websocketUtils";

type LogEvent = {
  type: string;
  logs?: string;
  data?: string;
  message?: string;
  log_id?: string | null;
  cursor?: number;
  start_cursor?: number;
  end_cursor?: number;
  history?: boolean;
  source?: string;
  retryable?: boolean;
};

export function createLogsWebSocket(container: string, service: string, options: {
  resume?: { logId: string; cursor: number };
  onEvent: (event: LogEvent) => void;
  onOpen: () => void;
  onClose: (event: CloseEvent) => void;
  onError: (error: Error) => void;
}): WebSocket {
  const params = new URLSearchParams({ live: "true", tail: String(MAX_LOG_LINES) });
  if (options.resume) {
    params.set("log_id", options.resume.logId);
    params.set("cursor", String(options.resume.cursor));
  }
  const ws = new WebSocket(`${getWebSocketBaseUrl()}/ws/${encodeURIComponent(container)}/services/${encodeURIComponent(service)}/logs?${params}`);
  ws.onmessage = event => {
    try { options.onEvent(parseJsonMessage(event.data) as LogEvent); }
    catch (error) { options.onError(error instanceof Error ? error : new Error("Invalid log event")); }
  };
  ws.onopen = options.onOpen;
  ws.onclose = options.onClose;
  ws.onerror = () => options.onError(new Error("Log connection unavailable."));
  return ws;
}
