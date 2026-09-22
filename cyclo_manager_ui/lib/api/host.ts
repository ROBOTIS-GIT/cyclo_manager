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
import type { ContainerScriptResponse, ContainerStartStatusResponse, RepoStatusResponse, UpdateRequest, UpdateResponse, UpdateStatusResponse, RepoUpdatesResponse, RepoBranchCheckResponse, CycloManagerVersionResponse, HostAgentVersionResponse } from "@/types/api";

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
