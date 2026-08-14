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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createFilePath,
  deleteFilePath,
  getFileTree,
  readFile,
  renameFilePath,
  searchFiles,
  writeFile,
} from "@/lib/api";
import type { FileTreeEntry } from "@/types/api";

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function formatBytes(size: number | null): string {
  if (size == null) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function formatTime(value: number | null): string {
  if (value == null) return "";
  return new Date(value * 1000).toLocaleString();
}

function fileLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "TypeScript";
  if (lower.endsWith(".py")) return "Python";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "YAML";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".xml")) return "XML";
  if (lower.endsWith(".md")) return "Markdown";
  if (lower.endsWith(".sh")) return "Shell";
  if (lower.endsWith(".css")) return "CSS";
  if (lower.endsWith(".html")) return "HTML";
  return "Text";
}

function ToolbarButton({
  children,
  disabled,
  onClick,
  title,
  primary = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="h-8 px-3 rounded border text-xs font-semibold disabled:cursor-not-allowed"
      style={{
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

export default function FilesPage() {
  const [rootPath, setRootPath] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileModified, setFileModified] = useState<number | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [readonly, setReadonly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const dirty = selectedPath !== "" && content !== originalContent;
  const editorOpen = selectedPath !== "";
  const rootLabel = rootPath.split("/").filter(Boolean).pop() || rootPath || "Home";
  const sortedEntries = useMemo(
    () => entries.slice().sort((a, b) => Number(a.type !== "directory") - Number(b.type !== "directory") || a.name.localeCompare(b.name)),
    [entries]
  );
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
    }));
  }, [currentPath]);

  const clearNotice = useCallback(() => {
    setError("");
    setMessage("");
  }, []);

  const confirmDirty = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("Current file has unsaved changes. Continue?");
  }, [dirty]);

  const clearEditor = useCallback(() => {
    setSelectedPath("");
    setContent("");
    setOriginalContent("");
    setFileModified(null);
    setFileSize(null);
    setReadonly(false);
  }, []);

  const loadDirectory = useCallback(async (
    targetPath: string,
    showHiddenValue: boolean,
    clearOpenFile: boolean = true
  ) => {
    clearNotice();
    setLoading(true);
    try {
      const response = await getFileTree(targetPath, showHiddenValue);
      setRootPath(response.root_path);
      setCurrentPath(response.path);
      setEntries(response.entries);
      setSelectedEntryPath("");
      setSearchMode(false);
      setSearchTruncated(false);
      if (clearOpenFile) clearEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, [clearEditor, clearNotice]);

  useEffect(() => {
    loadDirectory("", false);
  }, [loadDirectory]);

  async function openDirectory(path: string) {
    if (!confirmDirty()) return;
    await loadDirectory(path, showHidden);
  }

  async function openRoot() {
    if (!confirmDirty()) return;
    await loadDirectory("", showHidden);
  }

  async function openFile(entry: FileTreeEntry) {
    if (!confirmDirty()) return;
    clearNotice();
    setBusy(true);
    try {
      const response = await readFile(entry.path);
      setSelectedPath(response.path);
      setSelectedEntryPath(response.path);
      setContent(response.content);
      setOriginalContent(response.content);
      setFileModified(response.modified);
      setFileSize(response.size);
      setReadonly(response.readonly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open file");
    } finally {
      setBusy(false);
    }
  }

  const runSearch = useCallback(async (queryValue: string, pathValue: string, showHiddenValue: boolean) => {
    const query = queryValue.trim();
    if (!query) {
      setSearchMode(false);
      setSearchTruncated(false);
      await loadDirectory(pathValue, showHiddenValue, false);
      return;
    }
    clearNotice();
    setSearching(true);
    setLoading(true);
    try {
      const response = await searchFiles(pathValue, query, showHiddenValue);
      setEntries(response.entries);
      setSearchMode(true);
      setSearchTruncated(response.truncated);
      setSelectedEntryPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search files");
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [clearNotice, loadDirectory]);

  async function clearSearch() {
    setSearchQuery("");
    setSearchMode(false);
    setSearchTruncated(false);
    await loadDirectory(currentPath, showHidden, false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(searchQuery, currentPath, showHidden);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [currentPath, runSearch, searchQuery, showHidden]);

  async function saveFile() {
    if (!selectedPath || readonly) return;
    clearNotice();
    setBusy(true);
    try {
      await writeFile(selectedPath, content, fileModified);
      const response = await readFile(selectedPath);
      setContent(response.content);
      setOriginalContent(response.content);
      setFileModified(response.modified);
      setFileSize(response.size);
      setReadonly(response.readonly);
      await loadDirectory(currentPath, showHidden, false);
      setSelectedPath(response.path);
      setContent(response.content);
      setOriginalContent(response.content);
      setMessage("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setBusy(false);
    }
  }

  async function createItem(type: "file" | "directory") {
    clearNotice();
    const label = type === "file" ? "file" : "folder";
    const name = window.prompt(`New ${label} name`);
    if (!name) return;
    const path = joinPath(currentPath, name.trim());
    setBusy(true);
    try {
      await createFilePath(path, type);
      await loadDirectory(currentPath, showHidden);
      setMessage(type === "file" ? "File created" : "Folder created");
      if (type === "file") {
        const created = { name: name.trim(), path, type: "file", size: 0, modified: null, readonly: false, hidden: false, symlink: false } as FileTreeEntry;
        await openFile(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to create ${label}`);
    } finally {
      setBusy(false);
    }
  }

  async function renameItem(entry: FileTreeEntry) {
    clearNotice();
    const newName = window.prompt("Rename", entry.name);
    if (!newName || newName === entry.name) return;
    setBusy(true);
    try {
      const response = await renameFilePath(entry.path, newName.trim());
      await loadDirectory(currentPath, showHidden);
      if (selectedPath === entry.path) {
        setSelectedPath(response.path);
        setSelectedEntryPath(response.path);
        if (entry.type === "file") {
          const renamed = await readFile(response.path);
          setContent(renamed.content);
          setOriginalContent(renamed.content);
          setFileModified(renamed.modified);
          setFileSize(renamed.size);
          setReadonly(renamed.readonly);
        }
      }
      setMessage("Renamed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(entry: FileTreeEntry) {
    clearNotice();
    const recursive = entry.type === "directory";
    const confirmed = window.confirm(`Delete ${entry.name}?`);
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteFilePath(entry.path, recursive);
      await loadDirectory(currentPath, showHidden);
      if (selectedPath === entry.path || selectedPath.startsWith(`${entry.path}/`)) {
        setSelectedEntryPath("");
        setSelectedPath("");
        setContent("");
        setOriginalContent("");
        setFileModified(null);
        setFileSize(null);
        setReadonly(false);
      }
      setMessage("Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  function closeEditor() {
    if (!confirmDirty()) return;
    clearEditor();
  }

  async function openEntry(entry: FileTreeEntry) {
    if (entry.type === "directory") {
      await openDirectory(entry.path);
    } else {
      await openFile(entry);
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="flex items-center justify-end gap-4 pb-3">
        <div className="flex items-center gap-2 shrink-0">
          <label className="h-8 flex items-center gap-2 px-2 text-xs" style={{ color: "var(--vscode-foreground)" }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setShowHidden(checked);
                loadDirectory(currentPath, checked, false);
              }}
              style={{ accentColor: "var(--vscode-focusBorder)" }}
            />
            <span>Show hidden</span>
          </label>
          <ToolbarButton onClick={() => createItem("file")} disabled={busy}>New File</ToolbarButton>
          <ToolbarButton onClick={() => createItem("directory")} disabled={busy}>New Folder</ToolbarButton>
          <ToolbarButton onClick={() => loadDirectory(currentPath, showHidden, false)} disabled={loading}>Refresh</ToolbarButton>
          {editorOpen && (
            <ToolbarButton onClick={saveFile} disabled={!dirty || readonly || busy} primary>Save</ToolbarButton>
          )}
        </div>
      </div>

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
        className={`flex-1 min-h-0 grid ${editorOpen ? "grid-cols-[320px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"} border overflow-hidden`}
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <aside
          className={`min-w-0 min-h-0 flex flex-col ${editorOpen ? "border-r" : ""}`}
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
            ) : sortedEntries.map((entry) => {
              const active = selectedEntryPath === entry.path;
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
                    }}
                    onDoubleClick={() => {
                      void openEntry(entry);
                    }}
                    className="min-w-0 px-3 py-2 text-left"
                    style={{ color: active ? "var(--vscode-foreground)" : "var(--vscode-foreground)", background: "transparent", border: "none" }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base leading-none shrink-0" aria-hidden>
                        {entry.type === "directory" ? "📁" : "📄"}
                      </span>
                      <span className="truncate text-sm">{entry.name}</span>
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

        {editorOpen && (
          <section className="min-w-0 min-h-0 flex flex-col" style={{ backgroundColor: "var(--vscode-editor-background)" }}>
            <div className="h-10 px-4 border-b flex items-center justify-between gap-3" style={{ borderColor: "var(--vscode-panel-border)" }}>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--vscode-foreground)" }}>
                  {selectedPath} {dirty ? "*" : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs shrink-0" style={{ color: "var(--vscode-descriptionForeground)" }}>
                <span>{fileLanguage(selectedPath)}</span>
                {fileSize != null && <span>{formatBytes(fileSize)}</span>}
                {fileModified != null && <span>{formatTime(fileModified)}</span>}
                {readonly && <span style={{ color: "var(--vscode-warningForeground)" }}>Read only</span>}
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
                  Close
                </button>
              </div>
            </div>

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

            <div className="h-8 px-4 border-t flex items-center justify-between text-xs" style={{ borderColor: "var(--vscode-panel-border)", color: "var(--vscode-descriptionForeground)" }}>
              <span className="truncate">{selectedPath}</span>
              <span>{busy ? "Working..." : dirty ? "Unsaved changes" : "Ready"}</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
