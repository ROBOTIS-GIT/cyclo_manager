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

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import type {
  ContainerScriptResponse,
  ContainerStartStatusResponse,
  RepoStatusResponse,
  S6AgentStatusListResponse,
  S6AgentUpdateResponse,
  SupportedRobotContainersResponse,
  UpdateRequest,
  UpdateResponse,
  UpdateStatusResponse,
  ServiceStatusResponse,
  ServiceControlResponse,
  ServiceLogsClearResponse,
  ServiceActionRequest,
  DockerContainerListResponse,
  DockerContainerActionRequest,
  DockerContainerActionResponse,
  DockerContainerLogsResponse,
  DockerImageDeleteResponse,
  DockerImageListResponse,
  DockerImagePruneResponse,
  DockerTopResponse,
  ErrorResponse,
  BashrcResponse,
  RepoUpdatesResponse,
  RepoBranchCheckResponse,
  CycloManagerVersionResponse,
  HostAgentVersionResponse,
  RobotType,
  ROS2TopicInfoResponse,
  ROS2TopicsListResponse,
  ROS2TopicDataResponse,
  ROS2TwistPublishRequest,
  HostSystemStatsResponse,
  RobotInfoResponse,
  SerialPortsResponse,
} from "@/types/api";

// Get API base URL from environment variable, default to frontend host:8081
const getApiBaseUrl = (): string => {
  // Check for environment variable (Next.js replaces NEXT_PUBLIC_* at build time)
  const envUrl = process.env.NEXT_PUBLIC_API_URL;

  if (envUrl) {
    return envUrl;
  }

  // Mirror the page's protocol so an HTTPS page calls an HTTPS API and a
  // WSS page opens a WSS socket; this avoids mixed-content blocking.
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8081`;
  }

  // Fallback for server-side rendering
  return "http://localhost:8081";
};

const API_BASE_URL = getApiBaseUrl();

export function getDockerTerminalWsUrl(containerName: string, sessionId: string): string {
  const wsBase = API_BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/terminal/${containerName}/ws?session_id=${encodeURIComponent(sessionId)}`;
}

export function getServiceLogDownloadUrl(container: string, service: string): string {
  return `${API_BASE_URL}/${encodeURIComponent(container)}/services/${encodeURIComponent(service)}/logs/download`;
}

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Error handler
function handleError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ErrorResponse | { detail?: string }>;
    const data = axiosError.response?.data;
    const apiError =
      data && "error" in data && typeof data.error === "string" ? data.error : null;
    const detail =
      data && "detail" in data && typeof data.detail === "string"
        ? data.detail
        : null;
    const message =
      apiError ||
      detail ||
      axiosError.message ||
      "An unknown error occurred";
    throw new Error(message);
  }
  throw error;
}

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await apiClient.request<T>(config);
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

// Container Management

export async function getSupportedRobotContainers(): Promise<SupportedRobotContainersResponse> {
  return request<SupportedRobotContainersResponse>({ method: "GET", url: "/containers" });
}

export async function getS6AgentStatuses(): Promise<S6AgentStatusListResponse> {
  return request<S6AgentStatusListResponse>({
    method: "GET",
    url: "/containers/agents/status",
  });
}

export async function updateS6Agent(container: string): Promise<S6AgentUpdateResponse> {
  return request<S6AgentUpdateResponse>({
    method: "POST",
    url: `/containers/${encodeURIComponent(container)}/agent/update`,
  });
}

export async function getServiceStatus(
  container: string,
  service: string
): Promise<ServiceStatusResponse> {
  return request<ServiceStatusResponse>({
    method: "GET",
    url: `/${container}/services/${service}/status`,
  });
}

