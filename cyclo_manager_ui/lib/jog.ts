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

// UI labels and the resolution type come from the same increment list.
// Values must match JOINT_INCREMENTS in cyclo_manager/jog.py.
export const JOINT_INCREMENTS = [
  { value: "fine", millimetres: 1, degrees: 0.1 },
  { value: "normal", millimetres: 10, degrees: 1 },
  { value: "coarse", millimetres: 15, degrees: 3 },
  { value: "large", millimetres: 20, degrees: 5 },
] as const;

// SI units, matching the server's measured-completion tolerances.
export const POSITION_TOLERANCE = { m: 0.0001, rad: Math.PI / 18000 };
export const JOINT_HOLD_DELAY_MS = 350;
export const COMMAND_MIN_INTERVAL_MS = 90;
export const JOG_POLL_INTERVAL_MS = 100;
export const FEEDBACK_TIMEOUT_MS = 700;
export const BRINGUP_POLL_INTERVAL_MS = 2000;
export const BASE_TRANSLATION = { min: 0.05, max: 0.3, step: 0.05, initial: 0.1 };
export const BASE_ROTATION = { min: 0.1, max: 0.6, step: 0.1, initial: 0.2 };

export type JogResolution = typeof JOINT_INCREMENTS[number]["value"];

export type JogCommand =
  | { kind: "idle" | "stop" }
  | { kind: "base"; x: number; y: number; yaw: number }
  | { kind: "joint"; joint: string; direction: -1 | 1; mode: "hold" | "step"; resolution: JogResolution };

export type JogJoint = {
  name: string; group: string; topic: string; unit: "m" | "rad";
  lower: number; upper: number;
  position: number | null; target: number | null; available: boolean;
};
export type JogState = {
  robot_type: string; base_supported: boolean; feedback_fresh: boolean;
  feedback_age: number | null; description_available: boolean;
  base: [number, number, number]; joints: JogJoint[]; wheels: Record<string, number>;
};

export function formatJointPosition(value: number | null, unit: JogJoint["unit"]) {
  return value === null ? "—" : (unit === "m" ? value * 1000 : value * 180 / Math.PI).toFixed(1);
}
