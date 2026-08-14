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
  getFileDiff,
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

function gitStatusLabel(status: FileTreeEntry["git_status"]): string {
  if (status === "modified") return "M";
  if (status === "untracked") return "U";
  return "";
}

function gitStatusTitle(status: FileTreeEntry["git_status"]): string {
  if (status === "modified") return "Modified";
  if (status === "untracked") return "Untracked";
  return "";
}

type DiffRowKind = "same" | "added" | "removed" | "changed";

type DiffRow = {
  key: string;
  kind: DiffRowKind;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
};

type DiffOp = {
  type: "same" | "added" | "removed";
  text: string;
  leftLine: number | null;
  rightLine: number | null;
};

function splitDiffLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function simpleLineDiff(left: string[], right: string[]): DiffRow[] {
  const rowCount = Math.max(left.length, right.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const hasLeft = index < left.length;
    const hasRight = index < right.length;
    const leftText = hasLeft ? left[index] : "";
    const rightText = hasRight ? right[index] : "";
    const same = hasLeft && hasRight && leftText === rightText;
    return {
      key: `simple-${index}`,
      kind: same ? "same" : hasLeft && hasRight ? "changed" : hasLeft ? "removed" : "added",
      leftLine: hasLeft ? index + 1 : null,
      rightLine: hasRight ? index + 1 : null,
      leftText,
      rightText,
    };
  });
}

function flushDiffRows(rows: DiffRow[], removed: DiffOp[], added: DiffOp[]) {
  const rowCount = Math.max(removed.length, added.length);
  for (let index = 0; index < rowCount; index += 1) {
    const left = removed[index];
    const right = added[index];
    rows.push({
      key: `diff-${rows.length}`,
      kind: left && right ? "changed" : left ? "removed" : "added",
      leftLine: left?.leftLine ?? null,
      rightLine: right?.rightLine ?? null,
      leftText: left?.text ?? "",
      rightText: right?.text ?? "",
    });
  }
}

