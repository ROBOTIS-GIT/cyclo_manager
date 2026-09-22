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

import { request } from "./client";
import type { ROS2TopicInfoResponse, ROS2TopicsListResponse } from "@/types/api";

export async function getRobotDescription(topic: string, signal: AbortSignal) {
  return request<{ topic: string; data: unknown }>({
    method: "GET", url: "/ros2/robot-description", params: { topic }, signal,
  });
}

export async function checkCameraFrame(topic: string, signal: AbortSignal) {
  return request<{ topic: string; received: boolean; checked_at: number }>({
    method: "POST", url: "/ros2/camera/check", data: { topic }, signal,
  });
}

export async function getROS2Topics(): Promise<ROS2TopicsListResponse> {
  return request<ROS2TopicsListResponse>({ method: "GET", url: "/ros2/topics" });
}

export async function getROS2TopicInfo(topic: string): Promise<ROS2TopicInfoResponse> {
  return request<ROS2TopicInfoResponse>({
    method: "GET",
    url: `/ros2/topics/${encodeURIComponent(topic)}/info`,
  });
}
