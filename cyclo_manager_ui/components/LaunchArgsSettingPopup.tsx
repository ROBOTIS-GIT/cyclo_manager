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

import type { LaunchArgDef, LaunchArgsConfig } from "@/config/launchArgs";
import { getDefaultArgs } from "@/config/launchArgs";

const CUSTOM_SELECT_VALUE = "__custom__";

function getSelectMode(def: LaunchArgDef, value: string): string {
  if (value === def.default) return def.default;
  const preset = def.selectOptions?.find((option) => option.value === value);
  if (preset && preset.value !== CUSTOM_SELECT_VALUE) {
    return preset.value;
  }
  return CUSTOM_SELECT_VALUE;
}

function handleSelectModeChange(
  def: LaunchArgDef,
  mode: string,
  currentValue: string,
  update: (key: string, value: string) => void
) {
  if (mode === CUSTOM_SELECT_VALUE) {
    if (getSelectMode(def, currentValue) !== CUSTOM_SELECT_VALUE) {
      update(def.key, "");
    }
    return;
  }
  update(def.key, mode);
}

export interface LaunchArgsSettingPopupProps {
  open: boolean;
  onClose: () => void;
  config: LaunchArgsConfig;
  args: Record<string, string>;
  onChange: (args: Record<string, string>) => void;
}

export default function LaunchArgsSettingPopup({
  open,
  onClose,
  config,
  args,
  onChange,
}: LaunchArgsSettingPopupProps) {
  if (!open) return null;

  const update = (key: string, value: string) => {
    onChange({ ...args, [key]: value });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    fontSize: "12px",
    borderRadius: "4px",
    border: "1px solid var(--vscode-input-border)",
    backgroundColor: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 500,
    color: "var(--vscode-descriptionForeground)",
    marginBottom: "4px",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  };

  const boolRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "6px 0",
  };

  const boolOptionStyle = (selected: boolean): React.CSSProperties => ({
    padding: "4px 12px",
    fontSize: "12px",
    borderRadius: "4px",
    border: `1px solid ${selected ? "var(--vscode-focusBorder, #007acc)" : "var(--vscode-input-border)"}`,
    backgroundColor: selected ? "var(--vscode-button-background)" : "var(--vscode-input-background)",
    color: selected ? "var(--vscode-button-foreground)" : "var(--vscode-input-foreground)",
    cursor: "pointer",
    minWidth: "56px",
    textAlign: "center" as const,
  });

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: "none",
    paddingRight: "28px",
  };

  const defaultArgs = getDefaultArgs(config);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="rounded-lg overflow-hidden shadow-xl max-h-[80vh] overflow-y-auto"
        style={{
          backgroundColor: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)",
          minWidth: "420px",
          maxWidth: "90vw",
        }}
      >
        <div
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <span
            className="font-semibold text-sm"
            style={{ color: "var(--vscode-foreground)" }}
          >
            {config.title}
          </span>
          <button
            onClick={onClose}
            className="text-lg leading-none px-2 py-1 rounded hover:opacity-80"
            style={{ color: "var(--vscode-foreground)" }}
          >
            ×
          </button>
        </div>
        <div className="p-4 space-y-2">
              {config.args.map((def) => {
                const val = args[def.key] ?? def.default;
                const selectMode = def.type === "select" ? getSelectMode(def, val) : null;
                return (
                  <div key={def.key} style={def.type === "bool" ? boolRowStyle : rowStyle}>
                    {def.type === "bool" ? (
                      <>
                        <span style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>{def.label}</span>
                        <button type="button" onClick={() => update(def.key, "true")} style={boolOptionStyle(val === "true")}>
                          true
                        </button>
                        <button type="button" onClick={() => update(def.key, "false")} style={boolOptionStyle(val === "false")}>
                          false
                        </button>
                      </>
                    ) : def.type === "select" && def.selectOptions ? (
                      <>
                        <label style={labelStyle}>{def.label}</label>
                        <select
                          value={selectMode ?? def.default}
                          onChange={(e) => handleSelectModeChange(def, e.target.value, val, update)}
                          style={selectStyle}
                        >
                          {def.selectOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {selectMode === CUSTOM_SELECT_VALUE && (
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => update(def.key, e.target.value)}
                            placeholder="Enter file name"
                            style={inputStyle}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <label style={labelStyle}>{def.label}</label>
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => update(def.key, e.target.value)}
                          style={inputStyle}
                        />
                      </>
                    )}
                  </div>
                );
              })}
        </div>
        <div
          className="px-4 py-3 border-t flex justify-end gap-2"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <button
            onClick={() => onChange({ ...defaultArgs })}
            className="px-3 py-1.5 text-sm rounded"
            style={{
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
            }}
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded"
            style={{
              backgroundColor: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
