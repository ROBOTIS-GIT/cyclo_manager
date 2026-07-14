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

import LogViewer from "./LogViewer";
import { useServiceLogStream } from "@/hooks/useServiceLogStream";
import { getServiceLogDownloadUrl } from "@/lib/api";

interface FixedLogPanelProps {
  container: string;
  service: string;
  onClose: () => void;
}

export default function FixedLogPanel({
  container,
  service,
  onClose,
}: FixedLogPanelProps) {
  const { lines, error, isClearing, clearLogs } = useServiceLogStream(container, service);

  const downloadLogs = () => {
    const link = document.createElement("a");
    link.href = getServiceLogDownloadUrl(container, service);
    link.download = `${container}_${service}_current.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

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
            onClick={downloadLogs}
            style={{
              background: "none",
              border: "none",
              color: "var(--vscode-foreground)",
              cursor: "pointer",
              fontSize: "12px",
              padding: "4px 8px",
              borderRadius: "2px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--vscode-toolbar-hoverBackground)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Download
          </button>
          <button
            onClick={clearLogs}
            disabled={isClearing}
            style={{
              background: "none",
              border: "none",
              color: "var(--vscode-foreground)",
              cursor: isClearing ? "not-allowed" : "pointer",
              fontSize: "12px",
              padding: "4px 8px",
              borderRadius: "2px",
              opacity: isClearing ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isClearing) e.currentTarget.style.backgroundColor = "var(--vscode-toolbar-hoverBackground)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {isClearing ? "Clearing…" : "Clear"}
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
          <LogViewer lines={lines} autoScroll={true} className="h-full" />
        </div>
      </div>
    </div>
  );
}
