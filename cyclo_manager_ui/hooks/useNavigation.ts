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

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDockerContainers, getSupportedRobotContainers } from "@/lib/api";

const JOG_CONTAINER = "ai_worker";

export function useNavigation(closeMenu: () => void) {
  const router = useRouter();
  const [navError, setNavError] = useState<string | null>(null);
  const [systemChoices, setSystemChoices] = useState<string[]>([]);

  async function handleSystemClick() {
    closeMenu();
    setNavError(null);
    setSystemChoices([]);
    try {
      const { supported_robot_containers } = await getSupportedRobotContainers();
      if (supported_robot_containers.length === 0) {
        setNavError("No supported robot container is configured.");
        return;
      }
      const { containers } = await getDockerContainers(false);
      const runningContainerNames = new Set(containers.map((container) => container.name));
      const runningRobotContainers = supported_robot_containers.filter((container) =>
        runningContainerNames.has(container)
      );
      if (runningRobotContainers.length === 0) {
        setNavError("No robot container is running.");
        return;
      }
      if (runningRobotContainers.length === 1) {
        router.push(`/${runningRobotContainers[0]}/system`);
        return;
      }
      setSystemChoices(runningRobotContainers);
    } catch {
      setNavError("Failed to connect to the manager.");
    }
  }

  function openSystemPage(container: string) {
    setSystemChoices([]);
    setNavError(null);
    router.push(`/${container}/system`);
  }

  async function handleJogClick() {
    closeMenu();
    setNavError(null);
    setSystemChoices([]);
    try {
      const { containers } = await getDockerContainers(false);
      const isAiWorkerRunning = containers.some((container) => container.name === JOG_CONTAINER);
      if (!isAiWorkerRunning) {
        setNavError("Jog is available only when the ai_worker container is running.");
        return;
      }
      router.push("/jog");
    } catch {
      setNavError("Failed to connect to the manager.");
    }
  }

  return { navError, setNavError, systemChoices, setSystemChoices, handleSystemClick, handleJogClick, openSystemPage };
}
