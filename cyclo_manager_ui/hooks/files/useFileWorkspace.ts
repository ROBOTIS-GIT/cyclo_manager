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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createFilePath, deleteFilePath, getFileDiff, getFileTree, readFile,
  renameFilePath, searchFiles, writeFile,
} from "@/lib/api";
import type { FileTreeEntry } from "@/types/api";
import { joinPath } from "@/lib/files/format";
import { useFileUpload } from "./useFileUpload";

export function useFileWorkspace() {
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
  const searchModeRef = useRef(false);
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
      return response;
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
    searchModeRef.current = searchMode;
  }, [searchMode]);

  useEffect(() => {
    if (editorOpen) return;
    // An empty query only needs to run while results are on screen, so that clearing
    // the box restores the listing without re-fetching on every directory change.
    // searchMode is read through a ref so flipping it does not re-trigger the search.
    if (!searchQuery.trim() && !searchModeRef.current) return;
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
      const directory = await loadDirectory(currentPath, showHidden, false);
      setSelectedPath(response.path);
      setContent(response.content);
      setOriginalContent(response.content);
      setViewMode("edit");
      setDiffOriginalContent("");
      setDiffCurrentContent("");
      setDiffStatus(null);
      const savedEntry = directory?.entries.find((entry) => entry.path === response.path);
      setSelectedGitStatus(savedEntry?.git_status ?? null);
      setMessage("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setBusy(false);
    }
  }

  async function createItem(type: "file" | "directory") {
    if (!confirmDirty()) return;
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
    if (!confirmDirty()) return;
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
    if (!confirmDirty()) return;
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
        clearEditor();
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

  const upload = useFileUpload({
    currentPath, showHidden, loadDirectory, clearNotice, setError, setMessage,
  });
  const { uploading } = upload;

  function changeShowHidden(checked: boolean) {
    setShowHidden(checked);
    void loadDirectory(currentPath, checked, false);
  }

  function refresh() {
    void loadDirectory(currentPath, showHidden, false);
  }

  return {
    editorOpen,
    notice: { error, message },
    upload: { ...upload, destination: currentPath || rootLabel },
    toolbar: {
      showHidden, changeShowHidden, createItem, refresh, busy, uploading,
      loading, editorOpen, viewMode, saveFile, dirty, readonly,
    },
    browser: {
      editorOpen, openRoot, rootLabel, breadcrumbs, openDirectory, searchQuery,
      setSearchQuery, clearSearch, searchMode, searching, searchTruncated,
      currentPath, loading, uploading, sortedEntries, selectedEntryPath,
      setSelectedEntryPath, openEntry, renameItem, deleteItem,
    },
    editor: {
      selectedPath, dirty, fileSize, fileModified, readonly, viewMode,
      diffAvailable, showDiff, busy, setViewMode, closeEditor, content,
      setContent, diffOriginalContent, diffCurrentContent, diffStatus,
    },
  };
}

export type FileWorkspace = ReturnType<typeof useFileWorkspace>;
