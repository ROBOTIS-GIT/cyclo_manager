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

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import StatusBadge from "@/components/StatusBadge";
import type {
  CycloManagerVersionResponse,
  DockerContainerInfo,
  RepoUpdateStatus,
  S6AgentStatusResponse,
} from "@/types/api";

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function gaugeColor(percent: number): string {
  if (percent >= 90) return "#f44336";
  if (percent >= 75) return "#ff9800";
  return "var(--vscode-button-background, #0078d4)";
}

export function btnStyle(primary: boolean, disabled = false): CSSProperties {
  return {
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
  };
}

export function Card({
  children,
  title,
  action,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  action?: ReactNode;
  className?: string;
}) {
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
          <span
            className="text-sm font-bold uppercase tracking-widest"
            style={{ color: "var(--vscode-foreground)" }}
          >
            {title}
          </span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function CircleGauge({
  fill,
  label,
  display,
  sub,
  size = 110,
}: {
  fill: number;
  label: string;
  display?: string;
  sub?: string;
  size?: number;
}) {
  const stroke = Math.max(6, Math.round(size * 0.073));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(fill, 100) / 100) * circumference;
  const color = gaugeColor(fill);
  const cx = size / 2;
  const cy = size / 2;
  const labelFontSize = Math.max(10, Math.round(size * 0.109));
  const valueFontSize = Math.max(13, Math.round(size * 0.136));
  const labelOffset = Math.round(size * 0.09);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--vscode-input-background, rgba(128,128,128,0.2))"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text
          x={cx}
          y={cy - labelOffset}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={labelFontSize}
          fontWeight="500"
          fill="var(--vscode-descriptionForeground)"
        >
          {label}
        </text>
        <text
          x={cx}
          y={cy + labelOffset}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={valueFontSize}
          fontWeight="700"
          fill={color}
        >
          {display ?? `${fill}%`}
        </text>
      </svg>
      {sub && (
        <div
          className="text-center"
          style={{
            color: "var(--vscode-descriptionForeground)",
            fontSize: size < 110 ? 12 : 14,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function UpdatableRepoRow({
  repo,
  onUpdate,
  bordered = true,
}: {
  repo: RepoUpdateStatus;
  onUpdate: () => void;
  bordered?: boolean;
}) {
  return (
    <div
      className="px-4 py-3"
      style={bordered ? { borderTop: "1px solid var(--vscode-panel-border)" } : undefined}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
            {repo.name}
          </div>
          {repo.current_version && (
            <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {repo.has_update && repo.latest_version
                ? `${repo.current_version} -> ${repo.latest_version}`
                : repo.current_version}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span
            className="text-xs font-semibold"
            style={{ color: repo.has_update ? "var(--vscode-errorForeground)" : "#3fb950" }}
          >
            {repo.has_update ? "Update available" : "Up to date"}
          </span>
          {repo.has_update && (
            <button onClick={onUpdate} style={btnStyle(true)}>
              Update
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CycloManagerStatusRow({
  version,
  onUpdate,
  bordered = true,
}: {
  version: CycloManagerVersionResponse;
  onUpdate: () => void;
  bordered?: boolean;
}) {
  const statusLabel = !version.pypi_available
    ? "Check unavailable"
    : version.update_available
      ? "Update available"
      : "Up to date";
  const statusColor = !version.pypi_available
    ? "var(--vscode-descriptionForeground)"
    : version.update_available
      ? "var(--vscode-errorForeground)"
      : "#3fb950";

  return (
    <div
      className="px-4 py-3"
      style={bordered ? { borderTop: "1px solid var(--vscode-panel-border)" } : undefined}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
            Cyclo Manager
          </div>
          <div className="text-xs truncate" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Current {version.current} / Latest {version.latest}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span className="text-xs font-semibold" style={{ color: statusColor }}>
            {statusLabel}
          </span>
          {version.update_available && (
            <button onClick={onUpdate} style={btnStyle(true)}>
              Update
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function VersionGroup({
  title,
  children,
}: {
  title: string;
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
        className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-widest"
        style={{ color: "var(--vscode-descriptionForeground)" }}
      >
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function AgentStatusRow({
  agent,
  updating,
  onUpdate,
  bordered = true,
}: {
  agent: S6AgentStatusResponse;
  updating: boolean;
  onUpdate: () => void;
  bordered?: boolean;
}) {
  const statusLabel =
    agent.status === "up_to_date" ? "Up to date" :
      agent.status === "compatible" ? "Compatible" :
        agent.status === "outdated" ? "Update available" :
          agent.status === "unreachable" ? "Not responding" :
        agent.status === "unknown_version" ? "Unknown version" :
          "Unknown";
  const showUpdateButton = agent.status === "outdated";
  const statusColor =
    showUpdateButton || agent.status === "unreachable" || agent.status === "unknown_version"
      ? "var(--vscode-errorForeground)"
      : "#3fb950";

  return (
    <div
      className="px-4 py-3"
      style={bordered ? { borderTop: "1px solid var(--vscode-panel-border)" } : undefined}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
            {agent.container} s6 agent
          </div>
          <div className="text-xs truncate" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Installed {agent.version ?? "unknown"} / Required {agent.minimum_required_version}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span
            className="text-xs font-semibold"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </span>
          {showUpdateButton && (
            <button onClick={onUpdate} disabled={updating} style={btnStyle(true, updating)}>
              {updating ? "Updating..." : "Update"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type AgentUpdateModalState = {
  container: string;
  status: "confirm" | "running" | "waiting" | "done" | "error";
  message: string;
  output: string;
};

export function AgentUpdateModal({
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
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
              x
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
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--vscode-panel-border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
          }}
        >
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

export function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="shrink-0 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
        {label}
      </span>
      <span
        className="text-right font-bold break-all text-sm"
        style={{ color: value ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)" }}
      >
        {value ?? "-"}
      </span>
    </div>
  );
}

export function InfoStatusRow({ label, value }: { label: string; value: boolean | null | undefined }) {
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

const iconBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  padding: 0,
  border: "none",
  borderRadius: "50%",
  cursor: "pointer",
  backgroundColor: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
};

const iconBtnDisabled: CSSProperties = { ...iconBtn, opacity: 0.4, cursor: "not-allowed" };

function IconButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={disabled ? iconBtnDisabled : iconBtn}>
      {children}
    </button>
  );
}

export function ContainerRow({
  container,
  onAction,
  onOpenLog,
  onOpenBashrc,
  busy,
  busyAction,
  bordered = true,
}: {
  container: DockerContainerInfo;
  onAction: (action: "start" | "stop" | "restart") => void;
  onOpenLog: () => void;
  onOpenBashrc: () => void;
  busy: boolean;
  busyAction: string | null;
  bordered?: boolean;
}) {
  const running = container.status.toLowerCase() === "running";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={bordered ? { borderTop: "1px solid var(--vscode-panel-border)" } : undefined}
    >
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
        <div className="flex items-center gap-1.5" style={{ width: 100 }}>
          {running ? (
            <>
              <IconButton onClick={() => onAction("stop")} disabled={busy} title={busyAction === "stop" ? "Stopping..." : "Stop"}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="1" y="1" width="10" height="10" rx="1" />
                </svg>
              </IconButton>
              <IconButton onClick={() => onAction("restart")} disabled={busy} title={busyAction === "restart" ? "Restarting..." : "Restart"}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </IconButton>
            </>
          ) : (
            <>
              <IconButton onClick={() => onAction("start")} disabled={busy} title={busyAction === "start" ? "Starting..." : "Start"}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <polygon points="2,1 11,6 2,11" />
                </svg>
              </IconButton>
              <span style={{ width: 30 }} />
            </>
          )}
          <IconButton onClick={onOpenLog} title="Log">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="15" y2="18" />
            </svg>
          </IconButton>
        </div>

        <div className="mx-1.5 h-4 w-px" style={{ backgroundColor: "var(--vscode-panel-border)" }} />

        <Link
          href={running ? `/terminal?container=${encodeURIComponent(container.name)}` : "#"}
          style={btnStyle(false, !running)}
          className="no-underline text-xs"
          onClick={!running ? (e) => e.preventDefault() : undefined}
        >
          Terminal
        </Link>
        <button onClick={onOpenBashrc} disabled={!running} style={btnStyle(false, !running)}>
          bashrc
        </button>
      </div>
    </div>
  );
}
