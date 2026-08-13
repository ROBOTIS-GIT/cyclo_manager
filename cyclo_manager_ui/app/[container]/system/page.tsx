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
import type { CSSProperties } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Convert from "ansi-to-html";
import { usePolling } from "@/hooks/usePolling";
import { useServiceStatus } from "@/hooks/useServiceStatus";
import {
  controlDockerContainer,
  getDockerContainerLogs,
  getDockerContainers,
  getROS2TopicAvailability,
  getROS2TopicData,
  getSerialPorts,
  ros2Subscribe,
  ros2Unsubscribe,
} from "@/lib/api";
import type { SerialPortInfo } from "@/types/api";
import {
  getDefaultArgs,
  mergeWithDefaults,
  type LaunchArgsConfig,
} from "@/config/launchArgs";
import { getSystemProfile, type SystemControlTopic, type SystemProfile, type SystemRobotOption } from "@/config/systemProfiles";
import LaunchArgsSettingPopup from "@/components/LaunchArgsSettingPopup";
import FixedLogPanel from "@/components/FixedLogPanel";
import Robot3DViewer from "@/components/Robot3DViewer";
import ContainerControlBox from "@/components/system/ContainerControlBox";
import ServiceControlBox from "@/components/system/ServiceControlBox";
import { useTheme } from "@/contexts/ThemeContext";
import type { RobotType } from "@/types/api";

const STATUS_POLL_INTERVAL = 2000;
const ROBOT_DESCRIPTION_TOPIC = "/robot_description";
const JOINT_STATES_TOPIC = "/joint_states";

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

const ERROR_STYLES: CSSProperties = {
  color: "var(--vscode-errorForeground)",
  backgroundColor: "rgba(244, 135, 113, 0.1)",
  border: "1px solid rgba(244, 135, 113, 0.3)",
};

type ToolbarHelpKey = "robot" | "leader" | "intelligence" | "zenoh";

