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
import { useParams } from "next/navigation";
import Link from "next/link";
import Convert from "ansi-to-html";
import { controlService, getServiceStatus, getDockerContainers, controlDockerContainer, getDockerContainerLogs, ros2Subscribe, ros2Unsubscribe } from "@/lib/api";
import { useROS2TopicWebSocket } from "@/lib/websocket";
import type { ServiceStatusResponse } from "@/types/api";
import {
  LG2_LEADER_AI_CONFIG,
  followerModelToApi,
  getDefaultArgs,
  getFollowerLaunchConfig,
  getStoredFollowerRobotModel,
  isFollowerRobotModel,
  mergeWithDefaults,
  type FollowerRobotModel,
  type LaunchArgsConfig,
} from "@/config/launchArgs";
import ControlToolbar from "@/components/ControlToolbar";
import FixedLogPanel from "@/components/FixedLogPanel";
import Robot3DViewer from "@/components/Robot3DViewer";
import { useTheme } from "@/contexts/ThemeContext";

const LEADER_SERVICE_NAME = "avatar_bringup";
const STATUS_POLL_INTERVAL = 2000;
const ERROR_DISPLAY_DURATION = 5000;
const STATUS_RELOAD_DELAY = 1000;

const CONTROL_TOPICS = [
  { topic: "/joint_states", msgType: "sensor_msgs/msg/JointState" },
  { topic: "/robot_description", msgType: "std_msgs/msg/String" },
  { topic: "/ai_worker/battery/left/state", msgType: "sensor_msgs/msg/BatteryState" },
  { topic: "/ai_worker/battery/right/state", msgType: "sensor_msgs/msg/BatteryState" },
] as const;

function parseBatteryPercentage(topicData: unknown): number | null {
  if (!topicData || typeof topicData !== "object") return null;
  const d = topicData as Record<string, unknown>;
  const payload = (d.data ?? d) as Record<string, unknown>;
  const pct = payload.percentage;
  if (typeof pct !== "number") return null;
  return Math.round(pct * 100);
}

const PANEL_STYLES = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

function getBringupArgsStorageKey(config: LaunchArgsConfig, container: string): string {
  const key = config.storageKey ?? config.serviceId;
  return `bringup_args_${key}_${container}`;
}

function getStoredBringupArgs(config: LaunchArgsConfig, container: string): Record<string, string> {
  if (typeof window === "undefined" || !container) return getDefaultArgs(config);
  try {
    const stored = localStorage.getItem(getBringupArgsStorageKey(config, container));
    if (!stored) return getDefaultArgs(config);
    const parsed = JSON.parse(stored) as Record<string, string>;
    return mergeWithDefaults(config, parsed);
  } catch {
    return getDefaultArgs(config);
  }
}

const FOLLOWER_SERVICE_NAME = "ai_worker_bringup";
const CYCLO_INTELLIGENCE_CONTAINER = "cyclo_intelligence";
const CYCLO_INTELLIGENCE_SERVICE = "cyclo_intelligence";
const ZENOH_DAEMON_CONTAINER_NAME = "zenoh_daemon";

function useServiceStatus(
  container: string | undefined,
  serviceName: string | (() => string)
) {
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!container) return;
    try {
      const name = typeof serviceName === "function" ? serviceName() : serviceName;
      const serviceStatus = await getServiceStatus(container, name);
      setStatus((prev) =>
        prev?.is_up === serviceStatus.is_up && prev?.pid === serviceStatus.pid
          ? prev
          : serviceStatus
      );
    } catch {
      setStatus((prev) => (prev === null ? prev : null));
    }
  }, [container, serviceName]);

  const handleControl = useCallback(
    async (
      action: "up" | "down" | "restart",
      launchArgs?: Record<string, string>,
      robotType?: "sg2" | "bg2" | "sh5" | "bh5"
    ) => {
      if (!container) return;
      setLoading(true);
      setError(null);
      try {
        const name = typeof serviceName === "function" ? serviceName() : serviceName;
        const argsToSend = (action === "up" || action === "restart") ? launchArgs : undefined;
        await controlService(container, name, action, argsToSend, robotType);
        setTimeout(loadStatus, STATUS_RELOAD_DELAY);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to control service");
        setTimeout(() => setError(null), ERROR_DISPLAY_DURATION);
      } finally {
        setLoading(false);
      }
    },
    [container, serviceName, loadStatus]
  );

  return { status, loading, error, loadStatus, handleControl };
}

