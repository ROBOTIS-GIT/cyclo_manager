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

type DataListener = (data: Uint8Array) => void;
type CloseListener = () => void;
type OpenListener = () => void;

interface TerminalConnection {
  ws: WebSocket;
  subscribers: Set<DataListener>;
  closeListeners: Set<CloseListener>;
}

const connections = new Map<string, TerminalConnection>();

function getOrCreateConnection(wsUrl: string): TerminalConnection {
  let conn = connections.get(wsUrl);
  if (conn) return conn;

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  conn = {
    ws,
    subscribers: new Set(),
    closeListeners: new Set(),
  };

  ws.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const data = new Uint8Array(event.data);
    conn!.subscribers.forEach((listener) => listener(data));
  };

  ws.onclose = () => {
    conn!.closeListeners.forEach((listener) => listener());
    connections.delete(wsUrl);
  };

  connections.set(wsUrl, conn);
  return conn;
}

export function requestTerminalReplay(wsUrl: string) {
  sendTerminalJson(wsUrl, { type: "replay" });
}

export function subscribeTerminal(
  wsUrl: string,
  onData: DataListener,
  onClose?: CloseListener,
  onOpen?: OpenListener
): () => void {
  const conn = getOrCreateConnection(wsUrl);
  const isFirstSubscriber = conn.subscribers.size === 0;
  conn.subscribers.add(onData);
  if (onClose) conn.closeListeners.add(onClose);

  const onReady = () => {
    onOpen?.();
    if (isFirstSubscriber) {
      requestTerminalReplay(wsUrl);
    }
  };

  if (conn.ws.readyState === WebSocket.OPEN) {
    onReady();
  } else {
    conn.ws.addEventListener("open", () => onReady(), { once: true });
  }

  return () => {
    conn.subscribers.delete(onData);
    if (onClose) conn.closeListeners.delete(onClose);
    if (conn.subscribers.size === 0 && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.close();
    }
  };
}

export function sendTerminalText(wsUrl: string, text: string) {
  const conn = connections.get(wsUrl);
  if (conn?.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(new TextEncoder().encode(text));
  }
}

export function sendTerminalJson(wsUrl: string, payload: unknown) {
  const conn = connections.get(wsUrl);
  if (conn?.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(payload));
  }
}

export function closeTerminalConnection(wsUrl: string) {
  const conn = connections.get(wsUrl);
  if (!conn) return;
  if (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING) {
    conn.ws.close();
  }
  connections.delete(wsUrl);
}

export function closeAllTerminalConnections() {
  for (const wsUrl of [...connections.keys()]) {
    closeTerminalConnection(wsUrl);
  }
}
