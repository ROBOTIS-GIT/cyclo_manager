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
import Convert from "ansi-to-html";
import { usePolling } from "@/hooks/usePolling";
import {
  AgentStatusRow,
  AgentUpdateModal,
  type AgentUpdateModalState,
  btnStyle,
  Card,
  CircleGauge,
  ContainerRow,
  formatUptime,
  InfoRow,
  InfoStatusRow,
  pct,
  UpdatableRepoRow,
} from "@/components/dashboard/DashboardComponents";
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
import UpdateWizard from "@/components/UpdateWizard";
import { useTheme } from "@/contexts/ThemeContext";

const POLL_INTERVAL = 5000;

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
