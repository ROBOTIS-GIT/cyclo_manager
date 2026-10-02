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

import type { FileTreeEntry } from "@/types/api";

export function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

export function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function formatBytes(size: number | null): string {
  if (size == null) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export function formatTime(value: number | null): string {
  if (value == null) return "";
  return new Date(value * 1000).toLocaleString();
}

export function fileLanguage(path: string): string {
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

export function gitStatusLabel(status: FileTreeEntry["git_status"]): string {
  if (status === "modified") return "M";
  if (status === "untracked") return "U";
  return "";
}

export function gitStatusTitle(status: FileTreeEntry["git_status"]): string {
  if (status === "modified") return "Modified";
  if (status === "untracked") return "Untracked";
  return "";
}
