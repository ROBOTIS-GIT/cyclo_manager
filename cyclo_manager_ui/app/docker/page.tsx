"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Convert from "ansi-to-html";
import {
  getDockerContainers,
  controlDockerContainer,
  getDockerContainerLogs,
  getBashrc,
  updateBashrc,
} from "@/lib/api";
import type { DockerContainerInfo } from "@/types/api";
import StatusBadge from "@/components/StatusBadge";
import { useTheme } from "@/contexts/ThemeContext";

export default function DockerPage() {
  const { theme } = useTheme();
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{ container: string; action: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logsByContainer, setLogsByContainer] = useState<Record<string, string>>({});
  const [loadingLogsFor, setLoadingLogsFor] = useState<string | null>(null);
  const [logErrors, setLogErrors] = useState<Record<string, string>>({});
  const [settingsContainer, setSettingsContainer] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"info" | "log" | "bashrc">("info");
  const [bashrcContent, setBashrcContent] = useState("");
  const [bashrcLoading, setBashrcLoading] = useState(false);
  const [bashrcSaving, setBashrcSaving] = useState(false);
  const [bashrcError, setBashrcError] = useState<string | null>(null);

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

  const loadContainers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getDockerContainers(true);
      setContainers(res.containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load containers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  const handleAction = async (name: string, action: "start" | "stop" | "restart", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActionLoading({ container: name, action });
    setActionError(null);
    try {
      await controlDockerContainer(name, action);
      await loadContainers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Docker action failed");
      setTimeout(() => setActionError(null), 4000);
    } finally {
      setActionLoading(null);
    }
  };

  const loadBashrc = useCallback(async (name: string) => {
    setBashrcLoading(true);
    setBashrcError(null);
    try {
      const res = await getBashrc(name);
      setBashrcContent(res.content ?? "");
    } catch (err) {
      setBashrcError(err instanceof Error ? err.message : "Failed to load bashrc");
    } finally {
      setBashrcLoading(false);
    }
  }, []);

  const handleSaveBashrc = async () => {
    if (!settingsContainer) return;
    setBashrcSaving(true);
    setBashrcError(null);
    try {
      await updateBashrc(settingsContainer, bashrcContent);
      loadBashrc(settingsContainer);
    } catch (err) {
      setBashrcError(err instanceof Error ? err.message : "Failed to save bashrc");
    } finally {
      setBashrcSaving(false);
    }
  };

  const fetchLogs = async (name: string) => {
    if (logsByContainer[name]) return;
    setLoadingLogsFor(name);
    setLogErrors((prev) => ({ ...prev, [name]: "" }));
    try {
      const response = await getDockerContainerLogs(name, 100);
      setLogsByContainer((prev) => ({ ...prev, [name]: response.logs }));
    } catch (err) {
      setLogErrors((prev) => ({ ...prev, [name]: err instanceof Error ? err.message : "Failed to fetch logs" }));
    } finally {
      setLoadingLogsFor(null);
    }
  };

  const buttonStyle = (primary: boolean, disabled: boolean) => ({
    padding: "4px 12px",
    fontSize: "12px",
    border: "none",
    borderRadius: "2px",
    cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
    opacity: disabled ? 0.5 : 1,
    backgroundColor: primary ? "var(--vscode-button-background)" : "var(--vscode-button-secondaryBackground)",
    color: primary ? "var(--vscode-button-foreground)" : "var(--vscode-button-secondaryForeground)",
  });

  if (loading && containers.length === 0) {
    return (
      <div className="p-6">
        <p style={{ color: "var(--vscode-descriptionForeground)" }}>Loading Docker containers...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--vscode-foreground)" }}>
          Docker Containers
        </h1>
        <button
          onClick={loadContainers}
          disabled={loading}
          style={buttonStyle(true, loading)}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded text-sm"
          style={{ backgroundColor: "var(--vscode-inputValidation-errorBackground)", color: "var(--vscode-errorForeground)" }}
        >
          {error}
        </div>
      )}

      {actionError && (
        <div
          className="mb-4 p-3 rounded text-sm"
          style={{ backgroundColor: "var(--vscode-inputValidation-errorBackground)", color: "var(--vscode-errorForeground)" }}
        >
          {actionError}
        </div>
      )}

      <div
        className="rounded-lg border overflow-hidden"
        style={{ backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}
      >
        <table className="w-full text-sm" style={{ color: "var(--vscode-foreground)" }}>
          <thead>
            <tr style={{ backgroundColor: "var(--vscode-list-hoverBackground)", borderBottom: "1px solid var(--vscode-panel-border)" }}>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Image</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {containers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  No containers found.
                </td>
              </tr>
            ) : (
              containers.map((c) => {
                const isRunning = c.status?.toLowerCase() === "running";
                const busy = actionLoading !== null && actionLoading.container === c.name;
                return (
                  <tr
                    key={c.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: "var(--vscode-panel-border)" }}
                  >
                    <td className="px-4 py-3 font-mono">{c.name}</td>
                    <td className="px-4 py-3">{c.image || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">{new Date(c.created).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isRunning ? (
                          <>
                            <button
                              onClick={(e) => handleAction(c.name, "stop", e)}
                              disabled={busy}
                              style={buttonStyle(false, busy)}
                            >
                              {actionLoading?.container === c.name && actionLoading?.action === "stop" ? "Stopping..." : "Stop"}
                            </button>
                            <button
                              onClick={(e) => handleAction(c.name, "restart", e)}
                              disabled={busy}
                              style={buttonStyle(false, busy)}
                            >
                              {actionLoading?.container === c.name && actionLoading?.action === "restart" ? "Restarting..." : "Restart"}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => handleAction(c.name, "start", e)}
                            disabled={busy}
                            style={buttonStyle(true, busy)}
                          >
                            {actionLoading?.container === c.name && actionLoading?.action === "start" ? "Starting..." : "Start"}
                          </button>
                        )}
                        <button
                          onClick={() => { setSettingsContainer(c.name); setSettingsTab("info"); }}
                          className="p-1.5 rounded"
                          style={{
                            backgroundColor: "var(--vscode-button-secondaryBackground)",
                            color: "var(--vscode-button-secondaryForeground)",
                            border: "none",
                            cursor: "pointer",
                          }}
                          title="Settings"
                          aria-label="Settings"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {settingsContainer && (() => {
        const docker = containers.find((d) => d.name === settingsContainer);
        if (!docker) return null;
        const slotError = logErrors[docker.name];
        const isLoadingLogs = loadingLogsFor === docker.name;
        const logContent = logsByContainer[docker.name];

        return (
          <div
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            onClick={() => setSettingsContainer(null)}
          >
            <div
              className="rounded-lg border shadow-xl w-[42rem] h-[28rem] flex flex-col overflow-hidden"
              style={{
                backgroundColor: "var(--vscode-editor-background)",
                borderColor: "var(--vscode-panel-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--vscode-panel-border)" }}>
                <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
                  Settings — {docker.name}
                </h2>
                <button
                  onClick={() => setSettingsContainer(null)}
                  className="p-1 rounded hover:opacity-80"
                  style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="flex border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>
                <button
                  onClick={() => setSettingsTab("info")}
                  className="px-4 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: settingsTab === "info" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
                    color: settingsTab === "info" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Info
                </button>
                <button
                  onClick={() => { setSettingsTab("log"); fetchLogs(docker.name); }}
                  className="px-4 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: settingsTab === "log" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
                    color: settingsTab === "log" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Log
                </button>
                <button
                  onClick={() => { setSettingsTab("bashrc"); loadBashrc(docker.name); }}
                  className="px-4 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: settingsTab === "bashrc" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
                    color: settingsTab === "bashrc" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  bashrc
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {settingsTab === "info" && (
                  <div className="space-y-2 text-sm">
                    <div><span className="font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>Container ID:</span> <span className="font-mono break-all" style={{ color: "var(--vscode-foreground)" }}>{docker.id}</span></div>
                    <div><span className="font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>Image:</span> <span style={{ color: "var(--vscode-foreground)" }}>{docker.image}</span></div>
                    <div><span className="font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>Status:</span> <StatusBadge status={docker.status} /></div>
                    <div><span className="font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>Created:</span> <span style={{ color: "var(--vscode-foreground)" }}>{new Date(docker.created).toLocaleString()}</span></div>
                  </div>
                )}
                {settingsTab === "log" && (
                  <div>
                    {isLoadingLogs && <p style={{ color: "var(--vscode-descriptionForeground)" }}>Loading logs...</p>}
                    {slotError && <p style={{ color: "var(--vscode-errorForeground)" }}>{slotError}</p>}
                    {logContent && (
                      <pre
                        className="text-xs p-3 rounded overflow-auto max-h-96 font-mono whitespace-pre-wrap break-words"
                        style={{ backgroundColor: "var(--vscode-textCodeBlock-background)", color: "var(--vscode-foreground)" }}
                        dangerouslySetInnerHTML={{ __html: convert.toHtml(logContent) }}
                      />
                    )}
                  </div>
                )}
                {settingsTab === "bashrc" && (
                  <div className="space-y-2">
                    {bashrcError && (
                      <div
                        className="px-2 py-1.5 rounded text-xs"
                        style={{
                          color: "var(--vscode-errorForeground)",
                          backgroundColor: "rgba(244, 135, 113, 0.1)",
                          border: "1px solid rgba(244, 135, 113, 0.3)",
                        }}
                      >
                        {bashrcError}
                      </div>
                    )}
                    {bashrcLoading ? (
                      <p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                        Loading ~/.bashrc...
                      </p>
                    ) : (
                      <>
                        <textarea
                          value={bashrcContent}
                          onChange={(e) => setBashrcContent(e.target.value)}
                          className="w-full min-h-[200px] p-2 text-xs font-mono rounded resize-y"
                          style={{
                            border: "1px solid var(--vscode-input-border)",
                            backgroundColor: "var(--vscode-input-background)",
                            color: "var(--vscode-input-foreground)",
                          }}
                          spellCheck={false}
                        />
                        <button
                          onClick={handleSaveBashrc}
                          disabled={bashrcLoading || bashrcSaving}
                          className="px-3 py-1.5 text-sm rounded disabled:opacity-50"
                          style={{
                            backgroundColor: "var(--vscode-button-background)",
                            color: "var(--vscode-button-foreground)",
                          }}
                        >
                          {bashrcSaving ? "Saving…" : "Save"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
