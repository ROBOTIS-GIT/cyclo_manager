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
import { Card, CircleGauge, ContainerRow, formatUptime, InfoRow, InfoStatusRow, pct } from "@/components/dashboard/DashboardComponents";
import DockerImagesModal from "@/components/dashboard/DockerImagesModal";
import CpuUsageModal from "@/components/dashboard/CpuUsageModal";
import ContainerSettingsModal from "@/components/dashboard/ContainerSettingsModal";
import VersionManagementPanel from "@/components/dashboard/VersionManagementPanel";
import { useDashboardData } from "@/hooks/dashboard/useDashboardData";
import { useContainerSettings } from "@/hooks/dashboard/useContainerSettings";

export default function HomePage() {
  const { robotInfo, systemStats, containers, actionLoading, handleAction, versionManagementInternetStatus } = useDashboardData();
  const settings = useContainerSettings();
  const [showDockerImages, setShowDockerImages] = useState(false);
  const [showCpuUsage, setShowCpuUsage] = useState(false);

  const memPct = systemStats ? pct(systemStats.memory_used_mb, systemStats.memory_total_mb) : 0;
  const diskPct = systemStats ? pct(systemStats.disk_used_gb, systemStats.disk_total_gb) : 0;
  const ssdPct =
    systemStats?.ssd_used_gb != null && systemStats.ssd_total_gb != null
      ? pct(systemStats.ssd_used_gb, systemStats.ssd_total_gb)
      : 0;
  const hasSsdStats = systemStats?.ssd_used_gb != null && systemStats.ssd_total_gb != null;
  const storageLabel = systemStats?.ssd_mount_path === "/data" ? "SD" : "SSD";
  const systemGaugeSize = hasSsdStats ? 96 : 110;
  const settingsDocker = containers.find((c) => c.name === settings.settingsContainer) ?? null;

  return (
    <>
      {showDockerImages && (
        <DockerImagesModal onClose={() => setShowDockerImages(false)} />
      )}
      {showCpuUsage && (
        <CpuUsageModal summary={systemStats} onClose={() => setShowCpuUsage(false)} />
      )}
      <div className="flex flex-col gap-6">

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-4 items-stretch">

          {/* Robot Information */}
          <section>
            <Card title="Robot Information" className="h-full">
              <div className="px-5 pb-2">
                <InfoRow label="Hostname" value={robotInfo?.hostname} />
                <InfoRow label="OS" value={robotInfo?.os_info} />
                <InfoRow label="IP Address" value={robotInfo?.ip_address} />
                <InfoStatusRow label="Internet" value={robotInfo?.internet_connected} />
                <InfoRow
                  label="Uptime"
                  value={systemStats ? formatUptime(systemStats.uptime_seconds) : undefined}
                />
              </div>
            </Card>
          </section>

          {/* System Status */}
          <section>
            <Card title="System Status" className="h-full">
              {systemStats == null ? (
                <div className="p-5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Unavailable
                </div>
              ) : (
                <div
                  className="p-4 grid grid-cols-2 sm:flex sm:flex-wrap justify-around"
                  style={{ gap: hasSsdStats ? 12 : 24 }}
                >
                  <button
                    type="button"
                    onClick={() => setShowCpuUsage(true)}
                    title="CPU usage (3s average) — show processes"
                    aria-label="Show CPU processes"
                    className="rounded-md transition-opacity hover:opacity-80 focus:outline-none"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    <CircleGauge
                      fill={systemStats.cpu_percent}
                      display={`${systemStats.cpu_percent.toFixed(1)}%`}
                      label="CPU"
                      size={systemGaugeSize}
                    />
                  </button>
                  <CircleGauge
                    fill={memPct} label="Memory"
                    sub={`${(systemStats.memory_used_mb / 1024).toFixed(1)} / ${(systemStats.memory_total_mb / 1024).toFixed(1)} GB`}
                    size={systemGaugeSize}
                  />
                  <CircleGauge
                    fill={diskPct} label="System"
                    sub={`${systemStats.disk_used_gb} / ${systemStats.disk_total_gb} GB`}
                    size={systemGaugeSize}
                  />
                  {hasSsdStats && (
                    <CircleGauge
                      fill={ssdPct}
                      label={storageLabel}
                      sub={`${systemStats.ssd_used_gb} / ${systemStats.ssd_total_gb} GB`}
                      size={systemGaugeSize}
                    />
                  )}
                  {systemStats.temperature_celsius != null && (
                    <CircleGauge
                      fill={Math.round(systemStats.temperature_celsius)}
                      label="Temp"
                      display={`${systemStats.temperature_celsius}°C`}
                      size={systemGaugeSize}
                    />
                  )}
                </div>
              )}
            </Card>
          </section>

        </div>

        {/* ── Bottom row: 2 columns ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4 items-start">

        <section>
          <Card
            title="Container Management"
            action={
              <button
                onClick={() => setShowDockerImages(true)}
                title="Docker images"
                aria-label="Docker images"
                className="docker-images-action"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "var(--docker-images-size, 30px)",
                  height: "var(--docker-images-size, 30px)",
                  padding: 0,
                  border: "none",
                  borderRadius: "50%",
                  cursor: "pointer",
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-secondaryForeground)",
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </button>
            }
          >
            {containers.length === 0 ? (
              <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                No containers found
              </div>
            ) : (
              containers.map((c) => {
                const busy = actionLoading?.container === c.name;
                return (
                  <div
                    key={c.id}
                    className="mx-4 my-1 rounded-md border overflow-hidden"
                    style={{
                      borderColor: "var(--vscode-panel-border)",
                      backgroundColor: "transparent",
                    }}
                  >
                    <ContainerRow
                      container={c}
                      onAction={(action) => handleAction(c.name, action)}
                      onOpenLog={() => settings.openLog(c.name)}
                      onOpenBashrc={() => settings.openBashrc(c.name)}
                      busy={busy}
                      busyAction={busy ? actionLoading!.action : null}
                      bordered={false}
                    />
                  </div>
                );
              })
            )}
          </Card>
        </section>

        <VersionManagementPanel internetStatus={versionManagementInternetStatus} />

        </div>

      </div>

      {settingsDocker && <ContainerSettingsModal container={settingsDocker} settings={settings} />}

    </>
  );
}
