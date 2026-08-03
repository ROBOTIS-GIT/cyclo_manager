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

import { useCallback, useEffect, useState, type ReactNode } from "react";
import HelpPopover from "@/components/HelpPopover";
import UpdateWizard from "@/components/UpdateWizard";
import {
  AgentUpdateModal,
  type AgentUpdateModalState,
  btnStyle,
  Card,
} from "@/components/dashboard/DashboardComponents";
import CycloManagerUpdateModal from "@/components/dashboard/CycloManagerUpdateModal";
import {
  getCycloManagerVersion,
  getRepoUpdates,
  getS6AgentStatuses,
  updateS6Agent,
} from "@/lib/api";
import type {
  CycloManagerVersionResponse,
  RepoUpdateStatus,
  S6AgentStatusResponse,
} from "@/types/api";

type CheckState = "loading" | "error" | "done";
export type InternetStatus = "loading" | "online" | "offline" | "unknown";

type RowStatus = {
  label: string;
  color: string;
  canUpdate: boolean;
};

const STATUS_OK = "#3fb950";
const STATUS_ERROR = "var(--vscode-errorForeground)";
const STATUS_MUTED = "var(--vscode-descriptionForeground)";
const OFFLINE_MESSAGE = "Internet connection required";

const VERSION_HELP_TEXT = {
  repositories: "Shows whether repositories can be updated from their configured remotes.",
  agents: "Shows the s6 agent version running inside each container. s6 agents is responsible for managing something like a service or a process inside a container.",
  manager: "Shows the installed Cyclo Manager version and whether a manager update is available.",
} as const;

function versionValue(value: string | null | undefined): string {
  return value?.trim() || "unknown";
}

function offlineStatus(): RowStatus {
  return { label: OFFLINE_MESSAGE, color: STATUS_MUTED, canUpdate: false };
}

function repoStatus(repo: RepoUpdateStatus, offline: boolean): RowStatus {
  if (offline) return offlineStatus();
  return repo.has_update
    ? { label: "Update available", color: STATUS_ERROR, canUpdate: true }
    : { label: "Up to date", color: STATUS_OK, canUpdate: false };
}

function managerStatus(version: CycloManagerVersionResponse, offline: boolean): RowStatus {
  if (offline) return offlineStatus();
  if (!version.pypi_available) {
    return { label: "Check unavailable", color: STATUS_MUTED, canUpdate: false };
  }
  return version.update_available
    ? { label: "Update available", color: STATUS_ERROR, canUpdate: true }
    : { label: "Up to date", color: STATUS_OK, canUpdate: false };
}

function agentStatus(agent: S6AgentStatusResponse, offline: boolean): RowStatus {
  if (offline) return offlineStatus();
  if (agent.status === "up_to_date") {
    return { label: "Up to date", color: STATUS_OK, canUpdate: false };
  }
  if (agent.status === "compatible") {
    return { label: "Compatible", color: STATUS_OK, canUpdate: false };
  }
  if (agent.status === "outdated") {
    return { label: "Update available", color: STATUS_ERROR, canUpdate: true };
  }
  if (agent.status === "unreachable") {
    return { label: "Not responding", color: STATUS_ERROR, canUpdate: false };
  }
  if (agent.status === "unknown_version") {
    return { label: "Unknown version", color: STATUS_ERROR, canUpdate: false };
  }
  return { label: "Unknown", color: STATUS_OK, canUpdate: false };
}

function emptyMessage(
  checkState: CheckState,
  errorMessage: string,
  emptyMessageText: string,
  loadingMessage: string,
): string {
  if (checkState === "loading") return loadingMessage;
  if (checkState === "error") return errorMessage;
  return emptyMessageText;
}

function VersionLine({
  current,
  targetLabel,
  target,
}: {
  current: string | null | undefined;
  targetLabel: "Latest" | "Required";
  target: string | null | undefined;
}) {
  return (
    <div className="text-xs truncate" style={{ color: "var(--vscode-descriptionForeground)" }}>
      Current {versionValue(current)} / {targetLabel} {versionValue(target)}
    </div>
  );
}

