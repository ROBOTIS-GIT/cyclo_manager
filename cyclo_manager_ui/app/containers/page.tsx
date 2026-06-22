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
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getConfiguredContainers,
  getDockerContainers,
  controlDockerContainer,
} from "@/lib/api";
import type { ConfiguredContainerInfo, DockerContainerInfo } from "@/types/api";
import StatusBadge from "@/components/StatusBadge";
import CycloManagerUpdateAnnouncement from "@/components/CycloManagerUpdateAnnouncement";

const SLOTS: { label: string; containerName: string }[] = [
  { label: "ai worker", containerName: "ai_worker" },
  { label: "open manipulator", containerName: "open_manipulator" },
];

const btnStyle = (primary: boolean, disabled?: boolean): React.CSSProperties => ({
  padding: "4px 12px",
  fontSize: "12px",
  border: "none",
  borderRadius: "2px",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
  backgroundColor: primary
    ? "var(--vscode-button-background)"
    : "var(--vscode-button-secondaryBackground)",
  color: primary
    ? "var(--vscode-button-foreground)"
    : "var(--vscode-button-secondaryForeground)",
});

export default function ContainersPage() {
  const searchParams = useSearchParams();
  const destination = searchParams.get("to") === "topics" ? "topics" : "system";
  const [cmUpdateBanner, setCmUpdateBanner] = useState(false);
  const [configuredContainers, setConfiguredContainers] = useState<ConfiguredContainerInfo[]>([]);
  const [dockerContainers, setDockerContainers] = useState<DockerContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dockerLoading, setDockerLoading] = useState<string | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);

  const loadContainers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [containersRes, dockerRes] = await Promise.all([
        getConfiguredContainers(),
        getDockerContainers(true),
      ]);
      setConfiguredContainers(containersRes.containers);
      setDockerContainers(dockerRes.containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  const hasConfiguredContainer = (name: string) =>
    configuredContainers.some((c) => c.name === name);

  const findDockerContainer = (name: string): DockerContainerInfo | undefined =>
    dockerContainers.find(
      (d) => d.name === name || d.name === name.replace(/_/g, "-")
    );

  const handleDockerAction = async (
    dockerName: string,
    action: "start" | "stop" | "restart",
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDockerLoading(action);
    setDockerError(null);
    try {
      await controlDockerContainer(dockerName, action);
      await loadContainers();
    } catch (err) {
      setDockerError(err instanceof Error ? err.message : "Docker action failed");
      setTimeout(() => setDockerError(null), 4000);
    } finally {
      setDockerLoading(null);
    }
  };

  return (
    <>
      <CycloManagerUpdateAnnouncement
        suppressed={loading || !!error}
        onBannerVisibilityChange={setCmUpdateBanner}
      />
      {loading ? (
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ color: "var(--vscode-descriptionForeground)", backgroundColor: "var(--vscode-editor-background)" }}
        >
          Loading...
        </div>
      ) : error ? (
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{ backgroundColor: "var(--vscode-editor-background)" }}
        >
          <div
            className="border rounded p-4"
            style={{
              backgroundColor: "rgba(244, 135, 113, 0.1)",
              borderColor: "rgba(244, 135, 113, 0.3)",
              color: "var(--vscode-errorForeground)",
            }}
          >
            <p className="mb-2">{error}</p>
            <button onClick={loadContainers} style={btnStyle(true)}>Retry</button>
          </div>
        </div>
      ) : (
        <div
          className="min-h-screen flex flex-col p-6"
          style={{ backgroundColor: "var(--vscode-editor-background)" }}
        >
          <div className={`w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0 ${cmUpdateBanner ? "pt-14" : ""}`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0 w-full">
              {dockerError && (
                <div
                  className="mb-4 p-2 rounded text-sm"
                  style={{ backgroundColor: "rgba(244, 135, 113, 0.1)", color: "var(--vscode-errorForeground)" }}
                >
                  {dockerError}
                </div>
              )}
              <div className="flex flex-row justify-center gap-6">
                {SLOTS.filter(
                  (slot) =>
                    hasConfiguredContainer(slot.containerName) &&
                    findDockerContainer(slot.containerName) != null
                ).map((slot) => {
                  const docker = findDockerContainer(slot.containerName);
                  const isRunning = docker?.status?.toLowerCase() === "running";

                  return (
                    <Link key={slot.containerName} href={`/${slot.containerName}/${destination}`}>
                      <div
                        className="group rounded-lg border-2 p-6 cursor-pointer w-[32rem] h-[32rem] flex flex-col hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] hover:scale-[1.02] transition-all duration-150"
                        style={{
                          backgroundColor: "var(--vscode-sidebar-background)",
                          borderColor: "var(--vscode-panel-border)",
                        }}
                      >
                        <div className="font-medium text-lg flex items-center gap-2 flex-wrap" style={{ color: "var(--vscode-foreground)" }}>
                          {slot.label}
                          {docker && <StatusBadge status={docker.status} />}
                        </div>

                        <div className="flex-1 min-h-0 flex items-center justify-center">
                          {slot.containerName === "ai_worker" && (
                            <img
                              src="/ai_worker.png"
                              alt="AI Worker"
                              className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-150"
                            />
                          )}
                        </div>

                        <div className="mt-4 flex items-center gap-2 flex-shrink-0">
                          {isRunning ? (
                            <>
                              <button
                                onClick={(e) => handleDockerAction(docker!.name, "stop", e)}
                                disabled={dockerLoading !== null}
                                style={btnStyle(false, dockerLoading !== null)}
                              >
                                {dockerLoading === "stop" ? "Stopping..." : "Stop"}
                              </button>
                              <button
                                onClick={(e) => handleDockerAction(docker!.name, "restart", e)}
                                disabled={dockerLoading !== null}
                                style={btnStyle(false, dockerLoading !== null)}
                              >
                                {dockerLoading === "restart" ? "Restarting..." : "Restart"}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={(e) => handleDockerAction(docker!.name, "start", e)}
                              disabled={dockerLoading !== null}
                              style={btnStyle(true, dockerLoading !== null)}
                            >
                              {dockerLoading === "start" ? "Starting..." : "Start"}
                            </button>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
