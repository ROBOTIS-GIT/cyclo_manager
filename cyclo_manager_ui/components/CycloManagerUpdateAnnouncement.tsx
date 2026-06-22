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

type Phase = "idle" | "stopping" | "restarting" | "installing" | "starting" | "done" | "error";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  stopping: "Stopping server...",
  restarting: "Server stopped. Waiting for install to complete...",
  installing: "Installing package...",
  starting: "Starting server...",
  done: "Update complete. Reloading...",
  error: "Update failed.",
};

const STEPS: { key: Phase; label: string }[] = [
  { key: "stopping",   label: "Stop Server" },
  { key: "installing", label: "Install Package" },
  { key: "starting",   label: "Start Server" },
];

function StepBar({ phase }: { phase: Phase }) {
  const order: Phase[] = ["stopping", "installing", "starting", "done"];
  const idx = order.indexOf(phase === "restarting" ? "installing" : phase);
  return (
    <div className="flex items-center gap-0 px-5 py-3 text-xs"
      style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}>
      {STEPS.map((step, i) => {
        const done = i < (idx === -1 ? 0 : idx) || phase === "done";
        const active = order[idx] === step.key && phase !== "done";
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span style={{
                width: 20, height: 20, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 600, flexShrink: 0,
                backgroundColor: done ? "#3fb950" : active ? "var(--vscode-button-background)" : "transparent",
                color: done || active ? "#fff" : "var(--vscode-descriptionForeground)",
                border: done || active ? "none" : "1px solid var(--vscode-panel-border)",
              }}>
                {done ? "✓" : i + 1}
              </span>
              <span style={{
                color: active ? "var(--vscode-foreground)" : done ? "#3fb950" : "var(--vscode-descriptionForeground)",
                fontWeight: active ? 600 : 400,
              }}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="mx-2" style={{ color: "var(--vscode-panel-border)" }}>—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  const [downOutput, setDownOutput] = useState("");
  const [installOutput, setInstallOutput] = useState("");
  const [upOutput, setUpOutput] = useState("");
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

  // After server comes back up, poll status endpoint for install+up results
  const pollStatus = useCallback(() => {
    pollingRef.current = setInterval(async () => {
      try {
        const s = await getUpdateStatus();
        if (s.phase === "installing" || s.phase === "starting") {
          setPhase(s.phase);
          if (s.install_output) setInstallOutput(s.install_output);
        } else if (s.phase === "done") {
          stopPolling();
          if (s.install_output) setInstallOutput(s.install_output);
          if (s.up_output) setUpOutput(s.up_output);
          setPhase("done");
          setTimeout(() => window.location.reload(), 1500);
        } else if (s.phase === "error") {
          stopPolling();
          if (s.install_output) setInstallOutput(s.install_output);
          if (s.up_output) setUpOutput(s.up_output);
          setErrorMsg(s.error);
          setPhase("error");
        }
      } catch {
        // server still restarting, keep polling
      }
    }, 3000);
  }, [stopPolling]);

  // After cyclo down, wait for server to come back before polling status
  const waitForServerThenPollStatus = useCallback(() => {
    setPhase("restarting");
    const serverPoll = setInterval(async () => {
      try {
        await getCycloManagerVersion();
        clearInterval(serverPoll);
        pollStatus();
      } catch {
        // still down
      }
    }, 3000);
  }, [pollStatus]);

  const handleUpdate = useCallback(async () => {
    setPhase("stopping");
    setDownOutput("");
    setInstallOutput("");
    setUpOutput("");
    setErrorMsg("");
    try {
      const res = await updateCycloManager();
      setDownOutput(res.down_output);
      waitForServerThenPollStatus();
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : "Failed to start update.");
    }
  }, [waitForServerThenPollStatus]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  if (!info?.update_available) return null;

  const isRunning = phase === "stopping" || phase === "restarting" || phase === "installing" || phase === "starting";
  const canClose = !isRunning && phase !== "done";

  return (
    <>
      {!suppressed && (
        <div
          className="fixed top-0 left-0 right-0 z-50 p-3 flex flex-wrap items-center justify-center gap-3 shadow-md"
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

            {/* Step bar */}
            {phase !== "idle" && <StepBar phase={phase} />}

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="flex flex-col gap-3">
              {phase === "idle" && (
                <div className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  <div>The following steps will be performed:</div>
                  <ol className="flex flex-col gap-1 pl-4 list-decimal">
                    <li><strong style={{ color: "var(--vscode-foreground)" }}>Stop Server</strong> — stop cyclo_manager stack</li>
                    <li><strong style={{ color: "var(--vscode-foreground)" }}>Install Package</strong> — pip install -U cyclo-manager</li>
                    <li><strong style={{ color: "var(--vscode-foreground)" }}>Start Server</strong> — restart cyclo_manager stack</li>
                  </ol>
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
              {downOutput && <OutputBox output={downOutput} />}
              {installOutput && <OutputBox output={installOutput} />}
              {upOutput && <OutputBox output={upOutput} />}
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
