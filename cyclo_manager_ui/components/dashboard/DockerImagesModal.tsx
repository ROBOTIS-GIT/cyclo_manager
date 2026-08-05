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
import { btnStyle } from "@/components/dashboard/DashboardComponents";
import {
  deleteDockerImage,
  getDockerImages,
  pruneDockerImages,
} from "@/lib/api";
import type { DockerImageInfo } from "@/types/api";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatCreated(created: string): string {
  if (!created) return "-";
  const parsed = new Date(created);
  if (Number.isNaN(parsed.getTime())) return created;
  return parsed.toLocaleString();
}

function imageLabel(image: DockerImageInfo): string {
  return image.tags.length > 0 ? image.tags.join(", ") : "<none>";
}

export default function DockerImagesModal({ onClose }: { onClose: () => void }) {
  const [images, setImages] = useState<DockerImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const totalSize = useMemo(
    () => images.reduce((sum, image) => sum + image.size_bytes, 0),
    [images]
  );
  const danglingCount = useMemo(
    () => images.filter((image) => image.dangling).length,
    [images]
  );

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getDockerImages();
      setImages(result.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Docker images");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const handleDelete = useCallback(async (image: DockerImageInfo) => {
    if (image.used_by.length > 0) return;
    const confirmed = window.confirm(`Delete Docker image ${imageLabel(image)}?`);
    if (!confirmed) return;

    setBusyImageId(image.id);
    setError(null);
    setMessage(null);
    try {
      const result = await deleteDockerImage(image.id);
      setMessage(result.message);
      await loadImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete image");
    } finally {
      setBusyImageId(null);
    }
  }, [loadImages]);

  const handlePrune = useCallback(async () => {
    const confirmed = window.confirm("Prune dangling Docker images?");
    if (!confirmed) return;

    setPruning(true);
    setError(null);
    setMessage(null);
    try {
      const result = await pruneDockerImages();
      setMessage(`${result.message}. Reclaimed ${formatBytes(result.space_reclaimed_bytes)}.`);
      await loadImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to prune images");
    } finally {
      setPruning(false);
    }
  }, [loadImages]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="rounded-lg border shadow-xl flex flex-col overflow-hidden"
        style={{
          width: "min(920px, 95vw)",
          height: "min(680px, 88vh)",
          backgroundColor: "var(--vscode-editor-background)",
          borderColor: "var(--vscode-panel-border)",
        }}
      >
        <div
          className="px-5 py-4 border-b flex items-start justify-between gap-4"
          style={{ borderColor: "var(--vscode-panel-border)" }}
        >
          <div>
            <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
              Docker Images
            </h2>
            <div className="text-xs mt-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {images.length} images / {danglingCount} dangling / {formatBytes(totalSize)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadImages}
              disabled={loading || pruning || busyImageId != null}
              style={btnStyle(false, loading || pruning || busyImageId != null)}
            >
              Refresh
            </button>
            <button
              onClick={handlePrune}
              disabled={loading || pruning || danglingCount === 0 || busyImageId != null}
              style={btnStyle(true, loading || pruning || danglingCount === 0 || busyImageId != null)}
            >
              {pruning ? "Pruning..." : "Prune dangling"}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:opacity-80"
              style={{
                color: "var(--vscode-foreground)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              title="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {(error || message) && (
          <div className="px-5 pt-3">
            <div
              className="px-3 py-2 rounded text-xs"
              style={{
                color: error ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)",
                backgroundColor: error ? "rgba(244,135,113,0.1)" : "var(--vscode-textBlockQuote-background)",
                border: error
                  ? "1px solid rgba(244,135,113,0.3)"
                  : "1px solid var(--vscode-panel-border)",
              }}
            >
              {error ?? message}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Loading images...
            </div>
          ) : images.length === 0 ? (
            <div className="p-5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
              No Docker images found
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ color: "var(--vscode-descriptionForeground)" }}>
                  <th className="text-left px-5 py-2 font-medium">Image</th>
                  <th className="text-left px-3 py-2 font-medium">ID</th>
                  <th className="text-left px-3 py-2 font-medium">Size</th>
                  <th className="text-left px-3 py-2 font-medium">Created</th>
                  <th className="text-left px-3 py-2 font-medium">Used by</th>
                  <th className="text-right px-5 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => {
                  const used = image.used_by.length > 0;
                  const deleting = busyImageId === image.id;
                  return (
                    <tr
                      key={image.id}
                      style={{
                        borderTop: "1px solid var(--vscode-panel-border)",
                        color: "var(--vscode-foreground)",
                      }}
                    >
                      <td className="px-5 py-3 align-top">
                        <div className="font-medium break-all">{imageLabel(image)}</div>
                        {image.dangling && (
                          <span
                            className="inline-block mt-1 px-1.5 py-0.5 rounded text-[11px]"
                            style={{
                              color: "var(--vscode-descriptionForeground)",
                              backgroundColor: "var(--vscode-badge-background)",
                            }}
                          >
                            dangling
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-xs">
                        {image.short_id}
                      </td>
                      <td className="px-3 py-3 align-top whitespace-nowrap">
                        {formatBytes(image.size_bytes)}
                      </td>
                      <td className="px-3 py-3 align-top whitespace-nowrap text-xs">
                        {formatCreated(image.created)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {used ? image.used_by.join(", ") : "-"}
                      </td>
                      <td className="px-5 py-3 align-top text-right">
                        <button
                          onClick={() => handleDelete(image)}
                          disabled={used || deleting || pruning}
                          title={used ? `Used by ${image.used_by.join(", ")}` : "Delete image"}
                          style={btnStyle(false, used || deleting || pruning)}
                        >
                          {deleting ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
