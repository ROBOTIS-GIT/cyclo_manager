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

import { useCallback, useState } from "react";
import { controlDockerContainer, getDockerContainers, getSerialPorts } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { useServiceStatus } from "@/hooks/useServiceStatus";
import type { SystemProfile } from "@/config/systemProfiles";
import {
  CYCLO_INTELLIGENCE_CONTAINER, CYCLO_INTELLIGENCE_SERVICE,
  SYSTEM_STATUS_POLL_INTERVAL, ZENOH_DAEMON_CONTAINER,
} from "@/config/systemServices";
import type { SerialPortInfo } from "@/types/api";
import type { SystemLaunchSettings } from "./useSystemLaunchSettings";

export function useSystemServices(
  container: string, profile: SystemProfile, settings: SystemLaunchSettings,
) {
  const robot = useServiceStatus(container, profile.robotServiceName);
  const leader = useServiceStatus(container, profile.leaderServiceName);
  const intelligence = useServiceStatus(CYCLO_INTELLIGENCE_CONTAINER, CYCLO_INTELLIGENCE_SERVICE);
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [intelligenceContainerStatus, setIntelligenceContainerStatus] = useState<string | null>(null);
  const [zenohStatus, setZenohStatus] = useState("");
  const [zenohAction, setZenohAction] = useState<"start" | "stop" | null>(null);

  usePolling(() => {
    void robot.loadStatus();
    void leader.loadStatus();
  }, SYSTEM_STATUS_POLL_INTERVAL, {
    resetKey: `${container}:${settings.robot.value}:${settings.leader.value}:${profile.robotServiceName}:${profile.leaderServiceName ?? ""}`,
  });
  usePolling(intelligence.loadStatus, SYSTEM_STATUS_POLL_INTERVAL, {
    resetKey: `${container}:cyclo-intelligence`,
  });
  usePolling(async (isActive) => {
    try {
      const response = await getSerialPorts();
      if (isActive()) setSerialPorts(response.ports);
    } catch {
      if (isActive()) setSerialPorts([]);
    }
  }, SYSTEM_STATUS_POLL_INTERVAL, { resetKey: `${container}:serial-ports` });

  const loadContainers = useCallback(async (isActive: () => boolean = () => true) => {
    try {
      const { containers } = await getDockerContainers(true);
      if (!isActive()) return;
      setIntelligenceContainerStatus(containers.find(item => item.name === CYCLO_INTELLIGENCE_CONTAINER)?.status ?? null);
      setZenohStatus(containers.find(item => item.name === ZENOH_DAEMON_CONTAINER)?.status ?? "");
    } catch {
      if (!isActive()) return;
      setIntelligenceContainerStatus(null);
      setZenohStatus("");
    }
  }, []);
  usePolling(loadContainers, SYSTEM_STATUS_POLL_INTERVAL, { resetKey: `${container}:external-service-containers` });

  const toggleRobot = async () => {
    const action = robot.status?.is_up ? "down" : "up";
    await robot.handleControl(action,
      action === "up" ? settings.robot.args : undefined,
      action === "up" ? settings.robot.option?.robotType : undefined);
  };
  const toggleLeader = async () => {
    if (!profile.leaderServiceName) return;
    const action = leader.status?.is_up ? "down" : "up";
    await leader.handleControl(action,
      action === "up" ? settings.leader.args : undefined,
      action === "up" ? settings.leader.option?.robotType : undefined);
  };
  const toggleIntelligence = async () => {
    await intelligence.handleControl(intelligence.status?.is_up ? "down" : "up");
  };
  const toggleZenoh = async () => {
    const action = zenohStatus.toLowerCase() === "running" ? "stop" : "start";
    setZenohAction(action);
    try {
      await controlDockerContainer(ZENOH_DAEMON_CONTAINER, action);
      await loadContainers();
    } finally {
      setZenohAction(null);
    }
  };

  return {
    robot, leader, intelligence, serialPorts,
    intelligenceContainerRunning: intelligenceContainerStatus?.toLowerCase() === "running",
    zenohStatus, zenohLoading: zenohAction !== null,
    toggleRobot, toggleLeader, toggleIntelligence, toggleZenoh,
  };
}

export type SystemServices = ReturnType<typeof useSystemServices>;
