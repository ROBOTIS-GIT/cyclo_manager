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
import HelpPopover from "@/components/HelpPopover";
import StatusBadge from "@/components/StatusBadge";
import { LogIcon, PlayIcon, SquareIcon } from "@/components/system/ControlBoxParts";

const GROUP_STYLES: CSSProperties = {
  backgroundColor: "var(--vscode-toolbar-groupBg, rgba(128, 128, 128, 0.08))",
  border: "1px solid var(--vscode-panel-border)",
};

export type ContainerControlBoxProps = {
  title: ReactNode;
  status: string;
  loading: boolean;
  onToggle: () => void;
  showLogs: boolean;
  onToggleLogs: () => void;
  size?: "toolbar" | "compact";
  help?: {
    text: ReactNode;
    ariaLabel: string;
  };
};

export default function ContainerControlBox({
  title,
  status,
  loading,
  onToggle,
  showLogs,
  onToggleLogs,
  size = "toolbar",
  help,
}: ContainerControlBoxProps) {
  const isRunning = status.toLowerCase() === "running";
  const titleClass =
    size === "compact"
      ? "text-[10px] font-medium uppercase tracking-wider"
      : "text-sm font-medium uppercase tracking-wider";
  const buttonClass =
    size === "compact"
      ? "w-[30px] h-[30px] rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
      : "w-11 h-11 rounded border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center";
  const iconClass = size === "compact" ? "w-3.5 h-3.5" : undefined;

  return (
    <div
      className={
        size === "compact"
          ? "flex flex-col gap-1.5 rounded-none px-3 py-2 min-h-[72px] justify-center"
          : "flex flex-col gap-2.5 rounded-none px-5 py-4 min-h-[108px] justify-center"
      }
      style={GROUP_STYLES}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {typeof title === "string" ? (
          <span className={titleClass} style={{ color: "var(--vscode-descriptionForeground)" }}>
            {title}
          </span>
        ) : (
          title
        )}
        {status ? <StatusBadge status={status} dotOnly /> : null}
        {help && (
          <HelpPopover ariaLabel={help.ariaLabel}>
            {help.text}
          </HelpPopover>
        )}
      </div>
      <div className={size === "compact" ? "flex items-center gap-2" : "flex items-center gap-3"}>
        <button
          type="button"
          onClick={onToggle}
          disabled={loading}
          title={isRunning ? "Stop" : "Start"}
          aria-label={isRunning ? "Stop" : "Start"}
          className={buttonClass}
          style={{
            backgroundColor: isRunning
              ? "var(--vscode-button-secondaryBackground)"
              : "var(--vscode-button-background)",
            color: isRunning
              ? "var(--vscode-button-secondaryForeground)"
              : "var(--vscode-button-foreground)",
          }}
        >
          {isRunning ? <SquareIcon className={iconClass} /> : <PlayIcon className={iconClass} />}
        </button>
        <button
          type="button"
          onClick={onToggleLogs}
          title="Log"
          aria-label="Log"
          className={buttonClass}
          style={{
            backgroundColor: showLogs
              ? "var(--vscode-button-secondaryBackground)"
              : "var(--vscode-button-background)",
            color: showLogs
              ? "var(--vscode-button-secondaryForeground)"
              : "var(--vscode-button-foreground)",
          }}
        >
          <LogIcon className={iconClass} />
        </button>
      </div>
    </div>
  );
}
