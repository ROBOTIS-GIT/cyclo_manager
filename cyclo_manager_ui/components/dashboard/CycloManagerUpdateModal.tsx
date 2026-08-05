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

import { useCallback, useEffect, useRef, useState } from "react";
import { btnStyle } from "@/components/dashboard/DashboardComponents";
import { getCycloManagerVersion, getHostAgentVersion, getUpdateStatus, updateCycloManager } from "@/lib/api";
import type { CycloManagerVersionResponse } from "@/types/api";

type Phase = "idle" | "updating" | "done" | "error";

const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
const STATUS_POLL_MS = 2000;
const VERSION_POLL_MS = 3000;
const STATUS_IDLE_GRACE_MS = 8000;
const HOST_AGENT_VERSION_GRACE_MS = 30000;

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  updating: "Updating Cyclo Manager...",
  done: "Update complete. Reloading...",
  error: "Update failed.",
};

function isKnownVersion(version: string): boolean {
  return !!version && version !== "unknown";
}

function isUpdateSuccessful(
  version: CycloManagerVersionResponse,
  beforeCurrent: string,
  targetLatest: string,
): boolean {
  if (isKnownVersion(version.current) && beforeCurrent && version.current !== beforeCurrent) {
    return true;
  }
  if (isKnownVersion(targetLatest) && version.current === targetLatest) {
    return true;
  }
  if (version.pypi_available && isKnownVersion(version.latest) && version.current === version.latest) {
    return true;
  }
  if (version.pypi_available && !version.update_available && isKnownVersion(version.latest)) {
    return true;
  }
  return false;
}

function isUpdateFailed(version: CycloManagerVersionResponse, beforeCurrent: string): boolean {
  if (!version.pypi_available || !beforeCurrent) {
    return false;
  }
  return version.update_available && version.current === beforeCurrent;
}

function isHostAgentUpdated(hostAgentVersion: string, managerCurrent: string): boolean {
  if (!isKnownVersion(hostAgentVersion)) {
    return false;
  }
  return isKnownVersion(managerCurrent) && hostAgentVersion === managerCurrent;
}

function OutputBox({
  output,
  error,
}: {
  output: string;
  error?: boolean;
}) {
  if (!output) return null;
  let textColor = "var(--vscode-foreground)";
  if (error) {
    textColor = "var(--vscode-errorForeground)";
  }
  return (
    <pre
      className="text-xs p-3 rounded font-mono whitespace-pre-wrap break-words overflow-auto"
      style={{
        minHeight: 160,
        maxHeight: 220,
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        color: textColor,
        border: "1px solid var(--vscode-panel-border)",
      }}
    >
      {output}
    </pre>
  );
}

