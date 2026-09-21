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

import type { ObserverConnectionState } from "@/lib/websocketUtils";

export default function ObserverConnectionNotice({ connection, reconnect }: {
  connection: ObserverConnectionState; reconnect: () => void;
}) {
  if (!connection.error) return null;
  return <div role="alert" className="rounded border p-2 text-xs" style={{
    color: "var(--vscode-errorForeground)", background: "var(--vscode-sidebar-background)",
    borderColor: "var(--vscode-panel-border)",
  }}>
    <p className="break-words">{connection.error}</p>
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
      <span>{connection.retryInMs !== null
        ? `Retrying in ${Math.ceil(connection.retryInMs / 1000)} s`
        : connection.status === "connecting" ? "Reconnecting…" : "Automatic retry stopped"}</span>
      <button type="button" className="rounded border px-2 py-1" onClick={reconnect}>Reconnect</button>
    </div>
  </div>;
}
