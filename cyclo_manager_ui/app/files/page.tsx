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

import { FileEditor } from "@/components/files/FileEditor";
import { FileExplorer } from "@/components/files/FileExplorer";
import { FileToolbar } from "@/components/files/FileToolbar";
import { useFileWorkspace } from "@/hooks/files/useFileWorkspace";

export default function FilesPage() {
  const { editorOpen, notice: { error, message }, upload, toolbar, browser, editor } = useFileWorkspace();

  return (
    <div
      className="relative h-full min-h-0 flex flex-col overflow-hidden"
      onDragEnter={upload.handleDragEnter}
      onDragOver={upload.handleDragOver}
      onDragLeave={upload.handleDragLeave}
      onDrop={upload.handleDrop}
    >
      {upload.draggingFiles && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed"
          style={{
            color: "var(--vscode-textLink-foreground)",
            backgroundColor: "rgba(31,111,235,0.12)",
            borderColor: "var(--vscode-focusBorder)",
          }}
        >
          <div
            className="px-4 py-3 rounded border text-sm font-semibold"
            style={{
              color: "var(--vscode-foreground)",
              backgroundColor: "var(--vscode-editor-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            Drop files to upload to {upload.destination}
          </div>
        </div>
      )}
      <FileToolbar {...toolbar} />

      {(error || message) && (
        <div
          className="mb-3 px-3 py-2 rounded border text-sm"
          style={{
            color: error ? "var(--vscode-errorForeground)" : "var(--vscode-successForeground)",
            borderColor: error ? "rgba(244,135,113,0.35)" : "rgba(137,209,133,0.35)",
            backgroundColor: error ? "rgba(244,135,113,0.1)" : "rgba(137,209,133,0.1)",
          }}
        >
          {error || message}
        </div>
      )}

      <div
        className={`flex-1 min-h-0 grid ${editorOpen ? "grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"} border overflow-hidden`}
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <FileExplorer {...browser} />
        {editorOpen && <FileEditor {...editor} />}
      </div>
    </div>
  );
}
