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
  robot_type?: "sg2" | "bg2";
}

export interface ServiceControlResponse {
  container: string;
  service: string;
  action: "up" | "down" | "restart";
  result: string;
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
