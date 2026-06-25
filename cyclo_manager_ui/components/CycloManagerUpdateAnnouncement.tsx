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

import { useEffect, useState, useCallback, useRef } from "react";
import { getCycloManagerVersion, updateCycloManager, getUpdateStatus } from "@/lib/api";
import type { CycloManagerVersionResponse } from "@/types/api";
import { useAppsHubBanner } from "@/contexts/AppsHubBannerContext";

type Phase = "idle" | "updating" | "done" | "error";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  updating: "Updating cyclo_manager...",
  done: "Update complete. Reloading...",
  error: "Update failed.",
};

function OutputBox({ output, error }: { output: string; error?: boolean }) {
  if (!output) return null;
  return (
    <pre className="text-xs p-3 rounded font-mono whitespace-pre-wrap break-words overflow-auto"
      style={{
        maxHeight: 200,
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        color: error ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)",
        border: "1px solid var(--vscode-panel-border)",
      }}>
      {output}
    </pre>
  );
}

export type CycloManagerUpdateAnnouncementProps = {
  suppressed?: boolean;
  onBannerVisibilityChange?: (visible: boolean) => void;
};

export default function CycloManagerUpdateAnnouncement({
  suppressed = false,
  onBannerVisibilityChange,
}: CycloManagerUpdateAnnouncementProps) {
  const [info, setInfo] = useState<CycloManagerVersionResponse | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [output, setOutput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setUpdateBannerVisible } = useAppsHubBanner();

  useEffect(() => {
    getCycloManagerVersion()
      .then((data) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  const bannerVisible = !suppressed && !!info?.update_available;
  useEffect(() => {
    setUpdateBannerVisible(bannerVisible);
    return () => setUpdateBannerVisible(false);
  }, [bannerVisible, setUpdateBannerVisible]);
  useEffect(() => {
    onBannerVisibilityChange?.(bannerVisible);
  }, [bannerVisible, onBannerVisibilityChange]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(() => {
    pollingRef.current = setInterval(async () => {
      try {
        const s = await getUpdateStatus();
        if (s.output) setOutput(s.output);
        if (s.phase === "done") {
          stopPolling();
          setPhase("done");
          setTimeout(() => window.location.reload(), 1500);
        } else if (s.phase === "error") {
          stopPolling();
          setErrorMsg(s.error);
          setPhase("error");
        }
      } catch {
        // keep polling
      }
    }, 3000);
  }, [stopPolling]);

  const handleUpdate = useCallback(async () => {
    setPhase("updating");
    setOutput("");
    setErrorMsg("");
    try {
      await updateCycloManager();
      pollStatus();
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : "Failed to start update.");
    }
  }, [pollStatus]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  if (!info?.update_available) return null;

  const isRunning = phase === "updating";
  const canClose = !isRunning && phase !== "done";

  return (
    <>
      {!suppressed && (
        <div
          className="w-full z-50 p-3 flex flex-wrap items-center justify-center gap-3 shadow-md"
          style={{
            backgroundColor: "var(--vscode-badge-background, #4dabf7)",
            color: "var(--vscode-badge-foreground, #fff)",
          }}
        >
          <span className="text-sm font-medium">
            cyclo_manager {info.current} → {info.latest}
          </span>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="px-3 py-1.5 rounded text-sm font-medium border border-white/50 hover:bg-white/20"
          >
            Update available
          </button>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[70]"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="rounded-lg border shadow-xl flex flex-col overflow-hidden"
            style={{
              width: "min(560px, 95vw)",
              maxHeight: "88vh",
              backgroundColor: "var(--vscode-editor-background)",
              borderColor: "var(--vscode-panel-border)",
            }}>

            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-start justify-between"
              style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}>
              <div>
                <div className="text-sm font-bold" style={{ color: "var(--vscode-foreground)" }}>
                  Update cyclo_manager
                </div>
                {info.current && info.latest && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--vscode-descriptionForeground)" }}>
                    {info.current} → {info.latest}
                  </div>
                )}
              </div>
              {canClose && (
                <button onClick={() => { setShowModal(false); setPhase("idle"); }}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 0 8px", color: "var(--vscode-descriptionForeground)" }}>
                  ✕
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="flex flex-col gap-3">
              {phase === "idle" && (
                <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Runs <code>cyclo_manager update</code> — installs the latest package and restarts the stack without removing sockets or services.
                </div>
              )}

              {/* Status label */}
              {phase !== "idle" && phase !== "error" && (
                <div className="text-sm" style={{ color: phase === "done" ? "#3fb950" : "var(--vscode-descriptionForeground)" }}>
                  {PHASE_LABELS[phase]}
                </div>
              )}
              {phase === "error" && (
                <div className="text-sm" style={{ color: "var(--vscode-errorForeground)" }}>
                  {errorMsg}
                </div>
              )}

              {/* Logs */}
              {output && <OutputBox output={output} />}
            </div>

            {/* Footer */}
            <div style={{
              padding: "12px 20px", borderTop: "1px solid var(--vscode-panel-border)",
              display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0,
            }}>
              {phase === "idle" && (
                <>
                  <button onClick={() => setShowModal(false)}
                    style={{ padding: "6px 18px", fontSize: 13, border: "none", borderRadius: 2, cursor: "pointer",
                      backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)" }}>
                    Cancel
                  </button>
                  <button onClick={handleUpdate}
                    style={{ padding: "6px 18px", fontSize: 13, border: "none", borderRadius: 2, cursor: "pointer",
                      backgroundColor: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" }}>
                    Update Now
                  </button>
                </>
              )}
              {phase === "error" && (
                <>
                  <button onClick={() => { setShowModal(false); setPhase("idle"); }}
                    style={{ padding: "6px 18px", fontSize: 13, border: "none", borderRadius: 2, cursor: "pointer",
                      backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)" }}>
                    Close
                  </button>
                  <button onClick={handleUpdate}
                    style={{ padding: "6px 18px", fontSize: 13, border: "none", borderRadius: 2, cursor: "pointer",
                      backgroundColor: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" }}>
                    Retry
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