export default function SystemPage() {
  const params = useParams();
  const container = (params.container as string) ?? "";
  const { theme } = useTheme();

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

  const [robotType, setRobotType] = useState<FollowerRobotModel>(() => getStoredFollowerRobotModel(container));
  const [showLogs, setShowLogs] = useState(false);
  const [showLeaderLogs, setShowLeaderLogs] = useState(false);
  const [showCycloIntelligenceLogs, setShowCycloIntelligenceLogs] = useState(false);
  const [showZenohDaemonLogs, setShowZenohDaemonLogs] = useState(false);

  const [zenohDaemonContainer, setZenohDaemonContainer] = useState<{ name: string; status: string } | null>(null);
  const [zenohDaemonActionLoading, setZenohDaemonActionLoading] = useState<"start" | "stop" | null>(null);
  const [zenohDaemonLogContent, setZenohDaemonLogContent] = useState("");
  const [zenohDaemonLogLoading, setZenohDaemonLogLoading] = useState(false);
  const robotConfig = getFollowerLaunchConfig(robotType);
  const [robotBringupArgs, setRobotBringupArgs] = useState<Record<string, string>>(
    () => getStoredBringupArgs(robotConfig, container)
  );
  const [leaderBringupArgs, setLeaderBringupArgs] = useState<Record<string, string>>(
    () => getStoredBringupArgs(LG2_LEADER_AI_CONFIG, container)
  );

  const robotService = useServiceStatus(container, FOLLOWER_SERVICE_NAME);
  const leaderService = useServiceStatus(container, LEADER_SERVICE_NAME);
  const cycloIntelligenceService = useServiceStatus(CYCLO_INTELLIGENCE_CONTAINER, CYCLO_INTELLIGENCE_SERVICE);

  const { topicData: batteryLeftData } = useROS2TopicWebSocket("/ai_worker/battery/left/state");
  const { topicData: batteryRightData } = useROS2TopicWebSocket("/ai_worker/battery/right/state");
  const batteryLeft = parseBatteryPercentage(batteryLeftData);
  const batteryRight = parseBatteryPercentage(batteryRightData);

  useEffect(() => {
    cycloIntelligenceService.loadStatus();
  }, [CYCLO_INTELLIGENCE_CONTAINER, cycloIntelligenceService.loadStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      cycloIntelligenceService.loadStatus();
    }, STATUS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [cycloIntelligenceService.loadStatus]);

  const loadZenohDaemon = useCallback(async () => {
    try {
      const res = await getDockerContainers(true);
      const c = res.containers.find((d) => d.name === ZENOH_DAEMON_CONTAINER_NAME);
      setZenohDaemonContainer(c ? { name: c.name, status: c.status } : null);
    } catch {
      setZenohDaemonContainer(null);
    }
  }, []);

  useEffect(() => {
    loadZenohDaemon();
  }, [loadZenohDaemon]);

  useEffect(() => {
    const interval = setInterval(loadZenohDaemon, STATUS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadZenohDaemon]);

  useEffect(() => {
    if (!container) return;
    for (const { topic, msgType } of CONTROL_TOPICS) {
      ros2Subscribe(topic, msgType).catch(() => {});
    }
    return () => {
      for (const { topic } of CONTROL_TOPICS) {
        ros2Unsubscribe(topic).catch(() => {});
      }
    };
  }, [container]);

  const handleZenohDaemonBringup = useCallback(async () => {
    const isRunning = zenohDaemonContainer?.status?.toLowerCase() === "running";
    const action = isRunning ? "stop" : "start";
    setZenohDaemonActionLoading(action);
    try {
      await controlDockerContainer(ZENOH_DAEMON_CONTAINER_NAME, action);
      await loadZenohDaemon();
    } finally {
      setZenohDaemonActionLoading(null);
    }
  }, [zenohDaemonContainer?.status, loadZenohDaemon]);

  useEffect(() => {
    if (!showZenohDaemonLogs) return;
    setZenohDaemonLogLoading(true);
    getDockerContainerLogs(ZENOH_DAEMON_CONTAINER_NAME, 200)
      .then((r) => setZenohDaemonLogContent(r.logs))
      .catch(() => setZenohDaemonLogContent("Failed to load logs."))
      .finally(() => setZenohDaemonLogLoading(false));
  }, [showZenohDaemonLogs]);

  const handleCycloIntelligenceBringup = useCallback(async () => {
    const action: "up" | "down" = cycloIntelligenceService.status?.is_up ? "down" : "up";
    await cycloIntelligenceService.handleControl(action);
  }, [cycloIntelligenceService]);

  const handleRobotBringup = useCallback(async () => {
    const action: "up" | "down" = robotService.status?.is_up ? "down" : "up";
    const launchArgs = action === "up" ? robotBringupArgs : undefined;
    const robotTypeParam =
      action === "up" && robotType ? followerModelToApi(robotType) : undefined;
    await robotService.handleControl(action, launchArgs, robotTypeParam);
  }, [robotService, robotBringupArgs, robotType]);

  const handleLeaderBringup = useCallback(async () => {
    const action: "up" | "down" = leaderService.status?.is_up ? "down" : "up";
    const launchArgs = action === "up" ? leaderBringupArgs : undefined;
    await leaderService.handleControl(action, launchArgs);
  }, [leaderService, leaderBringupArgs]);

  useEffect(() => {
    if (container) {
      setRobotType(getStoredFollowerRobotModel(container));
      setLeaderBringupArgs(getStoredBringupArgs(LG2_LEADER_AI_CONFIG, container));
    }
  }, [container]);

  useEffect(() => {
    if (container) {
      const cfg = getFollowerLaunchConfig(robotType);
      setRobotBringupArgs(getStoredBringupArgs(cfg, container));
    }
  }, [container, robotType]);

  useEffect(() => {
    if (container && robotType) {
      localStorage.setItem(`robot_type_${container}`, robotType);
    }
  }, [container, robotType]);

  useEffect(() => {
    if (container && robotBringupArgs) {
      localStorage.setItem(getBringupArgsStorageKey(robotConfig, container), JSON.stringify(robotBringupArgs));
    }
  }, [container, robotBringupArgs, robotConfig]);

  useEffect(() => {
    if (container && leaderBringupArgs) {
      localStorage.setItem(`bringup_args_${LG2_LEADER_AI_CONFIG.serviceId}_${container}`, JSON.stringify(leaderBringupArgs));
    }
  }, [container, leaderBringupArgs]);

  useEffect(() => {
    if (container) {
      robotService.loadStatus();
      leaderService.loadStatus();
    }
  }, [container, robotType, robotService, leaderService]);

  useEffect(() => {
    if (!container) return;
    const interval = setInterval(() => {
      robotService.loadStatus();
      leaderService.loadStatus();
    }, STATUS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [container, robotType, robotService, leaderService]);

  if (!container) {
    return (
      <div style={{ color: "var(--vscode-foreground)" }}>
        Missing container. <Link href="/app" className="underline">Back to Apps</Link>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - 120px)", minHeight: "400px" }}
    >
      <ControlToolbar
        robotType={robotType}
        onRobotTypeChange={(v) => {
          const t = isFollowerRobotModel(v) ? v : "SG2";
          setRobotType(t);
          if (container) localStorage.setItem(`robot_type_${container}`, t);
        }}
        robotService={{
          status: robotService.status,
          loading: robotService.loading,
          error: robotService.error,
        }}
        leaderService={{
          status: leaderService.status,
          loading: leaderService.loading,
          error: leaderService.error,
        }}
        onRobotBringup={handleRobotBringup}
        onLeaderBringup={handleLeaderBringup}
        showLogs={showLogs}
        showLeaderLogs={showLeaderLogs}
        onToggleLogs={() => {
          setShowLogs((prev) => !prev);
          setShowLeaderLogs(false);
          setShowCycloIntelligenceLogs(false);
          setShowZenohDaemonLogs(false);
        }}
        onToggleLeaderLogs={() => {
          setShowLeaderLogs((prev) => !prev);
          setShowLogs(false);
          setShowCycloIntelligenceLogs(false);
          setShowZenohDaemonLogs(false);
        }}
        robotLaunchConfig={robotConfig}
        robotBringupArgs={robotBringupArgs}
        onRobotBringupArgsChange={setRobotBringupArgs}
        leaderLaunchConfig={LG2_LEADER_AI_CONFIG}
        leaderBringupArgs={leaderBringupArgs}
        onLeaderBringupArgsChange={setLeaderBringupArgs}
        cycloIntelligenceService={{
          status: cycloIntelligenceService.status,
          loading: cycloIntelligenceService.loading,
        }}
        onCycloIntelligenceBringup={handleCycloIntelligenceBringup}
        showCycloIntelligenceLogs={showCycloIntelligenceLogs}
        onToggleCycloIntelligenceLogs={() => {
          setShowCycloIntelligenceLogs((prev) => !prev);
          setShowLogs(false);
          setShowLeaderLogs(false);
          setShowZenohDaemonLogs(false);
        }}
        zenohDaemonService={{
          status: zenohDaemonContainer?.status ?? "",
          loading: zenohDaemonActionLoading !== null,
        }}
        onZenohDaemonBringup={handleZenohDaemonBringup}
        showZenohDaemonLogs={showZenohDaemonLogs}
        onToggleZenohDaemonLogs={() => {
          setShowZenohDaemonLogs((prev) => !prev);
          setShowLogs(false);
          setShowLeaderLogs(false);
          setShowCycloIntelligenceLogs(false);
        }}
      />
      <div className="flex gap-4 items-stretch mt-4 flex-1 min-h-0">
        <div className="flex-none flex flex-col gap-4" style={{ width: "500px" }}>
          <Robot3DViewer />
          <div
            className="rounded border overflow-hidden"
            style={{
              backgroundColor: "var(--vscode-sidebar-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            <div
              className="px-5 pt-4 pb-1 text-sm font-bold uppercase tracking-widest"
              style={{ color: "var(--vscode-foreground)" }}
            >
              Robot Status
            </div>
            <div className="px-5 pb-3">
              {[
                {
                  label: "Bringup",
                  value: robotService.status === null ? null : robotService.status.is_up ? "Running" : "Stopped",
                  ok: robotService.status?.is_up ?? null,
                },
                {
                  label: "Battery (Left)",
                  value: batteryLeft !== null ? `${batteryLeft}%` : null,
                  ok: batteryLeft !== null ? batteryLeft > 20 : null,
                },
                {
                  label: "Battery (Right)",
                  value: batteryRight !== null ? `${batteryRight}%` : null,
                  ok: batteryRight !== null ? batteryRight > 20 : null,
                },
              ].map(({ label, value, ok }) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-3 py-2 text-sm"
                >
                  <span className="shrink-0" style={{ color: "var(--vscode-descriptionForeground)" }}>
                    {label}
                  </span>
                  <span
                    className="text-right font-bold break-all"
                    style={{
                      color: ok === null || value === null
                        ? "var(--vscode-descriptionForeground)"
                        : ok === false
                        ? "var(--vscode-errorForeground)"
                        : "var(--vscode-testing-iconPassed, #73c991)",
                    }}
                  >
                    {value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {showLogs && !showLeaderLogs && (
          <div style={PANEL_STYLES}>
            <FixedLogPanel container={container} service={FOLLOWER_SERVICE_NAME} onClose={() => setShowLogs(false)} />
          </div>
        )}
        {showLeaderLogs && !showLogs && (
          <div style={PANEL_STYLES}>
            <FixedLogPanel container={container} service={LEADER_SERVICE_NAME} onClose={() => setShowLeaderLogs(false)} />
          </div>
        )}
        {showCycloIntelligenceLogs && (
          <div style={PANEL_STYLES}>
            <FixedLogPanel container={CYCLO_INTELLIGENCE_CONTAINER} service={CYCLO_INTELLIGENCE_SERVICE} onClose={() => setShowCycloIntelligenceLogs(false)} />
          </div>
        )}
        {showZenohDaemonLogs && (
          <div style={PANEL_STYLES}>
            <div className="flex flex-col h-full rounded border overflow-hidden" style={{ backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}>
              <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--vscode-panel-border)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--vscode-foreground)" }}>Zenoh Daemon — Log</span>
                <button
                  onClick={() => setShowZenohDaemonLogs(false)}
                  className="p-1 rounded hover:opacity-80"
                  style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-3">
                {zenohDaemonLogLoading ? (
                  <p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading logs...</p>
                ) : (
                  <pre
                    className="text-xs font-mono whitespace-pre-wrap break-words"
                    style={{ backgroundColor: "var(--vscode-textCodeBlock-background)", color: "var(--vscode-foreground)", padding: "0.75rem", borderRadius: "4px" }}
                    dangerouslySetInnerHTML={{ __html: convert.toHtml(zenohDaemonLogContent) }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
