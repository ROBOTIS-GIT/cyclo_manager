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
import { getSystemStats, getRobotInfo } from "@/lib/api";
import type { HostSystemStatsResponse, RobotInfoResponse } from "@/types/api";
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

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function gaugeColor(percent: number): string {
  if (percent >= 90) return "#f44336";
  if (percent >= 75) return "#ff9800";
  return "var(--vscode-button-background, #0078d4)";
}

// ─── primitives ─────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs font-semibold uppercase tracking-widest mb-3"
      style={{ color: "var(--vscode-descriptionForeground)" }}
    >
      {children}
    </h2>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border ${className}`}
      style={{
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sidebar-background)",
      }}
    >
      {children}
    </div>
  );
}

// ─── sub-components ─────────────────────────────────────────────────────────

function CircleGauge({
  fill,
  label,
  display,
  sub,
}: {
  fill: number;
  label: string;
  display?: string;
  sub?: string;
}) {
  const SIZE = 90;
  const STROKE = 7;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(fill, 100) / 100) * circumference;
  const color = gaugeColor(fill);
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="var(--vscode-input-background, rgba(128,128,128,0.2))"
          strokeWidth={STROKE}
        />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
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
          {display ?? `${fill}%`}
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
      className="flex items-start justify-between gap-3 py-2"
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

// ─── page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [cmUpdateBanner, setCmUpdateBanner] = useState(false);
  const [robotInfo, setRobotInfo] = useState<RobotInfoResponse | null>(null);
  const [systemStats, setSystemStats] = useState<HostSystemStatsResponse | null>(null);

  const loadAll = useCallback(async () => {
    await Promise.allSettled([
      getRobotInfo().then(setRobotInfo).catch(() => {}),
      getSystemStats().then(setSystemStats).catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadAll]);

  const memPct = systemStats ? pct(systemStats.memory_used_mb, systemStats.memory_total_mb) : 0;
  const diskPct = systemStats ? pct(systemStats.disk_used_gb, systemStats.disk_total_gb) : 0;

  return (
    <>
      <CycloManagerUpdateAnnouncement suppressed={false} onBannerVisibilityChange={setCmUpdateBanner} />
      <div className={`flex flex-col gap-6 max-w-4xl ${cmUpdateBanner ? "pt-14" : ""}`}>

        <div className="flex gap-4 items-stretch">

          {/* Robot Information */}
          <section className="w-56 shrink-0">
            <SectionHeading>Robot Information</SectionHeading>
            <Card className="h-[calc(100%-28px)]">
              <div className="px-4 pb-1">
                <InfoRow label="Hostname" value={robotInfo?.hostname} />
                <InfoRow label="OS" value={robotInfo?.os_info} />
                <InfoRow label="IP Address" value={robotInfo?.ip_address} />
                <InfoRow
                  label="Uptime"
                  value={systemStats ? formatUptime(systemStats.uptime_seconds) : undefined}
                />
              </div>
            </Card>
          </section>

          {/* System Status */}
          <section className="flex-1 min-w-0">
            <SectionHeading>System Status</SectionHeading>
            <Card className="h-[calc(100%-28px)]">
              {systemStats == null ? (
                <div className="p-5 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  Unavailable
                </div>
              ) : (
                <div className="p-5 flex gap-4 justify-around">
                  <CircleGauge fill={systemStats.cpu_percent} label="CPU" />
                  <CircleGauge
                    fill={memPct}
                    label="Memory"
                    sub={`${(systemStats.memory_used_mb / 1024).toFixed(1)} / ${(systemStats.memory_total_mb / 1024).toFixed(1)} GB`}
                  />
                  <CircleGauge
                    fill={diskPct}
                    label="Disk"
                    sub={`${systemStats.disk_used_gb} / ${systemStats.disk_total_gb} GB`}
                  />
                  {systemStats.temperature_celsius != null && (
                    <CircleGauge
                      fill={Math.round(systemStats.temperature_celsius)}
                      label="Temp"
                      display={`${systemStats.temperature_celsius}°C`}
                    />
                  )}
                </div>
              )}
            </Card>
          </section>

        </div>

      </div>
    </>
  );
}
