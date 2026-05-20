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

import { useTheme } from "@/contexts/ThemeContext";

export default function ThemeToggle({
  compact = false,
  rail = false,
}: {
  compact?: boolean;
  /** Narrow ~120px sidebar: smallest labels and padding */
  rail?: boolean;
}) {
  const { theme, setTheme } = useTheme();

  const segmentBase = rail
    ? "flex-1 min-w-0 py-0.5 px-0 text-[9px] font-semibold leading-none transition-colors border-none cursor-pointer"
    : compact
      ? "flex-1 min-w-0 py-1 px-0.5 text-[10px] font-semibold leading-tight transition-colors border-none cursor-pointer"
      : "flex-1 min-w-0 py-2 px-1 text-[11px] font-semibold leading-tight transition-colors border-none cursor-pointer";

  return (
    <div
      className={`flex w-full overflow-hidden ${rail ? "rounded-md" : "rounded-lg"}`}
      style={{
        backgroundColor: "var(--vscode-input-background)",
        border: "1px solid var(--vscode-panel-border)",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
      }}
      role="group"
      aria-label="Color theme"
    >
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={segmentBase}
        style={{
          backgroundColor: theme === "light" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
          color: theme === "light" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
          borderRight: "1px solid var(--vscode-panel-border)",
        }}
        aria-pressed={theme === "light"}
        title="Light theme"
      >
        Light
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={segmentBase}
        style={{
          backgroundColor: theme === "dark" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
          color: theme === "dark" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
        }}
        aria-pressed={theme === "dark"}
        title="Dark theme"
      >
        Dark
      </button>
    </div>
  );
}
