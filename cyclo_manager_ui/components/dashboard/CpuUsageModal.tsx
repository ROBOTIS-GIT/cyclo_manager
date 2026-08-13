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

import { useCallback, useEffect, useState } from "react";
import { getSystemProcesses } from "@/lib/api";
import type { SystemProcessesResponse, SystemProcessInfo } from "@/types/api";

const PROCESS_POLL_INTERVAL_MS = 2000;
const PROCESS_LIMIT = 80;

function formatRss(rssKb: number | null): string {
  if (rssKb == null) return "-";
  if (rssKb >= 1024 * 1024) return `${(rssKb / (1024 * 1024)).toFixed(1)} GB`;
  return `${Math.round(rssKb / 1024)} MB`;
}

function percent(used: number, total: number): string {
  return `${((used / Math.max(1, total)) * 100).toFixed(1)}%`;
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div
      className="min-w-0 border rounded px-3 py-2"
      style={{
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sidebar-background)",
      }}
    >
      <div className="text-[10px] font-semibold uppercase" style={{ color: "var(--vscode-descriptionForeground)" }}>
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums mt-0.5" style={{ color: "var(--vscode-foreground)" }}>
        {value}
      </div>
      {detail && (
        <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {detail}
        </div>
      )}
    </div>
  );
}

export default function CpuUsageModal({ onClose }: { onClose: () => void }) {
  const [processes, setProcesses] = useState<SystemProcessInfo[]>([]);
  const [summary, setSummary] = useState<Omit<SystemProcessesResponse, "processes"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProcesses = useCallback(async () => {
    try {
      const response = await getSystemProcesses(PROCESS_LIMIT);
      setProcesses(response.processes);
      setSummary({
        cpu_percent: response.cpu_percent,
        memory_used_mb: response.memory_used_mb,
        memory_total_mb: response.memory_total_mb,
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load processes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await loadProcesses();
    };
    run();
    const timer = window.setInterval(run, PROCESS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadProcesses]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[70]"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="rounded-lg border shadow-xl flex flex-col overflow-hidden"
        style={{
          width: "min(900px, 95vw)",
          maxHeight: "86vh",
          backgroundColor: "var(--vscode-editor-background)",
          borderColor: "var(--vscode-panel-border)",
        }}
      >
        <div
          className="px-5 py-3 border-b flex items-center justify-between gap-4"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--vscode-foreground)" }}>
              CPU Usage
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Top host processes by total CPU share
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="p-1 rounded hover:opacity-80"
            style={{
              color: "var(--vscode-foreground)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {summary && (
            <div
              className="grid grid-cols-2 gap-2 px-4 py-3 border-b"
              style={{
                borderColor: "var(--vscode-panel-border)",
              }}
            >
              <SummaryMetric label="CPU" value={`${summary.cpu_percent.toFixed(1)}%`} detail="Total usage" />
              <SummaryMetric
                label="Memory"
                value={percent(summary.memory_used_mb, summary.memory_total_mb)}
                detail={`${(summary.memory_used_mb / 1024).toFixed(1)} / ${(summary.memory_total_mb / 1024).toFixed(1)} GB`}
              />
            </div>
          )}
          {error && (
            <div
              className="m-4 px-3 py-2 text-sm rounded border"
              style={{
                color: "var(--vscode-errorForeground)",
                borderColor: "rgba(244,135,113,0.35)",
                backgroundColor: "rgba(244,135,113,0.1)",
              }}
            >
              {error}
            </div>
          )}
          {loading && !error ? (
            <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Loading processes...
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead
                className="sticky top-0"
                style={{
                  backgroundColor: "var(--vscode-editor-background)",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                <tr>
                  <th className="text-left font-semibold px-4 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>PID</th>
                  <th className="text-left font-semibold px-3 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>USER</th>
                  <th className="text-right font-semibold px-3 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>CPU %</th>
                  <th className="text-right font-semibold px-3 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>MEM %</th>
                  <th className="text-right font-semibold px-3 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>RSS</th>
                  <th className="text-left font-semibold px-3 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>COMMAND</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--vscode-foreground)" }}>
                {processes.map((process) => (
                  <tr key={process.pid} className="border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>
                    <td className="px-4 py-1.5 font-mono tabular-nums">{process.pid}</td>
                    <td className="px-3 py-1.5 font-mono">{process.user}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{process.cpu_percent.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{process.memory_percent.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatRss(process.rss_kb)}</td>
                    <td className="px-3 py-1.5 font-mono max-w-[28rem] truncate" title={process.command}>
                      {process.command}
                    </td>
                  </tr>
                ))}
                {processes.length === 0 && !error && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-4 text-sm"
                      style={{ color: "var(--vscode-descriptionForeground)" }}
                    >
                      No processes found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
