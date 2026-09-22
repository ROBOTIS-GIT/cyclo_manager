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

import { useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSystemProfile, type SystemProfile } from "@/config/systemProfiles";
import type { SystemLogTarget } from "@/config/systemServices";
import { useSystemLaunchSettings } from "@/hooks/system/useSystemLaunchSettings";
import { useSystemServices } from "@/hooks/system/useSystemServices";
import Robot3DViewer from "@/components/Robot3DViewer";
import SystemServiceToolbar from "@/components/system/SystemServiceToolbar";
import SystemRobotStatus from "@/components/system/SystemRobotStatus";
import SystemLogPanel from "@/components/system/SystemLogPanel";

const subscribeToHydration = () => () => {};

function SystemContent({ container, profile }: { container: string; profile: SystemProfile }) {
  const settings = useSystemLaunchSettings(container, profile);
  const services = useSystemServices(container, profile, settings);
  const [log, setLog] = useState<SystemLogTarget | null>(null);
  const viewerReloadKey = `${container}:${settings.robot.value}:${services.robot.status?.is_up}:${services.robot.status?.pid}`;

  return (
    <div className="system-page relative flex flex-col">
      <SystemServiceToolbar
        profile={profile} settings={settings} services={services} log={log}
        onToggleLog={target => setLog(current => current === target ? null : target)}
      />
      <div className="flex flex-col lg:flex-row gap-4 items-stretch mt-4 flex-1 min-h-0">
        <div className="w-full lg:w-[500px] max-w-full flex-none flex flex-col gap-4">
          <Robot3DViewer reloadKey={viewerReloadKey}
            descriptionEnabled={services.robot.status?.is_up === true} />
          <SystemRobotStatus profile={profile} robotType={settings.robot.value}
            bringup={services.robot.status} />
        </div>
        <SystemLogPanel target={log} container={container} profile={profile} onClose={() => setLog(null)} />
      </div>
    </div>
  );
}

export default function SystemPage() {
  const params = useParams();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const container = (params.container as string) ?? "";
  const profile = getSystemProfile(container);
  if (!container || !profile) {
    return (
      <div style={{ color: "var(--vscode-foreground)" }}>
        {!container ? "Missing container." : `Unsupported robot container: ${container}.`}{" "}
        <Link href="/app" className="underline">Back to Apps</Link>
      </div>
    );
  }
  // Read saved model settings before mounting telemetry or the robot viewer.
  if (!hydrated) return null;
  return <SystemContent key={container} container={container} profile={profile} />;
}
