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

"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout";
import { AppsHubButton } from "@/components/AppsHubLink";
import ManagerIntelligenceShortcuts from "@/components/ManagerIntelligenceShortcuts";
import ThemeToggle from "./ThemeToggle";
import { getSupportedRobotContainers } from "@/lib/api";

export default function VSCodeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [navError, setNavError] = useState<string | null>(null);
  const [systemChoices, setSystemChoices] = useState<string[]>([]);

  type NavItemWithHref = { href: string; label: string; icon: string; isHome?: boolean; isTopics?: boolean; isTerminal?: boolean };
  type NavItemWithoutHref = { label: string; icon: string; isSystem: true };
  type NavItem = NavItemWithHref | NavItemWithoutHref;

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "📊", isHome: true },
    { label: "System", icon: "🤖", isSystem: true },
    { href: "/topics", label: "Topics", icon: "📡", isTopics: true },
    { href: "/terminal", label: "Terminal", icon: "🖥️", isTerminal: true },
    { href: "/novnc", label: "noVNC", icon: "📺" },
    { href: "/jog", label: "Jog", icon: "🎮" },
  ];

  async function handleSystemClick() {
    setNavError(null);
    setSystemChoices([]);
    try {
      const { supported_robot_containers } = await getSupportedRobotContainers();
      if (supported_robot_containers.length === 0) {
        setNavError("No supported robot container is configured.");
        return;
      }
      if (supported_robot_containers.length === 1) {
        router.push(`/${supported_robot_containers[0]}/system`);
        return;
      }
      setSystemChoices(supported_robot_containers);
    } catch {
      setNavError("Failed to connect to the manager.");
    }
  }

  function openSystemPage(container: string) {
    setSystemChoices([]);
    setNavError(null);
    router.push(`/${container}/system`);
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Sidebar */}
      <div
        className="flex flex-col"
        style={{
          backgroundColor: "var(--vscode-sidebar-background)",
          borderRight: "1px solid var(--vscode-sidebar-border)",
          width: `${SIDEBAR_WIDTH_PX}px`,
          minWidth: `${SIDEBAR_WIDTH_PX}px`,
        }}
      >
        {/* Sidebar Header */}
        <div
          className="px-1.5 py-2 border-b flex flex-col gap-2 items-center shrink-0"
          style={{ borderColor: "var(--vscode-sidebar-border)" }}
        >
          <div className="w-full min-w-0">
            <ThemeToggle rail />
          </div>
          <div
            className="border-t pt-2 w-full -mx-1.5 px-1.5"
            style={{ borderColor: "var(--vscode-sidebar-border)" }}
          >
            <div className="flex justify-center w-full items-center gap-1 flex-nowrap">
              <AppsHubButton variant="onSidebar" compact />
              <ManagerIntelligenceShortcuts variant="onSidebar" compact />
            </div>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <nav
          className="flex-1 min-h-0 w-full flex flex-col items-center gap-1.5 py-2 px-1 overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          {navItems.map((item) => {
            const isSystemPage = pathname?.match(/^\/[^/]+\/system\/?$/);
            const isTopicsPage = pathname === "/topics" || pathname?.startsWith("/topics/");
            const isTerminalPage = pathname === "/terminal" || pathname?.startsWith("/terminal/");
            const isHomePage = pathname === "/dashboard";
            const isActive =
              "isHome" in item && item.isHome
                ? !!isHomePage
                : "isSystem" in item && item.isSystem
                ? !!isSystemPage
                : "isTopics" in item && item.isTopics
                  ? !!isTopicsPage
                  : "isTerminal" in item && item.isTerminal
                    ? !!isTerminalPage
                    : "href" in item && (pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href)));

            const baseStyle: React.CSSProperties = {
              backgroundColor: isActive ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
              color: isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
            };

            const sharedClass = "flex flex-col items-center justify-center gap-0.5 rounded-md w-full aspect-square shrink-0 px-1 py-1 text-center transition-colors box-border";

            if ("isSystem" in item && item.isSystem) {
              return (
                <button
                  key="system"
                  onClick={handleSystemClick}
                  className={sharedClass}
                  style={{ ...baseStyle, border: "none", cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span className="text-[1.125rem] leading-none select-none" aria-hidden>{item.icon}</span>
                  <span className="text-[10px] font-semibold leading-tight">{item.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={"href" in item ? item.href : item.label}
                href={"href" in item ? item.href : "/"}
                className={`${sharedClass} no-underline`}
                style={baseStyle}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span className="text-[1.125rem] leading-none select-none" aria-hidden>{item.icon}</span>
                <span className="text-[10px] font-semibold leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content Area */}
      <main
        className="flex-1 flex flex-col overflow-hidden"
        style={{ backgroundColor: "var(--vscode-editor-background)" }}
      >
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </main>

      </div>

      {/* Nav error alert */}
      {navError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        >
          <div
            className="rounded-lg p-5 flex flex-col gap-3 max-w-sm w-full mx-4"
            style={{
              backgroundColor: "var(--vscode-editor-background)",
              border: "1px solid var(--vscode-inputValidation-errorBorder)",
            }}
          >
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--vscode-inputValidation-errorBorder)", fontSize: "1.1rem" }}>⚠</span>
              <span className="font-semibold text-sm" style={{ color: "var(--vscode-foreground)" }}>
                {navError}
              </span>
            </div>
            <button
              className="self-end px-3 py-1 rounded text-xs font-semibold transition-colors"
              style={{
                backgroundColor: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                border: "none",
                cursor: "pointer",
              }}
              onClick={() => setNavError(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {systemChoices.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        >
          <div
            className="rounded-lg p-5 flex flex-col gap-3 max-w-sm w-full mx-4"
            style={{
              backgroundColor: "var(--vscode-editor-background)",
              border: "1px solid var(--vscode-panel-border)",
            }}
          >
            <div className="font-semibold text-sm" style={{ color: "var(--vscode-foreground)" }}>
              Select Robot System
            </div>
            <div className="flex flex-col gap-2">
              {systemChoices.map((container) => (
                <button
                  key={container}
                  type="button"
                  onClick={() => openSystemPage(container)}
                  className="px-3 py-2 rounded text-sm font-semibold text-left transition-colors"
                  style={{
                    backgroundColor: "var(--vscode-button-secondaryBackground)",
                    color: "var(--vscode-button-secondaryForeground)",
                    border: "1px solid var(--vscode-panel-border)",
                    cursor: "pointer",
                  }}
                >
                  {container}
                </button>
              ))}
            </div>
            <button
              className="self-end px-3 py-1 rounded text-xs font-semibold transition-colors"
              style={{
                backgroundColor: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                border: "none",
                cursor: "pointer",
              }}
              onClick={() => setSystemChoices([])}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