function buildSideBySideDiff(originalContent: string, currentContent: string): DiffRow[] {
  const left = splitDiffLines(originalContent);
  const right = splitDiffLines(currentContent);
  if (left.length * right.length > 400000) return simpleLineDiff(left, right);

  const dp = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      dp[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? dp[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(dp[leftIndex + 1][rightIndex], dp[leftIndex][rightIndex + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
      ops.push({ type: "same", text: left[leftIndex], leftLine: leftIndex + 1, rightLine: rightIndex + 1 });
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex >= right.length || (leftIndex < left.length && dp[leftIndex + 1][rightIndex] >= dp[leftIndex][rightIndex + 1])) {
      ops.push({ type: "removed", text: left[leftIndex], leftLine: leftIndex + 1, rightLine: null });
      leftIndex += 1;
    } else {
      ops.push({ type: "added", text: right[rightIndex], leftLine: null, rightLine: rightIndex + 1 });
      rightIndex += 1;
    }
  }

  const rows: DiffRow[] = [];
  let pendingRemoved: DiffOp[] = [];
  let pendingAdded: DiffOp[] = [];
  for (const op of ops) {
    if (op.type === "same") {
      flushDiffRows(rows, pendingRemoved, pendingAdded);
      pendingRemoved = [];
      pendingAdded = [];
      rows.push({
        key: `same-${rows.length}`,
        kind: "same",
        leftLine: op.leftLine,
        rightLine: op.rightLine,
        leftText: op.text,
        rightText: op.text,
      });
    } else if (op.type === "removed") {
      pendingRemoved.push(op);
    } else {
      pendingAdded.push(op);
    }
  }
  flushDiffRows(rows, pendingRemoved, pendingAdded);
  return rows;
}

function diffCellBackground(kind: DiffRowKind, side: "left" | "right"): string {
  if (kind === "removed" && side === "left") return "rgba(248,81,73,0.16)";
  if (kind === "added" && side === "right") return "rgba(63,185,80,0.16)";
  if (kind === "changed") return side === "left" ? "rgba(248,81,73,0.14)" : "rgba(63,185,80,0.14)";
  return "transparent";
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
  const [viewMode, setViewMode] = useState<"edit" | "diff">("edit");
  const [diffOriginalContent, setDiffOriginalContent] = useState("");
  const [diffCurrentContent, setDiffCurrentContent] = useState("");
  const [diffStatus, setDiffStatus] = useState<FileTreeEntry["git_status"]>(null);
  const [selectedGitStatus, setSelectedGitStatus] = useState<FileTreeEntry["git_status"]>(null);
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
  const diffAvailable = selectedGitStatus === "modified" || selectedGitStatus === "untracked";
  const rootLabel = rootPath.split("/").filter(Boolean).pop() || rootPath || "Home";
  const sortedEntries = useMemo(
    () => entries.slice().sort((a, b) => Number(a.type !== "directory") - Number(b.type !== "directory") || a.name.localeCompare(b.name)),
    [entries]
  );
  const diffRows = useMemo(
    () => buildSideBySideDiff(diffOriginalContent, diffCurrentContent),
    [diffCurrentContent, diffOriginalContent]
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
    setViewMode("edit");
    setDiffOriginalContent("");
    setDiffCurrentContent("");
    setDiffStatus(null);
    setSelectedGitStatus(null);
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
      const shouldClearSearch = searchMode || searchQuery.trim() !== "";
      const response = await readFile(entry.path);
      setSelectedPath(response.path);
      setSelectedEntryPath(response.path);
      setSearchQuery("");
      setSearchMode(false);
      setSearchTruncated(false);
      setViewMode("edit");
      setDiffOriginalContent("");
      setDiffCurrentContent("");
      setDiffStatus(null);
      setSelectedGitStatus(entry.git_status);
      setContent(response.content);
      setOriginalContent(response.content);
      setFileModified(response.modified);
      setFileSize(response.size);
      setReadonly(response.readonly);
      if (shouldClearSearch) {
        await loadDirectory(currentPath, showHidden, false);
        setSelectedEntryPath(response.path);
      }
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
    if (editorOpen) return;
    const timer = window.setTimeout(() => {
      void runSearch(searchQuery, currentPath, showHidden);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [currentPath, editorOpen, runSearch, searchQuery, showHidden]);

  async function showDiff() {
    if (!selectedPath || !diffAvailable) return;
    if (dirty && !window.confirm("Current file has unsaved changes. Show diff anyway?")) return;
    clearNotice();
    setBusy(true);
    try {
      const response = await getFileDiff(selectedPath);
      setDiffOriginalContent(response.original_content);
      setDiffCurrentContent(response.current_content);
      setDiffStatus(response.status);
      setViewMode("diff");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diff");
    } finally {
      setBusy(false);
    }
  }

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
      setViewMode("edit");
      setDiffOriginalContent("");
      setDiffCurrentContent("");
      setDiffStatus(null);
      setSelectedGitStatus(null);
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
        const created = { name: name.trim(), path, type: "file", size: 0, modified: null, readonly: false, hidden: false, symlink: false, git_status: null } as FileTreeEntry;
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
        setViewMode("edit");
        setDiffOriginalContent("");
        setDiffCurrentContent("");
        setDiffStatus(null);
        setSelectedGitStatus(null);
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
        setViewMode("edit");
        setDiffOriginalContent("");
        setDiffCurrentContent("");
        setDiffStatus(null);
        setSelectedGitStatus(null);
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
          {editorOpen && viewMode === "edit" && (
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
                  Close
                </button>
              </div>
            </div>

            {viewMode === "diff" ? (
              <div
                className="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5"
                style={{
                  color: "var(--vscode-foreground)",
                  backgroundColor: "var(--vscode-editor-background)",
                  tabSize: 2,
                }}
              >
                <div className="min-w-[900px]">
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
        )}
      </div>
    </div>
  );
}
