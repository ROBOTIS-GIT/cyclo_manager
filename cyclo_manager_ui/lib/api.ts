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

import axios, { AxiosError } from "axios";
import type {
  ConfiguredContainerListResponse,
  ServiceListResponse,
  ServiceStatusResponse,
  ServiceStatusListResponse,
  ServiceControlResponse,
  ServiceLogsResponse,
  ServiceLogsClearResponse,
  ServiceActionRequest,
  DockerContainerListResponse,
  DockerContainerStatus,
  DockerContainerActionRequest,
  DockerContainerActionResponse,
  DockerContainerLogsResponse,
  DockerTopResponse,
  ErrorResponse,
  ServiceRunScriptResponse,
  BashrcResponse,
  RepoVersionResponse,
  CycloManagerVersionResponse,
  ROS2TopicsListResponse,
  ROS2TopicDataResponse,
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
  return `${wsBase}/docker/${containerName}/terminal/ws?session_id=${encodeURIComponent(sessionId)}`;
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
    const axiosError = error as AxiosError<ErrorResponse>;
    const message =
      axiosError.response?.data?.error ||
      axiosError.message ||
      "An unknown error occurred";
    throw new Error(message);
  }
  throw error;
}

// Container Management

export async function getConfiguredContainers(): Promise<ConfiguredContainerListResponse> {
  try {
    const response = await apiClient.get<ConfiguredContainerListResponse>("/containers");
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getServices(
  container: string
): Promise<ServiceListResponse> {
  try {
    const response = await apiClient.get<ServiceListResponse>(
      `/${container}/services`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getServiceStatus(
  container: string,
  service: string
): Promise<ServiceStatusResponse> {
  try {
    const response = await apiClient.get<ServiceStatusResponse>(
      `/${container}/services/${service}/status`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getServiceStatuses(
  container: string
): Promise<ServiceStatusListResponse> {
  try {
    const response = await apiClient.get<ServiceStatusListResponse>(
      `/${container}/services/status`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function controlService(
  container: string,
  service: string,
  action: "up" | "down" | "restart",
  launchArgs?: Record<string, string>,
  robotType?: "sg2" | "bg2" | "sh5" | "bh5"
): Promise<ServiceControlResponse> {
  try {
    const request: ServiceActionRequest = {
      action,
      ...(launchArgs && Object.keys(launchArgs).length > 0 && { launch_args: launchArgs }),
      ...(robotType != null && { robot_type: robotType }),
    };
    const response = await apiClient.post<ServiceControlResponse>(
      `/${container}/services/${service}`,
      request
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getServiceLogs(
  container: string,
  service: string,
  tail: number = 100
): Promise<ServiceLogsResponse> {
  try {
    const response = await apiClient.get<ServiceLogsResponse>(
      `/${container}/services/${service}/logs`,
      {
        params: { tail },
      }
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function clearServiceLogs(
  container: string,
  service: string
): Promise<ServiceLogsClearResponse> {
  try {
    const response = await apiClient.delete<ServiceLogsClearResponse>(
      `/${container}/services/${service}/logs`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getServiceRunScript(
  container: string,
  service: string
): Promise<ServiceRunScriptResponse> {
  try {
    const response = await apiClient.get<ServiceRunScriptResponse>(
      `/${container}/services/${service}/run`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function updateServiceRunScript(
  container: string,
  service: string,
  content: string
): Promise<ServiceRunScriptResponse> {
  try {
    const response = await apiClient.put<ServiceRunScriptResponse>(
      `/${container}/services/${service}/run`,
      { content }
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getBashrc(container: string): Promise<BashrcResponse> {
  try {
    const response = await apiClient.get<BashrcResponse>(`/${container}/bashrc`);
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function updateBashrc(
  container: string,
  content: string
): Promise<BashrcResponse> {
  try {
    const response = await apiClient.put<BashrcResponse>(`/${container}/bashrc`, {
      content,
    });
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

// Docker Container Management

export async function getDockerContainers(
  all: boolean = false
): Promise<DockerContainerListResponse> {
  try {
    const response = await apiClient.get<DockerContainerListResponse>(
      "/docker/containers",
      {
        params: { all },
      }
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getDockerContainerStatus(
  name: string
): Promise<DockerContainerStatus> {
  try {
    const response = await apiClient.get<DockerContainerStatus>(
      `/docker/${name}/status`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function controlDockerContainer(
  name: string,
  action: "start" | "stop" | "restart",
  timeout?: number
): Promise<DockerContainerActionResponse> {
  try {
    const request: DockerContainerActionRequest = { action, timeout };
    const response = await apiClient.post<DockerContainerActionResponse>(
      `/docker/${name}`,
      request
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getDockerContainerTop(
  name: string
): Promise<DockerTopResponse> {
  try {
    const response = await apiClient.get<DockerTopResponse>(`/docker/${name}/top`);
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function killDockerProcess(
  name: string,
  pid: number,
  signal: string = "SIGTERM"
): Promise<void> {
  try {
    await apiClient.delete(`/docker/${name}/processes/${pid}`, { params: { signal } });
  } catch (error) {
    handleError(error);
  }
}

export async function stopDockerTerminal(
  name: string,
  sessionId: string
): Promise<void> {
  try {
    await apiClient.delete(`/docker/${name}/terminal/${sessionId}`);
  } catch {
    // best-effort cleanup
  }
}

export async function getDockerContainerLogs(
  name: string,
  tail: number = 100
): Promise<DockerContainerLogsResponse> {
  try {
    const response = await apiClient.get<DockerContainerLogsResponse>(
      `/docker/${name}/logs`,
      {
        params: { tail },
      }
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getRepoVersion(
  container: string
): Promise<RepoVersionResponse> {
  try {
    const response = await apiClient.get<RepoVersionResponse>(
      `/docker/${container}/version`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getCycloManagerVersion(): Promise<CycloManagerVersionResponse> {
  try {
    const response = await apiClient.get<CycloManagerVersionResponse>("/version");
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function updateCycloManager(): Promise<{ message: string }> {
  try {
    const response = await apiClient.post<{ message: string }>(
      "/version/update"
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

// ROS2 Topic Management

export async function getROS2Topics(
  container: string
): Promise<ROS2TopicsListResponse> {
  try {
    const response = await apiClient.get<ROS2TopicsListResponse>(
      `/${container}/ros2/topics`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function getROS2TopicData(
  container: string,
  topic: string
): Promise<ROS2TopicDataResponse> {
  try {
    const response = await apiClient.get<ROS2TopicDataResponse>(
      `/${container}/ros2/topics/${encodeURIComponent(topic)}`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export interface ROS2TopicInfoResponse {
  topic: string;
  info: string;
}

export async function getROS2TopicInfo(
  container: string,
  topic: string
): Promise<ROS2TopicInfoResponse> {
  try {
    const response = await apiClient.get<ROS2TopicInfoResponse>(
      `/${container}/ros2/topics/${encodeURIComponent(topic)}/info`
    );
    return response.data;
  } catch (error) {
    handleError(error);
  }
}

export async function ros2Subscribe(
  container: string,
  topic: string,
  msgType?: string
): Promise<void> {
  await apiClient.post(
    `/${container}/ros2/topics/${encodeURIComponent(topic)}/subscribe`,
    msgType ? { msg_type: msgType } : {}
  );
}

export async function ros2Unsubscribe(
  container: string,
  topic: string
): Promise<void> {
  await apiClient.post(
    `/${container}/ros2/topics/${encodeURIComponent(topic)}/unsubscribe`
  );
}
