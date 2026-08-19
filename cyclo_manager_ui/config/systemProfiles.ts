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

import {
  BG2_CONFIG,
  BH5_CONFIG,
  F1_CONFIG,
  F2_CONFIG,
  LG2_CONFIG,
  MOBILE_CONFIG,
  OMY_CONFIG,
  OMY_L_CONFIG,
  OMX_CONFIG,
  OMX_L_CONFIG,
  SG2_CONFIG,
  SH5_CONFIG,
  type LaunchArgSelectOption,
  type LaunchArgsConfig,
} from "@/config/launchArgs";
import type { RobotType } from "@/types/api";

export type SystemTopic = {
  label: string;
  topic: string;
};

export type SystemControlTopic = {
  topic: string;
  msgType: string;
};

export type SystemRobotOption = LaunchArgSelectOption & {
  config: LaunchArgsConfig;
  robotType?: RobotType;
};

export type SystemProfile = {
  label: string;
  robotServiceName: string;
  leaderServiceName: string | null;
  robotTypeOptions: readonly SystemRobotOption[];
  leaderTypeOptions: readonly SystemRobotOption[];
  batteryTopics: readonly SystemTopic[];
  cameraTopics: readonly SystemTopic[];
  cameraTopicsByRobotType?: Partial<Record<RobotType, readonly SystemTopic[]>>;
};

const AI_WORKER_BATTERY_TOPICS = [
  { label: "Battery (Left)", topic: "/ai_worker/battery/left/state" },
  { label: "Battery (Right)", topic: "/ai_worker/battery/right/state" },
] as const;

const AI_WORKER_CAMERA_TOPICS = [
  { label: "Camera (Head)", topic: "/zed/zed_node/left/image_rect_color/compressed" },
  { label: "Camera (Wrist L)", topic: "/camera_left/camera_left/color/image_rect_raw/compressed" },
  { label: "Camera (Wrist R)", topic: "/camera_right/camera_right/color/image_rect_raw/compressed" },
] as const;

const AI_WORKER_F1_F2_CAMERA_TOPICS = [
  { label: "Camera (Head)", topic: "/camera_head/camera_head/color/image_raw/compressed" },
  { label: "Camera (Wrist L)", topic: "/camera_left/camera_left/color/image_rect_raw/compressed" },
  { label: "Camera (Wrist R)", topic: "/camera_right/camera_right/color/image_rect_raw/compressed" },
] as const;

const AI_WORKER_ROBOT_TYPE_OPTIONS = [
  { value: "sg2", label: "SG2", config: SG2_CONFIG, robotType: "sg2" },
  { value: "bg2", label: "BG2", config: BG2_CONFIG, robotType: "bg2" },
  { value: "sh5", label: "SH5", config: SH5_CONFIG, robotType: "sh5" },
  { value: "bh5", label: "BH5", config: BH5_CONFIG, robotType: "bh5" },
  { value: "f1", label: "F1", config: F1_CONFIG, robotType: "f1" },
  { value: "f2", label: "F2", config: F2_CONFIG, robotType: "f2" },
  { value: "mobile", label: "Mobile", config: MOBILE_CONFIG, robotType: "mobile" },
] as const;

const OPEN_MANIPULATOR_ROBOT_TYPE_OPTIONS = [
  { value: "omy", label: "OMY", config: OMY_CONFIG, robotType: "omy" },
  { value: "omx", label: "OMX", config: OMX_CONFIG, robotType: "omx" },
] as const;

const AI_WORKER_LEADER_TYPE_OPTIONS = [
  { value: "lg2", label: "LG2", config: LG2_CONFIG },
] as const;

const OPEN_MANIPULATOR_LEADER_TYPE_OPTIONS = [
  { value: "omy", label: "OMY-L", config: OMY_L_CONFIG, robotType: "omy" },
  { value: "omx", label: "OMX-L", config: OMX_L_CONFIG, robotType: "omx" },
] as const;

export const SYSTEM_PROFILES: Record<string, SystemProfile> = {
  ai_worker: {
    label: "AI Worker",
    robotServiceName: "ai_worker_bringup",
    leaderServiceName: "avatar_bringup",
    robotTypeOptions: AI_WORKER_ROBOT_TYPE_OPTIONS,
    leaderTypeOptions: AI_WORKER_LEADER_TYPE_OPTIONS,
    batteryTopics: AI_WORKER_BATTERY_TOPICS,
    cameraTopics: AI_WORKER_CAMERA_TOPICS,
    cameraTopicsByRobotType: {
      f1: AI_WORKER_F1_F2_CAMERA_TOPICS,
      f2: AI_WORKER_F1_F2_CAMERA_TOPICS,
    },
  },
  open_manipulator: {
    label: "Open Manipulator",
    robotServiceName: "open_manipulator_bringup",
    leaderServiceName: "leader_bringup",
    robotTypeOptions: OPEN_MANIPULATOR_ROBOT_TYPE_OPTIONS,
    leaderTypeOptions: OPEN_MANIPULATOR_LEADER_TYPE_OPTIONS,
    batteryTopics: [],
    cameraTopics: [],
  },
};

export function getSystemProfile(container: string): SystemProfile | null {
  return SYSTEM_PROFILES[container] ?? null;
}
