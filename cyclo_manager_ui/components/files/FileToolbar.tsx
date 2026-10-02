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

import type { FileWorkspace } from "@/hooks/files/useFileWorkspace";

function ToolbarButton({
  children,
  disabled,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 px-1.5 md:px-3 rounded border text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed"
      style={{
        minHeight: 32,
        minWidth: 0,
        color: primary ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)",
        backgroundColor: primary ? "var(--vscode-button-background)" : "var(--vscode-button-secondaryBackground)",
        borderColor: "var(--vscode-panel-border)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function FileToolbar({
  showHidden, changeShowHidden, createItem, refresh, busy, uploading,
  loading, editorOpen, viewMode, saveFile, dirty, readonly,
}: FileWorkspace["toolbar"]) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pb-3 shrink-0">
      <div className="flex items-center gap-1 md:gap-2 w-full md:w-auto">
        <label className="h-8 flex items-center gap-1 md:gap-2 md:px-2 text-[11px] md:text-xs whitespace-nowrap shrink-0" style={{ color: "var(--vscode-foreground)" }}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => changeShowHidden(event.currentTarget.checked)}
            style={{ accentColor: "var(--vscode-focusBorder)" }}
          />
          <span>Show hidden</span>
        </label>
        <div className="flex items-center justify-end gap-1 md:gap-2 flex-1 md:flex-none">
          <ToolbarButton onClick={() => createItem("file")} disabled={busy || uploading}>New File</ToolbarButton>
          <ToolbarButton onClick={() => createItem("directory")} disabled={busy || uploading}>New Folder</ToolbarButton>
          <ToolbarButton onClick={refresh} disabled={loading || uploading}>Refresh</ToolbarButton>
        </div>
      </div>
      {editorOpen && viewMode === "edit" && (
        <ToolbarButton onClick={saveFile} disabled={!dirty || readonly || busy || uploading} primary>Save</ToolbarButton>
      )}
    </div>
  );
}
