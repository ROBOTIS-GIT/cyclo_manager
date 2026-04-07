"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import Convert from "ansi-to-html";
import {
  getConfiguredContainers,
  getDockerContainers,
  controlDockerContainer,
  getDockerContainerLogs,
  getRepoVersion,
  getCycloManagerVersion,
} from "@/lib/api";
import type { ConfiguredContainerInfo, DockerContainerInfo, RepoVersionResponse, CycloManagerVersionResponse } from "@/types/api";
import StatusBadge from "@/components/StatusBadge";
import { useAppsHubBanner } from "@/contexts/AppsHubBannerContext";
import { useTheme } from "@/contexts/ThemeContext";

const SLOTS: { label: string; containerName: string }[] = [
  { label: "ai worker", containerName: "ai_worker" },
  { label: "open manipulator", containerName: "open_manipulator" },
];

export default function HomePage() {
  const { theme } = useTheme();
  const { setUpdateBannerVisible } = useAppsHubBanner();
  const [configuredContainers, setConfiguredContainers] = useState<ConfiguredContainerInfo[]>([]);
  const [dockerContainers, setDockerContainers] = useState<DockerContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dockerLoading, setDockerLoading] = useState<string | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [logsBySlot, setLogsBySlot] = useState<Record<string, string>>({});
  const [loadingLogsSlot, setLoadingLogsSlot] = useState<string | null>(null);
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const [settingsSlot, setSettingsSlot] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"info" | "log">("info");
  const [versionInfo, setVersionInfo] = useState<RepoVersionResponse | null>(null);
  const [showUpdateInstructions, setShowUpdateInstructions] = useState(false);
  const [cycloManagerVersionInfo, setCycloManagerVersionInfo] = useState<CycloManagerVersionResponse | null>(null);
  const [showCycloManagerUpdateInstructions, setShowCycloManagerUpdateInstructions] = useState(false);

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
      const [containersRes, dockerRes] = await Promise.all([
        getConfiguredContainers(),
        getDockerContainers(true),
      ]);
      setConfiguredContainers(containersRes.containers);
      setDockerContainers(dockerRes.containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  useEffect(() => {
    const docker = findDockerContainer("ai_worker");
    if (
      !hasConfiguredContainer("ai_worker") ||
      !docker ||
      docker.status?.toLowerCase() !== "running"
    ) {
      setVersionInfo(null);
      return;
    }
    getRepoVersion(docker.name)
      .then((info) => setVersionInfo(info))
      .catch(() => setVersionInfo(null));
  }, [configuredContainers, dockerContainers]);

  useEffect(() => {
    getCycloManagerVersion()
      .then((info) => setCycloManagerVersionInfo(info))
      .catch(() => setCycloManagerVersionInfo(null));
  }, []);

  useEffect(() => {
    const show =
      !loading &&
      !error &&
      !!cycloManagerVersionInfo?.update_available;
    setUpdateBannerVisible(show);
    return () => setUpdateBannerVisible(false);
  }, [
    loading,
    error,
    cycloManagerVersionInfo?.update_available,
    setUpdateBannerVisible,
  ]);

  const hasConfiguredContainer = (name: string) =>
    configuredContainers.some((c) => c.name === name);

  const findDockerContainer = (name: string): DockerContainerInfo | undefined =>
    dockerContainers.find(
      (d) => d.name === name || d.name === name.replace(/_/g, "-")
    );

  const handleDockerAction = async (
    dockerName: string,
    action: "start" | "stop" | "restart",
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDockerLoading(action);
    setDockerError(null);
    try {
      await controlDockerContainer(dockerName, action);
      await loadContainers();
    } catch (err) {
      setDockerError(err instanceof Error ? err.message : "Docker action failed");
      setTimeout(() => setDockerError(null), 4000);
    } finally {
      setDockerLoading(null);
    }
  };

  const fetchDockerLogs = async (dockerName: string) => {
    if (logsBySlot[dockerName]) return;
    setLoadingLogsSlot(dockerName);
    setSlotErrors((prev) => ({ ...prev, [dockerName]: "" }));
    try {
      const response = await getDockerContainerLogs(dockerName, 100);
      setLogsBySlot((prev) => ({ ...prev, [dockerName]: response.logs }));
    } catch (err) {
      setSlotErrors((prev) => ({ ...prev, [dockerName]: err instanceof Error ? err.message : "Failed to fetch logs" }));
    } finally {
      setLoadingLogsSlot(null);
    }
  };

  const getDockerActionButtonStyle = (primary: boolean, disabled?: boolean) => ({
    padding: "4px 12px",
    fontSize: "12px",
    border: "none",
    borderRadius: "2px",
    cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
    opacity: disabled ? 0.5 : 1,
    backgroundColor: primary
      ? "var(--vscode-button-background)"
      : "var(--vscode-button-secondaryBackground)",
    color: primary
      ? "var(--vscode-button-foreground)"
      : "var(--vscode-button-secondaryForeground)",
  });

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          color: "var(--vscode-descriptionForeground)",
          backgroundColor: "var(--vscode-editor-background)",
        }}
      >
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: "var(--vscode-editor-background)" }}
      >
        <div
          className="border rounded p-4"
          style={{
            backgroundColor: "rgba(244, 135, 113, 0.1)",
            borderColor: "rgba(244, 135, 113, 0.3)",
            color: "var(--vscode-errorForeground)",
          }}
        >
          <p className="mb-2">{error}</p>
          <button onClick={loadContainers} style={getDockerActionButtonStyle(true, false)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col p-6"
      style={{ backgroundColor: "var(--vscode-editor-background)" }}
    >
      {cycloManagerVersionInfo?.update_available && (
        <div
          className="fixed top-0 left-0 right-0 z-50 p-3 flex flex-wrap items-center justify-center gap-3 shadow-md"
          style={{
            backgroundColor: "var(--vscode-badge-background, #4dabf7)",
            color: "var(--vscode-badge-foreground, #fff)",
          }}
        >
          <span className="text-sm font-medium">
            cyclo_manager {cycloManagerVersionInfo.current} → {cycloManagerVersionInfo.latest}
          </span>
          <button
            type="button"
            onClick={() => setShowCycloManagerUpdateInstructions(true)}
            className="px-3 py-1.5 rounded text-sm font-medium border border-white/50 hover:bg-white/20"
          >
            Update available
          </button>
        </div>
      )}
      <div
        className={`w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0 ${cycloManagerVersionInfo?.update_available ? "pt-14" : ""}`}
      >
        <header className="w-full flex justify-center shrink-0 pb-5 pt-0">
          <img
            src="/cyclo_logo.png"
            alt="CYCLO"
            className="h-14 sm:h-16 w-auto max-w-[min(100%,34rem)] object-contain"
            draggable={false}
            style={{
              filter: theme === "dark" ? "invert(1)" : undefined,
            }}
          />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0 w-full">
        {dockerError && (
          <div
            className="mb-4 p-2 rounded text-sm"
            style={{
              backgroundColor: "rgba(244, 135, 113, 0.1)",
              color: "var(--vscode-errorForeground)",
            }}
          >
            {dockerError}
          </div>
        )}
        <div className="flex flex-row justify-center gap-6">
          {SLOTS.filter(
            (slot) =>
              hasConfiguredContainer(slot.containerName) && findDockerContainer(slot.containerName) != null
          ).map((slot) => {
            const docker = findDockerContainer(slot.containerName);
            const isRunning = docker?.status?.toLowerCase() === "running";

            const CardContent = (
              <div
                key={slot.containerName}
                className="rounded-lg border-2 p-6 cursor-pointer w-[32rem] h-[32rem] flex flex-col hover:border-[var(--vscode-focusBorder)]"
                style={{
                  backgroundColor: "var(--vscode-sidebar-background)",
                  borderColor: "var(--vscode-panel-border)",
                }}
              >
                <div className="font-medium text-lg flex items-center gap-2 flex-wrap" style={{ color: "var(--vscode-foreground)" }}>
                  {slot.label}
                  {docker != null && (
                    <StatusBadge status={docker.status} />
                  )}
                  {slot.containerName === "ai_worker" && versionInfo?.update_available && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="text-xs px-2 py-0.5 rounded font-medium cursor-pointer hover:opacity-90"
                      style={{
                        backgroundColor: "var(--vscode-badge-background, #4dabf7)",
                        color: "var(--vscode-badge-foreground, #fff)",
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowUpdateInstructions(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowUpdateInstructions(true);
                        }
                      }}
                      title="How to update"
                    >
                      Update available
                    </span>
                  )}
                </div>

                {docker != null ? (
                  <>
                    <div className="flex-1 min-h-0 flex items-center justify-center">
                      {slot.containerName === "ai_worker" && (
                        <img
                          src="/ai_worker.png"
                          alt="AI Worker"
                          className="max-w-full max-h-full object-contain"
                        />
                      )}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2 flex-shrink-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {isRunning ? (
                          <>
                            <button
                              onClick={(e) => handleDockerAction(docker.name, "stop", e)}
                              disabled={dockerLoading !== null}
                              style={getDockerActionButtonStyle(false, dockerLoading !== null)}
                            >
                              {dockerLoading === "stop" ? "Stopping..." : "Stop"}
                            </button>
                            <button
                              onClick={(e) => handleDockerAction(docker.name, "restart", e)}
                              disabled={dockerLoading !== null}
                              style={getDockerActionButtonStyle(false, dockerLoading !== null)}
                            >
                              {dockerLoading === "restart" ? "Restarting..." : "Restart"}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => handleDockerAction(docker.name, "start", e)}
                            disabled={dockerLoading !== null}
                            style={getDockerActionButtonStyle(true, dockerLoading !== null)}
                          >
                            {dockerLoading === "start" ? "Starting..." : "Start"}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSettingsSlot(docker.name);
                          setSettingsTab("info");
                        }}
                        className="p-1.5 rounded flex-shrink-0"
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
                  </>
                ) : (
                  <div className="mt-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                    Docker container not running
                  </div>
                )}
              </div>
            );

            return (
              <Link key={slot.containerName} href={`/${slot.containerName}/control`}>
                {CardContent}
              </Link>
            );
          })}
        </div>
        </div>

        {showUpdateInstructions && (
          <div
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowUpdateInstructions(false)}
          >
            <div
              className="rounded-lg border shadow-xl w-[28rem] flex flex-col overflow-hidden"
              style={{
                backgroundColor: "var(--vscode-editor-background)",
                borderColor: "var(--vscode-panel-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--vscode-panel-border)" }}>
                <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
                  How to update ai_worker
                </h2>
                <button
                  onClick={() => setShowUpdateInstructions(false)}
                  className="p-1 rounded hover:opacity-80"
                  style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              {versionInfo && (
                <div
                  className="px-4 py-2 flex gap-4 text-sm"
                  style={{
                    borderBottom: "1px solid var(--vscode-panel-border)",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  <span>Current: <span className="font-mono font-medium" style={{ color: "var(--vscode-foreground)" }}>{versionInfo.current}</span></span>
                  <span>Latest: <span className="font-mono font-medium" style={{ color: "var(--vscode-foreground)" }}>{versionInfo.latest}</span></span>
                </div>
              )}
              <div className="p-4 space-y-4 text-sm" style={{ color: "var(--vscode-foreground)" }}>
                <div>
                  <p className="mb-1.5">1. Go to the ai_worker/docker directory & stop container.</p>
                  <div
                    className="rounded overflow-hidden border"
                    style={{
                      borderColor: "var(--vscode-panel-border)",
                      backgroundColor: "var(--vscode-editor-background)",
                    }}
                  >
                    <div
                      className="px-3 py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--vscode-sidebar-background)",
                        borderBottom: "1px solid var(--vscode-panel-border)",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      bash
                    </div>
                    <pre
                      className="p-3 text-xs font-mono overflow-x-auto m-0"
                      style={{
                        color: "var(--vscode-editor-foreground, var(--vscode-foreground))",
                        fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
                      }}
                    >
                      ./container stop
                    </pre>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5">2. Git pull latest ai_worker source.</p>
                  <div
                    className="rounded overflow-hidden border"
                    style={{
                      borderColor: "var(--vscode-panel-border)",
                      backgroundColor: "var(--vscode-editor-background)",
                    }}
                  >
                    <div
                      className="px-3 py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--vscode-sidebar-background)",
                        borderBottom: "1px solid var(--vscode-panel-border)",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      bash
                    </div>
                    <pre
                      className="p-3 text-xs font-mono overflow-x-auto m-0"
                      style={{
                        color: "var(--vscode-editor-foreground, var(--vscode-foreground))",
                        fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
                      }}
                    >
                      git pull
                    </pre>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5">3. Start container.</p>
                  <div
                    className="rounded overflow-hidden border"
                    style={{
                      borderColor: "var(--vscode-panel-border)",
                      backgroundColor: "var(--vscode-editor-background)",
                    }}
                  >
                    <div
                      className="px-3 py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--vscode-sidebar-background)",
                        borderBottom: "1px solid var(--vscode-panel-border)",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      bash
                    </div>
                    <pre
                      className="p-3 text-xs font-mono overflow-x-auto m-0"
                      style={{
                        color: "var(--vscode-editor-foreground, var(--vscode-foreground))",
                        fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
                      }}
                    >
                      ./container start
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showCycloManagerUpdateInstructions && cycloManagerVersionInfo && (
          <div
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowCycloManagerUpdateInstructions(false)}
          >
            <div
              className="rounded-lg border shadow-xl w-[28rem] flex flex-col overflow-hidden"
              style={{
                backgroundColor: "var(--vscode-editor-background)",
                borderColor: "var(--vscode-panel-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--vscode-panel-border)" }}>
                <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
                  How to update cyclo_manager
                </h2>
                <button
                  onClick={() => setShowCycloManagerUpdateInstructions(false)}
                  className="p-1 rounded hover:opacity-80"
                  style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div
                className="px-4 py-2 flex gap-4 text-sm"
                style={{
                  borderBottom: "1px solid var(--vscode-panel-border)",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                <span>Current: <span className="font-mono font-medium" style={{ color: "var(--vscode-foreground)" }}>{cycloManagerVersionInfo.current}</span></span>
                <span>Latest: <span className="font-mono font-medium" style={{ color: "var(--vscode-foreground)" }}>{cycloManagerVersionInfo.latest}</span></span>
              </div>
              <div className="p-4 space-y-4 text-sm" style={{ color: "var(--vscode-foreground)" }}>
                <div>
                  <p className="mb-1.5">1. Use below command in host</p>
                  <div
                    className="rounded overflow-hidden border"
                    style={{
                      borderColor: "var(--vscode-panel-border)",
                      backgroundColor: "var(--vscode-editor-background)",
                    }}
                  >
                    <div
                      className="px-3 py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: "var(--vscode-sidebar-background)",
                        borderBottom: "1px solid var(--vscode-panel-border)",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      bash
                    </div>
                    <pre
                      className="p-3 text-xs font-mono overflow-x-auto m-0"
                      style={{
                        color: "var(--vscode-editor-foreground, var(--vscode-foreground))",
                        fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
                      }}
                    >
                      cyclo_manager update
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {settingsSlot && (() => {
          const docker = dockerContainers.find(
            (d) => d.name === settingsSlot || d.name === settingsSlot.replace(/_/g, "-")
          );
          if (!docker) return null;
          const slotError = slotErrors[docker.name];
          const isLoadingLogs = loadingLogsSlot === docker.name;
          const logContent = logsBySlot[docker.name];

          return (
            <div
              className="fixed inset-0 flex items-center justify-center z-50"
              style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
              onClick={() => setSettingsSlot(null)}
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
                    onClick={() => setSettingsSlot(null)}
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
                    onClick={() => { setSettingsTab("log"); fetchDockerLogs(docker.name); }}
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
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
