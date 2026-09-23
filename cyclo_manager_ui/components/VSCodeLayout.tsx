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

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout";
import { AppsHubButton } from "@/components/AppsHubLink";
import ManagerIntelligenceShortcuts from "@/components/ManagerIntelligenceShortcuts";
import ThemeToggle from "./ThemeToggle";
import { navigationItems } from "@/config/navigation";
import { useNavigation } from "@/hooks/useNavigation";
import SidebarNavigation from "@/components/layout/SidebarNavigation";

export default function VSCodeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const menu = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => menu.current?.close();
  const openMenu = () => {
    window.dispatchEvent(new Event("cyclo:jog-stop"));
    menu.current?.showModal();
    setMenuOpen(true);
  };
  useEffect(() => {
    const updateHeight = () => {
      document.documentElement.style.setProperty("--app-height", `${window.visualViewport?.height ?? window.innerHeight}px`);
      if (window.matchMedia("(min-width: 768px)").matches) menu.current?.close();
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
  const pathname = usePathname();
  const { navError, setNavError, selection, cancelSelection, handleSystemClick, handleJogClick, openRobotPage, handleNavigate } = useNavigation(closeMenu, pathname ?? "");
  const title = navigationItems.find(item => item.matches(pathname ?? ""))?.label ?? "Cyclo Manager";
  const navigation = <SidebarNavigation pathname={pathname ?? ""} onNavigate={handleNavigate}
    onSystem={handleSystemClick} onJog={handleJogClick} />;

  return (
    <div className="app-shell flex flex-col overflow-hidden">
      <header className="mobile-header flex items-center gap-3 border-b px-3 md:hidden" style={{ background: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}>
        <button type="button" onClick={openMenu} aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={menuOpen} className="h-11 w-11 rounded text-xl">☰</button>
        <span className="font-semibold flex-1 truncate">{title}</span>
        <span className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>Cyclo Manager</span>
      </header>
      <dialog ref={menu} id="mobile-navigation" aria-label="Navigation" className="mobile-navigation"
        onClose={() => setMenuOpen(false)} onClick={event => { if (event.target === event.currentTarget) closeMenu(); }}>
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>
            <span className="font-semibold">Cyclo Manager</span>
            <button type="button" onClick={closeMenu} aria-label="Close navigation" className="h-11 w-11 rounded text-xl">×</button>
          </div>
          <div className="mobile-menu-tools flex items-center justify-between gap-3 px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--vscode-panel-border)" }}>
            <div className="w-[108px] shrink-0"><ThemeToggle rail buttonHeight={24} /></div>
            <div className="flex items-center gap-1" onClick={event => { if ((event.target as HTMLElement).closest("a")) handleNavigate(); }}>
              <AppsHubButton variant="onSidebar" compact />
              <ManagerIntelligenceShortcuts variant="onSidebar" compact />
            </div>
          </div>
          {navigation}
        </div>
      </dialog>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Sidebar */}
      <div
        className="hidden md:flex flex-col shrink-0"
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
            <div className="flex justify-center w-full items-center gap-1 flex-nowrap"
              onClick={event => { if ((event.target as HTMLElement).closest("a")) handleNavigate(); }}>
              <AppsHubButton variant="onSidebar" compact />
              <ManagerIntelligenceShortcuts variant="onSidebar" compact />
            </div>
          </div>
        </div>

        {/* Sidebar Navigation */}
        {navigation}
      </div>

      {/* Main Content Area */}
      <main
        className="flex-1 min-w-0 flex flex-col overflow-hidden"
        style={{ backgroundColor: "var(--vscode-editor-background)" }}
      >
        <div className="app-content flex-1 min-h-0 min-w-0 overflow-auto p-3 md:p-6">
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

      {selection && (
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
              Select Robot for {selection.page === "jog" ? "Jog" : "System"}
            </div>
            <div className="flex flex-col gap-2">
              {selection.containers.map((container) => (
                <button
                  key={container}
                  type="button"
                  onClick={() => openRobotPage(container)}
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
              onClick={cancelSelection}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