export async function controlService(
  container: string,
  service: string,
  action: "up" | "down" | "restart",
  launchArgs?: Record<string, string>,
  robotType?: RobotType
): Promise<ServiceControlResponse> {
  const data: ServiceActionRequest = {
    action,
    ...(launchArgs && Object.keys(launchArgs).length > 0 && { launch_args: launchArgs }),
    ...(robotType != null && { robot_type: robotType }),
  };
  return request<ServiceControlResponse>({
    method: "POST",
    url: `/${container}/services/${service}`,
    data,
  });
}

export async function clearServiceLogs(
  container: string,
  service: string
): Promise<ServiceLogsClearResponse> {
  return request<ServiceLogsClearResponse>({
    method: "DELETE",
    url: `/${container}/services/${service}/logs`,
  });
}

export async function getBashrc(container: string): Promise<BashrcResponse> {
  return request<BashrcResponse>({ method: "GET", url: `/${container}/bashrc` });
}

export async function updateBashrc(
  container: string,
  content: string
): Promise<BashrcResponse> {
  return request<BashrcResponse>({
    method: "PUT",
    url: `/${container}/bashrc`,
    data: { content },
  });
}

// Docker Container Management

export async function getDockerContainers(
  all: boolean = false
): Promise<DockerContainerListResponse> {
  return request<DockerContainerListResponse>({
    method: "GET",
    url: "/docker/containers",
    params: { all },
  });
}

export async function getDockerImages(): Promise<DockerImageListResponse> {
  return request<DockerImageListResponse>({ method: "GET", url: "/docker/images" });
}

export async function deleteDockerImage(
  imageId: string
): Promise<DockerImageDeleteResponse> {
  return request<DockerImageDeleteResponse>({
    method: "DELETE",
    url: `/docker/images/${encodeURIComponent(imageId)}`,
  });
}

export async function pruneDockerImages(): Promise<DockerImagePruneResponse> {
  return request<DockerImagePruneResponse>({
    method: "POST",
    url: "/docker/images/prune",
  });
}

export async function controlDockerContainer(
  name: string,
  action: "start" | "stop" | "restart",
  timeout?: number
): Promise<DockerContainerActionResponse> {
  const data: DockerContainerActionRequest = { action, timeout };
  return request<DockerContainerActionResponse>({
    method: "POST",
    url: `/docker/${name}`,
    data,
  });
}

export async function getDockerContainerTop(
  name: string
): Promise<DockerTopResponse> {
  return request<DockerTopResponse>({ method: "GET", url: `/docker/${name}/top` });
}

export async function killDockerProcess(
  name: string,
  pid: number,
  signal: string = "SIGTERM"
): Promise<void> {
  await request<void>({
    method: "DELETE",
    url: `/docker/${name}/processes/${pid}`,
    params: { signal },
  });
}

export async function stopDockerTerminal(
  name: string,
  sessionId: string
): Promise<void> {
  try {
    await apiClient.delete(`/terminal/${name}/${sessionId}`);
  } catch {
    // best-effort cleanup
  }
}

export async function getDockerContainerLogs(
  name: string,
  tail: number = 100
): Promise<DockerContainerLogsResponse> {
  return request<DockerContainerLogsResponse>({
    method: "GET",
    url: `/docker/${name}/logs`,
    params: { tail },
  });
}

export async function getCycloManagerVersion(checkLatest: boolean = true): Promise<CycloManagerVersionResponse> {
  return request<CycloManagerVersionResponse>({
    method: "GET",
    url: "/version",
    params: { check_latest: checkLatest },
  });
}

export async function getHostAgentVersion(): Promise<HostAgentVersionResponse> {
  return request<HostAgentVersionResponse>({ method: "GET", url: "/host/version" });
}

export async function updateCycloManager(): Promise<void> {
  await request<void>({
    method: "POST",
    url: "/host/update",
    data: null,
    timeout: 60000,
  });
}

export async function getUpdateStatus(): Promise<UpdateStatusResponse> {
  return request<UpdateStatusResponse>({ method: "GET", url: "/host/update/status" });
}

// ROS2 Topic Management

