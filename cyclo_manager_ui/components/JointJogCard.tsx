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

import { HoldButton } from "@/components/JogControls";
import { secondary } from "@/components/ui/controlStyles";
import { formatJointPosition, POSITION_TOLERANCE } from "@/lib/jog";
import type { JogJoint } from "@/lib/jog";

function jointLabel(joint: JogJoint) {
  if (joint.name === "lift_joint") return "Lift";
  // Keep URDF names visible; pitch/yaw order varies between models.
  if (joint.group === "head") return `Neck ${joint.name.endsWith("1") ? "1" : "2"}`;
  if (joint.name.startsWith("gripper")) return joint.name.includes("_l_") ? "Left gripper" : "Right gripper";
  return `Joint ${joint.name.match(/\d+$/)?.[0] ?? ""}`;
}

type JointJogCardProps = {
  joint: JogJoint;
  enabled: boolean;
  active: boolean;
  onStart: (direction: -1 | 1) => void;
  onStop: () => void;
};

export default function JointJogCard({ joint, enabled, active, onStart, onStop }: JointJogCardProps) {
  const unit = joint.unit === "m" ? "mm" : "°";
  const canMove = enabled && joint.available;
  const range = joint.upper - joint.lower;
  const positionRatio = joint.position === null || range <= 0 ? null
    : Math.max(0, Math.min(1, (joint.position - joint.lower) / range));
  const targetPending = canMove && joint.position !== null && joint.target !== null
    && Math.abs(joint.target - joint.position) > POSITION_TOLERANCE[joint.unit];
  return <article aria-label={`${jointLabel(joint)} · ${joint.name}`}
    className="min-w-0 rounded-xl border p-4 md:p-5" style={{ background: "var(--vscode-editor-background)", borderColor: active ? "var(--vscode-focusBorder)" : "var(--vscode-panel-border)" }}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h3 className="text-base font-semibold">{jointLabel(joint)}</h3><div className="mt-1 text-[11px] font-mono break-all" style={secondary}>{joint.name}</div></div>
      <div className="flex gap-2 shrink-0">
        <HoldButton label={`Decrease ${joint.name}`} disabled={!canMove || (joint.position !== null && joint.position <= joint.lower)} onStart={() => onStart(-1)} onStop={onStop}>−</HoldButton>
        <HoldButton label={`Increase ${joint.name}`} disabled={!canMove || (joint.position !== null && joint.position >= joint.upper)} onStart={() => onStart(1)} onStop={onStop}>+</HoldButton>
      </div>
    </div>
    <dl className="grid gap-4 mt-5 tabular-nums" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))" }}>
      <div className="min-w-0">
        <dt className="text-xs" style={secondary}>Current{!joint.available && <span className="ml-2" style={{ color: "var(--vscode-errorForeground)" }}>{joint.position === null ? "No feedback" : "Stale"}</span>}</dt>
        <dd className="flex flex-wrap items-baseline gap-x-1.5 mt-1.5"><span className="text-3xl font-semibold tracking-tight">{formatJointPosition(joint.position, joint.unit)}</span><span className="text-sm" style={secondary}>{unit}</span></dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs" style={secondary}>Target</dt>
        <dd className="flex flex-wrap items-baseline gap-x-1.5 mt-1.5" style={targetPending ? { color: "var(--vscode-focusBorder)" } : secondary}><span className="text-3xl font-medium tracking-tight">{formatJointPosition(joint.target, joint.unit)}</span><span className="text-sm">{unit}</span></dd>
      </div>
    </dl>
    <div className="mt-6">
      <div className="relative h-1.5 rounded-full" style={{ background: "var(--vscode-panel-border)" }}
        role={positionRatio === null ? undefined : "meter"} aria-label={`${jointLabel(joint)} position`}
        aria-valuemin={joint.lower} aria-valuemax={joint.upper}
        aria-valuenow={positionRatio === null ? undefined : joint.lower + positionRatio * range}
        aria-valuetext={`${formatJointPosition(joint.position, joint.unit)} ${unit}${!joint.available ? " (unavailable)" : ""}`}>
        {positionRatio !== null && <>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${positionRatio * 100}%`, background: "var(--vscode-focusBorder)", opacity: joint.available ? 0.35 : 0.15 }} />
          <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${positionRatio * 100}%`, background: joint.available ? "var(--vscode-focusBorder)" : "var(--vscode-descriptionForeground)", borderColor: "var(--vscode-editor-background)" }} />
        </>}
      </div>
      <div className="flex justify-between gap-3 mt-2 text-[11px] tabular-nums" style={secondary}><span>{formatJointPosition(joint.lower, joint.unit)} {unit}</span><span>{formatJointPosition(joint.upper, joint.unit)} {unit}</span></div>
    </div>
  </article>;
}
