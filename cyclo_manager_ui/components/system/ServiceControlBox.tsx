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

import type { CSSProperties, ReactNode, RefObject } from "react";
import type { LaunchArgSelectOption } from "@/config/launchArgs";
import type { ServiceStatusResponse } from "@/types/api";
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

const HELP_BTN_CLASS =
  "inline-flex items-center justify-center shrink-0 rounded-full border leading-none font-semibold cursor-pointer select-none hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]";

const HELP_BTN_STYLE: CSSProperties = {
  width: "15px",
  height: "15px",
  fontSize: "10px",
  lineHeight: 1,
  borderColor: "var(--vscode-panel-border)",
  color: "var(--vscode-descriptionForeground)",
  backgroundColor: "var(--vscode-editor-background)",
};

export type ServiceControlBoxProps = {
  title: ReactNode;
  status: ServiceStatusResponse | null;
  loading: boolean;
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
    buttonRef: RefObject<HTMLButtonElement | null>;
    expanded: boolean;
    controls: string;
    onClick: () => void;
  };
};

export default function ServiceControlBox({
  title,
  status,
  loading,
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
      style={GROUP_STYLES}
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
          <button
            ref={help.buttonRef}
            type="button"
            onClick={help.onClick}
            className={HELP_BTN_CLASS}
            style={HELP_BTN_STYLE}
            aria-expanded={help.expanded}
            aria-controls={help.controls}
            title="Help"
          >
            ?
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {typeSelect && (
          <Select
            value={typeSelect.value}
            onChange={typeSelect.onChange}
            disabled={typeSelect.disabled}
            options={typeSelect.options}
          />
        )}
        <button
          onClick={onToggle}
          disabled={loading}
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
        {onSettings && <SettingsButton onClick={onSettings} />}
        <button
          onClick={onToggleLogs}
          title="Log"
          aria-label="Log"
          className="w-11 h-11 rounded border-none cursor-pointer inline-flex items-center justify-center"
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