export async function getROS2Topics(): Promise<ROS2TopicsListResponse> {
  return request<ROS2TopicsListResponse>({ method: "GET", url: "/ros2/topics" });
}

export async function getROS2TopicData(topic: string): Promise<ROS2TopicDataResponse> {
  return request<ROS2TopicDataResponse>({
    method: "GET",
    url: `/ros2/topics/${encodeURIComponent(topic)}`,
  });
}

export async function getROS2TopicInfo(topic: string): Promise<ROS2TopicInfoResponse> {
  return request<ROS2TopicInfoResponse>({
    method: "GET",
    url: `/ros2/topics/${encodeURIComponent(topic)}/info`,
  });
}

export async function ros2Subscribe(topic: string, msgType?: string): Promise<void> {
  await request<void>({
    method: "POST",
    url: `/ros2/topics/${encodeURIComponent(topic)}/subscribe`,
    data: msgType ? { msg_type: msgType } : {},
  });
}

export async function ros2Unsubscribe(topic: string): Promise<void> {
  await request<void>({
    method: "POST",
    url: `/ros2/topics/${encodeURIComponent(topic)}/unsubscribe`,
  });
}

export async function publishCmdVel(
  twist: ROS2TwistPublishRequest
): Promise<void> {
  await request<void>({
    method: "POST",
    url: "/ros2/cmd_vel",
    data: {
      topic: twist.topic ?? "/cmd_vel",
      linear_x: twist.linear_x,
      angular_z: twist.angular_z,
    },
  });
}

export async function getROS2TopicAvailability(topic: string): Promise<boolean> {
  try {
    const response = await apiClient.get<{ topic: string; available: boolean }>(
      `/ros2/topics/${encodeURIComponent(topic)}/available`
    );
    return response.data.available;
  } catch {
    return false;
  }
}

export async function getSystemStats(): Promise<HostSystemStatsResponse> {
  return request<HostSystemStatsResponse>({ method: "GET", url: "/system/status" });
}

export async function getRobotInfo(): Promise<RobotInfoResponse> {
  return request<RobotInfoResponse>({ method: "GET", url: "/system/info" });
}

export async function getSerialPorts(): Promise<SerialPortsResponse> {
  return request<SerialPortsResponse>({ method: "GET", url: "/system/serial-ports" });
}


export async function getRepoUpdates(): Promise<RepoUpdatesResponse> {
  return request<RepoUpdatesResponse>({ method: "GET", url: "/host/repos/updates" });
}

export async function getRepoBranchCheck(name: string): Promise<RepoBranchCheckResponse> {
  return request<RepoBranchCheckResponse>({
    method: "GET",
    url: `/host/repos/${name}/branch`,
  });
}

export async function getRepoStatus(name: string): Promise<RepoStatusResponse> {
  return request<RepoStatusResponse>({
    method: "GET",
    url: `/host/repos/${name}/status`,
  });
}

export async function updateRepo(
  name: string,
  strategy: "stash" | "reset",
  preserveFiles: string[] = []
): Promise<UpdateResponse> {
  const data: UpdateRequest = {
    strategy,
    preserve_files: preserveFiles,
  };
  return request<UpdateResponse>({
    method: "POST",
    url: `/host/repos/${name}/update`,
    data,
  });
}

export async function stopRepoContainer(name: string): Promise<ContainerScriptResponse> {
  return request<ContainerScriptResponse>({
    method: "POST",
    url: `/host/repos/${name}/container/stop`,
  });
}

export async function startRepoContainer(name: string): Promise<ContainerStartStatusResponse> {
  return request<ContainerStartStatusResponse>({
    method: "POST",
    url: `/host/repos/${name}/container/start`,
  });
}

export async function getStartRepoContainerStatus(
  name: string
): Promise<ContainerStartStatusResponse> {
  return request<ContainerStartStatusResponse>({
    method: "GET",
    url: `/host/repos/${name}/container/start/status`,
  });
}
