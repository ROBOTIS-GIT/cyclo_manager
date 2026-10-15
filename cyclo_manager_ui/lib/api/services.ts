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

import { API_BASE_URL, request } from "./client";
import { MAX_LOG_LINES } from "@/lib/logBuffer";
import type { RobotRuntime } from "@/lib/robotRuntime";
import type { S6AgentStatusListResponse, S6AgentUpdateResponse, SupportedRobotContainersResponse, ServiceStatusResponse, ServiceControlResponse, ServiceActionRequest, BashrcResponse, RobotType } from "@/types/api";

export async function getSupportedRobotContainers(running = false): Promise<SupportedRobotContainersResponse> {
  return request<SupportedRobotContainersResponse>({
    method: "GET", url: "/containers", params: { running },
  });
}

export const getBringupStatus = (container: string, signal: AbortSignal) => request<RobotRuntime>({
  url: `/${encodeURIComponent(container)}/bringup_status`, timeout: 5000, signal,
});

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

const serviceLogsPath = (container: string, service: string) =>
  `/${encodeURIComponent(container)}/services/${encodeURIComponent(service)}/logs`;

export type ServiceLogHistory = {
  supported: boolean;
  current_log_id: string | null;
  history: { log_id: string; size_bytes: number }[];
};

type ServiceLogSnapshot = {
  log_id: string;
  logs: string;
};

export function getServiceLogHistory(container: string, service: string, signal?: AbortSignal) {
  return request<ServiceLogHistory>({ url: `${serviceLogsPath(container, service)}/history`, signal, timeout: 10000 });
}

export function getServiceLogSnapshot(container: string, service: string, logId: string, signal?: AbortSignal) {
  return request<ServiceLogSnapshot>({
    url: `${serviceLogsPath(container, service)}/history/${encodeURIComponent(logId)}`,
    params: { lines: MAX_LOG_LINES }, signal, timeout: 10000,
  });
}

export function getServiceLogDownloadUrl(container: string, service: string, logId?: string | null): string {
  const suffix = logId ? `/history/${encodeURIComponent(logId)}/download` : "/download";
  return `${API_BASE_URL}${serviceLogsPath(container, service)}${suffix}`;
}
