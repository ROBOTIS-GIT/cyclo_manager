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
import type { DockerContainerListResponse, DockerContainerActionRequest, DockerContainerActionResponse, DockerContainerLogsResponse, DockerImageDeleteResponse, DockerImageListResponse, DockerImagePruneResponse, DockerTopResponse } from "@/types/api";

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
