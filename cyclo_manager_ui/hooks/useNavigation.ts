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

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getRunningRobotContainers, robotPageUrl, type RobotPage } from "@/lib/robotContainers";


export function useNavigation(closeMenu: () => void, pathname: string) {
  const router = useRouter();
  const [navError, setNavError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ page: RobotPage; containers: string[] } | null>(null);
  const requestId = useRef(0);

  // Also invalidate requests on back/forward navigation and layout unmount.
  useEffect(() => () => { ++requestId.current; }, [pathname]);

  async function openRobot(page: RobotPage) {
    const id = ++requestId.current;
    closeMenu();
    setNavError(null);
    setSelection(null);
    try {
      const runningRobotContainers = await getRunningRobotContainers();
      if (id !== requestId.current) return;
      if (runningRobotContainers.length === 0) {
        setNavError("No robot container is running.");
        return;
      }
      if (runningRobotContainers.length === 1) {
        router.push(robotPageUrl(runningRobotContainers[0], page));
        return;
      }
      setSelection({ page, containers: runningRobotContainers });
    } catch {
      if (id === requestId.current) setNavError("Failed to connect to the manager.");
    }
  }

  function openRobotPage(container: string) {
    if (!selection?.containers.includes(container)) return;
    ++requestId.current;
    setSelection(null);
    setNavError(null);
    router.push(robotPageUrl(container, selection.page));
  }

  function cancelSelection() {
    ++requestId.current;
    setSelection(null);
    setNavError(null);
  }

  function handleNavigate() {
    // Cancel before Next.js starts the transition, even for the current route.
    cancelSelection();
    closeMenu();
  }

  return {
    navError, setNavError, selection, cancelSelection, openRobotPage, handleNavigate,
    handleSystemClick: () => openRobot("system"), handleJogClick: () => openRobot("jog"),
  };
}
