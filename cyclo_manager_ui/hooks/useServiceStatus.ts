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

import { useCallback, useState } from "react";
import { controlService, getServiceStatus } from "@/lib/api";
import type { RobotType, ServiceStatusResponse } from "@/types/api";

const ERROR_DISPLAY_DURATION = 5000;
const STATUS_RELOAD_DELAY = 1000;

export function useServiceStatus(
  container: string | undefined,
  serviceName: string | (() => string) | null
) {
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!container || !serviceName) return;
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
      robotType?: RobotType
    ) => {
      if (!container || !serviceName) return;
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
