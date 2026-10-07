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
import LaunchArgsSettingPopup from "@/components/LaunchArgsSettingPopup";
import ContainerControlBox from "./ContainerControlBox";
import ServiceControlBox from "./ServiceControlBox";
import type { SystemProfile } from "@/config/systemProfiles";
import type { SystemLogTarget } from "@/config/systemServices";
import type { SystemLaunchSettings } from "@/hooks/system/useSystemLaunchSettings";
import type { SystemServices } from "@/hooks/system/useSystemServices";

const TOOLBAR_HELP_TEXT: Record<SystemLogTarget, string> = {
  robot:
    "Starts and stops the robot bringup service. The dot shows status — green is running, red is stopped.",
  leader:
    "Starts and stops the leader bringup service. The dot shows status — green is running, red is stopped.",
  intelligence:
    "Starts and stops the Cyclo Intelligence service in its container.",
  zenoh:
    "Starts and stops the Zenoh daemon Docker container. The dot shows container state — green running, red stopped. If you use zenoh as ros middleware, you need to run the zenoh daemon.",
};

const TOOLBAR_HELP_ARIA: Record<SystemLogTarget, string> = {
  robot: "Robot help",
  leader: "Leader help",
  intelligence: "Cyclo Intelligence help",
  zenoh: "Zenoh Daemon help",
};


interface Props {
  profile: SystemProfile;
  settings: SystemLaunchSettings;
  services: SystemServices;
  log: SystemLogTarget | null;
  onToggleLog: (target: SystemLogTarget) => void;
}

export default function SystemServiceToolbar({ profile, settings, services, log, onToggleLog }: Props) {
  const [argsPopup, setArgsPopup] = useState<"robot" | "leader" | null>(null);
  const launchControls = [
    { key: "robot", title: "Robot", options: profile.robotTypeOptions, onToggle: services.toggleRobot },
    { key: "leader", title: "Leader", options: profile.leaderTypeOptions, onToggle: services.toggleLeader },
  ] as const;

  return (
    <div
      className="system-services grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-wrap items-stretch gap-2 xl:gap-0 border-b py-2"
      style={{
        backgroundColor: "var(--vscode-editor-background)",
        borderColor: "var(--vscode-panel-border)",
        boxShadow: "0 1px 0 0 rgba(0,0,0,0.15)",
      }}
    >
      {launchControls.map(({ key, title, options, onToggle }) => {
        const launch = settings[key];
        const service = services[key];
        return <ServiceControlBox
          key={key}
          title={title}
          status={service.status}
          loading={service.loading}
          onToggle={onToggle}
          showLogs={log === key}
          onToggleLogs={() => onToggleLog(key)}
          onSettings={key === "leader" || launch.config.args.length > 0 ? () => setArgsPopup(key) : undefined}
          typeSelect={{ value: launch.value, onChange: launch.select,
            disabled: service.loading || service.status?.is_up === true, options }}
          help={{ text: TOOLBAR_HELP_TEXT[key], ariaLabel: TOOLBAR_HELP_ARIA[key] }}
        />;
      })}
      <ServiceControlBox
        title="Cyclo Intelligence"
        status={services.intelligence.status}
        loading={services.intelligence.loading}
        disabled={!services.intelligenceContainerRunning}
        onToggle={services.toggleIntelligence}
        showLogs={log === "intelligence"}
        onToggleLogs={() => onToggleLog("intelligence")}
        help={{ text: TOOLBAR_HELP_TEXT.intelligence, ariaLabel: TOOLBAR_HELP_ARIA.intelligence }}
      />
      <ContainerControlBox
        title="Zenoh Daemon"
        status={services.zenohStatus}
        loading={services.zenohLoading}
        onToggle={services.toggleZenoh}
        showLogs={log === "zenoh"}
        onToggleLogs={() => onToggleLog("zenoh")}
        help={{ text: TOOLBAR_HELP_TEXT.zenoh, ariaLabel: TOOLBAR_HELP_ARIA.zenoh }}
      />
      <div className="hidden xl:block flex-1 min-w-[8px]" style={{ flexBasis: 0 }} aria-hidden />
      {(services.robot.error || services.leader.error) && (
        <div className="flex gap-3 w-full mt-2">
          {launchControls.map(({ key, title }) => services[key].error && (
            <div key={key} className="text-sm px-3 py-2 rounded-md flex-1" style={{
              color: "var(--vscode-errorForeground)",
              backgroundColor: "rgba(244, 135, 113, 0.1)",
              border: "1px solid rgba(244, 135, 113, 0.3)",
            }}>
              {title}: {services[key].error}
            </div>
          ))}
        </div>
      )}
      {argsPopup && <LaunchArgsSettingPopup
        open
        onClose={() => setArgsPopup(null)}
        config={settings[argsPopup].config}
        args={settings[argsPopup].args}
        onChange={settings[argsPopup].setArgs}
        serialPorts={services.serialPorts}
      />}
    </div>
  );
}