const TOOLBAR_HELP_TEXT: Record<ToolbarHelpKey, string> = {
  robot:
    "Starts and stops the robot bringup service. The dot shows status — green is running, red is stopped.",
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

const UNSUPPORTED_LAUNCH_CONFIG: LaunchArgsConfig = {
  serviceId: "unsupported",
  title: "Unsupported Robot",
  args: [],
};

function isProfileOptionValue(
  value: string | null | undefined,
  options: readonly { value: string }[]
): value is string {
  return value != null && options.some((option) => option.value === value);
}

function getDefaultProfileOptionValue(options: readonly { value: string }[]): string {
  return options[0]?.value ?? "";
}

function getStoredProfileOptionValue(
  container: string,
  storageKey: string,
  fallback: string,
  options: readonly { value: string }[]
): string {
  if (typeof window === "undefined" || !container) return fallback;
  const stored = localStorage.getItem(storageKey);
  return isProfileOptionValue(stored, options) ? stored : fallback;
}

function getProfileRobotOption(
  robotType: string,
  options: readonly SystemRobotOption[]
): SystemRobotOption | null {
  return options.find((option) => option.value === robotType) ?? null;
}

const CYCLO_INTELLIGENCE_CONTAINER = "cyclo_intelligence";
const CYCLO_INTELLIGENCE_SERVICE = "cyclo_intelligence";
const ZENOH_DAEMON_CONTAINER_NAME = "zenoh_daemon";
const UNSUPPORTED_SYSTEM_PROFILE: SystemProfile = {
  label: "Unsupported",
  robotServiceName: "",
  leaderServiceName: null,
  robotTypeOptions: [{ value: "unsupported", label: "Unsupported", config: UNSUPPORTED_LAUNCH_CONFIG }],
  leaderTypeOptions: [],
  batteryTopics: [],
  cameraTopics: [],
};

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

  const systemProfile = getSystemProfile(container);
  const activeSystemProfile = systemProfile ?? UNSUPPORTED_SYSTEM_PROFILE;
  const [robotType, setRobotType] = useState<string>(() =>
    getStoredProfileOptionValue(
      container,
      `robot_type_${container}`,
      getDefaultProfileOptionValue(activeSystemProfile.robotTypeOptions),
      activeSystemProfile.robotTypeOptions
    )
  );
  const [leaderType, setLeaderType] = useState<string>(() =>
    getStoredProfileOptionValue(
      container,
      `leader_robot_type_${container}`,
      getDefaultProfileOptionValue(activeSystemProfile.leaderTypeOptions),
      activeSystemProfile.leaderTypeOptions
    )
  );
  const [showLogs, setShowLogs] = useState(false);
  const [showLeaderLogs, setShowLeaderLogs] = useState(false);
  const [showCycloIntelligenceLogs, setShowCycloIntelligenceLogs] = useState(false);
  const [showZenohDaemonLogs, setShowZenohDaemonLogs] = useState(false);
  const [showRobotArgsPopup, setShowRobotArgsPopup] = useState(false);
  const [showLeaderArgsPopup, setShowLeaderArgsPopup] = useState(false);

  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [cycloIntelligenceContainerStatus, setCycloIntelligenceContainerStatus] = useState<string | null>(null);
  const [zenohDaemonContainer, setZenohDaemonContainer] = useState<{ name: string; status: string } | null>(null);
  const [zenohDaemonActionLoading, setZenohDaemonActionLoading] = useState<"start" | "stop" | null>(null);
  const [zenohDaemonLogContent, setZenohDaemonLogContent] = useState("");
  const [zenohDaemonLogLoading, setZenohDaemonLogLoading] = useState(false);
  const robotOption = getProfileRobotOption(robotType, activeSystemProfile.robotTypeOptions);
  const leaderOption = getProfileRobotOption(leaderType, activeSystemProfile.leaderTypeOptions);
  const robotConfig = robotOption?.config ?? activeSystemProfile.robotTypeOptions[0]?.config ?? UNSUPPORTED_LAUNCH_CONFIG;
  const leaderConfig = leaderOption?.config ?? null;
  const batteryTopics = activeSystemProfile.batteryTopics;
  const cameraTopics =
    activeSystemProfile.cameraTopicsByRobotType?.[robotType as RobotType] ??
    activeSystemProfile.cameraTopics;
  const controlTopics = useMemo<SystemControlTopic[]>(
    () => {
      if (!systemProfile) return [];
      return [
        { topic: JOINT_STATES_TOPIC, msgType: "sensor_msgs/msg/JointState" },
        { topic: ROBOT_DESCRIPTION_TOPIC, msgType: "std_msgs/msg/String" },
        ...batteryTopics.map(({ topic }) => ({
          topic,
          msgType: "sensor_msgs/msg/BatteryState",
        })),
        ...cameraTopics.map(({ topic }) => ({
          topic,
          msgType: "sensor_msgs/msg/CompressedImage",
        })),
      ];
    },
    [batteryTopics, cameraTopics, systemProfile]
  );
  const [robotBringupArgs, setRobotBringupArgs] = useState<Record<string, string>>(
    () => getStoredBringupArgs(robotConfig, container)
  );
  const [leaderBringupArgs, setLeaderBringupArgs] = useState<Record<string, string>>(
    () => (leaderConfig ? getStoredBringupArgs(leaderConfig, container) : {})
  );

  const robotService = useServiceStatus(container, activeSystemProfile.robotServiceName);
  const leaderService = useServiceStatus(container, activeSystemProfile.leaderServiceName);
  const cycloIntelligenceService = useServiceStatus(CYCLO_INTELLIGENCE_CONTAINER, CYCLO_INTELLIGENCE_SERVICE);
  const robotSelectDisabled = robotService.loading || robotService.status?.is_up === true;
  const leaderSelectDisabled = leaderService.loading || leaderService.status?.is_up === true;
  const cycloIntelligenceContainerRunning =
    cycloIntelligenceContainerStatus?.toLowerCase() === "running";

  const [batteryPercentage, setBatteryPercentage] = useState<Record<string, number | null>>({});
  const [cameraAvailability, setCameraAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const pollStatus = async () => {
      const [batteryEntries, cameraEntries] = await Promise.all([
        Promise.all(
          batteryTopics.map(async ({ topic }) => {
            try {
              return [topic, parseBatteryPercentage(await getROS2TopicData(topic))] as const;
            } catch {
              return [topic, null] as const;
            }
          })
        ),
        Promise.all(
          cameraTopics.map(async ({ topic }) => [topic, await getROS2TopicAvailability(topic)] as const)
        ),
      ]);
      if (!cancelled) {
        setBatteryPercentage(Object.fromEntries(batteryEntries));
        setCameraAvailability(Object.fromEntries(cameraEntries));
        timeoutId = setTimeout(pollStatus, STATUS_POLL_INTERVAL);
      }
    };
    pollStatus();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [batteryTopics, cameraTopics]);

  usePolling(cycloIntelligenceService.loadStatus, STATUS_POLL_INTERVAL, {
    enabled: Boolean(container && systemProfile),
    resetKey: `${container}:cyclo-intelligence`,
  });

  const loadSerialPorts = useCallback(async () => {
    try {
      const res = await getSerialPorts();
      setSerialPorts(res.ports);
    } catch {
      setSerialPorts([]);
    }
  }, []);

  usePolling(loadSerialPorts, STATUS_POLL_INTERVAL, {
    enabled: Boolean(container && systemProfile),
    resetKey: `${container}:serial-ports`,
  });

  const loadExternalServiceContainers = useCallback(async () => {
    try {
      const res = await getDockerContainers(true);
      const cycloIntelligence = res.containers.find((d) => d.name === CYCLO_INTELLIGENCE_CONTAINER);
      const zenohDaemon = res.containers.find((d) => d.name === ZENOH_DAEMON_CONTAINER_NAME);
      setCycloIntelligenceContainerStatus(cycloIntelligence?.status ?? null);
      setZenohDaemonContainer(
        zenohDaemon ? { name: zenohDaemon.name, status: zenohDaemon.status } : null
      );
    } catch {
      setCycloIntelligenceContainerStatus(null);
      setZenohDaemonContainer(null);
    }
  }, []);

  usePolling(loadExternalServiceContainers, STATUS_POLL_INTERVAL, {
    enabled: Boolean(container && systemProfile),
    resetKey: `${container}:external-service-containers`,
  });

  useEffect(() => {
    if (!container || !systemProfile) return;
    for (const { topic, msgType } of controlTopics) {
      ros2Subscribe(topic, msgType).catch(() => {});
    }
    return () => {
      for (const { topic } of controlTopics) {
        ros2Unsubscribe(topic).catch(() => {});
      }
    };
  }, [container, controlTopics, systemProfile]);

  const handleZenohDaemonBringup = useCallback(async () => {
    const isRunning = zenohDaemonContainer?.status?.toLowerCase() === "running";
    const action = isRunning ? "stop" : "start";
    setZenohDaemonActionLoading(action);
    try {
      await controlDockerContainer(ZENOH_DAEMON_CONTAINER_NAME, action);
      await loadExternalServiceContainers();
    } finally {
      setZenohDaemonActionLoading(null);
    }
  }, [zenohDaemonContainer?.status, loadExternalServiceContainers]);

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
      action === "up" ? robotOption?.robotType : undefined;
    await robotService.handleControl(action, launchArgs, robotTypeParam);
  }, [robotService, robotBringupArgs, robotOption]);

  const handleLeaderBringup = useCallback(async () => {
    if (!activeSystemProfile.leaderServiceName) return;
    const action: "up" | "down" = leaderService.status?.is_up ? "down" : "up";
    const launchArgs = action === "up" ? leaderBringupArgs : undefined;
    const robotTypeParam = action === "up" ? leaderOption?.robotType : undefined;
    await leaderService.handleControl(action, launchArgs, robotTypeParam);
  }, [
    leaderService,
    leaderBringupArgs,
    leaderOption,
    activeSystemProfile.leaderServiceName,
  ]);

  useEffect(() => {
    if (container && systemProfile) {
      setRobotType(getStoredProfileOptionValue(
        container,
        `robot_type_${container}`,
        getDefaultProfileOptionValue(systemProfile.robotTypeOptions),
        systemProfile.robotTypeOptions
      ));
      setLeaderType(getStoredProfileOptionValue(
        container,
        `leader_robot_type_${container}`,
        getDefaultProfileOptionValue(systemProfile.leaderTypeOptions),
        systemProfile.leaderTypeOptions
      ));
      setLeaderBringupArgs(leaderConfig ? getStoredBringupArgs(leaderConfig, container) : {});
    }
  }, [container, leaderConfig, systemProfile]);

  useEffect(() => {
    if (container && systemProfile) {
      setRobotBringupArgs(getStoredBringupArgs(robotConfig, container));
    }
  }, [container, robotConfig, systemProfile]);

  useEffect(() => {
    if (container && systemProfile && robotType) {
      localStorage.setItem(`robot_type_${container}`, robotType);
    }
  }, [container, robotType, systemProfile]);

  useEffect(() => {
    if (container && systemProfile && leaderType) {
      localStorage.setItem(`leader_robot_type_${container}`, leaderType);
    }
  }, [container, leaderType, systemProfile]);

  useEffect(() => {
    if (container && systemProfile && robotBringupArgs) {
      localStorage.setItem(getBringupArgsStorageKey(robotConfig, container), JSON.stringify(robotBringupArgs));
    }
  }, [container, robotBringupArgs, robotConfig, systemProfile]);

  useEffect(() => {
    if (container && systemProfile && leaderConfig && leaderBringupArgs) {
      localStorage.setItem(getBringupArgsStorageKey(leaderConfig, container), JSON.stringify(leaderBringupArgs));
    }
  }, [container, leaderBringupArgs, leaderConfig, systemProfile]);

  usePolling(
    () => {
      robotService.loadStatus();
      leaderService.loadStatus();
    },
    STATUS_POLL_INTERVAL,
    { enabled: Boolean(container && systemProfile), resetKey: `${container ?? ""}:${robotType}:${leaderType}:${activeSystemProfile.robotServiceName}:${activeSystemProfile.leaderServiceName ?? ""}` }
  );

  if (!container) {
    return (
      <div style={{ color: "var(--vscode-foreground)" }}>
        Missing container. <Link href="/app" className="underline">Back to Apps</Link>
      </div>
    );
  }

  if (!systemProfile) {
    return (
      <div style={{ color: "var(--vscode-foreground)" }}>
        Unsupported robot container: {container}. <Link href="/app" className="underline">Back to Apps</Link>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - 120px)", minHeight: "400px" }}
    >
      <div
        className="flex flex-wrap items-stretch gap-0 border-b py-2"
        style={{
          backgroundColor: "var(--vscode-editor-background)",
          borderColor: "var(--vscode-panel-border)",
          boxShadow: "0 1px 0 0 rgba(0,0,0,0.15)",
        }}
      >
        <ServiceControlBox
          title="Robot"
          status={robotService.status}
          loading={robotService.loading}
          onToggle={handleRobotBringup}
          showLogs={showLogs}
          onToggleLogs={() => {
            setShowLogs((prev) => !prev);
            setShowLeaderLogs(false);
            setShowCycloIntelligenceLogs(false);
            setShowZenohDaemonLogs(false);
          }}
          onSettings={robotConfig.args.length > 0 ? () => setShowRobotArgsPopup(true) : undefined}
          typeSelect={{
            value: robotType,
            onChange: (v) => {
              const t = isProfileOptionValue(v, activeSystemProfile.robotTypeOptions)
                ? v
                : getDefaultProfileOptionValue(activeSystemProfile.robotTypeOptions);
              setRobotType(t);
              if (container) localStorage.setItem(`robot_type_${container}`, t);
            },
            disabled: robotSelectDisabled,
            options: activeSystemProfile.robotTypeOptions,
          }}
          help={{
            text: TOOLBAR_HELP_TEXT.robot,
            ariaLabel: TOOLBAR_HELP_ARIA.robot,
          }}
        />

        <ServiceControlBox
          title="Leader"
          status={leaderService.status}
          loading={leaderService.loading}
          onToggle={handleLeaderBringup}
          showLogs={showLeaderLogs}
          onToggleLogs={() => {
            setShowLeaderLogs((prev) => !prev);
            setShowLogs(false);
            setShowCycloIntelligenceLogs(false);
            setShowZenohDaemonLogs(false);
          }}
          onSettings={() => setShowLeaderArgsPopup(true)}
          typeSelect={{
            value: leaderType,
            onChange: (v) => {
              const t = isProfileOptionValue(v, activeSystemProfile.leaderTypeOptions)
                ? v
                : getDefaultProfileOptionValue(activeSystemProfile.leaderTypeOptions);
              setLeaderType(t);
              if (container) localStorage.setItem(`leader_robot_type_${container}`, t);
            },
            disabled: leaderSelectDisabled,
            options: activeSystemProfile.leaderTypeOptions,
          }}
          help={{
            text: TOOLBAR_HELP_TEXT.leader,
            ariaLabel: TOOLBAR_HELP_ARIA.leader,
          }}
        />

        <ServiceControlBox
          title="Cyclo Intelligence"
          status={cycloIntelligenceService.status}
          loading={cycloIntelligenceService.loading}
          disabled={!cycloIntelligenceContainerRunning}
          onToggle={handleCycloIntelligenceBringup}
          showLogs={showCycloIntelligenceLogs}
          onToggleLogs={() => {
            setShowCycloIntelligenceLogs((prev) => !prev);
            setShowLogs(false);
            setShowLeaderLogs(false);
            setShowZenohDaemonLogs(false);
          }}
          help={{
            text: TOOLBAR_HELP_TEXT.intelligence,
            ariaLabel: TOOLBAR_HELP_ARIA.intelligence,
          }}
        />

        <ContainerControlBox
          title="Zenoh Daemon"
          status={zenohDaemonContainer?.status ?? ""}
          loading={zenohDaemonActionLoading !== null}
          onToggle={handleZenohDaemonBringup}
          showLogs={showZenohDaemonLogs}
          onToggleLogs={() => {
            setShowZenohDaemonLogs((prev) => !prev);
            setShowLogs(false);
            setShowLeaderLogs(false);
            setShowCycloIntelligenceLogs(false);
          }}
          help={{
            text: TOOLBAR_HELP_TEXT.zenoh,
            ariaLabel: TOOLBAR_HELP_ARIA.zenoh,
          }}
        />

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
          config={robotConfig}
          args={robotBringupArgs}
          onChange={setRobotBringupArgs}
          serialPorts={serialPorts}
        />
        <LaunchArgsSettingPopup
          open={showLeaderArgsPopup}
          onClose={() => setShowLeaderArgsPopup(false)}
          config={leaderConfig ?? robotConfig}
          args={leaderBringupArgs}
          onChange={setLeaderBringupArgs}
          serialPorts={serialPorts}
        />
      </div>
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
                ...batteryTopics.map(({ label, topic }) => {
                  const pct = batteryPercentage[topic] ?? null;
                  return {
                    label,
                    value: pct !== null ? `${pct}%` : null,
                    ok: pct !== null ? pct > 20 : null,
                  };
                }),
                ...cameraTopics.map(({ label, topic }) => {
                  const available = cameraAvailability[topic] ?? null;
                  return {
                    label,
                    value: available ? "Active" : null,
                    ok: available,
                  };
                }),
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
            <FixedLogPanel container={container} service={activeSystemProfile.robotServiceName} onClose={() => setShowLogs(false)} />
          </div>
        )}
        {activeSystemProfile.leaderServiceName && showLeaderLogs && !showLogs && (
          <div style={PANEL_STYLES}>
            <FixedLogPanel container={container} service={activeSystemProfile.leaderServiceName} onClose={() => setShowLeaderLogs(false)} />
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
