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

import { useEffect, useState } from "react";
import { getRobotDescription } from "@/lib/api";

/** One retained description per enabled lifecycle; no permanent ROS subscription. */
export function useRobotDescription(topic: string, reloadKey: string | number, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([topic, reloadKey, attempt, enabled]);
  const [result, setResult] = useState<{
    key: string; value: { data: unknown; error: string | null } | null;
  }>({ key, value: null });
  // Forget old data/errors before rendering a stopped or restarted robot.
  if (result.key !== key) setResult({ key, value: null });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getRobotDescription(topic, controller.signal).then(response => {
      if (!controller.signal.aborted) setResult({ key, value: { data: response.data, error: null } });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, value: {
        data: null, error: error instanceof Error ? error.message : "Could not load robot description",
      } });
    });
    return () => controller.abort();
  }, [topic, key, enabled]);
  const current = enabled && result.key === key ? result.value : null;
  return { data: current?.data, loading: enabled && !current, error: current?.error,
    retry: () => { if (enabled) setAttempt(value => value + 1); } };
}
