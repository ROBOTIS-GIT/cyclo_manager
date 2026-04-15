"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FollowerRobotModel, LaunchArgsConfig } from "@/config/launchArgs";
import LaunchArgsSettingPopup from "./LaunchArgsSettingPopup";
import StatusBadge from "./StatusBadge";
import type { ServiceStatusResponse } from "@/types/api";

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function SquareIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  );
}

function LogIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  const baseStyle: React.CSSProperties = {
    width: "44px",
    height: "44px",
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    backgroundColor: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    transition: "background-color 0.15s ease",
  };
  return (
    <button
      onClick={onClick}
      style={baseStyle}
      title="Launch arguments"
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--vscode-button-hoverBackground)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--vscode-button-background)";
      }}
    >
      <GearIcon />
    </button>
  );
}

interface SelectProps {
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  options: { value: string; label: string }[];
}

function Select({ value, onChange, disabled, options }: SelectProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="w-full min-w-[96px] pl-4 pr-10 py-3 rounded-md border text-lg appearance-none bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder,#007acc)] focus:ring-offset-1 focus:ring-offset-[var(--vscode-editor-background)] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          borderColor: "var(--vscode-input-border)",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-70"
        style={{ color: "var(--vscode-input-foreground)" }}
        aria-hidden
      >
        <ChevronDownIcon />
      </span>
    </div>
  );
}

const GROUP_STYLES: React.CSSProperties = {
  backgroundColor: "var(--vscode-toolbar-groupBg, rgba(128, 128, 128, 0.08))",
  border: "1px solid var(--vscode-panel-border)",
};

export interface ControlToolbarProps {
  robotType: FollowerRobotModel;
  onRobotTypeChange: (v: string) => void;
  robotService: {
    status: ServiceStatusResponse | null;
    loading: boolean;
    error: string | null;
  };
  leaderService: {
    status: ServiceStatusResponse | null;
    loading: boolean;
    error: string | null;
  };
  onRobotBringup: () => void;
  onLeaderBringup: () => void;
  showLogs: boolean;
  showLeaderLogs: boolean;
  onToggleLogs: () => void;
  onToggleLeaderLogs: () => void;
  robotLaunchConfig: LaunchArgsConfig;
  robotBringupArgs: Record<string, string>;
  onRobotBringupArgsChange: (args: Record<string, string>) => void;
  leaderLaunchConfig: LaunchArgsConfig;
  leaderBringupArgs: Record<string, string>;
  onLeaderBringupArgsChange: (args: Record<string, string>) => void;
  physicalAiServerService: {
    status: ServiceStatusResponse | null;
    loading: boolean;
  };
  onPhysicalAiServerBringup: () => void;
  showPhysicalAiServerLogs: boolean;
  onTogglePhysicalAiServerLogs: () => void;
  zenohDaemonService: {
    status: string;
    loading: boolean;
  };
  onZenohDaemonBringup: () => void;
  showZenohDaemonLogs: boolean;
  onToggleZenohDaemonLogs: () => void;
}

const ERROR_STYLES: React.CSSProperties = {
  color: "var(--vscode-errorForeground)",
  backgroundColor: "rgba(244, 135, 113, 0.1)",
  border: "1px solid rgba(244, 135, 113, 0.3)",
};

const INLINE_HELP_STYLES: React.CSSProperties = {
  color: "var(--vscode-descriptionForeground)",
  backgroundColor: "var(--vscode-editor-background)",
  borderColor: "var(--vscode-panel-border)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
};

function computeToolbarHelpPosition(anchor: DOMRect): { top: number; left: number; width: number } {
  const panelWidth = Math.min(288, window.innerWidth - 24);
  let left = anchor.left;
  if (left + panelWidth > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - 12 - panelWidth);
  }
  return { top: anchor.bottom + 6, left, width: panelWidth };
}

type ToolbarHelpKey = "robot" | "leader" | "physical" | "zenoh";

const TOOLBAR_HELP_TEXT: Record<ToolbarHelpKey, string> = {
  robot:
    "Starts and stops the follower robot bringup service. The dot shows status — green is running, red is stopped. Pick SG2, BG2, SH5, or BH5, then use play to start; you cannot change the model while it is running.",
  leader:
    "Starts and stops the leader (avatar) bringup service. It runs with the LG2 configuration. The dot shows whether the service is up; use the gear to edit launch arguments.",
  physical:
    "Starts and stops the Physical AI Server service in its container. Click the Physical AI Server label to open the Physical AI Tools web UI on this host (port 80) in a new tab.",
  zenoh:
    "Starts and stops the Zenoh daemon Docker container (e.g. for network or middleware bridging). The dot shows container state — green running, red stopped.",
};

