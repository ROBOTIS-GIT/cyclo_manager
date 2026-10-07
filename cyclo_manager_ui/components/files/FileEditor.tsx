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
import { fileLanguage, formatBytes, formatTime, gitStatusTitle } from "@/lib/files/format";
import { FileDiff } from "./FileDiff";

export function FileEditor({
  selectedPath, dirty, fileSize, fileModified, readonly, viewMode,
  diffAvailable, showDiff, busy, setViewMode, closeEditor, content,
  setContent, diffOriginalContent, diffCurrentContent, diffStatus,
}: FileWorkspace["editor"]) {
  return (
    <section className="min-w-0 min-h-0 flex flex-col" style={{ backgroundColor: "var(--vscode-editor-background)" }}>
      <div className="min-h-11 px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0" style={{ borderColor: "var(--vscode-panel-border)" }}>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: "var(--vscode-foreground)" }}>
            {selectedPath} {dirty ? "*" : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
          <span>{fileLanguage(selectedPath)}</span>
          {fileSize != null && <span>{formatBytes(fileSize)}</span>}
          {fileModified != null && <span className="hidden lg:inline">{formatTime(fileModified)}</span>}
          {readonly && <span style={{ color: "var(--vscode-warningForeground)" }}>Read only</span>}
          {viewMode === "edit" && (
            <button
              type="button"
              title={diffAvailable ? "Show diff" : "No git changes"}
              aria-label="Show diff"
              onClick={showDiff}
              disabled={!diffAvailable || busy}
              className="h-7 px-2 rounded text-xs font-semibold disabled:cursor-not-allowed"
              style={{
                color: "var(--vscode-foreground)",
                backgroundColor: "var(--vscode-button-secondaryBackground)",
                border: "1px solid var(--vscode-panel-border)",
                opacity: !diffAvailable || busy ? 0.45 : 1,
              }}
            >
              Diff
            </button>
          )}
          {viewMode === "diff" && (
            <button
              type="button"
              title="Back to edit"
              aria-label="Back to edit"
              onClick={() => setViewMode("edit")}
              className="h-7 px-2 rounded text-xs font-semibold"
              style={{
                color: "var(--vscode-foreground)",
                backgroundColor: "var(--vscode-button-secondaryBackground)",
                border: "1px solid var(--vscode-panel-border)",
              }}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            title="Close"
            aria-label="Close file"
            onClick={closeEditor}
            className="h-7 px-2 rounded text-xs font-semibold"
            style={{
              color: "var(--vscode-foreground)",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              border: "1px solid var(--vscode-panel-border)",
            }}
          >
            <span className="md:hidden">← Files</span><span className="hidden md:inline">Close</span>
          </button>
        </div>
      </div>

      {viewMode === "diff" ? (
        <FileDiff original={diffOriginalContent} current={diffCurrentContent} />
      ) : (
        <textarea
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          spellCheck={false}
          readOnly={readonly || busy}
          className="flex-1 min-h-0 w-full resize-none p-4 outline-none font-mono text-sm leading-6"
          style={{
            color: "var(--vscode-foreground)",
            backgroundColor: "var(--vscode-editor-background)",
            border: "none",
            tabSize: 2,
          }}
        />
      )}

      <div className="h-8 px-4 border-t flex items-center justify-between text-xs" style={{ borderColor: "var(--vscode-panel-border)", color: "var(--vscode-descriptionForeground)" }}>
        <span className="truncate">{selectedPath}</span>
        <span>{busy ? "Working..." : viewMode === "diff" ? gitStatusTitle(diffStatus) : dirty ? "Unsaved changes" : "Ready"}</span>
      </div>
    </section>
  );
}
