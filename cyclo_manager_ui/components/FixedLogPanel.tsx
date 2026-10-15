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

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import LogViewer from "./LogViewer";
import { useServiceLogStream, type LogBuffer } from "@/hooks/useServiceLogStream";
import { getServiceLogDownloadUrl, getServiceLogHistory, type ServiceLogHistory } from "@/lib/api";

interface FixedLogPanelProps { container: string; service: string; onClose: () => void }
const buttonClass = "rounded px-2 py-1 text-xs hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-40";
const formatId = (id: string) => {
  const [year, month, day, hour, minute, suffix] = id.split("_");
  return `${year}-${month}-${day} ${hour}:${minute}${suffix ? ` (${suffix})` : ""}`;
};
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Changing container/service discards requests, sockets and cached history from the previous target.
export default function FixedLogPanel(props: FixedLogPanelProps) {
  return <ServiceLogPanel key={`${props.container}/${props.service}`} {...props} />;
}

function ServiceLogPanel({ container, service, onClose }: FixedLogPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyId = useId();
  const historyMenu = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 12, maxHeight: 320 });
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<ServiceLogHistory | null>(null);
  const [listError, setListError] = useState("");
  const [listing, setListing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [cache] = useState(() => new Map<string, LogBuffer>());

  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController();
    // Defer the request state so opening/closing the list is safe under Strict Mode.
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setListing(true);
      setListError("");
      try {
        const result = await getServiceLogHistory(container, service, controller.signal);
        if (!controller.signal.aborted) setHistory(result);
      } catch (error) {
        if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : "Could not load history.");
      } finally {
        if (!controller.signal.aborted) setListing(false);
      }
    });
    return () => controller.abort();
  }, [container, service, historyOpen, refresh]);

  const selectLog = (id: string | null) => {
    setSelected(id);
    historyMenu.current?.hidePopover();
  };

  return <section className="flex h-full min-h-0 flex-col overflow-hidden rounded border"
    style={{ background: "var(--vscode-editor-background)", borderColor: "var(--vscode-panel-border)", color: "var(--vscode-foreground)" }}>
    <LogContent key={selected ?? "live"} container={container} service={service} logId={selected} cache={cache}
      headerActions={<>
        <button className={buttonClass} popoverTarget={historyId} aria-expanded={historyOpen}
          aria-controls={historyId} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuPosition({ top: rect.bottom + 4, right: Math.max(12, window.innerWidth - rect.right),
              maxHeight: Math.max(80, Math.min(320, window.innerHeight - rect.bottom - 16)) });
          }}>History <span aria-hidden="true">⌄</span></button>
        <button className={buttonClass} aria-label="Close logs" onClick={onClose}>✕</button>
      </>} />
    <div ref={historyMenu} id={historyId} popover="auto" role="dialog" aria-label="Log history"
      onToggle={event => setHistoryOpen(event.currentTarget.matches(":popover-open"))}
      className="rounded border p-0 text-xs shadow-lg"
      style={{ position: "fixed", inset: "unset", ...menuPosition,
        margin: 0, width: `min(20rem, calc(100vw - ${menuPosition.right + 12}px))`, overflowY: "auto",
        background: "var(--vscode-editor-background)", color: "var(--vscode-foreground)", borderColor: "var(--vscode-panel-border)" }}>
      <div className="sticky top-0 flex items-center justify-between border-b px-3 py-2"
        style={{ background: "var(--vscode-editor-background)", borderColor: "var(--vscode-panel-border)" }}>
        <span className="font-medium">History</span>
        <button className={buttonClass} disabled={listing} onClick={() => setRefresh(value => value + 1)}>{listing ? "Loading…" : "Refresh"}</button>
      </div>
      <button className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
        aria-pressed={!selected} onClick={() => selectLog(null)}>
        <span>Current logs</span>{!selected && <span aria-hidden="true">✓</span>}
      </button>
      {history?.supported && history.history.map(entry => <button key={entry.log_id}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
        aria-pressed={selected === entry.log_id} onClick={() => selectLog(entry.log_id)}>
        <span>{formatId(entry.log_id)}</span>
        <span className="flex items-center gap-2" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {formatSize(entry.size_bytes)}{selected === entry.log_id && <span aria-hidden="true">✓</span>}
        </span>
      </button>)}
      {listError && <p role="alert" className="px-3 py-2" style={{ color: "var(--vscode-errorForeground)" }}>{listError}</p>}
      {history && !history.supported && <p className="px-3 py-2">History is unavailable on this agent.</p>}
      {history?.supported && !listing && history.history.length === 0 && <p className="px-3 py-2">No recorded executions.</p>}
    </div>
  </section>;
}

function LogContent({ container, service, logId, cache, headerActions }: {
  container: string; service: string; logId: string | null; cache: Map<string, LogBuffer>; headerActions: ReactNode;
}) {
  const log = useServiceLogStream(container, service, logId, cache);
  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
      style={{ borderColor: "var(--vscode-panel-border)", background: "var(--vscode-titleBar-activeBackground)" }}>
      <span className="min-w-0 break-all text-xs font-semibold">
        {service} Logs
        {logId && <span className="ml-2 font-normal" style={{ color: "var(--vscode-descriptionForeground)" }}>{formatId(logId)}</span>}
      </span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        <a className={buttonClass} href={getServiceLogDownloadUrl(container, service, logId ?? log.buffer.logId)} download>Download</a>
        {(logId || log.disconnected) &&
          <button className={buttonClass} onClick={log.reload}>{logId ? "Reload" : "Reconnect"}</button>}
        {headerActions}
      </div>
    </header>
    {log.error && <div role="alert" className="shrink-0 px-3 py-2 text-xs" style={{ color: "var(--vscode-errorForeground)", background: "rgba(244,135,113,0.08)" }}>{log.error}</div>}
    <div className="min-h-0 flex-1">
      <LogViewer blocks={log.buffer.blocks} resetKey={log.buffer.revision}
        emptyMessage={log.loading ? "Loading logs…" : logId ? "No logs in this execution." : log.supported === false ? "Waiting for logs…" : "Waiting for an active execution…"} />
    </div>
  </div>;
}
