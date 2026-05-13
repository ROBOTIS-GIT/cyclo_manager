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

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDockerContainerTop, killDockerProcess, getDockerTerminalWsUrl, stopDockerTerminal } from "@/lib/api";
import { XTerminal } from "@/components/XTerminal";
import type { DockerTopResponse } from "@/types/api";

interface Tab {
  sessionId: string;
  label: string;
  wsUrl: string;
}

function newSessionId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function storageKey(name: string) {
  return `cm_terms_${name}`;
}

export default function ContainerTerminalPage() {
  const params = useParams();
  const name = typeof params.name === "string" ? params.name : "";

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const loadedForRef = useRef<string | null>(null);
  const tabCounterRef = useRef(0);

  const [top, setTop] = useState<DockerTopResponse | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [killLoadingPid, setKillLoadingPid] = useState<number | null>(null);
  const [killError, setKillError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!name || loadedForRef.current === name) return;
    loadedForRef.current = name;

    let initial: Tab[] = [];
    try {
      const stored = localStorage.getItem(storageKey(name));
      if (stored) {
        const sessions: { sessionId: string; label: string }[] = JSON.parse(stored);
        initial = sessions.map((s) => ({
          ...s,
          wsUrl: getDockerTerminalWsUrl(name, s.sessionId),
        }));
        const maxNum = Math.max(0, ...initial.map((t) => parseInt(t.label.match(/\d+$/)?.[0] ?? "0")));
        tabCounterRef.current = maxNum;
      }
    } catch {
      initial = [];
    }
    if (initial.length === 0) {
      const sessionId = newSessionId();
      tabCounterRef.current = 1;
      initial = [{ sessionId, label: "bash 1", wsUrl: getDockerTerminalWsUrl(name, sessionId) }];
    }
    setTabs(initial);
    setActiveId(initial[0].sessionId);
  }, [name]);

  useEffect(() => {
    if (!name || tabs.length === 0) return;
    localStorage.setItem(
      storageKey(name),
      JSON.stringify(tabs.map(({ sessionId, label }) => ({ sessionId, label })))
    );
  }, [name, tabs]);

  const fetchTop = useCallback(async () => {
    if (!name) return;
    try {
      const res = await getDockerContainerTop(name);
      setTop(res);
      setTopError(null);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Failed to fetch processes");
    }
  }, [name]);

  useEffect(() => {
    fetchTop();
    intervalRef.current = setInterval(fetchTop, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchTop]);

  const openTab = useCallback(() => {
    if (!name) return;
    const sessionId = newSessionId();
    tabCounterRef.current += 1;
    const tab: Tab = {
      sessionId,
      label: `bash ${tabCounterRef.current}`,
      wsUrl: getDockerTerminalWsUrl(name, sessionId),
    };
    setTabs((prev) => [...prev, tab]);
    setActiveId(sessionId);
  }, [name]);

  const closeTab = useCallback((sessionId: string) => {
    stopDockerTerminal(name, sessionId);
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.sessionId !== sessionId);
      if (remaining.length === 0) {
        localStorage.removeItem(storageKey(name));
        loadedForRef.current = null;
      }
      setActiveId((cur) => {
        if (cur !== sessionId) return cur;
        const idx = prev.findIndex((t) => t.sessionId === sessionId);
        return remaining[Math.max(0, idx - 1)]?.sessionId ?? remaining[0]?.sessionId ?? null;
      });
      return remaining;
    });
  }, [name]);

  const handleKill = async (pid: number) => {
    setKillLoadingPid(pid);
    setKillError(null);
    try {
      await killDockerProcess(name, pid, "SIGKILL");
      await fetchTop();
    } catch (err) {
      setKillError(err instanceof Error ? err.message : "Failed to kill process");
      setTimeout(() => setKillError(null), 4000);
    } finally {
      setKillLoadingPid(null);
    }
  };

  const titles = top?.titles ?? [];
  const pidIdx = titles.findIndex((t) => t === "PID");
  const userIdx = titles.findIndex((t) => t === "UID" || t === "USER");
  const cmdIdx = titles.findIndex((t) => t === "CMD" || t === "COMMAND");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Breadcrumb */}
      <div
        className="flex items-center gap-3 px-4 py-2 shrink-0 border-b text-sm"
        style={{ borderColor: "var(--vscode-panel-border)", color: "var(--vscode-foreground)", backgroundColor: "var(--vscode-editor-background)" }}
      >
        <Link href="/docker" className="flex items-center gap-1 no-underline" style={{ color: "var(--vscode-descriptionForeground)" }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Docker
        </Link>
        <span style={{ color: "var(--vscode-descriptionForeground)" }}>/</span>
        <span className="font-mono font-medium">{name}</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: Process list */}
        <div
          className="flex flex-col shrink-0 border-r overflow-hidden"
          style={{ width: "340px", borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)" }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 border-b shrink-0"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Processes
            </span>
            <button
              onClick={fetchTop}
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", border: "none", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>

          {killError && (
            <div className="px-3 py-1.5 text-xs shrink-0" style={{ color: "var(--vscode-errorForeground)", backgroundColor: "rgba(244,135,113,0.1)" }}>
              {killError}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {topError && <p className="p-3 text-xs" style={{ color: "var(--vscode-errorForeground)" }}>{topError}</p>}
            {!top && !topError && <p className="p-3 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading...</p>}
            {top && (
              <table className="w-full text-xs" style={{ color: "var(--vscode-foreground)" }}>
                <thead>
                  <tr className="sticky top-0" style={{ backgroundColor: "var(--vscode-list-hoverBackground)", borderBottom: "1px solid var(--vscode-panel-border)" }}>
                    <th className="text-left px-3 py-1.5 font-medium">PID</th>
                    <th className="text-left px-3 py-1.5 font-medium">User</th>
                    <th className="text-left px-3 py-1.5 font-medium w-full">Command</th>
                    <th className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {(top.processes ?? []).map((row, i) => {
                    const pid = pidIdx >= 0 ? row[pidIdx] : "";
                    const user = userIdx >= 0 ? row[userIdx] : "";
                    const cmd = cmdIdx >= 0 ? row[cmdIdx] : row[row.length - 1];
                    const pidNum = parseInt(pid, 10);
                    return (
                      <tr key={i} className="border-b last:border-b-0" style={{ borderColor: "var(--vscode-panel-border)" }}>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap">{pid}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{user}</td>
                        <td className="px-3 py-1.5 font-mono max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap" title={cmd}>{cmd}</td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => handleKill(pidNum)}
                            disabled={killLoadingPid === pidNum || isNaN(pidNum)}
                            className="px-1.5 py-0.5 rounded text-[10px]"
                            style={{
                              backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                              color: "var(--vscode-errorForeground)",
                              border: "none",
                              cursor: killLoadingPid === pidNum ? "not-allowed" : "pointer",
                              opacity: killLoadingPid === pidNum ? 0.5 : 1,
                            }}
                          >
                            Kill
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {top.processes?.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: "var(--vscode-descriptionForeground)" }}>No processes</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Terminal with tab bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Tab bar */}
          <div
            className="flex items-end shrink-0 overflow-x-auto"
            style={{ backgroundColor: "var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sidebar-background))", borderBottom: "1px solid var(--vscode-panel-border)", minHeight: "36px" }}
          >
            {tabs.map((tab) => {
              const isActive = tab.sessionId === activeId;
              return (
                <div
                  key={tab.sessionId}
                  className="flex items-center shrink-0 gap-1.5 px-3 cursor-pointer select-none"
                  style={{
                    height: "36px",
                    fontSize: "13px",
                    borderRight: "1px solid var(--vscode-panel-border)",
                    backgroundColor: isActive ? "var(--vscode-editor-background)" : "transparent",
                    color: isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                    borderTop: isActive ? "1px solid var(--vscode-focusBorder, #007fd4)" : "1px solid transparent",
                  }}
                  onClick={() => setActiveId(tab.sessionId)}
                >
                  <span>{tab.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.sessionId); }}
                    className="flex items-center justify-center w-4 h-4 rounded-sm"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.7, fontSize: "14px", lineHeight: 1, padding: 0 }}
                    aria-label="Close tab"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={openTab}
              className="flex items-center justify-center shrink-0 px-2"
              style={{ height: "36px", background: "none", border: "none", cursor: "pointer", color: "var(--vscode-descriptionForeground)", fontSize: "18px", lineHeight: 1 }}
              aria-label="New terminal"
              title="New terminal"
            >
              +
            </button>
          </div>

          {/* Terminal area */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden", backgroundColor: "#1e1e1e" }}>
            {tabs.length === 0 && (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                No terminal open
              </div>
            )}
            {tabs.map((tab) => (
              <XTerminal
                key={tab.sessionId}
                wsUrl={tab.wsUrl}
                isActive={tab.sessionId === activeId}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
