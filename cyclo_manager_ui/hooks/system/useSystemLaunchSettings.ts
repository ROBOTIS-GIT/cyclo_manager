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
import { getDefaultArgs, mergeWithDefaults, type LaunchArgsConfig } from "@/config/launchArgs";
import type { SystemProfile, SystemRobotOption } from "@/config/systemProfiles";

type LaunchArgs = Record<string, string>;

const EMPTY_CONFIG: LaunchArgsConfig = {
  serviceId: "unsupported", title: "Unsupported Robot", args: [],
};

function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStoredValue(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Settings still work without browser storage. */ }
}

function argsStorageKey(config: LaunchArgsConfig, container: string): string {
  return `bringup_args_${config.storageKey ?? config.serviceId}_${container}`;
}

function readArgs(config: LaunchArgsConfig, container: string): LaunchArgs {
  try {
    const stored = readStoredValue(argsStorageKey(config, container));
    return stored ? mergeWithDefaults(config, JSON.parse(stored)) : getDefaultArgs(config);
  } catch {
    return getDefaultArgs(config);
  }
}

function useLaunchSelection(
  container: string,
  storageKey: string,
  options: readonly SystemRobotOption[],
) {
  const findOption = (value: string | null) =>
    options.find(option => option.value === value) ?? options[0] ?? null;
  const [selection, setSelection] = useState(() => {
    const option = findOption(readStoredValue(storageKey));
    return { option, args: option ? readArgs(option.config, container) : {} };
  });

  const select = (value: string) => {
    const option = findOption(value);
    if (option?.value === selection.option?.value) return;
    // Switch the selected model and its launch arguments together. An effect that
    // persists the old arguments must never overwrite the new model's settings.
    setSelection({ option, args: option ? readArgs(option.config, container) : {} });
    if (option) writeStoredValue(storageKey, option.value);
  };
  const setArgs = (args: LaunchArgs) => {
    setSelection(current => ({ ...current, args }));
    if (selection.option) {
      writeStoredValue(argsStorageKey(selection.option.config, container), JSON.stringify(args));
    }
  };

  return {
    option: selection.option,
    value: selection.option?.value ?? "",
    config: selection.option?.config ?? EMPTY_CONFIG,
    args: selection.args,
    select,
    setArgs,
  };
}

// The System content is keyed by container so each container loads its own settings.
export function useSystemLaunchSettings(container: string, profile: SystemProfile) {
  const robot = useLaunchSelection(container, `robot_type_${container}`, profile.robotTypeOptions);
  const leader = useLaunchSelection(container, `leader_robot_type_${container}`, profile.leaderTypeOptions);
  return { robot, leader };
}

export type SystemLaunchSettings = ReturnType<typeof useSystemLaunchSettings>;
