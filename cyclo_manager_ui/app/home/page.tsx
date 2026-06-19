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
import {
  getConfiguredContainers,
  getServiceStatuses,
  getSystemStats,
  getRobotInfo,
} from "@/lib/api";
import type {
  ServiceStatusResponse,
  HostSystemStatsResponse,
  RobotInfoResponse,
} from "@/types/api";
import CycloManagerUpdateAnnouncement from "@/components/CycloManagerUpdateAnnouncement";

const POLL_INTERVAL = 5000;

// ─── helpers ────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function gaugeColor(percent: number): string {
  if (percent >= 90) return "#f44336";
  if (percent >= 75) return "#ff9800";
  return "var(--vscode-button-background, #0078d4)";
}

function tempColor(c: number): string {
  if (c >= 85) return "#f44336";
  if (c >= 70) return "#ff9800";
  return "var(--vscode-foreground)";
}

// ─── sub-components ─────────────────────────────────────────────────────────

function CircleGauge({
  percent,
  label,
  sub,
  valueText,
  arcPercent,
}: {
  percent?: number;
  label: string;
  sub?: string;
  valueText?: string;
  arcPercent?: number;
}) {
  const size = 90;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = arcPercent ?? percent ?? 0;
  const offset = circumference - (Math.min(arc, 100) / 100) * circumference;
  const color = gaugeColor(arc);
  const cx = size / 2;
  const cy = size / 2;
  const display = valueText ?? `${percent}%`;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="var(--vscode-input-background, rgba(128,128,128,0.2))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text
          x={cx} y={cy - 9}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="10" fontWeight="500"
          fill="var(--vscode-descriptionForeground)"
        >
          {label}
        </text>
        <text
          x={cx} y={cy + 8}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="13" fontWeight="700"
          fill={color}
        >
          {display}
        </text>
      </svg>
      {sub && (
        <div className="text-xs text-center" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div
      className="flex items-start justify-between gap-3 py-2 text-sm"
      style={{ borderTop: "1px solid var(--vscode-panel-border)" }}
    >
      <span className="shrink-0 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
        {label}
      </span>
      <span
        className="text-right font-bold break-all text-xs"
        style={{ color: value ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)" }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function ServiceRow({ s, container }: { s: ServiceStatusResponse; container: string }) {
  return (
    <div
      className="flex items-center gap-3 py-2.5 px-4"
      style={{ borderTop: "1px solid var(--vscode-panel-border)" }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{
          backgroundColor: s.is_up
            ? "var(--vscode-testing-iconPassed, #4caf50)"
            : "var(--vscode-descriptionForeground)",
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: "var(--vscode-foreground)" }}>
          {s.service_label ?? s.service}
        </div>
        <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {container}
          {s.is_up && s.uptime_seconds != null && (
            <span className="ml-2">· {formatUptime(s.uptime_seconds)}</span>
          )}
        </div>
      </div>
      <span
        className="text-xs px-2 py-0.5 rounded shrink-0"
        style={{
          backgroundColor: s.is_up ? "rgba(76, 175, 80, 0.15)" : "rgba(128, 128, 128, 0.15)",
          color: s.is_up
            ? "var(--vscode-testing-iconPassed, #4caf50)"
            : "var(--vscode-descriptionForeground)",
        }}
      >
        {s.is_up ? "running" : "stopped"}
      </span>
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [cmUpdateBanner, setCmUpdateBanner] = useState(false);
  const [robotInfo, setRobotInfo] = useState<RobotInfoResponse | null>(null);
  const [systemStats, setSystemStats] = useState<HostSystemStatsResponse | null>(null);
  const [allServices, setAllServices] = useState<{ container: string; service: ServiceStatusResponse }[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);

  const loadRobotInfo = useCallback(async () => {
    try { setRobotInfo(await getRobotInfo()); } catch {}
  }, []);

  const loadSystemStats = useCallback(async () => {
    try { setSystemStats(await getSystemStats()); } catch {}
  }, []);

  const loadServices = useCallback(async () => {
    try {
      const { containers } = await getConfiguredContainers();
      const results = await Promise.allSettled(
        containers.map(async (c) => {
          const res = await getServiceStatuses(c.name);
          return res.statuses.map((s) => ({ container: c.name, service: s }));
        })
      );
      setAllServices(results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
    } catch {} finally {
      setAppsLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.allSettled([loadRobotInfo(), loadSystemStats(), loadServices()]);
  }, [loadRobotInfo, loadSystemStats, loadServices]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadAll]);

  const memPct = systemStats ? pct(systemStats.memory_used_mb, systemStats.memory_total_mb) : 0;
  const diskPct = systemStats ? pct(systemStats.disk_used_gb, systemStats.disk_total_gb) : 0;
  const runningCount = allServices.filter((x) => x.service.is_up).length;

  return (
    <>
      <CycloManagerUpdateAnnouncement suppressed={false} onBannerVisibilityChange={setCmUpdateBanner} />
      <div className={`flex flex-col gap-6 max-w-4xl ${cmUpdateBanner ? "pt-14" : ""}`}>

        {/* ── Top row: Robot Information + System Status ── */}
        <div className="flex gap-4 items-stretch">

          {/* Robot Information */}
          <section className="w-56 shrink-0">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Robot Information
            </h2>
            <div
              className="rounded-lg border h-[calc(100%-28px)]"
              style={{ borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)" }}
            >
              <div className="px-4 pb-1">
                <InfoRow label="Hostname" value={robotInfo?.hostname} />
                <InfoRow label="OS" value={robotInfo?.os_info} />
                <InfoRow label="IP Address" value={robotInfo?.ip_address} />
                <InfoRow
                  label="Uptime"
                  value={systemStats ? formatUptime(systemStats.uptime_seconds) : undefined}
                />
              </div>
            </div>
          </section>

          {/* System Status */}
          <section className="flex-1 min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--vscode-descriptionForeground)" }}>
              System Status
            </h2>
            <div
              className="rounded-lg border h-[calc(100%-28px)]"
              style={{ borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)" }}
            >
              {systemStats == null ? (
                <div className="p-5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Unavailable
                </div>
              ) : (
                <div className="p-5 flex flex-col gap-4 h-full">
                  {/* Circles */}
                  <div className="flex gap-4 justify-around">
                    <CircleGauge percent={systemStats.cpu_percent} label="CPU" />
                    <CircleGauge
                      percent={memPct}
                      label="Memory"
                      sub={`${(systemStats.memory_used_mb / 1024).toFixed(1)} / ${(systemStats.memory_total_mb / 1024).toFixed(1)} GB`}
                    />
                    <CircleGauge
                      percent={diskPct}
                      label="Disk"
                      sub={`${systemStats.disk_used_gb} / ${systemStats.disk_total_gb} GB`}
                    />
                    {systemStats.temperature_celsius != null && (
                      <CircleGauge
                        label="Temp"
                        valueText={`${systemStats.temperature_celsius}°C`}
                        arcPercent={Math.round((systemStats.temperature_celsius / 100) * 100)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── Running Applications ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Running Applications
            </h2>
            {!appsLoading && (
              <span className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
                {runningCount} / {allServices.length} running
              </span>
            )}
          </div>
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--vscode-panel-border)", backgroundColor: "var(--vscode-sidebar-background)" }}
          >
            {appsLoading ? (
              <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                Loading...
              </div>
            ) : allServices.length === 0 ? (
              <div className="p-4 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                No services found
              </div>
            ) : (
              [...allServices]
                .sort((a, b) => Number(b.service.is_up) - Number(a.service.is_up))
                .map(({ container, service }, i) => (
                  <div key={`${container}/${service.service}`} style={i === 0 ? { borderTop: "none" } : {}}>
                    <ServiceRow s={service} container={container} />
                  </div>
                ))
            )}
          </div>
        </section>

      </div>
    </>
  );
}
