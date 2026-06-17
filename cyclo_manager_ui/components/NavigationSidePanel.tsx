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
// Author: Howon Kim

"use client";

import type { ServiceStatusResponse } from "@/types/api";

type TopicInfo = {
  topic: string;
};

type NavigationSidePanelProps = {
  displayTopics: readonly TopicInfo[];
  mapName: string;
  status: ServiceStatusResponse | null;
  showGlobalCostmap: boolean;
  showGlobalPlan: boolean;
  showGoalPose: boolean;
  showLocalCostmap: boolean;
  showMap: boolean;
  showRobotModel: boolean;
  showScan: boolean;
  showTf: boolean;
  hasTopicData: (topic: string) => boolean;
  setShowGlobalCostmap: (value: boolean) => void;
  setShowGlobalPlan: (value: boolean) => void;
  setShowGoalPose: (value: boolean) => void;
  setShowLocalCostmap: (value: boolean) => void;
  setShowMap: (value: boolean) => void;
  setShowRobotModel: (value: boolean) => void;
  setShowScan: (value: boolean) => void;
  setShowTf: (value: boolean) => void;
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className="h-8 px-2 border flex items-center gap-2 text-xs font-medium"
      style={{
        color: "var(--vscode-foreground)",
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sidebar-background)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function TopicName({ topic }: { topic: string }) {
  if (topic === "/local_costmap/published_footprint") {
    return (
      <span className="font-mono min-w-0 leading-4">
        <span className="block">/local_costmap</span>
        <span className="block">/published_footprint</span>
      </span>
    );
  }

  return <span className="font-mono truncate min-w-0">{topic}</span>;
}

export function NavigationSidePanel({
  displayTopics,
  hasTopicData,
  mapName,
  status,
  showGlobalCostmap,
  showGlobalPlan,
  showGoalPose,
  showLocalCostmap,
  showMap,
  showRobotModel,
  showScan,
  showTf,
  setShowGlobalCostmap,
  setShowGlobalPlan,
  setShowGoalPose,
  setShowLocalCostmap,
  setShowMap,
  setShowRobotModel,
  setShowScan,
  setShowTf,
}: NavigationSidePanelProps) {
  return (
    <aside className="min-h-0 flex flex-col gap-3">
      <div
        className="border p-3 grid gap-2"
        style={{
          color: "var(--vscode-foreground)",
          borderColor: "var(--vscode-panel-border)",
          backgroundColor: "var(--vscode-sidebar-background)",
        }}
      >
        <div className="text-xs font-semibold">Layers</div>
        <div className="flex flex-wrap gap-2">
          <Toggle label="Map" checked={showMap} onChange={setShowMap} />
          <Toggle label="Global costmap" checked={showGlobalCostmap} onChange={setShowGlobalCostmap} />
          <Toggle label="Local costmap" checked={showLocalCostmap} onChange={setShowLocalCostmap} />
          <Toggle label="Lidar" checked={showScan} onChange={setShowScan} />
          <Toggle label="Global plan" checked={showGlobalPlan} onChange={setShowGlobalPlan} />
          <Toggle label="Goal Pose" checked={showGoalPose} onChange={setShowGoalPose} />
          <Toggle label="TF" checked={showTf} onChange={setShowTf} />
          <Toggle label="Robot Model" checked={showRobotModel} onChange={setShowRobotModel} />
        </div>
      </div>
      <div
        className="border p-3 grid gap-2 text-xs"
        style={{
          color: "var(--vscode-foreground)",
          borderColor: "var(--vscode-panel-border)",
          backgroundColor: "var(--vscode-sidebar-background)",
        }}
      >
        <div className="font-semibold">Topics</div>
        {displayTopics.map(({ topic }) => (
          <div key={topic} className="flex items-center justify-between gap-3 min-w-0">
            <TopicName topic={topic} />
            <span className="shrink-0" style={{ color: "var(--vscode-descriptionForeground)" }}>
              {hasTopicData(topic) ? "live" : "wait"}
            </span>
          </div>
        ))}
      </div>
      <div
        className="border p-3 grid gap-2 text-xs shrink-0"
        style={{
          color: "var(--vscode-descriptionForeground)",
          borderColor: "var(--vscode-panel-border)",
          backgroundColor: "var(--vscode-sidebar-background)",
        }}
      >
        <div>
          Map name: <span className="font-mono">{mapName || "-"}</span>
        </div>
        <div>
          PID: <span className="font-mono">{status?.pid ?? "-"}</span>
        </div>
      </div>
    </aside>
  );
}
