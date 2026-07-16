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

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import Convert from "ansi-to-html";
import { usePolling } from "@/hooks/usePolling";
import {
  getSystemStats,
  getRobotInfo,
  getDockerContainers,
  controlDockerContainer,
  getDockerContainerLogs,
  getBashrc,
  updateBashrc,
  getRepoUpdates,
  getS6AgentStatuses,
  updateS6Agent,
} from "@/lib/api";
import type {
  HostSystemStatsResponse,
  RobotInfoResponse,
  DockerContainerInfo,
  RepoUpdateStatus,
  S6AgentStatusResponse,
} from "@/types/api";
import StatusBadge from "@/components/StatusBadge";
import UpdateWizard from "@/components/UpdateWizard";
import { useTheme } from "@/contexts/ThemeContext";

const POLL_INTERVAL = 5000;

// ─── helpers ────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function gaugeColor(percent: number): string {
  if (percent >= 90) return "#f44336";
  if (percent >= 75) return "#ff9800";
  return "var(--vscode-button-background, #0078d4)";
}

// ─── primitives ─────────────────────────────────────────────────────────────

function Card({ children, title, action, className = "" }: { children: React.ReactNode; title?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border overflow-hidden ${className}`}
      style={{
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sidebar-background)",
      }}
    >
      {title && (
        <div className="px-5 pt-4 pb-1.5 flex items-center justify-between">
          <span className="text-sm font-bold uppercase tracking-widest"
            style={{ color: "var(--vscode-foreground)" }}>
            {title}
          </span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const btnStyle = (primary: boolean, disabled: boolean): React.CSSProperties => ({
  padding: "4px 12px",
  fontSize: "13px",
  border: "none",
  borderRadius: "2px",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
  backgroundColor: primary
    ? "var(--vscode-button-background)"
    : "var(--vscode-button-secondaryBackground)",
  color: primary
    ? "var(--vscode-button-foreground)"
    : "var(--vscode-button-secondaryForeground)",
});

// ─── sub-components ─────────────────────────────────────────────────────────

function CircleGauge({ fill, label, display, sub }: {
  fill: number; label: string; display?: string; sub?: string;
}) {
  const SIZE = 110, STROKE = 8;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(fill, 100) / 100) * circumference;
  const color = gaugeColor(fill);
  const cx = SIZE / 2, cy = SIZE / 2;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="var(--vscode-input-background, rgba(128,128,128,0.2))" strokeWidth={STROKE} />
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={STROKE}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.5s ease" }} />
        <text x={cx} y={cy - 10} textAnchor="middle" dominantBaseline="middle"
          fontSize="12" fontWeight="500" fill="var(--vscode-descriptionForeground)">
          {label}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="middle"
          fontSize="15" fontWeight="700" fill={color}>
          {display ?? `${fill}%`}
        </text>
      </svg>
      {sub && (
        <div className="text-sm text-center" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function UpdatableRepoRow({ repo, onUpdate }: {
  repo: RepoUpdateStatus;
  onUpdate: () => void;
}) {
  return (
    <div className="px-5 py-3" style={{ borderTop: "1px solid var(--vscode-panel-border)" }}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
            {repo.name}
          </div>
          {repo.current_version && (
            <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {repo.has_update && repo.latest_version
                ? `${repo.current_version} → ${repo.latest_version}`
                : repo.current_version}
            </div>
          )}
        </div>
        {repo.has_update && (
          <button onClick={onUpdate} style={btnStyle(true, false)}>
            Update
          </button>
        )}
      </div>
    </div>
  );
}

function AgentStatusRow({
  agent,
  updating,
  onUpdate,
}: {
  agent: S6AgentStatusResponse;
  updating: boolean;
  onUpdate: () => void;
}) {
  const statusLabel =
    agent.status === "outdated" ? "Update required" :
      agent.status === "unreachable" ? "Unreachable" :
        agent.status === "unknown_version" ? "Unknown version" :
          "OK";

  return (
    <div className="px-5 py-3" style={{ borderTop: "1px solid var(--vscode-panel-border)" }}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
            {agent.container} s6 agent
          </div>
          <div className="text-xs truncate" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Installed {agent.version ?? "unknown"} · Required {agent.minimum_required_version}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span
            className="text-xs font-semibold"
            style={{ color: agent.update_required ? "var(--vscode-errorForeground)" : "#3fb950" }}
          >
            {statusLabel}
          </span>
          {agent.update_required && (
            <button
              onClick={onUpdate}
              disabled={updating}
              style={btnStyle(true, updating)}
            >
              {updating ? "Updating…" : "Update"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type AgentUpdateModalState = {
  container: string;
  status: "confirm" | "running" | "waiting" | "done" | "error";
  message: string;
  output: string;
};

function AgentUpdateModal({
  state,
  onClose,
  onConfirm,
}: {
  state: AgentUpdateModalState;
  onClose: () => void;
  onConfirm: (container: string) => void;
}) {
  const running = state.status === "running" || state.status === "waiting";
  const confirming = state.status === "confirm";
  const statusColor =
    state.status === "done" ? "#3fb950" :
      state.status === "error" ? "var(--vscode-errorForeground)" :
        "var(--vscode-descriptionForeground)";
  const detail =
    state.status === "confirm" ? `The s6 agent in ${state.container} container will be updated to the manager version and the container will restart.` :
      state.status === "running" ? "Updating repository checkout and restarting the container." :
        state.status === "waiting" ? "Container restarted. Waiting for the container agent to return." :
          state.status === "done" ? "Agent update completed." :
            "Agent update failed.";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      backgroundColor: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div
        style={{
          width: "min(620px, 95vw)",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "6px",
          border: "1px solid var(--vscode-panel-border)",
          backgroundColor: "var(--vscode-editor-background)",
          overflow: "hidden",
        }}
      >
        <div
          className="px-5 pt-4 pb-3 flex items-start justify-between"
          style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}
        >
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--vscode-foreground)" }}>
              {state.container} s6 agent
            </div>
            <div className="text-xs mt-0.5" style={{ color: statusColor }}>
              {state.message}
            </div>
          </div>
          {!confirming && (
            <button
              onClick={onClose}
              disabled={running}
              style={{
                background: "none",
                border: "none",
                cursor: running ? "not-allowed" : "pointer",
                opacity: running ? 0.5 : 1,
                padding: "0 0 0 8px",
                lineHeight: 1,
                color: "var(--vscode-descriptionForeground)",
              }}
              title="Close"
            >
              ✕
            </button>
          )}
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "grid",
            gap: 12,
          }}
        >
          <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
            {detail}
          </div>
          {state.output && (
            <pre
              className="text-xs p-3 rounded font-mono whitespace-pre-wrap break-words overflow-auto"
              style={{
                maxHeight: 260,
                backgroundColor: "var(--vscode-textCodeBlock-background)",
                color: state.status === "error" ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)",
                border: "1px solid var(--vscode-panel-border)",
              }}
            >
              {state.output}
            </pre>
          )}
        </div>
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--vscode-panel-border)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          flexShrink: 0,
        }}>
          {confirming ? (
            <>
              <button onClick={onClose} style={btnStyle(false)}>
                Cancel
              </button>
              <button onClick={() => onConfirm(state.container)} style={btnStyle(true)}>
                Update
              </button>
            </>
          ) : (
            <button onClick={onClose} disabled={running} style={btnStyle(false, running)}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="shrink-0 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
        {label}
      </span>
      <span className="text-right font-bold break-all text-sm"
        style={{ color: value ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function InfoStatusRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  if (value == null) {
    return <InfoRow label={label} value={undefined} />;
  }

  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="shrink-0 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
        {label}
      </span>
      <StatusBadge status={value} label={value ? "Connected" : "Disconnected"} />
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, padding: 0, border: "none", borderRadius: "50%",
  cursor: "pointer",
  backgroundColor: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
};

const iconBtnDisabled: React.CSSProperties = { ...iconBtn, opacity: 0.4, cursor: "not-allowed" };

function IconButton({ onClick, disabled, title, children }: {
  onClick?: () => void; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={disabled ? iconBtnDisabled : iconBtn}>
      {children}
    </button>
  );
}

function ContainerRow({ container, onAction, onOpenLog, onOpenBashrc, busy, busyAction }: {
  container: DockerContainerInfo;
  onAction: (action: "start" | "stop" | "restart") => void;
  onOpenLog: () => void;
  onOpenBashrc: () => void;
  busy: boolean;
  busyAction: string | null;
}) {
  const running = container.status.toLowerCase() === "running";

  return (
    <div className="flex items-center gap-3 px-5 py-3"
      style={{ borderTop: "1px solid var(--vscode-panel-border)" }}>
      <div className="flex-1 min-w-0">
        <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
          {container.name}
        </div>
        <div className="text-sm truncate" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {container.image}
        </div>
      </div>
      <div className="w-24 flex justify-start shrink-0">
        <StatusBadge status={container.status} />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {/* control icons — 3 fixed slots */}
        <div className="flex items-center gap-1.5" style={{ width: 100 }}>
          {running ? (
            <>
              <IconButton onClick={() => onAction("stop")} disabled={busy}
                title={busyAction === "stop" ? "Stopping…" : "Stop"}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="1" y="1" width="10" height="10" rx="1" />
                </svg>
              </IconButton>
              <IconButton onClick={() => onAction("restart")} disabled={busy}
                title={busyAction === "restart" ? "Restarting…" : "Restart"}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </IconButton>
            </>
          ) : (
            <>
              <IconButton onClick={() => onAction("start")} disabled={busy}
                title={busyAction === "start" ? "Starting…" : "Start"}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <polygon points="2,1 11,6 2,11" />
                </svg>
              </IconButton>
              <span style={{ width: 30 }} />
            </>
          )}
          <IconButton onClick={onOpenLog} title="Log">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="15" y2="18" />
            </svg>
          </IconButton>
        </div>

        {/* divider */}
        <div className="mx-1.5 h-4 w-px" style={{ backgroundColor: "var(--vscode-panel-border)" }} />

        {/* utility buttons — always visible, disabled when not running */}
        <Link
          href={running ? `/terminal?container=${encodeURIComponent(container.name)}` : "#"}
          style={btnStyle(false, !running)}
          className="no-underline text-xs"
          onClick={!running ? (e) => e.preventDefault() : undefined}
        >
          Terminal
        </Link>
        <button onClick={onOpenBashrc} disabled={!running} style={btnStyle(false, !running)}>bashrc</button>
      </div>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { theme } = useTheme();
  const [robotInfo, setRobotInfo] = useState<RobotInfoResponse | null>(null);
  const [systemStats, setSystemStats] = useState<HostSystemStatsResponse | null>(null);
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [updatableRepos, setUpdatableRepos] = useState<RepoUpdateStatus[]>([]);
  const [repoCheckState, setRepoCheckState] = useState<"loading" | "error" | "done">("loading");
  const [agentStatuses, setAgentStatuses] = useState<S6AgentStatusResponse[]>([]);
  const [agentCheckState, setAgentCheckState] = useState<"loading" | "error" | "done">("loading");
  const [updatingAgent, setUpdatingAgent] = useState<string | null>(null);
  const [agentUpdateModal, setAgentUpdateModal] = useState<AgentUpdateModalState | null>(null);
  const [wizardRepo, setWizardRepo] = useState<RepoUpdateStatus | null>(null);
  const [actionLoading, setActionLoading] = useState<{ container: string; action: string } | null>(null);

  // settings modal
  const [settingsContainer, setSettingsContainer] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"log" | "bashrc">("log");
  const [logsByContainer, setLogsByContainer] = useState<Record<string, string>>({});
  const [loadingLogsFor, setLoadingLogsFor] = useState<string | null>(null);
  const [logErrors, setLogErrors] = useState<Record<string, string>>({});
  const [bashrcContent, setBashrcContent] = useState("");
  const [bashrcLoading, setBashrcLoading] = useState(false);
  const [bashrcSaving, setBashrcSaving] = useState(false);
  const [bashrcError, setBashrcError] = useState<string | null>(null);

  const convert = useMemo(() => {
    const isDark = theme === "dark";
    return new Convert({
      fg: isDark ? "#d4d4d4" : "#333333",
      bg: isDark ? "#1e1e1e" : "#ffffff",
      newline: false, escapeXML: true, stream: false,
      colors: isDark
        ? { 0: "#000000", 1: "#cd3131", 2: "#0dbc79", 3: "#e5e510", 4: "#2472c8", 5: "#bc3fbc", 6: "#11a8cd", 7: "#e5e5e5", 8: "#666666", 9: "#f14c4c", 10: "#23d18b", 11: "#f5f543", 12: "#3b8eea", 13: "#d670d6", 14: "#29b8db", 15: "#e5e5e5" }
        : { 0: "#000000", 1: "#cd3131", 2: "#0dbc79", 3: "#e5e510", 4: "#2472c8", 5: "#bc3fbc", 6: "#11a8cd", 7: "#333333", 8: "#666666", 9: "#f14c4c", 10: "#23d18b", 11: "#f5f543", 12: "#3b8eea", 13: "#d670d6", 14: "#29b8db", 15: "#333333" },
    });
  }, [theme]);

  const loadContainers = useCallback(async () => {
    try {
      const { containers } = await getDockerContainers(true);
      setContainers(containers);
    } catch {}
  }, []);

  const loadRepoUpdates = useCallback(async () => {
    setRepoCheckState("loading");
    try {
      const { repos } = await getRepoUpdates();
      setUpdatableRepos(repos);
      setRepoCheckState("done");
    } catch {
      setRepoCheckState("error");
    }
  }, []);

  const loadAgentStatuses = useCallback(async () => {
    setAgentCheckState("loading");
    try {
      const { agents } = await getS6AgentStatuses();
      setAgentStatuses(agents);
      setAgentCheckState("done");
    } catch {
      setAgentCheckState("error");
    }
  }, []);

  const loadVersionManagement = useCallback(() => {
    loadRepoUpdates();
    loadAgentStatuses();
  }, [loadAgentStatuses, loadRepoUpdates]);

  const openAgentUpdateConfirm = useCallback((container: string) => {
    setAgentUpdateModal({
      container,
      status: "confirm",
      message: "s6 agent will be updated and container will be restarted.",
      output: "",
    });
  }, []);

  const handleAgentUpdate = useCallback(async (container: string) => {
    setUpdatingAgent(container);
    setAgentUpdateModal({
      container,
      status: "running",
      message: "Updating agent repository and restarting container...",
      output: "",
    });
    try {
      const result = await updateS6Agent(container);
      if (!result.success) {
        const message = result.output || `Update failed with exit code ${result.exit_code}`;
        setAgentUpdateModal({
          container,
          status: "error",
          message: "Update failed.",
          output: message,
        });
        return;
      }

      setAgentUpdateModal({
        container,
        status: "waiting",
        message: `Container restarted after updating to ${result.target_ref}. Waiting for agent status...`,
        output: result.output,
      });

      let latestAgents: S6AgentStatusResponse[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const { agents } = await getS6AgentStatuses();
        latestAgents = agents;
        setAgentStatuses(agents);
        setAgentCheckState("done");
        const updatedAgent = agents.find((agent) => agent.container === container);
        if (updatedAgent && updatedAgent.status !== "unreachable") {
          setAgentUpdateModal({
            container,
            status: updatedAgent.update_required ? "error" : "done",
            message: updatedAgent.update_required
              ? updatedAgent.message ?? "Agent still requires update."
              : "Agent is reachable and compatible.",
            output: result.output,
          });
          return;
        }
      }

      setAgentStatuses(latestAgents);
      setAgentUpdateModal({
        container,
        status: "error",
        message: "Agent did not become reachable after restart.",
        output: result.output,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update s6 agent";
      setAgentUpdateModal({
        container,
        status: "error",
        message: "Update failed.",
        output: message,
      });
    } finally {
      setUpdatingAgent(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.allSettled([
      getRobotInfo().then(setRobotInfo).catch(() => {}),
      getSystemStats().then(setSystemStats).catch(() => {}),
      loadContainers(),
    ]);
  }, [loadContainers]);

  usePolling(loadAll, POLL_INTERVAL);

  useEffect(() => {
    loadVersionManagement();
  }, [loadVersionManagement]);

  const handleAction = useCallback(async (name: string, action: "start" | "stop" | "restart") => {
    setActionLoading({ container: name, action });
    try {
      await controlDockerContainer(name, action);
      await loadContainers();
    } catch (err) {
      console.error("Docker action failed:", err);
    } finally {
      setActionLoading(null);
    }
  }, [loadContainers]);

  const fetchLogs = useCallback(async (name: string) => {
    if (logsByContainer[name]) return;
    setLoadingLogsFor(name);
    try {
      const res = await getDockerContainerLogs(name, 100);
      setLogsByContainer((p) => ({ ...p, [name]: res.logs }));
    } catch (err) {
      setLogErrors((p) => ({ ...p, [name]: err instanceof Error ? err.message : "Failed" }));
    } finally {
      setLoadingLogsFor(null);
    }
  }, [logsByContainer]);

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
      await loadBashrc(settingsContainer);
    } catch (err) {
      setBashrcError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBashrcSaving(false);
    }
  };

  const openLog = useCallback((name: string) => {
    setSettingsContainer(name);
    setSettingsTab("log");
    fetchLogs(name);
  }, [fetchLogs]);

  const openBashrc = useCallback((name: string) => {
    setSettingsContainer(name);
    setSettingsTab("bashrc");
    setBashrcContent("");
    setBashrcError(null);
    loadBashrc(name);
  }, [loadBashrc]);

  const memPct = systemStats ? pct(systemStats.memory_used_mb, systemStats.memory_total_mb) : 0;
  const diskPct = systemStats ? pct(systemStats.disk_used_gb, systemStats.disk_total_gb) : 0;
  const settingsDocker = containers.find((c) => c.name === settingsContainer) ?? null;
  const agentIssues = agentStatuses.filter((agent) => agent.update_required);
  const versionManagementLoading = repoCheckState === "loading" || agentCheckState === "loading";
  const versionManagementError = repoCheckState === "error" && agentCheckState === "error";
  const hasRepoUpdates = updatableRepos.length > 0;
  const hasAgentIssues = agentIssues.length > 0;

  return (
    <>
      {wizardRepo && (
        <UpdateWizard
          repo={wizardRepo}
          onClose={() => setWizardRepo(null)}
          onDone={() => { setWizardRepo(null); loadRepoUpdates(); }}
        />
      )}
      {agentUpdateModal && (
        <AgentUpdateModal
          state={agentUpdateModal}
          onClose={() => setAgentUpdateModal(null)}
          onConfirm={handleAgentUpdate}
        />
      )}
      <div className="flex flex-col gap-6">

        <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: "1fr 1.5fr 1fr" }}>

          {/* Robot Information */}
          <section>
            <Card title="Robot Information" className="h-full">
              <div className="px-5 pb-2">
                <InfoRow label="Hostname" value={robotInfo?.hostname} />
                <InfoRow label="OS" value={robotInfo?.os_info} />
                <InfoRow label="IP Address" value={robotInfo?.ip_address} />
                <InfoStatusRow label="Internet" value={robotInfo?.internet_connected} />
                <InfoRow
                  label="Uptime"
                  value={systemStats ? formatUptime(systemStats.uptime_seconds) : undefined}
                />
              </div>
            </Card>
          </section>

          {/* System Status */}
          <section>
            <Card title="System Status" className="h-full">
              {systemStats == null ? (
                <div className="p-5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Unavailable
                </div>
              ) : (
                <div className="p-6 flex gap-6 justify-around">
                  <CircleGauge fill={systemStats.cpu_percent} label="CPU" />
                  <CircleGauge
                    fill={memPct} label="Memory"
                    sub={`${(systemStats.memory_used_mb / 1024).toFixed(1)} / ${(systemStats.memory_total_mb / 1024).toFixed(1)} GB`}
                  />
                  <CircleGauge
                    fill={diskPct} label="Disk"
                    sub={`${systemStats.disk_used_gb} / ${systemStats.disk_total_gb} GB`}
                  />
                  {systemStats.temperature_celsius != null && (
                    <CircleGauge
                      fill={Math.round(systemStats.temperature_celsius)}
                      label="Temp"
                      display={`${systemStats.temperature_celsius}°C`}
                    />
                  )}
                </div>
              )}
            </Card>
          </section>

        </div>

        {/* ── Bottom row: 2 columns ── */}
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "1.5fr 1fr" }}>

        <section>
          <Card title="Container Management">
            {containers.length === 0 ? (
              <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                No containers found
              </div>
            ) : (
              containers.map((c, i) => {
                const busy = actionLoading?.container === c.name;
                return (
                  <div key={c.id} style={i === 0 ? { borderTop: "none" } : {}}>
                    <ContainerRow
                      container={c}
                      onAction={(action) => handleAction(c.name, action)}
                      onOpenLog={() => openLog(c.name)}
                      onOpenBashrc={() => openBashrc(c.name)}
                      busy={busy}
                      busyAction={busy ? actionLoading!.action : null}
                    />
                  </div>
                );
              })
            )}
          </Card>
        </section>

        {/* Version Management */}
        <section>
          <Card
            title="Version Management"
            action={
              <button
                onClick={loadVersionManagement}
                disabled={versionManagementLoading}
                style={{ ...btnStyle(false, versionManagementLoading), padding: "2px 8px", fontSize: 11 }}
              >
                Refresh
              </button>
            }
          >
            {versionManagementLoading ? (
              <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                Checking for updates…
              </div>
            ) : versionManagementError ? (
              <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                Update status unavailable
              </div>
            ) : (
              <>
                {hasAgentIssues && (
                  <div>
                    <div className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-widest"
                      style={{ color: "var(--vscode-descriptionForeground)" }}>
                      Container Agents
                    </div>
                    {agentIssues.map((agent, i) => (
                      <div key={agent.container} style={i === 0 ? { borderTop: "none" } : {}}>
                        <AgentStatusRow
                          agent={agent}
                          updating={updatingAgent === agent.container}
                          onUpdate={() => openAgentUpdateConfirm(agent.container)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {hasRepoUpdates && (
                  <div>
                    <div className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-widest"
                      style={{ color: "var(--vscode-descriptionForeground)" }}>
                      Repositories
                    </div>
                    {updatableRepos.map((repo, i) => (
                      <div key={repo.name} style={i === 0 ? { borderTop: "none" } : {}}>
                        <UpdatableRepoRow
                          repo={repo}
                          onUpdate={() => setWizardRepo(repo)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {!hasAgentIssues && !hasRepoUpdates && (
                  <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                    {robotInfo?.internet_connected === false || repoCheckState === "error"
                      ? "Repository update status unavailable"
                      : "No updates available"}
                  </div>
                )}

                {agentCheckState === "error" && !hasAgentIssues && (
                  <div className="px-5 pb-4 text-xs" style={{ color: "var(--vscode-errorForeground)" }}>
                    Container agent status unavailable
                  </div>
                )}
              </>
            )}
          </Card>
        </section>

        </div>

      </div>

      {/* ── Settings modal ── */}
      {settingsDocker && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="rounded-lg border shadow-xl w-[42rem] h-[28rem] flex flex-col overflow-hidden"
            style={{ backgroundColor: "var(--vscode-editor-background)", borderColor: "var(--vscode-panel-border)" }}
          >
            {/* header */}
            <div className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "var(--vscode-panel-border)" }}>
              <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
                {settingsDocker.name}
              </h2>
              <button onClick={() => setSettingsContainer(null)}
                className="p-1 rounded hover:opacity-80"
                style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {/* body */}
            <div className="flex-1 overflow-auto p-4">
              {settingsTab === "log" && (
                <div>
                  {loadingLogsFor === settingsDocker.name && (
                    <p style={{ color: "var(--vscode-descriptionForeground)" }}>Loading logs...</p>
                  )}
                  {logErrors[settingsDocker.name] && (
                    <p style={{ color: "var(--vscode-errorForeground)" }}>{logErrors[settingsDocker.name]}</p>
                  )}
                  {logsByContainer[settingsDocker.name] && (
                    <pre
                      className="text-xs p-3 rounded overflow-auto font-mono whitespace-pre-wrap break-words"
                      style={{ backgroundColor: "var(--vscode-textCodeBlock-background)", color: "var(--vscode-foreground)" }}
                      dangerouslySetInnerHTML={{ __html: convert.toHtml(logsByContainer[settingsDocker.name]) }}
                    />
                  )}
                </div>
              )}
              {settingsTab === "bashrc" && (
                <div className="space-y-2">
                  {bashrcError && (
                    <div className="px-2 py-1.5 rounded text-xs"
                      style={{ color: "var(--vscode-errorForeground)", backgroundColor: "rgba(244,135,113,0.1)", border: "1px solid rgba(244,135,113,0.3)" }}>
                      {bashrcError}
                    </div>
                  )}
                  {bashrcLoading ? (
                    <p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading ~/.bashrc...</p>
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
                        style={{ backgroundColor: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" }}
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
      )}
    </>
  );
}
