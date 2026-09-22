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
import { gitStatusLabel, gitStatusTitle, parentPath } from "@/lib/files/format";

export function FileExplorer({
  editorOpen, openRoot, rootLabel, breadcrumbs, openDirectory, searchQuery,
  setSearchQuery, clearSearch, searchMode, searching, searchTruncated,
  currentPath, loading, uploading, sortedEntries, selectedEntryPath,
  setSelectedEntryPath, openEntry, renameItem, deleteItem,
}: FileWorkspace["browser"]) {
  return (
    <aside
      className={`min-w-0 min-h-0 flex-col ${editorOpen ? "hidden md:flex md:border-r" : "flex"}`}
      style={{ backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}
    >
      <div className="px-3 py-2 border-b flex items-center gap-1 overflow-x-auto" style={{ borderColor: "var(--vscode-panel-border)" }}>
        <div className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={openRoot}
            className="text-xs font-semibold rounded px-1.5 py-1"
            style={{ color: "var(--vscode-textLink-foreground)", background: "transparent", border: "none" }}
          >
            {rootLabel}
          </button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-1 shrink-0">
              <span className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>/</span>
              <button
                type="button"
                onClick={() => openDirectory(crumb.path)}
                className="text-xs rounded px-1.5 py-1"
                style={{ color: "var(--vscode-textLink-foreground)", background: "transparent", border: "none" }}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        {!editorOpen && (
          <>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") void clearSearch();
              }}
              placeholder="Search"
              className="w-40 h-7 rounded border px-2 text-xs shrink-0"
              style={{
                color: "var(--vscode-input-foreground)",
                backgroundColor: "var(--vscode-input-background)",
                borderColor: "var(--vscode-input-border)",
              }}
            />
            {searchMode && (
              <button
                type="button"
                title="Clear search"
                onClick={() => void clearSearch()}
                disabled={searching}
                className="h-7 px-2 rounded text-xs shrink-0"
                style={{
                  color: "var(--vscode-descriptionForeground)",
                  background: "transparent",
                  border: "1px solid var(--vscode-panel-border)",
                }}
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      {searchMode && (
        <div
          className="px-3 py-1.5 border-b text-xs"
          style={{
            borderColor: "var(--vscode-panel-border)",
            color: searchTruncated ? "var(--vscode-warningForeground)" : "var(--vscode-descriptionForeground)",
          }}
        >
          Search results for &quot;{searchQuery}&quot;{searchTruncated ? " (truncated)" : ""}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {currentPath && !searchMode && (
          <button
            type="button"
            onClick={() => openDirectory(parentPath(currentPath))}
            className="w-full px-3 py-2 text-left text-sm border-b"
            style={{ color: "var(--vscode-foreground)", borderColor: "var(--vscode-panel-border)", background: "transparent" }}
          >
            ../
          </button>
        )}
        {loading ? (
          <div className="p-3 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading...</div>
        ) : uploading ? (
          <div className="p-3 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Uploading...</div>
        ) : sortedEntries.map((entry) => {
          const active = selectedEntryPath === entry.path;
          const gitLabel = gitStatusLabel(entry.git_status);
          return (
            <div
              key={entry.path}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center border-b"
              style={{
                borderColor: "var(--vscode-panel-border)",
                backgroundColor: active ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedEntryPath(entry.path);
                  if (window.matchMedia("(max-width: 767px), (pointer: coarse)").matches) void openEntry(entry);
                }}
                onDoubleClick={() => {
                  if (!window.matchMedia("(max-width: 767px), (pointer: coarse)").matches) void openEntry(entry);
                }}
                className="min-w-0 px-3 py-2 text-left"
                style={{ color: "var(--vscode-foreground)", background: "transparent", border: "none" }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base leading-none shrink-0" aria-hidden>
                    {entry.type === "directory" ? "📁" : "📄"}
                  </span>
                  <span className="truncate text-sm">{entry.name}</span>
                  {gitLabel && (
                    <span
                      title={gitStatusTitle(entry.git_status)}
                      className="h-4 min-w-4 px-1 rounded text-[10px] font-semibold leading-4 text-center shrink-0"
                      style={{
                        color: entry.git_status === "modified" ? "var(--vscode-warningForeground)" : "var(--vscode-textLink-foreground)",
                        backgroundColor: entry.git_status === "modified" ? "rgba(255,193,7,0.12)" : "rgba(88,166,255,0.12)",
                      }}
                    >
                      {gitLabel}
                    </span>
                  )}
                  {entry.readonly && <span className="text-[10px] shrink-0" style={{ color: "var(--vscode-warningForeground)" }}>RO</span>}
                </div>
                {searchMode && (
                  <div className="text-[11px] truncate mt-0.5 pl-7" style={{ color: "var(--vscode-descriptionForeground)" }}>
                    {entry.path}
                  </div>
                )}
              </button>
              <div className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  title="Rename"
                  onClick={() => renameItem(entry)}
                  className="h-7 px-2 rounded text-[11px]"
                  style={{ color: "var(--vscode-descriptionForeground)", background: "transparent", border: "none" }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => deleteItem(entry)}
                  className="h-7 px-2 rounded text-[11px]"
                  style={{ color: "var(--vscode-errorForeground)", background: "transparent", border: "none" }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {!loading && sortedEntries.length === 0 && (
          <div className="p-3 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
            Empty folder
          </div>
        )}
      </div>
    </aside>
  );
}
