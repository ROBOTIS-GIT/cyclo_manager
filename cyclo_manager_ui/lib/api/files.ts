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

import { request } from "./client";
import type { FileDiffResponse, FileOperationResponse, FileReadResponse, FileSearchResponse, FileTreeResponse, FileUploadResponse } from "@/types/api";

export async function getFileTree(
  path: string = "",
  showHidden: boolean = false
): Promise<FileTreeResponse> {
  return request<FileTreeResponse>({
    method: "GET",
    url: "/host/files/tree",
    params: { path, show_hidden: showHidden },
  });
}

export async function readFile(path: string): Promise<FileReadResponse> {
  return request<FileReadResponse>({
    method: "GET",
    url: "/host/files/read",
    params: { path },
  });
}

export async function getFileDiff(path: string): Promise<FileDiffResponse> {
  return request<FileDiffResponse>({
    method: "GET",
    url: "/host/files/diff",
    params: { path },
  });
}

export async function searchFiles(
  path: string,
  query: string,
  showHidden: boolean = false,
  limit: number = 200
): Promise<FileSearchResponse> {
  return request<FileSearchResponse>({
    method: "GET",
    url: "/host/files/search",
    params: { path, query, show_hidden: showHidden, limit },
  });
}

export async function writeFile(
  path: string,
  content: string,
  expectedModified: number | null
): Promise<FileOperationResponse> {
  return request<FileOperationResponse>({
    method: "POST",
    url: "/host/files/write",
    data: {
      path,
      content,
      expected_modified: expectedModified,
    },
  });
}

export async function createFilePath(
  path: string,
  type: "file" | "directory",
  content: string = ""
): Promise<FileOperationResponse> {
  return request<FileOperationResponse>({
    method: "POST",
    url: "/host/files/create",
    data: { path, type, content },
  });
}

export async function renameFilePath(
  path: string,
  newName: string
): Promise<FileOperationResponse> {
  return request<FileOperationResponse>({
    method: "POST",
    url: "/host/files/rename",
    data: { path, new_name: newName },
  });
}

export async function uploadFile(
  path: string,
  file: File,
  overwrite: boolean = false
): Promise<FileUploadResponse> {
  return request<FileUploadResponse>({
    method: "POST",
    url: "/host/files/upload",
    params: { path, filename: file.name, overwrite },
    data: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
  });
}

export async function deleteFilePath(
  path: string,
  recursive: boolean = false
): Promise<FileOperationResponse> {
  return request<FileOperationResponse>({
    method: "DELETE",
    url: "/host/files",
    params: { path, recursive },
  });
}