const TOOLBAR_HELP_ARIA: Record<ToolbarHelpKey, string> = {
  robot: "Robot help",
  leader: "Leader help",
  physical: "Physical AI Server help",
  zenoh: "Zenoh Daemon help",
};

const HELP_BTN_CLASS =
  "inline-flex items-center justify-center shrink-0 rounded-full border leading-none font-semibold cursor-pointer select-none hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]";

const HELP_BTN_STYLE: React.CSSProperties = {
  width: "15px",
  height: "15px",
  fontSize: "10px",
  lineHeight: 1,
  borderColor: "var(--vscode-panel-border)",
  color: "var(--vscode-descriptionForeground)",
  backgroundColor: "var(--vscode-editor-background)",
};

export default function ControlToolbar({
  robotType,
  onRobotTypeChange,
  robotService,
  leaderService,
  onRobotBringup,
  onLeaderBringup,
  showLogs,
  showLeaderLogs,
  onToggleLogs,
  onToggleLeaderLogs,
  robotLaunchConfig,
  robotBringupArgs,
  onRobotBringupArgsChange,
  leaderLaunchConfig,
  leaderBringupArgs,
  onLeaderBringupArgsChange,
  physicalAiServerService,
  onPhysicalAiServerBringup,
  showPhysicalAiServerLogs,
  onTogglePhysicalAiServerLogs,
  zenohDaemonService,
  onZenohDaemonBringup,
  showZenohDaemonLogs,
  onToggleZenohDaemonLogs,
}: ControlToolbarProps) {
  const [showRobotArgsPopup, setShowRobotArgsPopup] = useState(false);
  const [showLeaderArgsPopup, setShowLeaderArgsPopup] = useState(false);
  const [activeToolbarHelp, setActiveToolbarHelp] = useState<ToolbarHelpKey | null>(null);
  const [toolbarHelpCoords, setToolbarHelpCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const robotHelpBtnRef = useRef<HTMLButtonElement>(null);
  const leaderHelpBtnRef = useRef<HTMLButtonElement>(null);
  const physicalHelpBtnRef = useRef<HTMLButtonElement>(null);
  const zenohHelpBtnRef = useRef<HTMLButtonElement>(null);

  const helpBtnRefs: Record<ToolbarHelpKey, React.RefObject<HTMLButtonElement | null>> = {
    robot: robotHelpBtnRef,
    leader: leaderHelpBtnRef,
    physical: physicalHelpBtnRef,
    zenoh: zenohHelpBtnRef,
  };

  const robotHelpPanelId = useId();
  const leaderHelpPanelId = useId();
  const physicalHelpPanelId = useId();
  const zenohHelpPanelId = useId();

  const helpPanelIds: Record<ToolbarHelpKey, string> = {
    robot: robotHelpPanelId,
    leader: leaderHelpPanelId,
    physical: physicalHelpPanelId,
    zenoh: zenohHelpPanelId,
  };

  const robotSelectDisabled = robotService.loading || robotService.status?.is_up === true;

  const toggleToolbarHelp = useCallback((key: ToolbarHelpKey) => {
    setActiveToolbarHelp((cur) => (cur === key ? null : key));
  }, []);

  useLayoutEffect(() => {
    if (!activeToolbarHelp) {
      setToolbarHelpCoords(null);
      return;
    }
    const el = helpBtnRefs[activeToolbarHelp].current;
    if (el) {
      setToolbarHelpCoords(computeToolbarHelpPosition(el.getBoundingClientRect()));
    }
  }, [activeToolbarHelp]);

  useEffect(() => {
    if (!activeToolbarHelp) return;
    const sync = () => {
      const el = helpBtnRefs[activeToolbarHelp].current;
      if (el) setToolbarHelpCoords(computeToolbarHelpPosition(el.getBoundingClientRect()));
    };
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [activeToolbarHelp]);

  useEffect(() => {
    if (!activeToolbarHelp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveToolbarHelp(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeToolbarHelp]);

  return (
    <>
    <div
      className="flex flex-wrap items-stretch gap-0 border-b py-2"
      style={{
        backgroundColor: "var(--vscode-editor-background)",
        borderColor: "var(--vscode-panel-border)",
        boxShadow: "0 1px 0 0 rgba(0,0,0,0.15)",
      }}
    >
      <div
        className="flex flex-col gap-2.5 rounded-none px-5 py-4 min-h-[108px] justify-center"
        style={GROUP_STYLES}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            Robot
          </span>
          {robotService.status && <StatusBadge status={robotService.status.is_up} dotOnly />}
          <button
            ref={robotHelpBtnRef}
            type="button"
            onClick={() => toggleToolbarHelp("robot")}
            className={HELP_BTN_CLASS}
            style={HELP_BTN_STYLE}
            aria-expanded={activeToolbarHelp === "robot"}
            aria-controls={robotHelpPanelId}
            title="Help"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={robotType}
            onChange={(v) => onRobotTypeChange(v)}
            disabled={robotSelectDisabled}
            options={[
              { value: "SG2", label: "SG2" },
              { value: "BG2", label: "BG2" },
              { value: "SH5", label: "SH5" },
              { value: "BH5", label: "BH5" },
            ]}
          />
          <button
            onClick={onRobotBringup}
            disabled={robotService.loading}
            title={robotService.status?.is_up ? "Stop" : "Bringup"}
            aria-label={robotService.status?.is_up ? "Stop" : "Bringup"}
            className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            style={{
              backgroundColor: robotService.status?.is_up ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)",
              color: robotService.status?.is_up ? "var(--vscode-button-secondaryForeground)" : "var(--vscode-button-foreground)",
            }}
          >
            {robotService.status?.is_up ? <SquareIcon /> : <PlayIcon />}
          </button>
          <SettingsButton onClick={() => setShowRobotArgsPopup(true)} />
          <button
            onClick={onToggleLogs}
            title="Log"
            aria-label="Log"
            className="w-11 h-11 rounded border-none cursor-pointer inline-flex items-center justify-center"
            style={{
              backgroundColor: showLogs ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)",
              color: showLogs ? "var(--vscode-button-secondaryForeground)" : "var(--vscode-button-foreground)",
            }}
          >
            <LogIcon />
          </button>
        </div>
      </div>

      <div
        className="flex flex-col gap-2.5 rounded-none px-5 py-4 min-h-[108px] justify-center"
        style={GROUP_STYLES}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            Leader
          </span>
          {leaderService.status && <StatusBadge status={leaderService.status.is_up} dotOnly />}
          <button
            ref={leaderHelpBtnRef}
            type="button"
            onClick={() => toggleToolbarHelp("leader")}
            className={HELP_BTN_CLASS}
            style={HELP_BTN_STYLE}
            aria-expanded={activeToolbarHelp === "leader"}
            aria-controls={leaderHelpPanelId}
            title="Help"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value="LG2"
            options={[{ value: "LG2", label: "LG2" }]}
            disabled={true}
          />
          <button
            onClick={onLeaderBringup}
            disabled={leaderService.loading}
            title={leaderService.status?.is_up ? "Stop" : "Bringup"}
            aria-label={leaderService.status?.is_up ? "Stop" : "Bringup"}
            className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            style={{
              backgroundColor: leaderService.status?.is_up ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)",
              color: leaderService.status?.is_up ? "var(--vscode-button-secondaryForeground)" : "var(--vscode-button-foreground)",
            }}
          >
            {leaderService.status?.is_up ? <SquareIcon /> : <PlayIcon />}
          </button>
          <SettingsButton onClick={() => setShowLeaderArgsPopup(true)} />
          <button
            onClick={onToggleLeaderLogs}
            title="Log"
            aria-label="Log"
            className="w-11 h-11 rounded border-none cursor-pointer inline-flex items-center justify-center"
            style={{
              backgroundColor: showLeaderLogs ? "var(--vscode-button-secondaryBackground)" : "var(--vscode-button-background)",
              color: showLeaderLogs ? "var(--vscode-button-secondaryForeground)" : "var(--vscode-button-foreground)",
            }}
          >
            <LogIcon />
          </button>
        </div>
      </div>

      <div
        className="flex flex-col gap-2.5 rounded-none px-5 py-4 min-h-[108px] justify-center"
        style={GROUP_STYLES}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.open(`http://${window.location.hostname}:80`, "_blank");
              }
            }}
            className="text-sm font-medium uppercase tracking-wider cursor-pointer border-none bg-transparent p-0 text-left"
            style={{ color: "var(--vscode-descriptionForeground)" }}
            title="Open Physical AI Tools (port 80)"
          >
            Physical AI Server
          </button>
          {physicalAiServerService.status && (
            <StatusBadge status={physicalAiServerService.status.is_up} dotOnly />
          )}
          <button
            ref={physicalHelpBtnRef}
            type="button"
            onClick={() => toggleToolbarHelp("physical")}
            className={HELP_BTN_CLASS}
            style={HELP_BTN_STYLE}
            aria-expanded={activeToolbarHelp === "physical"}
            aria-controls={physicalHelpPanelId}
            title="Help"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onPhysicalAiServerBringup}
            disabled={physicalAiServerService.loading}
            title={physicalAiServerService.status?.is_up ? "Stop" : "Bringup"}
            aria-label={physicalAiServerService.status?.is_up ? "Stop" : "Bringup"}
            className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            style={{
              backgroundColor: physicalAiServerService.status?.is_up
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              color: physicalAiServerService.status?.is_up
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
            }}
          >
            {physicalAiServerService.status?.is_up ? <SquareIcon /> : <PlayIcon />}
          </button>
          <button
            onClick={onTogglePhysicalAiServerLogs}
            title="Log"
            aria-label="Log"
            className="w-11 h-11 rounded border-none cursor-pointer inline-flex items-center justify-center"
            style={{
              backgroundColor: showPhysicalAiServerLogs
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              color: showPhysicalAiServerLogs
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
            }}
          >
            <LogIcon />
          </button>
        </div>
      </div>

      <div
        className="flex flex-col gap-2.5 rounded-none px-5 py-4 min-h-[108px] justify-center"
        style={GROUP_STYLES}
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            Zenoh Daemon
          </span>
          {zenohDaemonService.status && (
            <StatusBadge status={zenohDaemonService.status} dotOnly />
          )}
          <button
            ref={zenohHelpBtnRef}
            type="button"
            onClick={() => toggleToolbarHelp("zenoh")}
            className={HELP_BTN_CLASS}
            style={HELP_BTN_STYLE}
            aria-expanded={activeToolbarHelp === "zenoh"}
            aria-controls={zenohHelpPanelId}
            title="Help"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onZenohDaemonBringup}
            disabled={zenohDaemonService.loading}
            title={zenohDaemonService.status?.toLowerCase() === "running" ? "Stop" : "Start"}
            aria-label={zenohDaemonService.status?.toLowerCase() === "running" ? "Stop" : "Start"}
            className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            style={{
              backgroundColor: zenohDaemonService.status?.toLowerCase() === "running"
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              color: zenohDaemonService.status?.toLowerCase() === "running"
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
            }}
          >
            {zenohDaemonService.status?.toLowerCase() === "running" ? <SquareIcon /> : <PlayIcon />}
          </button>
          <button
            onClick={onToggleZenohDaemonLogs}
            title="Log"
            aria-label="Log"
            className="w-11 h-11 rounded border-none cursor-pointer inline-flex items-center justify-center"
            style={{
              backgroundColor: showZenohDaemonLogs
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              color: showZenohDaemonLogs
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
            }}
          >
            <LogIcon />
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-[8px]" style={{ flexBasis: 0 }} aria-hidden />

      {(robotService.error || leaderService.error) && (
        <div className="flex gap-3 w-full mt-2">
          {robotService.error && (
            <div className="text-sm px-3 py-2 rounded-md flex-1" style={ERROR_STYLES}>
              Robot: {robotService.error}
            </div>
          )}
          {leaderService.error && (
            <div className="text-sm px-3 py-2 rounded-md flex-1" style={ERROR_STYLES}>
              Leader: {leaderService.error}
            </div>
          )}
        </div>
      )}

      <LaunchArgsSettingPopup
        open={showRobotArgsPopup}
        onClose={() => setShowRobotArgsPopup(false)}
        config={robotLaunchConfig}
        args={robotBringupArgs}
        onChange={onRobotBringupArgsChange}
      />
      <LaunchArgsSettingPopup
        open={showLeaderArgsPopup}
        onClose={() => setShowLeaderArgsPopup(false)}
        config={leaderLaunchConfig}
        args={leaderBringupArgs}
        onChange={onLeaderBringupArgsChange}
      />
    </div>
    {typeof document !== "undefined" &&
      activeToolbarHelp &&
      toolbarHelpCoords &&
      createPortal(
        <div
          id={helpPanelIds[activeToolbarHelp]}
          role="region"
          aria-label={TOOLBAR_HELP_ARIA[activeToolbarHelp]}
          className="fixed z-[9999] text-xs leading-snug rounded border px-2.5 py-2"
          style={{
            ...INLINE_HELP_STYLES,
            top: toolbarHelpCoords.top,
            left: toolbarHelpCoords.left,
            width: toolbarHelpCoords.width,
          }}
        >
          {TOOLBAR_HELP_TEXT[activeToolbarHelp]}
        </div>,
        document.body
      )}
    </>
  );
}
