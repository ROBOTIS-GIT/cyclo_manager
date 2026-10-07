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

export const SYSTEM_STATUS_POLL_INTERVAL = 2000;
export const CYCLO_INTELLIGENCE_CONTAINER = "cyclo_intelligence";
export const CYCLO_INTELLIGENCE_SERVICE = "cyclo_intelligence";
export const ZENOH_DAEMON_CONTAINER = "zenoh_daemon";

export type SystemLogTarget = "robot" | "leader" | "intelligence" | "zenoh";
