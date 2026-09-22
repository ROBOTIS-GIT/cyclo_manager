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

type NavigationBase = { label: string; icon: string; matches: (pathname: string) => boolean };
export type NavigationItem = NavigationBase & (
  | { href: string; action?: never }
  | { action: "system" | "jog"; href?: never }
);

const route = (href: string) => (pathname: string) => pathname === href || pathname.startsWith(`${href}/`);

export const navigationItems: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", matches: pathname => pathname === "/dashboard" },
  { action: "system", label: "System", icon: "🤖", matches: pathname => /^\/[^/]+\/system\/?$/.test(pathname) },
  { action: "jog", label: "Jog", icon: "🎮", matches: pathname => pathname === "/jog" },
  { href: "/record-play", label: "Record & Play", icon: "⏺", matches: route("/record-play") },
  { href: "/topics", label: "Topics", icon: "📡", matches: route("/topics") },
  { href: "/terminal", label: "Terminal", icon: "🖥️", matches: route("/terminal") },
  { href: "/novnc", label: "noVNC", icon: "📺", matches: route("/novnc") },
  { href: "/files", label: "Files", icon: "📁", matches: route("/files") },
];
