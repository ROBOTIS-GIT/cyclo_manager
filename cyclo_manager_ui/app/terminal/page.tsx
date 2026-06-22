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
import {
  getDockerContainers,
  getDockerContainerTop,
  killDockerProcess,
  getDockerTerminalWsUrl,
  stopDockerTerminal,
} from "@/lib/api";
import { XTerminal } from "@/components/XTerminal";
import type { DockerContainerInfo, DockerTopResponse } from "@/types/api";

interface Tab {
  sessionId: string;
  label: string;
  wsUrl: string;
}

function nextBashNumber(tabs: Tab[]): number {
  const used = new Set(tabs.map((t) => parseInt(t.label.match(/\d+$/)?.[0] ?? "0")));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function newSessionId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function storageKey(name: string) {
  return `cm_terms_${name}`;
}

function loadTabsForContainer(name: string): Tab[] {
  try {
    const stored = localStorage.getItem(storageKey(name));
    if (stored) {
      const sessions: { sessionId: string; label: string }[] = JSON.parse(stored);
      return sessions.map((s) => ({
        ...s,
        wsUrl: getDockerTerminalWsUrl(name, s.sessionId),
      }));
    }
  } catch {
    // ignore
  }
  const sessionId = newSessionId();
  return [{ sessionId, label: "bash 1", wsUrl: getDockerTerminalWsUrl(name, sessionId) }];
}

function saveTabsForContainer(name: string, tabs: Tab[]) {
  if (tabs.length === 0) {
    localStorage.removeItem(storageKey(name));
  } else {
    localStorage.setItem(
      storageKey(name),
      JSON.stringify(tabs.map(({ sessionId, label }) => ({ sessionId, label })))
    );
  }
}

export default function TerminalPage() {
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);

  // tabs & activeId per container
  const tabsMapRef = useRef<Record<string, Tab[]>>({});
  const activeIdMapRef = useRef<Record<string, string | null>>({});
  const [, forceUpdate] = useState(0);
  const rerender = useCallback(() => forceUpdate((n) => n + 1), []);

  // process list
  const [top, setTop] = useState<DockerTopResponse | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [killLoadingPid, setKillLoadingPid] = useState<number | null>(null);
  const [killError, setKillError] = useState<string | null>(null);
  const topIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const docker = await getDockerContainers();
        setContainers(docker.containers);

        if (docker.containers.length > 0) {
          const first = docker.containers[0].name;
          setSelectedContainer(first);
          ensureTabsLoaded(first);
        }
      } catch {
        // ignore
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTop = useCallback(async (name: string) => {
    try {
      const res = await getDockerContainerTop(name);
      setTop(res);
      setTopError(null);
    } catch (err) {
      setTop(null);
      setTopError(err instanceof Error ? err.message : "Failed to fetch processes");
    }
  }, []);

  useEffect(() => {
    if (!selectedContainer) return;
    setTop(null);
    setTopError(null);
    fetchTop(selectedContainer);
    if (topIntervalRef.current) clearInterval(topIntervalRef.current);
    topIntervalRef.current = setInterval(() => fetchTop(selectedContainer), 3000);
    return () => { if (topIntervalRef.current) clearInterval(topIntervalRef.current); };
  }, [selectedContainer, fetchTop]);

  function ensureTabsLoaded(name: string) {
    if (tabsMapRef.current[name]) return;
    const tabs = loadTabsForContainer(name);
    tabsMapRef.current[name] = tabs;
    activeIdMapRef.current[name] = tabs[0]?.sessionId ?? null;
  }

  function handleSelectContainer(name: string) {
    ensureTabsLoaded(name);
    setSelectedContainer(name);
  }

  const currentTabs = selectedContainer ? (tabsMapRef.current[selectedContainer] ?? []) : [];
  const currentActiveId = selectedContainer ? (activeIdMapRef.current[selectedContainer] ?? null) : null;

  function setActiveId(id: string) {
    if (!selectedContainer) return;
    activeIdMapRef.current[selectedContainer] = id;
    rerender();
  }

  function openTab() {
    if (!selectedContainer) return;
    const sessionId = newSessionId();
    const n = nextBashNumber(tabsMapRef.current[selectedContainer] ?? []);
    const tab: Tab = {
      sessionId,
      label: `bash ${n}`,
      wsUrl: getDockerTerminalWsUrl(selectedContainer, sessionId),
    };
    const next = [...(tabsMapRef.current[selectedContainer] ?? []), tab];
    tabsMapRef.current[selectedContainer] = next;
    activeIdMapRef.current[selectedContainer] = sessionId;
    saveTabsForContainer(selectedContainer, next);
    rerender();
  }

  function closeTab(sessionId: string) {
    if (!selectedContainer) return;
    stopDockerTerminal(selectedContainer, sessionId);
    const prev = tabsMapRef.current[selectedContainer] ?? [];
    const remaining = prev.filter((t) => t.sessionId !== sessionId);
    tabsMapRef.current[selectedContainer] = remaining;

    const cur = activeIdMapRef.current[selectedContainer];
    if (cur === sessionId) {
      const idx = prev.findIndex((t) => t.sessionId === sessionId);
      activeIdMapRef.current[selectedContainer] =
        remaining[Math.max(0, idx - 1)]?.sessionId ?? remaining[0]?.sessionId ?? null;
    }
    saveTabsForContainer(selectedContainer, remaining);
    rerender();
  }

  async function handleKill(pid: number) {
    if (!selectedContainer) return;
    setKillLoadingPid(pid);
    setKillError(null);
    try {
      await killDockerProcess(selectedContainer, pid, "SIGKILL");
      await fetchTop(selectedContainer);
    } catch (err) {
      setKillError(err instanceof Error ? err.message : "Failed to kill process");
      setTimeout(() => setKillError(null), 4000);
    } finally {
      setKillLoadingPid(null);
    }
  }

  const titles = top?.titles ?? [];
  const pidIdx = titles.findIndex((t) => t === "PID");
  const userIdx = titles.findIndex((t) => t === "UID" || t === "USER");
  const cmdIdx = titles.findIndex((t) => t === "CMD" || t === "COMMAND");

  return (
    <div style={{ height: "100%", display: "flex", overflow: "hidden" }}>

      {/* Left panel */}
      <div
        className="flex flex-col shrink-0 border-r"
        style={{ width: "300px", borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)" }}
      >
        {/* Container list */}
        <div
          className="px-3 py-2 border-b shrink-0"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Containers
          </span>
        </div>
        <div className="shrink-0 py-1 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>
          {containers.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>No containers</p>
          )}
          {containers.map((c) => {
            const isRunning = c.status?.toLowerCase().includes("up") ?? false;
            const isSelected = selectedContainer === c.name;
            return (
              <button
                key={c.name}
                onClick={() => handleSelectContainer(c.name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                style={{
                  background: isSelected ? "var(--vscode-list-activeSelectionBackground)" : "none",
                  color: isSelected ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span
                  className="shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: isRunning ? "#3fb950" : "var(--vscode-descriptionForeground)", opacity: isRunning ? 1 : 0.4 }}
                />
                <span className="truncate font-mono">{c.name}</span>
              </button>
            );
          })}
        </div>

        {/* Process list */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b shrink-0"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Processes
          </span>
          {selectedContainer && (
            <button
              onClick={() => fetchTop(selectedContainer)}
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", border: "none", cursor: "pointer" }}
            >
              Refresh
            </button>
          )}
        </div>

        {killError && (
          <div className="px-3 py-1.5 text-xs shrink-0" style={{ color: "var(--vscode-errorForeground)", backgroundColor: "rgba(244,135,113,0.1)" }}>
            {killError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!selectedContainer && (
            <p className="px-3 py-3 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>Select a container</p>
          )}
          {selectedContainer && topError && (
            <p className="p-3 text-xs" style={{ color: "var(--vscode-errorForeground)" }}>{topError}</p>
          )}
          {selectedContainer && !top && !topError && (
            <p className="p-3 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading...</p>
          )}
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
                      <td className="px-3 py-1.5 font-mono max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap" title={cmd}>{cmd}</td>
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

      {/* Right: Terminal */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedContainer ? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Select a container
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div
              className="flex items-end shrink-0 overflow-x-auto"
              style={{
                backgroundColor: "var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sidebar-background))",
                borderBottom: "1px solid var(--vscode-panel-border)",
                minHeight: "36px",
              }}
            >
              {currentTabs.map((tab) => {
                const isActive = tab.sessionId === currentActiveId;
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
              {currentTabs.length === 0 && (
                <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  No terminal open
                </div>
              )}
              {containers.map((c) => {
                const tabs = tabsMapRef.current[c.name] ?? [];
                const activeId = activeIdMapRef.current[c.name] ?? null;
                return tabs.map((tab) => (
                  <XTerminal
                    key={`${c.name}-${tab.sessionId}`}
                    wsUrl={tab.wsUrl}
                    isActive={c.name === selectedContainer && tab.sessionId === activeId}
                  />
                ));
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
