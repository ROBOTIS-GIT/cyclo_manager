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
  robot_container: string;
}

export interface S6AgentStatusResponse {
  container: string;
  status: "ok" | "outdated" | "unreachable" | "unknown_version";
  version: string | null;
  minimum_required_version: string;
  update_required: boolean;
  message: string | null;
}

export interface S6AgentStatusListResponse {
  agents: S6AgentStatusResponse[];
}

export interface S6AgentUpdateResponse {
  container: string;
  target_ref: string;
  success: boolean;
  exit_code: number;
  output: string;
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
}

export interface ServiceControlResponse {
  container: string;
  service: string;
  action: "up" | "down" | "restart";
  result: string;
}

export interface ServiceLogsClearResponse {
  container: string;
  service: string;
  message: string;
  log_path: string | null;
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

export interface RepoUpdateStatus {
  name: string;
  branch: string | null;
  current_version: string | null;
  latest_version: string | null;
  has_update: boolean;
}

export interface RepoUpdatesResponse {
  repos: RepoUpdateStatus[];
  workspace_path: string;
}

export interface FileChange {
  path: string;
  status: string;
}

export interface RepoStatusResponse {
  name: string;
  changes: FileChange[];
  has_changes: boolean;
}

export interface RepoBranchCheckResponse {
  name: string;
  branch: string | null;
  allowed: boolean;
}

export interface UpdateRequest {
  strategy: "stash" | "reset";
  preserve_files: string[];
}

export interface UpdateStatusResponse {
  phase: string;
  output: string;
  error: string;
}

export interface UpdateResponse {
  name: string;
  success: boolean;
  output: string;
  stash_conflict: boolean;
  stash_conflict_files: string[];
}

export interface ContainerScriptResponse {
  name: string;
  action: string;
  success: boolean;
  output: string;
}

export interface CycloManagerVersionResponse {
  current: string;
  latest: string;
  pypi_available: boolean;
  update_available: boolean;
}

export interface ErrorResponse {
  error: string;
  detail: string | null;
}

export interface RobotInfoResponse {
  hostname: string;
  os_info: string | null;
  ip_address: string | null;
  internet_connected: boolean;
}

export interface HostSystemStatsResponse {
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  uptime_seconds: number;
  temperature_celsius: number | null;
}

// ROS2 Plugin Types

export interface ROS2TopicStatus {
  topic: string;
  msg_type: string;
  available: boolean;
  subscribed: boolean;
}

export interface ROS2TopicsListResponse {
  domain_id: number;
  topics: ROS2TopicStatus[];
}

export interface ROS2TopicDataResponse {
  topic: string;
  msg_type: string;
  data: unknown;
  available: boolean;
  domain_id: number;
}

export interface ROS2TopicInfoResponse {
  topic: string;
  info: string;
}

export interface ROS2TwistPublishRequest {
  linear_x: number;
  angular_z: number;
  topic?: string;
}
