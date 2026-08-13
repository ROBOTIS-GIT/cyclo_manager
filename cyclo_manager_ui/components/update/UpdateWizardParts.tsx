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

import type { CSSProperties } from "react";

export type Phase = "intro" | "stop" | "choose" | "update" | "start";

const PHASES: { key: Phase; label: string }[] = [
  { key: "intro", label: "Overview" },
  { key: "stop", label: "Stop Container" },
  { key: "choose", label: "Choose Strategy" },
  { key: "update", label: "Update Repository" },
  { key: "start", label: "Create and Start Container" },
];

export const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  backgroundColor: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const modal: CSSProperties = {
  width: "min(620px, 95vw)",
  maxHeight: "88vh",
  display: "flex",
  flexDirection: "column",
  borderRadius: "6px",
  border: "1px solid var(--vscode-panel-border)",
  backgroundColor: "var(--vscode-editor-background)",
  overflow: "hidden",
};

export const btnPrimary = (disabled = false): CSSProperties => ({
  padding: "6px 18px",
  fontSize: 13,
  border: "none",
  borderRadius: 2,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
  backgroundColor: "var(--vscode-button-background)",
  color: "var(--vscode-button-foreground)",
});

export const btnSecondary = (disabled = false): CSSProperties => ({
  padding: "6px 18px",
  fontSize: 13,
  border: "none",
  borderRadius: 2,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
  backgroundColor: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
});

export function StepBar({ current }: { current: Phase }) {
  const idx = PHASES.findIndex((p) => p.key === current);
  return (
    <div
      className="flex items-center gap-0 px-5 py-3 text-xs"
      style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}
    >
      {PHASES.map((p, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={p.key} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  flexShrink: 0,
                  backgroundColor: done
                    ? "#3fb950"
                    : active
                      ? "var(--vscode-button-background)"
                      : "transparent",
                  color: done || active ? "#fff" : "var(--vscode-descriptionForeground)",
                  border: done || active ? "none" : "1px solid var(--vscode-panel-border)",
                }}
              >
                {done ? "\u2713" : i + 1}
              </span>
              <span
                style={{
                  color: active
                    ? "var(--vscode-foreground)"
                    : done
                      ? "#3fb950"
                      : "var(--vscode-descriptionForeground)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {p.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <span className="mx-2" style={{ color: "var(--vscode-panel-border)" }}>
                -
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OutputBox({ output, error }: { output: string; error?: boolean }) {
  if (!output) return null;
  return (
    <pre
      className="text-xs p-3 rounded font-mono whitespace-pre-wrap break-words overflow-auto"
      style={{
        maxHeight: 260,
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        color: error ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)",
        border: "1px solid var(--vscode-panel-border)",
      }}
    >
      {output}
    </pre>
  );
}

export function RunningLabel({ label }: { label: string }) {
  return (
    <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
      {label}...
    </div>
  );
}
