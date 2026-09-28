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
import type { FileReadResponse, FileTreeEntry } from "@/types/api";
import { joinPath } from "@/lib/files/format";
import { useFileUpload } from "./useFileUpload";

export type FileRequest = { signal: AbortSignal; isCurrent: () => boolean };
type Operation = "directory" | "search" | "editor" | "mutation" | "upload";

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
  const [activity, setActivity] = useState<Operation | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const searchModeRef = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<{ controller: AbortController; exclusive: boolean } | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const busy = activity !== null;
  const loading = activity === "directory" || activity === "search";
  const searching = activity === "search";
  const uploading = activity === "upload";
  const dirty = selectedPath !== "" && content !== originalContent;
  const editorOpen = selectedPath !== "";
  const diffAvailable = selectedGitStatus === "modified" || selectedGitStatus === "untracked";
  const rootLabel = rootPath.split("/").filter(Boolean).pop() || rootPath || "Home";
  const sortedEntries = useMemo(
    () => entries.slice().sort((a, b) => Number(a.type !== "directory") - Number(b.type !== "directory") || a.name.localeCompare(b.name)),
    [entries]
  );
  const breadcrumbs = useMemo(() => currentPath.split("/").filter(Boolean).map((part, index, parts) => ({
    label: part, path: parts.slice(0, index + 1).join("/"),
  })), [currentPath]);

  const cancelRead = useCallback(() => {
    if (requestRef.current?.exclusive) return false;
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setActivity(null);
    return true;
  }, []);

  // Navigation supersedes reads; mutations keep one stable selection until finished.
  const runOperation = useCallback(async (kind: Operation, work: (request: FileRequest) => Promise<void>) => {
    if (!cancelRead()) return;
    const current = { controller: new AbortController(), exclusive: kind === "mutation" || kind === "upload" };
    requestRef.current = current;
    const request = { signal: current.controller.signal,
      isCurrent: () => requestRef.current === current && !current.controller.signal.aborted };
    setActivity(kind); setError(""); setMessage("");
    try {
      await work(request);
    } catch (err) {
      if (request.isCurrent()) setError(err instanceof Error ? err.message : "File operation failed");
    } finally {
      if (request.isCurrent()) { requestRef.current = null; setActivity(null); }
    }
  }, [cancelRead]);

  const confirmDirty = () => !dirty || window.confirm("Current file has unsaved changes. Continue?");
  const clearDiff = useCallback(() => {
    setViewMode("edit"); setDiffOriginalContent(""); setDiffCurrentContent(""); setDiffStatus(null);
  }, []);
  const clearEditor = useCallback(() => {
    setSelectedPath(""); setContent(""); setOriginalContent(""); clearDiff();
    setSelectedGitStatus(null); setFileModified(null); setFileSize(null); setReadonly(false);
  }, [clearDiff]);
  const applyFile = (response: FileReadResponse, gitStatus: FileTreeEntry["git_status"] = null) => {
    setSelectedPath(response.path); setSelectedEntryPath(response.path);
    setContent(response.content); setOriginalContent(response.content);
    setFileModified(response.modified); setFileSize(response.size); setReadonly(response.readonly);
    setSelectedGitStatus(gitStatus); clearDiff();
  };

  const readDirectory = useCallback(async (
    request: FileRequest, path: string, hidden: boolean, clearOpenFile = true,
  ) => {
    const response = await getFileTree(path, hidden, request.signal);
    if (!request.isCurrent()) return;
    setRootPath(response.root_path); setCurrentPath(response.path); setEntries(response.entries);
    setSelectedEntryPath(""); setSearchMode(false); setSearchTruncated(false);
    if (clearOpenFile) clearEditor();
    return response;
  }, [clearEditor]);
  const loadDirectory = useCallback((path: string, hidden: boolean, clearOpenFile = true) =>
    runOperation("directory", async request => { await readDirectory(request, path, hidden, clearOpenFile); }),
  [readDirectory, runOperation]);

  useEffect(() => {
    void loadDirectory("", false);
    return () => {
      if (searchTimer.current !== null) clearTimeout(searchTimer.current);
      requestRef.current?.controller.abort(); requestRef.current = null;
    };
  }, [loadDirectory]);

  async function openDirectory(path: string) {
    if (requestRef.current?.exclusive || !confirmDirty()) return;
    setSearchQuery(""); setSearchMode(false); setSearchTruncated(false);
    await loadDirectory(path, showHidden);
  }
  const openRoot = () => openDirectory("");

  async function openFile(entry: FileTreeEntry) {
    if (requestRef.current?.exclusive || !confirmDirty()) return;
    await runOperation("editor", async request => {
      const shouldClearSearch = searchMode || searchQuery.trim() !== "";
      setSearchQuery(""); setSearchMode(false);
      const response = await readFile(entry.path, request.signal);
      if (!request.isCurrent()) return;
      if (shouldClearSearch) await readDirectory(request, currentPath, showHidden, false);
      if (!request.isCurrent()) return;
      setSearchTruncated(false); applyFile(response, entry.git_status);
    });
  }

  const runSearch = useCallback((queryValue: string, path: string, hidden: boolean) =>
    runOperation("search", async request => {
      const query = queryValue.trim();
      if (!query) { await readDirectory(request, path, hidden, false); return; }
      const response = await searchFiles(path, query, hidden, 200, request.signal);
      if (!request.isCurrent()) return;
      setEntries(response.entries); setSearchMode(true);
      setSearchTruncated(response.truncated); setSelectedEntryPath("");
    }), [readDirectory, runOperation]);

  function changeSearchQuery(value: string) {
    if (!cancelRead()) return;
    setSearchQuery(value);
  }
  async function clearSearch() {
    if (!cancelRead()) return;
    setSearchQuery(""); setSearchMode(false); setSearchTruncated(false);
    await loadDirectory(currentPath, showHidden, false);
  }
  useEffect(() => { searchModeRef.current = searchMode; }, [searchMode]);
  useEffect(() => {
    if (editorOpen || (!searchQuery.trim() && !searchModeRef.current)) return;
    searchTimer.current = setTimeout(() => { void runSearch(searchQuery, currentPath, showHidden); }, 250);
    return () => { if (searchTimer.current !== null) clearTimeout(searchTimer.current); };
  }, [currentPath, editorOpen, runSearch, searchQuery, showHidden]);

  async function showDiff() {
    if (requestRef.current?.exclusive || !selectedPath || !diffAvailable) return;
    if (dirty && !window.confirm("Current file has unsaved changes. Show diff anyway?")) return;
    await runOperation("editor", async request => {
      const response = await getFileDiff(selectedPath, request.signal);
      if (!request.isCurrent()) return;
      setDiffOriginalContent(response.original_content); setDiffCurrentContent(response.current_content);
      setDiffStatus(response.status); setViewMode("diff");
    });
  }

  async function saveFile() {
    if (!selectedPath || readonly) return;
    await runOperation("mutation", async request => {
      await writeFile(selectedPath, content, fileModified);
      if (!request.isCurrent()) return;
      const response = await readFile(selectedPath, request.signal);
      if (!request.isCurrent()) return;
      const directory = await readDirectory(request, currentPath, showHidden, false);
      if (!request.isCurrent()) return;
      applyFile(response, directory?.entries.find(entry => entry.path === response.path)?.git_status);
      setMessage("Saved");
    });
  }

  async function createItem(type: "file" | "directory") {
    if (requestRef.current?.exclusive || !confirmDirty()) return;
    const name = window.prompt(`New ${type === "file" ? "file" : "folder"} name`);
    if (!name) return;
    const path = joinPath(currentPath, name.trim());
    await runOperation("mutation", async request => {
      await createFilePath(path, type);
      if (!request.isCurrent()) return;
      await readDirectory(request, currentPath, showHidden);
      if (!request.isCurrent()) return;
      if (type === "file") {
        const response = await readFile(path, request.signal);
        if (!request.isCurrent()) return;
        applyFile(response);
      }
      setMessage(type === "file" ? "File created" : "Folder created");
    });
  }

  async function renameItem(entry: FileTreeEntry) {
    if (requestRef.current?.exclusive || !confirmDirty()) return;
    const newName = window.prompt("Rename", entry.name);
    if (!newName || newName === entry.name) return;
    await runOperation("mutation", async request => {
      const response = await renameFilePath(entry.path, newName.trim());
      if (!request.isCurrent()) return;
      await readDirectory(request, currentPath, showHidden);
      if (!request.isCurrent()) return;
      if (selectedPath === entry.path && entry.type === "file") {
        const renamed = await readFile(response.path, request.signal);
        if (!request.isCurrent()) return;
        applyFile(renamed);
      }
      setMessage("Renamed");
    });
  }

  async function deleteItem(entry: FileTreeEntry) {
    if (requestRef.current?.exclusive || !confirmDirty() || !window.confirm(`Delete ${entry.name}?`)) return;
    await runOperation("mutation", async request => {
      await deleteFilePath(entry.path, entry.type === "directory");
      if (!request.isCurrent()) return;
      await readDirectory(request, currentPath, showHidden);
      if (request.isCurrent()) setMessage("Deleted");
    });
  }

  function closeEditor() {
    if (requestRef.current?.exclusive || !confirmDirty() || !cancelRead()) return;
    clearEditor();
  }
  const openEntry = (entry: FileTreeEntry) => entry.type === "directory" ? openDirectory(entry.path) : openFile(entry);
  const upload = useFileUpload({
    currentPath, showHidden, uploading, readDirectory, setMessage,
    runUpload: work => runOperation("upload", work),
  });
  function changeShowHidden(checked: boolean) {
    if (requestRef.current?.exclusive) return;
    setShowHidden(checked); void loadDirectory(currentPath, checked, false);
  }
  const refresh = () => { void loadDirectory(currentPath, showHidden, false); };

  return {
    editorOpen, notice: { error, message }, upload: { ...upload, destination: currentPath || rootLabel },
    toolbar: { showHidden, changeShowHidden, createItem, refresh, busy, uploading,
      loading, editorOpen, viewMode, saveFile, dirty, readonly },
    browser: { editorOpen, openRoot, rootLabel, breadcrumbs, openDirectory, searchQuery,
      setSearchQuery: changeSearchQuery, clearSearch, searchMode, searching, searchTruncated,
      currentPath, loading, uploading, sortedEntries, selectedEntryPath,
      setSelectedEntryPath, openEntry, renameItem, deleteItem },
    editor: { selectedPath, dirty, fileSize, fileModified, readonly, viewMode, diffAvailable, showDiff, busy,
      setViewMode: (mode: "edit" | "diff") => { if (cancelRead()) setViewMode(mode); },
      closeEditor, content, setContent, diffOriginalContent, diffCurrentContent, diffStatus },
  };
}

export type FileWorkspace = ReturnType<typeof useFileWorkspace>;
