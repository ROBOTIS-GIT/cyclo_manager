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

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import type { FollowerRobotModel, LaunchArgsConfig } from "@/config/launchArgs";
import LaunchArgsSettingPopup from "./LaunchArgsSettingPopup";
import StatusBadge from "./StatusBadge";
import type { ServiceStatusResponse } from "@/types/api";
import {
  computeToolbarHelpPosition,
  LogIcon,
  PlayIcon,
  Select,
  SettingsButton,
  SquareIcon,
} from "@/components/system/ControlToolbarParts";

const GROUP_STYLES: CSSProperties = {
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
  cycloIntelligenceService: {
    status: ServiceStatusResponse | null;
    loading: boolean;
  };
  onCycloIntelligenceBringup: () => void;
  showCycloIntelligenceLogs: boolean;
  onToggleCycloIntelligenceLogs: () => void;
  zenohDaemonService: {
    status: string;
    loading: boolean;
  };
  onZenohDaemonBringup: () => void;
  showZenohDaemonLogs: boolean;
  onToggleZenohDaemonLogs: () => void;
}

const ERROR_STYLES: CSSProperties = {
  color: "var(--vscode-errorForeground)",
  backgroundColor: "rgba(244, 135, 113, 0.1)",
  border: "1px solid rgba(244, 135, 113, 0.3)",
};

const INLINE_HELP_STYLES: CSSProperties = {
  color: "var(--vscode-descriptionForeground)",
  backgroundColor: "var(--vscode-editor-background)",
  borderColor: "var(--vscode-panel-border)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
};

type ToolbarHelpKey = "robot" | "leader" | "intelligence" | "zenoh";

const TOOLBAR_HELP_TEXT: Record<ToolbarHelpKey, string> = {
  robot:
    "Starts and stops the robot bringup service. The dot shows status — green is running, red is stopped. Pick SG2, BG2, SH5, BH5, or Mobile, then use play to start.",
  leader:
    "Starts and stops the leader bringup service. The dot shows status — green is running, red is stopped.",
  intelligence:
    "Starts and stops the Cyclo Intelligence service in its container.",
  zenoh:
    "Starts and stops the Zenoh daemon Docker container. The dot shows container state — green running, red stopped. If you use zenoh as ros middleware, you need to run the zenoh daemon.",
};

const TOOLBAR_HELP_ARIA: Record<ToolbarHelpKey, string> = {
  robot: "Robot help",
  leader: "Leader help",
  intelligence: "Cyclo Intelligence help",
  zenoh: "Zenoh Daemon help",
};

const HELP_BTN_CLASS =
  "inline-flex items-center justify-center shrink-0 rounded-full border leading-none font-semibold cursor-pointer select-none hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]";

const HELP_BTN_STYLE: CSSProperties = {
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
  cycloIntelligenceService,
  onCycloIntelligenceBringup,
  showCycloIntelligenceLogs,
  onToggleCycloIntelligenceLogs,
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
  const intelligenceHelpBtnRef = useRef<HTMLButtonElement>(null);
  const zenohHelpBtnRef = useRef<HTMLButtonElement>(null);

  const helpBtnRefs: Record<ToolbarHelpKey, RefObject<HTMLButtonElement | null>> = {
    robot: robotHelpBtnRef,
    leader: leaderHelpBtnRef,
    intelligence: intelligenceHelpBtnRef,
    zenoh: zenohHelpBtnRef,
  };

  const robotHelpPanelId = useId();
  const leaderHelpPanelId = useId();
  const intelligenceHelpPanelId = useId();
  const zenohHelpPanelId = useId();

  const helpPanelIds: Record<ToolbarHelpKey, string> = {
    robot: robotHelpPanelId,
    leader: leaderHelpPanelId,
    intelligence: intelligenceHelpPanelId,
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
              { value: "Mobile", label: "Mobile" },
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
                window.open(`http://${window.location.hostname}:7080`, "_blank");
              }
            }}
            className="text-sm font-medium uppercase tracking-wider cursor-pointer border-none bg-transparent p-0 text-left"
            style={{ color: "var(--vscode-descriptionForeground)" }}
            title="Open Cyclo Intelligence (port 7080)"
          >
            Cyclo Intelligence
          </button>
          {cycloIntelligenceService.status && (
            <StatusBadge status={cycloIntelligenceService.status.is_up} dotOnly />
          )}
          <button
            ref={intelligenceHelpBtnRef}
            type="button"
            onClick={() => toggleToolbarHelp("intelligence")}
            className={HELP_BTN_CLASS}
            style={HELP_BTN_STYLE}
            aria-expanded={activeToolbarHelp === "intelligence"}
            aria-controls={intelligenceHelpPanelId}
            title="Help"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCycloIntelligenceBringup}
            disabled={cycloIntelligenceService.loading}
            title={cycloIntelligenceService.status?.is_up ? "Stop" : "Bringup"}
            aria-label={cycloIntelligenceService.status?.is_up ? "Stop" : "Bringup"}
            className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            style={{
              backgroundColor: cycloIntelligenceService.status?.is_up
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              color: cycloIntelligenceService.status?.is_up
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
            }}
          >
            {cycloIntelligenceService.status?.is_up ? <SquareIcon /> : <PlayIcon />}
          </button>
          <button
            onClick={onToggleCycloIntelligenceLogs}
            title="Log"
            aria-label="Log"
            className="w-11 h-11 rounded border-none cursor-pointer inline-flex items-center justify-center"
            style={{
              backgroundColor: showCycloIntelligenceLogs
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              color: showCycloIntelligenceLogs
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
