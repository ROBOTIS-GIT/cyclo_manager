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

import ObserverConnectionNotice from "@/components/ObserverConnectionNotice";
import { useSystemTelemetry } from "@/hooks/useSystemTelemetry";
import type { SystemProfile } from "@/config/systemProfiles";
import type { RobotType, ServiceStatusResponse } from "@/types/api";
import CameraStatusRow from "./CameraStatusRow";

interface Props {
  profile: SystemProfile;
  robotType: string;
  bringup: ServiceStatusResponse | null;
  viewerReloadKey: string;
}

export default function SystemRobotStatus({ profile, robotType, bringup, viewerReloadKey }: Props) {
  const batteryTopics = profile.batteryTopics;
  const cameraTopics = profile.cameraTopicsByRobotType?.[robotType as RobotType] ?? profile.cameraTopics;
  const { batteries: batteryPercentage, cameras: cameraPublishers,
    connection: statusConnection, reconnect: reconnectStatus } = useSystemTelemetry(
      batteryTopics.map(item => item.topic), cameraTopics.map(item => item.topic), true,
    );

  return (
    <div
      className="rounded border overflow-hidden"
      style={{
        backgroundColor: "var(--vscode-sidebar-background)",
        borderColor: "var(--vscode-panel-border)",
      }}
    >
      <div
        className="px-5 pt-4 pb-1 text-sm font-bold uppercase tracking-widest"
        style={{ color: "var(--vscode-foreground)" }}
      >
        Robot Status
      </div>
      <div className="px-5 pb-3">
        <ObserverConnectionNotice connection={statusConnection} reconnect={reconnectStatus} />
        {[
          {
            label: "Bringup",
            value: bringup === null ? null : bringup.is_up ? "Running" : "Stopped",
            ok: bringup?.is_up ?? null,
          },
          ...batteryTopics.map(({ label, topic }) => {
            const pct = batteryPercentage[topic] ?? null;
            return {
              label,
              value: pct !== null ? `${pct}%` : null,
              ok: pct !== null ? pct > 20 : null,
            };
          }),
        ].map(({ label, value, ok }) => (
          <div
            key={label}
            className="flex items-start justify-between gap-3 py-2 text-sm"
          >
            <span className="shrink-0" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {label}
            </span>
            <span
              className="text-right font-bold break-all"
              style={{
                color: ok === null || value === null
                  ? "var(--vscode-descriptionForeground)"
                  : ok === false
                  ? "var(--vscode-errorForeground)"
                  : "var(--vscode-testing-iconPassed, #73c991)",
              }}
            >
              {value ?? "—"}
            </span>
          </div>
        ))}
        {cameraTopics.map(({ label, topic }) => <CameraStatusRow
          key={`${viewerReloadKey}:${topic}`} label={label} topic={topic}
          publisher={cameraPublishers[topic] ?? null} />)}
      </div>
    </div>
  );
}
