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

import { useState, useCallback, useRef } from "react";
import { usePolling } from "@/hooks/usePolling";
import { getDockerContainers, controlDockerContainer, getRobotInfo, getSystemStats } from "@/lib/api";
import type { DockerContainerInfo, RobotInfoResponse, SystemStatsResponse } from "@/types/api";
import type { InternetStatus } from "@/components/dashboard/VersionManagementPanel";

const POLL_INTERVAL = 5000;
const SYSTEM_STATS_POLL_INTERVAL_MS = 1000;

export function useDashboardData() {
  const [robotInfo, setRobotInfo] = useState<RobotInfoResponse | null>(null);
  const [robotInfoCheckState, setRobotInfoCheckState] = useState<"loading" | "error" | "done">("loading");
  const [systemStats, setSystemStats] = useState<SystemStatsResponse | null>(null);
  const statsRequestInFlight = useRef(false);
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [actionLoading, setActionLoading] = useState<{ container: string; action: string } | null>(null);


  const loadContainers = useCallback(async () => {
    try {
      const { containers } = await getDockerContainers(true);
      setContainers(containers);
    } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.allSettled([
      getRobotInfo()
        .then((info) => {
          setRobotInfo(info);
          setRobotInfoCheckState("done");
        })
        .catch(() => {
          setRobotInfo(null);
          setRobotInfoCheckState("error");
        }),
      loadContainers(),
    ]);
  }, [loadContainers]);

  usePolling(loadAll, POLL_INTERVAL);

  const loadSystemStats = useCallback(async (isActive: () => boolean) => {
    if (statsRequestInFlight.current) return;
    statsRequestInFlight.current = true;
    try {
      const response = await getSystemStats();
      if (isActive()) setSystemStats(response);
    } catch {
      // Keep the last sample during a temporary connection failure.
    } finally {
      statsRequestInFlight.current = false;
    }
  }, []);

  usePolling(loadSystemStats, SYSTEM_STATS_POLL_INTERVAL_MS);

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

  const versionManagementInternetStatus: InternetStatus =
    robotInfoCheckState === "loading"
      ? "loading"
      : robotInfoCheckState === "error"
        ? "unknown"
        : robotInfo?.internet_connected === false
          ? "offline"
          : "online";

  return { robotInfo, systemStats, containers, actionLoading, handleAction, versionManagementInternetStatus };
}
