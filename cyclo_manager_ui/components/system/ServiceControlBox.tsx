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

import type { CSSProperties, ReactNode } from "react";
import type { LaunchArgSelectOption } from "@/config/launchArgs";
import type { ServiceStatusResponse } from "@/types/api";
import HelpPopover from "@/components/HelpPopover";
import StatusBadge from "@/components/StatusBadge";
import {
  LogIcon,
  PlayIcon,
  Select,
  SettingsButton,
  SquareIcon,
} from "@/components/system/ControlBoxParts";

const GROUP_STYLES: CSSProperties = {
  backgroundColor: "var(--vscode-toolbar-groupBg, rgba(128, 128, 128, 0.08))",
  border: "1px solid var(--vscode-panel-border)",
};

export type ServiceControlBoxProps = {
  title: ReactNode;
  status: ServiceStatusResponse | null;
  loading: boolean;
  disabled?: boolean;
  onToggle: () => void;
  showLogs: boolean;
  onToggleLogs: () => void;
  onSettings?: () => void;
  typeSelect?: {
    value: string;
    onChange: (value: string) => void;
    options: readonly LaunchArgSelectOption[];
    disabled?: boolean;
  };
  help?: {
    text: ReactNode;
    ariaLabel: string;
  };
};

export default function ServiceControlBox({
  title,
  status,
  loading,
  disabled = false,
  onToggle,
  showLogs,
  onToggleLogs,
  onSettings,
  typeSelect,
  help,
}: ServiceControlBoxProps) {
  const isUp = status?.is_up === true;

  return (
    <div
      className="flex flex-col gap-2.5 rounded-none px-5 py-4 min-h-[108px] justify-center"
      aria-disabled={disabled}
      style={{
        ...GROUP_STYLES,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {typeof title === "string" ? (
          <span
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            {title}
          </span>
        ) : (
          title
        )}
        {status && <StatusBadge status={isUp} dotOnly />}
        {help && (
          <HelpPopover ariaLabel={help.ariaLabel} disabled={disabled}>
            {help.text}
          </HelpPopover>
        )}
      </div>
      <div className="flex items-center gap-3">
        {typeSelect && (
          <Select
            value={typeSelect.value}
            onChange={typeSelect.onChange}
            disabled={disabled || typeSelect.disabled}
            options={typeSelect.options}
          />
        )}
        <button
          onClick={onToggle}
          disabled={disabled || loading}
          title={isUp ? "Stop" : "Bringup"}
          aria-label={isUp ? "Stop" : "Bringup"}
          className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
          style={{
            backgroundColor: isUp
              ? "var(--vscode-button-secondaryBackground)"
              : "var(--vscode-button-background)",
            color: isUp
              ? "var(--vscode-button-secondaryForeground)"
              : "var(--vscode-button-foreground)",
          }}
        >
          {isUp ? <SquareIcon /> : <PlayIcon />}
        </button>
        {onSettings && <SettingsButton onClick={onSettings} disabled={disabled} />}
        <button
          onClick={onToggleLogs}
          disabled={disabled}
          title="Log"
          aria-label="Log"
          className="w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
          style={{
            backgroundColor: showLogs
              ? "var(--vscode-button-secondaryBackground)"
              : "var(--vscode-button-background)",
            color: showLogs
              ? "var(--vscode-button-secondaryForeground)"
              : "var(--vscode-button-foreground)",
          }}
        >
          <LogIcon />
        </button>
      </div>
    </div>
  );
}
