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

import { useEffect, useState, useCallback } from "react";
import { getRepoStatus, updateRepo, stopRepoContainer, startRepoContainer } from "@/lib/api";
import type { FileChange, RepoUpdateStatus } from "@/types/api";

type Phase = "stop" | "choose" | "update" | "start";
type RunStatus = "idle" | "running" | "done" | "error";
type Strategy = "stash" | "reset";

interface PhaseState {
  status: RunStatus;
  output: string;
}

interface Props {
  repo: RepoUpdateStatus;
  onClose: () => void;
  onDone: () => void;
}

const PHASES: { key: Phase; label: string }[] = [
  { key: "stop",   label: "Stop Container" },
  { key: "choose", label: "Choose Strategy" },
  { key: "update", label: "Update Repository" },
  { key: "start",  label: "Start Container" },
];

// ── styles ────────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 100,
  backgroundColor: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const modal: React.CSSProperties = {
  width: "min(620px, 95vw)",
  maxHeight: "88vh",
  display: "flex",
  flexDirection: "column",
  borderRadius: "6px",
  border: "1px solid var(--vscode-panel-border)",
  backgroundColor: "var(--vscode-editor-background)",
  overflow: "hidden",
};

const btnPrimary = (disabled = false): React.CSSProperties => ({
  padding: "6px 18px", fontSize: 13, border: "none", borderRadius: 2,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  backgroundColor: "var(--vscode-button-background)",
  color: "var(--vscode-button-foreground)",
});

const btnSecondary = (disabled = false): React.CSSProperties => ({
  padding: "6px 18px", fontSize: 13, border: "none", borderRadius: 2,
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  backgroundColor: "var(--vscode-button-secondaryBackground)",
  color: "var(--vscode-button-secondaryForeground)",
});

// ── sub-components ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: Phase }) {
  const idx = PHASES.findIndex(p => p.key === current);
  return (
    <div className="flex items-center gap-0 px-5 py-3 text-xs"
      style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}>
      {PHASES.map((p, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={p.key} className="flex items-center">
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
              }}>
                {p.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
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
        maxHeight: 260,
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        color: error ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)",
        border: "1px solid var(--vscode-panel-border)",
      }}>
      {output}
    </pre>
  );
}

