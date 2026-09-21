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

export const ROBOTS = ["sg2", "bg2", "sh5", "bh5", "f1", "f2", "mobile"];

export function storedRobot() {
  if (typeof window === "undefined") return "sg2";
  const value = localStorage.getItem("robot_type_ai_worker") ?? "sg2";
  return ROBOTS.includes(value) ? value : "sg2";
}

export function subscribeRobot(refresh: () => void) {
  window.addEventListener("focus", refresh);
  window.addEventListener("storage", refresh);
  return () => {
    window.removeEventListener("focus", refresh);
    window.removeEventListener("storage", refresh);
  };
}
