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

import { useMemo } from "react";
import { buildSideBySideDiff, type DiffRowKind } from "@/lib/files/diff";

function diffCellBackground(kind: DiffRowKind, side: "left" | "right"): string {
  if (kind === "removed" && side === "left") return "rgba(248,81,73,0.16)";
  if (kind === "added" && side === "right") return "rgba(63,185,80,0.16)";
  if (kind === "changed") return side === "left" ? "rgba(248,81,73,0.14)" : "rgba(63,185,80,0.14)";
  return "transparent";
}

export function FileDiff({ original, current }: { original: string; current: string }) {
  const diffRows = useMemo(() => buildSideBySideDiff(original, current), [original, current]);
  return (
    <div
      className="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5"
      style={{
        color: "var(--vscode-foreground)",
        backgroundColor: "var(--vscode-editor-background)",
        tabSize: 2,
      }}
    >
      <div className="md:hidden" aria-label="Unified diff">
        {diffRows.map((row, index) => <div key={index}>
          {row.kind !== "same" && row.leftLine != null && <div className="grid grid-cols-[3rem_minmax(0,1fr)]" style={{ background: diffCellBackground(row.kind, "left") }}><span className="px-1 text-right select-none">−{row.leftLine}</span><pre className="px-2 whitespace-pre-wrap break-all">{row.leftText}</pre></div>}
          {row.rightLine != null && <div className="grid grid-cols-[3rem_minmax(0,1fr)]" style={{ background: diffCellBackground(row.kind, "right") }}><span className="px-1 text-right select-none">{row.kind === "same" ? "" : "+"}{row.rightLine}</span><pre className="px-2 whitespace-pre-wrap break-all">{row.rightText}</pre></div>}
        </div>)}
      </div>
      <div className="hidden md:block min-w-[900px]">
        <div
          className="sticky top-0 z-10 grid grid-cols-[4rem_minmax(0,1fr)_4rem_minmax(0,1fr)] border-b"
          style={{
            color: "var(--vscode-descriptionForeground)",
            backgroundColor: "var(--vscode-editor-background)",
            borderColor: "var(--vscode-panel-border)",
          }}
        >
          <div className="px-2 py-1 text-right select-none">Old</div>
          <div className="min-w-0 px-2 py-1 border-r" style={{ borderColor: "var(--vscode-panel-border)" }}>Original</div>
          <div className="px-2 py-1 text-right select-none">New</div>
          <div className="min-w-0 px-2 py-1">Current</div>
        </div>
        {diffRows.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
            No changes
          </div>
        ) : diffRows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[4rem_minmax(0,1fr)_4rem_minmax(0,1fr)]"
          >
            <div
              className="px-2 text-right select-none"
              style={{
                color: "var(--vscode-descriptionForeground)",
                backgroundColor: diffCellBackground(row.kind, "left"),
              }}
            >
              {row.leftLine ?? ""}
            </div>
            <div
              className="min-w-0 px-2 whitespace-pre-wrap break-words border-r"
              style={{
                backgroundColor: diffCellBackground(row.kind, "left"),
                borderColor: "var(--vscode-panel-border)",
              }}
            >
              {row.leftText}
            </div>
            <div
              className="px-2 text-right select-none"
              style={{
                color: "var(--vscode-descriptionForeground)",
                backgroundColor: diffCellBackground(row.kind, "right"),
              }}
            >
              {row.rightLine ?? ""}
            </div>
            <div
              className="min-w-0 px-2 whitespace-pre-wrap break-words"
              style={{ backgroundColor: diffCellBackground(row.kind, "right") }}
            >
              {row.rightText}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
