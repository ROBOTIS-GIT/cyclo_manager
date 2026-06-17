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

// TypeScript types matching the cyclo_manager API Pydantic models

export interface ServiceInfo {
  id: string;
  label: string;
}

export interface ConfiguredContainerInfo {
  name: string;
  socket_path: string;
}

export interface ConfiguredContainerListResponse {
  containers: ConfiguredContainerInfo[];
}

export interface ServiceListResponse {
  container: string;
  services: ServiceInfo[];
}

export interface ServiceStatusResponse {
  container: string;
  service: string;
  service_label: string | null;
  name: string;
  raw: string;
  is_up: boolean;
  pid: number | null;
  uptime_seconds: number | null;
}

export interface ServiceStatusListResponse {
  container: string;
  statuses: ServiceStatusResponse[];
}

export interface ServiceActionRequest {
  action: "up" | "down" | "restart";
  launch_args?: Record<string, string>;
  robot_type?: "sg2" | "bg2" | "sh5" | "bh5" | "mobile";
  navigation_type?: "map" | "nav";
}

export interface ServiceControlResponse {
  container: string;
  service: string;
  action: "up" | "down" | "restart";
  result: string;
}

export interface PgmFileInfo {
  path: string;
  name: string;
}

export interface PgmFileListResponse {
  container: string;
  files: PgmFileInfo[];
}

export interface PgmImageResponse {
  container: string;
  path: string;
  width: number;
  height: number;
  maxval: number;
  pixels_base64: string;
}

export interface PgmSaveResponse {
  container: string;
  path: string;
  width: number;
  height: number;
  saved: boolean;
}

export interface ServiceLogsResponse {
  container: string;
  service: string;
  logs: string;
  tail: number;
  log_path: string | null;
}

export interface ServiceLogsClearResponse {
  container: string;
  service: string;
  message: string;
  log_path: string | null;
}

export interface ServiceRunScriptResponse {
  container: string;
  service: string;
  path: string;
  content: string;
}

export interface BashrcResponse {
  container: string;
  path: string;
  content: string;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  status: string;
  image: string;
  created: string;
}

export interface DockerContainerListResponse {
  containers: DockerContainerInfo[];
}

export interface DockerContainerStatus {
  id: string;
  name: string;
  status: string;
  state: string;
  running: boolean;
  restarting: boolean;
  paused: boolean;
  image: string;
  created: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
}

export interface DockerContainerActionRequest {
  action: "start" | "stop" | "restart";
  timeout?: number;
}

export interface DockerContainerActionResponse {
  name: string;
  action: "start" | "stop" | "restart";
  result: string;
}

export interface DockerContainerLogsResponse {
  container: string;
  logs: string;
  tail: number;
}

export interface DockerTopResponse {
  container: string;
  titles: string[];
  processes: string[][];
}

export interface RepoVersionResponse {
  container: string;
  current: string;
  latest: string;
  update_available: boolean;
}

export interface CycloManagerVersionResponse {
  current: string;
  latest: string;
  update_available: boolean;
}

export interface ErrorResponse {
  error: string;
  detail: string | null;
}

// ROS2 Plugin Types

export interface ROS2TopicStatus {
  topic: string;
  msg_type: string;
  available: boolean;
  subscribed: boolean;
}

export interface ROS2TopicsListResponse {
  container: string;
  domain_id: number;
  topics: ROS2TopicStatus[];
}

export interface ROS2TopicDataResponse {
  container: string;
  topic: string;
  msg_type: string;
  data: any;
  available: boolean;
  domain_id: number;
}

export interface ROS2TwistPublishRequest {
  linear_x: number;
  angular_z: number;
  topic?: string;
}

export interface ROS2TopicPublishRequest {
  msg_type: string;
  data: Record<string, any>;
}

export interface ROS2NavigateToPoseGoalRequest {
  pose: Record<string, any>;
  behavior_tree?: string;
}