function VersionStatusRow({
  title,
  current,
  targetLabel,
  target,
  status,
  actionLabel = "Update",
  actionBusyLabel,
  busy = false,
  onUpdate,
}: {
  title: string;
  current: string | null | undefined;
  targetLabel: "Latest" | "Required";
  target: string | null | undefined;
  status: RowStatus;
  actionLabel?: string;
  actionBusyLabel?: string;
  busy?: boolean;
  onUpdate: () => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
            {title}
          </div>
          <VersionLine current={current} targetLabel={targetLabel} target={target} />
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span className="text-xs font-semibold" style={{ color: status.color }}>
            {status.label}
          </span>
          {status.canUpdate && (
            <button onClick={onUpdate} disabled={busy} style={btnStyle(true, busy)}>
              {busy && actionBusyLabel ? actionBusyLabel : actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionGroup({
  title,
  help,
  children,
}: {
  title: string;
  help: {
    text: ReactNode;
    ariaLabel: string;
  };
  children: ReactNode;
}) {
  return (
    <div
      className="mx-4 my-3 rounded-md border overflow-hidden"
      style={{
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "transparent",
      }}
    >
      <div
        className="px-3 pt-2 pb-1 flex items-center gap-2"
        style={{ color: "var(--vscode-descriptionForeground)" }}
      >
        <span className="text-[11px] font-bold uppercase tracking-widest">
          {title}
        </span>
        <HelpPopover ariaLabel={help.ariaLabel}>
          {help.text}
        </HelpPopover>
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyVersionGroupRow({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
      {message}
    </div>
  );
}

export default function VersionManagementPanel({
  internetStatus,
}: {
  internetStatus: InternetStatus;
}) {
  const offline = internetStatus === "offline";
  const [managerVersion, setManagerVersion] = useState<CycloManagerVersionResponse | null>(null);
  const [managerCheckState, setManagerCheckState] = useState<CheckState>("loading");
  const [updatableRepos, setUpdatableRepos] = useState<RepoUpdateStatus[]>([]);
  const [repoCheckState, setRepoCheckState] = useState<CheckState>("loading");
  const [agentStatuses, setAgentStatuses] = useState<S6AgentStatusResponse[]>([]);
  const [agentCheckState, setAgentCheckState] = useState<CheckState>("loading");
  const [updatingAgent, setUpdatingAgent] = useState<string | null>(null);
  const [agentUpdateModal, setAgentUpdateModal] = useState<AgentUpdateModalState | null>(null);
  const [wizardRepo, setWizardRepo] = useState<RepoUpdateStatus | null>(null);
  const [managerUpdateVersion, setManagerUpdateVersion] =
    useState<CycloManagerVersionResponse | null>(null);

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

  const loadManagerVersion = useCallback(async () => {
    setManagerCheckState("loading");
    try {
      const version = await getCycloManagerVersion(!offline);
      setManagerVersion(version);
      setManagerCheckState("done");
    } catch {
      setManagerVersion(null);
      setManagerCheckState("error");
    }
  }, [offline]);

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
    loadManagerVersion();
    loadRepoUpdates();
    loadAgentStatuses();
  }, [loadAgentStatuses, loadManagerVersion, loadRepoUpdates]);

  useEffect(() => {
    if (internetStatus === "loading") return;
    loadVersionManagement();
  }, [internetStatus, loadVersionManagement]);

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
            status: updatedAgent.status === "outdated" ? "error" : "done",
            message: updatedAgent.status === "outdated"
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

  const hasRepos = updatableRepos.length > 0;
  const hasAgents = agentStatuses.length > 0;
  const versionManagementChecking =
    managerCheckState === "loading" ||
    repoCheckState === "loading" ||
    agentCheckState === "loading";
  const versionManagementLoading =
    versionManagementChecking &&
    !managerVersion &&
    !hasRepos &&
    !hasAgents;
  const versionManagementError =
    managerCheckState === "error" &&
    repoCheckState === "error" &&
    agentCheckState === "error";

  return (
    <section>
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
      {managerUpdateVersion && (
        <CycloManagerUpdateModal
          version={managerUpdateVersion}
          onClose={() => setManagerUpdateVersion(null)}
        />
      )}
      <Card
        title="Version Management"
        action={
          <button
            onClick={loadVersionManagement}
            disabled={versionManagementChecking || internetStatus === "loading"}
            style={{
              ...btnStyle(false, versionManagementChecking || internetStatus === "loading"),
              padding: "2px 8px",
              fontSize: 11,
            }}
          >
            Refresh
          </button>
        }
      >
        {versionManagementLoading ? (
          <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Checking for updates...
          </div>
        ) : versionManagementError ? (
          <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Update status unavailable
          </div>
        ) : (
          <>
            <VersionGroup
              title="Repositories"
              help={{
                text: VERSION_HELP_TEXT.repositories,
                ariaLabel: "Repositories version management help",
              }}
            >
              {hasRepos ? (
                updatableRepos.map((repo) => (
                  <VersionStatusRow
                    key={repo.name}
                    title={repo.name}
                    current={repo.current_version}
                    targetLabel="Latest"
                    target={repo.latest_version}
                    status={repoStatus(repo, offline)}
                    onUpdate={() => setWizardRepo(repo)}
                  />
                ))
              ) : (
                <EmptyVersionGroupRow
                  message={emptyMessage(
                    repoCheckState,
                    "Repository update status unavailable",
                    "No repositories found",
                    "Checking repositories...",
                  )}
                />
              )}
            </VersionGroup>

            <VersionGroup
              title="Container Agents"
              help={{
                text: VERSION_HELP_TEXT.agents,
                ariaLabel: "Container agents version management help",
              }}
            >
              {hasAgents ? (
                agentStatuses.map((agent) => (
                  <VersionStatusRow
                    key={agent.container}
                    title={`${agent.container} s6 agent`}
                    current={agent.version}
                    targetLabel="Required"
                    target={agent.minimum_required_version}
                    status={agentStatus(agent, offline)}
                    busy={updatingAgent === agent.container}
                    actionBusyLabel="Updating..."
                    onUpdate={() => openAgentUpdateConfirm(agent.container)}
                  />
                ))
              ) : (
                <EmptyVersionGroupRow
                  message={emptyMessage(
                    agentCheckState,
                    "Container agent status unavailable",
                    "No container agents found",
                    "Checking container agents...",
                  )}
                />
              )}
            </VersionGroup>

            <VersionGroup
              title="Cyclo Manager"
              help={{
                text: VERSION_HELP_TEXT.manager,
                ariaLabel: "Cyclo Manager version management help",
              }}
            >
              {managerVersion ? (
                <VersionStatusRow
                  title="Cyclo Manager"
                  current={managerVersion.current}
                  targetLabel="Latest"
                  target={managerVersion.latest}
                  status={managerStatus(managerVersion, offline)}
                  onUpdate={() => setManagerUpdateVersion(managerVersion)}
                />
              ) : (
                <EmptyVersionGroupRow
                  message={emptyMessage(
                    managerCheckState,
                    "Cyclo Manager version unavailable",
                    "Cyclo Manager version unavailable",
                    "Checking Cyclo Manager...",
                  )}
                />
              )}
            </VersionGroup>
          </>
        )}
      </Card>
    </section>
  );
}
