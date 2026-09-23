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

import { request } from "@/lib/api";

export type Recording = {
  id: string; name: string; robot: string; groups: string[]; topics: string[];
  messages: number; duration: number; created_at: string;
  omitted_groups?: string[];
};
export type RecordPlayState = {
  phase: "idle" | "recording" | "loading" | "preparing" | "playing" | "returning" | "settling" | "completed" | "error";
  active: boolean; error: string | null; owner: string | null; recording_id: string | null;
  robot: string | null; cycle: number; repeats: number; elapsed: number; duration: number;
  return_duration: number; messages: number;
  rate?: number;
  arrival_tolerance_deg?: number;
};
export type RecordingGroup = { id: string; label: string; topic: string; receiving: boolean; recommended: boolean };
export type RecordPlayOverview = {
  state: RecordPlayState; groups: RecordingGroup[]; recordings: Recording[];
  feedback_ready: boolean; storage: string;
};
export const GROUP_LABELS: Record<string, string> = {
  arm: "Arm + gripper", arm_l: "Left arm + gripper", arm_r: "Right arm + gripper", head: "Neck", lift: "Lift",
  hand_l: "Left hand", hand_r: "Right hand",
};
export const PHASE_LABELS: Record<RecordPlayState["phase"], string> = {
  idle: "Idle", recording: "Recording", loading: "Checking recording", preparing: "Moving to start pose",
  playing: "Playing", returning: "Returning to start pose",
  settling: "Checking target arrival", completed: "Playback complete", error: "Stopped with error",
};
export function recordingTime(seconds: number) {
  const value = Math.max(0, seconds);
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}
export const getRecordPlay = () => request<RecordPlayOverview>({
  url: "/record-play", timeout: 5000,
});
export const getRecordPlayStatus = () => request<RecordPlayState>({ url: "/record-play/status", timeout: 5000 });
export const recordPlayCommand = (action: "record" | "play" | "stop", data?: object) =>
  request<RecordPlayState>({ method: "POST", url: `/record-play/${action}`, data, timeout: 10000 });
export const deleteRecording = (recordingId: string) => request<RecordPlayState>({
  method: "DELETE", url: `/record-play/recordings/${encodeURIComponent(recordingId)}`, timeout: 10000,
});
