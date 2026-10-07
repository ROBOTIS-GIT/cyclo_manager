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

export function getDockerTerminalWsUrl(containerName: string, sessionId: string): string {
  const wsBase = API_BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/terminal/${containerName}/ws?session_id=${encodeURIComponent(sessionId)}`;
}

export async function stopDockerTerminal(
  name: string,
  sessionId: string
): Promise<void> {
  try {
    await request<void>({ method: "DELETE", url: `/terminal/${name}/${sessionId}` });
  } catch {
    // best-effort cleanup
  }
}