export default function CycloManagerUpdateModal({
  version,
  onClose,
}: {
  version: CycloManagerVersionResponse;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [output, setOutput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const failUpdate = useCallback((message: string) => {
    stopPolling();
    setErrorMsg(message);
    setPhase("error");
  }, [stopPolling]);

  const succeedUpdate = useCallback(() => {
    stopPolling();
    setPhase("done");
    setTimeout(() => window.location.reload(), 1500);
  }, [stopPolling]);

  const waitForServerThenCheckVersion = useCallback((
    beforeCurrent: string,
    targetLatest: string,
    startedAt: number,
  ) => {
    const versionCheckStartedAt = Date.now();
    pollingRef.current = setInterval(async () => {
      if (Date.now() - startedAt > UPDATE_TIMEOUT_MS) {
        failUpdate("Update timed out. Check the server and retry.");
        return;
      }
      try {
        const latestVersion = await getCycloManagerVersion();
        const managerUpdated = isUpdateSuccessful(latestVersion, beforeCurrent, targetLatest);
        let hostAgentVersion = "";
        try {
          hostAgentVersion = (await getHostAgentVersion()).version;
        } catch {
          // Host agent may still be restarting or still on a version without this endpoint.
        }
        const hostAgentUpdated = isHostAgentUpdated(hostAgentVersion, latestVersion.current);
        if (managerUpdated && hostAgentUpdated) {
          succeedUpdate();
        } else if (
          managerUpdated &&
          Date.now() - versionCheckStartedAt > HOST_AGENT_VERSION_GRACE_MS
        ) {
          failUpdate(
            `Host agent version is ${hostAgentVersion || "unavailable"}; expected ${latestVersion.current}.`,
          );
        } else if (isUpdateFailed(latestVersion, beforeCurrent)) {
          failUpdate(
            `Update may have failed. Still on ${latestVersion.current}, latest is ${latestVersion.latest}.`,
          );
        }
      } catch {
        // API still down, keep waiting.
      }
    }, VERSION_POLL_MS);
  }, [failUpdate, succeedUpdate]);

  const pollUntilDown = useCallback((
    beforeCurrent: string,
    targetLatest: string,
    startedAt: number,
  ) => {
    let consecutiveFailures = 0;
    let sawUpdating = false;

    pollingRef.current = setInterval(async () => {
      if (Date.now() - startedAt > UPDATE_TIMEOUT_MS) {
        failUpdate("Update timed out. Check the server and retry.");
        return;
      }
      try {
        consecutiveFailures = 0;
        const status = await getUpdateStatus();
        if (status.phase === "updating") sawUpdating = true;
        if (status.phase === "error") {
          if (status.output) setOutput(status.output);
          failUpdate(status.error || "Update failed.");
        } else if (
          status.phase === "done" ||
          (status.phase === "idle" && (sawUpdating || Date.now() - startedAt > STATUS_IDLE_GRACE_MS))
        ) {
          stopPolling();
          waitForServerThenCheckVersion(beforeCurrent, targetLatest, startedAt);
        }
      } catch {
        consecutiveFailures += 1;
        if (sawUpdating || consecutiveFailures >= 2) {
          stopPolling();
          waitForServerThenCheckVersion(beforeCurrent, targetLatest, startedAt);
        }
      }
    }, STATUS_POLL_MS);
  }, [failUpdate, stopPolling, waitForServerThenCheckVersion]);

  const handleUpdate = useCallback(async () => {
    const beforeCurrent = version.current;
    const targetLatest = version.latest;
    const startedAt = Date.now();

    setPhase("updating");
    setOutput("");
    setErrorMsg("");
    try {
      await updateCycloManager();
      pollUntilDown(beforeCurrent, targetLatest, startedAt);
    } catch (error) {
      setPhase("error");
      setErrorMsg(error instanceof Error ? error.message : "Failed to start update.");
    }
  }, [pollUntilDown, version.current, version.latest]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const running = phase === "updating";
  const canClose = !running && phase !== "done";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[70]"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="rounded-lg border shadow-xl flex flex-col overflow-hidden"
        style={{
          width: "min(560px, 95vw)",
          maxHeight: "88vh",
          backgroundColor: "var(--vscode-editor-background)",
          borderColor: "var(--vscode-panel-border)",
        }}
      >
        <div
          className="px-5 pt-4 pb-3 flex items-start justify-between"
          style={{ borderBottom: "1px solid var(--vscode-panel-border)", flexShrink: 0 }}
        >
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--vscode-foreground)" }}>
              Update Cyclo Manager
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {version.current} {"->"} {version.latest}
            </div>
          </div>
          {canClose && (
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 0 0 8px",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              x
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="flex flex-col gap-3">
          {phase === "idle" && (
            <div className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
              This updates the manager package, pulls Docker images, and restarts the stack.
            </div>
          )}
          {phase !== "idle" && phase !== "error" && (
            <div
              className="text-sm"
              style={{ color: phase === "done" ? "#3fb950" : "var(--vscode-descriptionForeground)" }}
            >
              {PHASE_LABELS[phase]}
            </div>
          )}
          {phase === "error" && (
            <div className="text-sm" style={{ color: "var(--vscode-errorForeground)" }}>
              {errorMsg}
            </div>
          )}
          <OutputBox output={output} error={phase === "error"} />
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--vscode-panel-border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {phase === "idle" && (
            <>
              <button onClick={onClose} style={btnStyle(false)}>
                Cancel
              </button>
              <button onClick={handleUpdate} style={btnStyle(true)}>
                Update
              </button>
            </>
          )}
          {phase === "error" && (
            <>
              <button onClick={onClose} style={btnStyle(false)}>
                Close
              </button>
              <button onClick={handleUpdate} style={btnStyle(true)}>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
