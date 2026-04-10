"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { SIDEBAR_WIDTH_PX } from "@/lib/layout";
import { AppsHubButton } from "@/components/AppsHubLink";
import ManagerPhysicalShortcuts from "@/components/ManagerPhysicalShortcuts";
import ThemeToggle from "./ThemeToggle";

const LAST_CONTAINER_KEY = "last_control_container";

export default function VSCodeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [controlHref, setControlHref] = useState("/app");
  const [topicsHref, setTopicsHref] = useState("/app");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const last = localStorage.getItem(LAST_CONTAINER_KEY);
    setControlHref(last ? `/${last}/control` : "/app");
    setTopicsHref(last ? `/${last}/topics` : "/app");
  }, [pathname]);

  const navItems = [
    { href: controlHref, label: "Control", icon: "🎮", isControl: true },
    { href: topicsHref, label: "Topics", icon: "📡", isTopics: true },
    { href: "/docker", label: "Docker", icon: "🐳", isDocker: true },
    { href: "/novnc", label: "noVNC", icon: "🖥️" },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
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
          className="px-3 py-4 border-b flex flex-col gap-4 items-center shrink-0"
          style={{ borderColor: "var(--vscode-sidebar-border)" }}
        >
          <div className="w-full min-w-0">
            <ThemeToggle />
          </div>
          <div
            className="border-t pt-4 w-full -mx-3 px-3"
            style={{ borderColor: "var(--vscode-sidebar-border)" }}
          >
            <div className="flex justify-center w-full items-center gap-3 flex-nowrap">
              <AppsHubButton variant="onSidebar" />
              <ManagerPhysicalShortcuts variant="onSidebar" />
            </div>
          </div>
        </div>

        {/* Sidebar Navigation — tall centered items (Gi-style rail) */}
        <nav
          className="flex-1 min-h-0 w-full flex flex-col items-center gap-3 py-4 px-2 overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          {navItems.map((item) => {
            const isControlPage = pathname?.match(/^\/[^/]+\/control\/?$/);
            const isTopicsPage = pathname?.match(/^\/[^/]+\/topics\/?$/);
            const isDockerPage = pathname === "/docker";
            const isActive =
              "isControl" in item && item.isControl
                ? !!isControlPage
                : "isTopics" in item && item.isTopics
                  ? !!isTopicsPage
                  : "isDocker" in item && item.isDocker
                    ? !!isDockerPage
                    : pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));

            const linkStyle: React.CSSProperties = {
              backgroundColor: isActive ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
              color: isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
            };

            return (
              <Link
                key={item.label === "Control" ? `control-${item.href}` : item.label === "Topics" ? `topics-${item.href}` : item.href}
                href={item.href}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl w-full aspect-square shrink-0 px-2 py-2 text-center no-underline transition-colors box-border"
                style={linkStyle}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
              >
                <span className="text-[2rem] leading-none select-none" aria-hidden>
                  {item.icon}
                </span>
                <span className="text-[15px] font-semibold leading-snug">{item.label}</span>
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
        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
