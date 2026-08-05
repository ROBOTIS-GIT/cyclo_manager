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

import { useCallback, useEffect, useMemo, useState } from "react";
import Convert from "ansi-to-html";
import { usePolling } from "@/hooks/usePolling";
import { controlDockerContainer, getDockerContainers, getDockerContainerLogs } from "@/lib/api";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout";
import ContainerControlBox from "@/components/system/ContainerControlBox";
import { useTheme } from "@/contexts/ThemeContext";

const NOVNC_SERVER_CONTAINER_NAME = "novnc-server";
const NOVNC_PATH = "/vnc.html?autoconnect=true&resize=scale";
const NOVNC_PORT = 8090;
const STATUS_POLL_INTERVAL = 2000;

function getNoVNCUrl(): string {
  if (typeof window === "undefined") return "";
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${NOVNC_PORT}${NOVNC_PATH}`;
}

export default function NoVNCPage() {
  const externalNovncUrl = process.env.NEXT_PUBLIC_NOVNC_URL;
  const [url, setUrl] = useState<string>(() => externalNovncUrl ?? "");
  const { theme } = useTheme();

  const [novncContainer, setNovncContainer] = useState<{ name: string; status: string } | null>(null);
  const [novncActionLoading, setNovncActionLoading] = useState<"start" | "stop" | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState("");
  const [logLoading, setLogLoading] = useState(false);

  const convert = useMemo(() => {
    const isDark = theme === "dark";
    return new Convert({
      fg: isDark ? "#d4d4d4" : "#333333",
      bg: isDark ? "#1e1e1e" : "#ffffff",
      newline: false,
      escapeXML: true,
      stream: false,
      colors: isDark
        ? { 0: "#000000", 1: "#cd3131", 2: "#0dbc79", 3: "#e5e510", 4: "#2472c8", 5: "#bc3fbc", 6: "#11a8cd", 7: "#e5e5e5", 8: "#666666", 9: "#f14c4c", 10: "#23d18b", 11: "#f5f543", 12: "#3b8eea", 13: "#d670d6", 14: "#29b8db", 15: "#e5e5e5" }
        : { 0: "#000000", 1: "#cd3131", 2: "#0dbc79", 3: "#e5e510", 4: "#2472c8", 5: "#bc3fbc", 6: "#11a8cd", 7: "#333333", 8: "#666666", 9: "#f14c4c", 10: "#23d18b", 11: "#f5f543", 12: "#3b8eea", 13: "#d670d6", 14: "#29b8db", 15: "#333333" },
    });
  }, [theme]);

  useEffect(() => {
    if (externalNovncUrl) return;
    setUrl(getNoVNCUrl());
  }, [externalNovncUrl]);

  const loadNovncContainer = useCallback(async () => {
    try {
      const res = await getDockerContainers(true);
      const c = res.containers.find((d) => d.name === NOVNC_SERVER_CONTAINER_NAME);
      setNovncContainer(c ? { name: c.name, status: c.status } : null);
    } catch {
      setNovncContainer(null);
    }
  }, []);

  usePolling(loadNovncContainer, STATUS_POLL_INTERVAL);

  const handleNovncDocker = useCallback(async () => {
    const isRunning = novncContainer?.status?.toLowerCase() === "running";
    const action = isRunning ? "stop" : "start";
    setNovncActionLoading(action);
    try {
      await controlDockerContainer(NOVNC_SERVER_CONTAINER_NAME, action);
      await loadNovncContainer();
    } finally {
      setNovncActionLoading(null);
    }
  }, [novncContainer?.status, loadNovncContainer]);

  useEffect(() => {
    if (!showLogs) return;
    setLogLoading(true);
    getDockerContainerLogs(NOVNC_SERVER_CONTAINER_NAME, 200)
      .then((r) => setLogContent(r.logs))
      .catch(() => setLogContent("Failed to load logs."))
      .finally(() => setLogLoading(false));
  }, [showLogs]);

  const isRunning = novncContainer?.status?.toLowerCase() === "running";
  const statusLabel = novncContainer?.status ?? "";
  /** Local default URL targets this host's novnc-server; external env URL may not use Docker on this machine. */
  const showIframe = Boolean(url) && (externalNovncUrl ? true : isRunning);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        position: "fixed",
        left: SIDEBAR_WIDTH_PX,
        top: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "var(--vscode-editor-background)",
      }}
    >
      <header
        className="flex flex-wrap items-center gap-4 px-4 py-2 shrink-0 border-b"
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <ContainerControlBox
          title="noVNC server"
          status={statusLabel}
          loading={novncActionLoading !== null}
          onToggle={handleNovncDocker}
          showLogs={showLogs}
          onToggleLogs={() => setShowLogs((v) => !v)}
          size="compact"
        />
      </header>

      {showLogs ? (
        <div
          className="shrink-0 flex flex-col border-b max-h-[min(40vh,320px)] min-h-[120px]"
          style={{ borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)" }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b shrink-0"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--vscode-foreground)" }}>
              noVNC server — Log
            </span>
            <button
              type="button"
              onClick={() => setShowLogs(false)}
              className="p-1 rounded hover:opacity-80"
              style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3">
            {logLoading ? (
              <p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading logs...</p>
            ) : (
              <pre
                className="text-xs font-mono whitespace-pre-wrap break-words"
                style={{
                  backgroundColor: "var(--vscode-textCodeBlock-background)",
                  color: "var(--vscode-foreground)",
                  padding: "0.75rem",
                  borderRadius: "4px",
                }}
                dangerouslySetInnerHTML={{ __html: convert.toHtml(logContent) }}
              />
            )}
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 relative" style={{ backgroundColor: "var(--vscode-editor-background)" }}>
        {showIframe ? (
          <iframe
            key={url}
            src={url}
            title="noVNC - Remote Desktop"
            className="absolute inset-0 w-full h-full block"
            style={{ border: "none" }}
          />
        ) : url && !externalNovncUrl && !isRunning ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            <p className="text-sm m-0" style={{ color: "var(--vscode-foreground)" }}>
              noVNC server container is not running.
            </p>
            <p className="text-xs m-0 max-w-md">
              Start <strong>{NOVNC_SERVER_CONTAINER_NAME}</strong> with the button above.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
