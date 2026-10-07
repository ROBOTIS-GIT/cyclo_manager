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

import { useState } from "react";
import { getFileTree, uploadFile } from "@/lib/api";
import type { FileRequest } from "./useFileWorkspace";
import { formatBytes } from "@/lib/files/format";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type UploadOptions = {
  currentPath: string;
  showHidden: boolean;
  uploading: boolean;
  readDirectory: (request: FileRequest, path: string, hidden: boolean, clearOpenFile: boolean) => Promise<unknown>;
  runUpload: (work: (request: FileRequest) => Promise<void>) => Promise<void>;
  setMessage: (message: string) => void;
};

export function useFileUpload({
  currentPath, showHidden, uploading, readDirectory, runUpload, setMessage,
}: UploadOptions) {
  const [dragDepth, setDragDepth] = useState(0);

  async function uploadDroppedFiles(files: File[]) {
    if (files.length === 0) return;
    await runUpload(async request => {
      const oversized = files.find(file => file.size > MAX_UPLOAD_BYTES);
      if (oversized) throw new Error(`${oversized.name} is larger than ${formatBytes(MAX_UPLOAD_BYTES)}`);
      const directory = await getFileTree(currentPath, true, request.signal);
      if (!request.isCurrent()) return;
      const existingNames = new Set(directory.entries.map(entry => entry.name));
      let uploadedCount = 0;
      for (const file of files) {
        if (!request.isCurrent()) return;
        const exists = existingNames.has(file.name);
        const overwrite = exists ? window.confirm(`${file.name} already exists. Overwrite it?`) : false;
        if (exists && !overwrite) continue;
        await uploadFile(currentPath, file, overwrite);
        existingNames.add(file.name);
        uploadedCount += 1;
      }
      if (!request.isCurrent()) return;
      await readDirectory(request, currentPath, showHidden, false);
      if (request.isCurrent()) setMessage(`${uploadedCount} file(s) uploaded`);
    });
  }

  function isFileDrag(event: React.DragEvent<HTMLDivElement>): boolean {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setDragDepth((value) => value + 1);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setDragDepth((value) => Math.max(0, value - 1));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer.files);
    setDragDepth(0);
    void uploadDroppedFiles(droppedFiles);
  }

  return { uploading, draggingFiles: dragDepth > 0, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