function RunningLabel({ label }: { label: string }) {
  return (
    <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
      {label}...
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function UpdateWizard({ repo, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>("stop");
  const [stop, setStop] = useState<PhaseState>({ status: "idle", output: "" });
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [chooseLoading, setChooseLoading] = useState(false);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [preserveFiles, setPreserveFiles] = useState<Set<string>>(new Set());
  const [upd, setUpd] = useState<PhaseState>({ status: "idle", output: "" });
  const [stashConflict, setStashConflict] = useState(false);
  const [stashConflictFiles, setStashConflictFiles] = useState<string[]>([]);
  const [start, setStart] = useState<PhaseState>({ status: "idle", output: "" });

  // ── Phase: stop ─────────────────────────────────────────────────────────────
  const runStop = useCallback(async () => {
    setStop({ status: "running", output: "" });
    try {
      const res = await stopRepoContainer(repo.name);
      setStop({ status: res.success ? "done" : "error", output: res.output });
    } catch (err) {
      setStop({ status: "error", output: err instanceof Error ? err.message : "Error" });
    }
  }, [repo.name]);

  useEffect(() => { runStop(); }, [runStop]);

  // ── Phase: choose (load git status) ─────────────────────────────────────────
  const loadChanges = useCallback(async () => {
    setChooseLoading(true);
    try {
      const res = await getRepoStatus(repo.name);
      setChanges(res.changes);
      setPreserveFiles(new Set(res.changes.map(c => c.path)));
    } catch {
      setChanges([]);
    } finally {
      setChooseLoading(false);
    }
  }, [repo.name]);

  useEffect(() => {
    if (phase === "choose") loadChanges();
  }, [phase, loadChanges]);

  // ── Phase: update ────────────────────────────────────────────────────────────
  const runUpdate = useCallback(async (strat: Strategy) => {
    setUpd({ status: "running", output: "" });
    try {
      const preserve = strat === "reset" ? Array.from(preserveFiles) : [];
      const res = await updateRepo(repo.name, strat, preserve);
      setUpd({ status: res.success ? "done" : "error", output: res.output });
      if (res.stash_conflict) {
        setStashConflict(true);
        setStashConflictFiles(res.stash_conflict_files);
      }
    } catch (err) {
      setUpd({ status: "error", output: err instanceof Error ? err.message : "Error" });
    }
  }, [repo.name, preserveFiles]);

  useEffect(() => {
    if (phase === "update" && strategy) runUpdate(strategy);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase: start ─────────────────────────────────────────────────────────────
  const runStart = useCallback(async () => {
    setStart({ status: "running", output: "" });
    try {
      const res = await startRepoContainer(repo.name);
      setStart({ status: res.success ? "done" : "error", output: res.output });
    } catch (err) {
      setStart({ status: "error", output: err instanceof Error ? err.message : "Error" });
    }
  }, [repo.name]);

  useEffect(() => {
    if (phase === "start") runStart();
  }, [phase, runStart]);

  // ── helpers ──────────────────────────────────────────────────────────────────
  const togglePreserve = (path: string) => {
    setPreserveFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const isRunning =
    (phase === "stop"   && stop.status  === "running") ||
    (phase === "update" && upd.status   === "running") ||
    (phase === "start"  && start.status === "running");

  // ── render body per phase ────────────────────────────────────────────────────
  const renderBody = () => {
    // STOP
    if (phase === "stop") {
      return (
        <div className="flex flex-col gap-3">
          {stop.status === "running" && <RunningLabel label="Stopping container" />}
          {stop.status === "done" && (
            <div className="text-sm" style={{ color: "#3fb950" }}>Container stopped.</div>
          )}
          {stop.status === "error" && (
            <div className="text-sm" style={{ color: "var(--vscode-errorForeground)" }}>
              Failed to stop container.
            </div>
          )}
          <OutputBox output={stop.output} error={stop.status === "error"} />
        </div>
      );
    }

    // CHOOSE
    if (phase === "choose") {
      return (
        <div className="flex flex-col gap-4">
          {chooseLoading ? (
            <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Checking repository status...
            </div>
          ) : changes.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
              No local changes.
            </div>
          ) : (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2"
                style={{ color: "var(--vscode-descriptionForeground)" }}>
                Local changes ({changes.length})
              </div>
              <div className="rounded border overflow-hidden" style={{ borderColor: "var(--vscode-panel-border)" }}>
                {changes.map(c => (
                  <div key={c.path}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-b-0"
                    style={{ borderColor: "var(--vscode-panel-border)", color: "var(--vscode-foreground)" }}>
                    {strategy === "reset" ? (
                      <input type="checkbox" checked={preserveFiles.has(c.path)}
                        onChange={() => togglePreserve(c.path)}
                        style={{ cursor: "pointer", accentColor: "var(--vscode-button-background)" }} />
                    ) : (
                      <span className="w-4 shrink-0 text-center font-mono text-[10px]"
                        style={{ color: c.status === "??" ? "#3fb950" : c.status.includes("D") ? "#f14c4c" : "#e2c08d" }}>
                        {c.status}
                      </span>
                    )}
                    <span className="font-mono truncate flex-1">{c.path}</span>
                    {strategy === "reset" && (
                      <span className="shrink-0 text-[10px]"
                        style={{ color: preserveFiles.has(c.path) ? "#3fb950" : "var(--vscode-descriptionForeground)" }}>
                        {preserveFiles.has(c.path) ? "keep" : "reset"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!chooseLoading && strategy === null && (
            <div className="flex flex-col gap-2">
              <button onClick={() => { setStrategy("stash"); setPhase("update"); }}
                className="w-full text-left rounded border px-4 py-3"
                style={{ borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--vscode-focusBorder, #007fd4)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--vscode-panel-border)"}>
                <div className="text-sm font-semibold mb-0.5" style={{ color: "var(--vscode-foreground)" }}>
                  Stash &amp; Update
                </div>
                <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Stashes local changes, pulls the update, then restores them. On conflict, local version wins.
                </div>
              </button>
              <button onClick={() => setStrategy("reset")}
                className="w-full text-left rounded border px-4 py-3"
                style={{ borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--vscode-focusBorder, #007fd4)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--vscode-panel-border)"}>
                <div className="text-sm font-semibold mb-0.5" style={{ color: "var(--vscode-foreground)" }}>
                  Reset &amp; Update
                </div>
                <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Select files to preserve, reset everything else, then pull the update.
                </div>
              </button>
            </div>
          )}

          {strategy === "reset" && (
            <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Checked files will be preserved after the update.
            </div>
          )}
        </div>
      );
    }

    // UPDATE
    if (phase === "update") {
      return (
        <div className="flex flex-col gap-3">
          {upd.status === "running" && <RunningLabel label="Updating repository" />}
          {upd.status === "done" && (
            <>
              <div className="text-sm" style={{ color: "#3fb950" }}>Repository updated.</div>
              {stashConflict && (
                <div className="text-xs px-3 py-2 rounded"
                  style={{ backgroundColor: "rgba(229,197,16,0.12)", color: "#e5c510" }}>
                  Some files had conflicts — local versions were kept.
                  {stashConflictFiles.length > 0 && (
                    <div className="mt-1 font-mono">{stashConflictFiles.join(", ")}</div>
                  )}
                </div>
              )}
            </>
          )}
          {upd.status === "error" && (
            <div className="text-sm" style={{ color: "var(--vscode-errorForeground)" }}>
              Repository update failed.
            </div>
          )}
          <OutputBox output={upd.output} error={upd.status === "error"} />
        </div>
      );
    }

    // START
    if (phase === "start") {
      return (
        <div className="flex flex-col gap-3">
          {start.status === "running" && <RunningLabel label="Starting container" />}
          {start.status === "done" && (
            <div className="text-sm" style={{ color: "#3fb950" }}>Container started.</div>
          )}
          {start.status === "error" && (
            <div className="text-sm" style={{ color: "var(--vscode-errorForeground)" }}>
              Failed to start container.
            </div>
          )}
          <OutputBox output={start.output} error={start.status === "error"} />
        </div>
      );
    }
  };

  // ── render footer per phase ───────────────────────────────────────────────────
  const renderFooter = () => {
    if (phase === "stop") return (
      <>
        <button style={btnSecondary(isRunning)} disabled={isRunning} onClick={onClose}>Cancel</button>
        <button style={btnPrimary(isRunning || stop.status === "idle")}
          disabled={isRunning || stop.status === "idle"}
          onClick={() => setPhase("choose")}>
          Next
        </button>
      </>
    );

    if (phase === "choose") return (
      <>
        <button style={btnSecondary()} onClick={() => setPhase("stop")}>Back</button>
        {strategy === "reset" && (
          <button style={btnPrimary(chooseLoading)}
            disabled={chooseLoading}
            onClick={() => setPhase("update")}>
            Reset &amp; Update
          </button>
        )}
      </>
    );

    if (phase === "update") return (
      <>
        <button style={btnPrimary(isRunning || upd.status === "idle" || upd.status === "error")}
          disabled={isRunning || upd.status === "idle" || upd.status === "error"}
          onClick={() => setPhase("start")}>
          Next
        </button>
      </>
    );

    if (phase === "start") return (
      <>
        <button style={btnSecondary(isRunning)} disabled={isRunning}
          onClick={() => { if (start.status === "done") onDone(); onClose(); }}>
          Close
        </button>
      </>
    );
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget && !isRunning) onClose(); }}>
      <div style={modal}>
        {/* Header */}
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}>
          <div className="text-sm font-bold" style={{ color: "var(--vscode-foreground)" }}>{repo.name}</div>
          {repo.current_version && repo.latest_version && (
            <div className="text-xs mt-0.5" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {repo.current_version} → {repo.latest_version}
            </div>
          )}
        </div>

        {/* Step bar */}
        <StepBar current={phase} />

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {renderBody()}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: "1px solid var(--vscode-panel-border)",
          display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0,
        }}>
          {renderFooter()}
        </div>
      </div>
    </div>
  );
}
