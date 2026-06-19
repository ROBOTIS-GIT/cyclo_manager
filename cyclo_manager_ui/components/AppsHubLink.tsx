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

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppsHubBanner } from "@/contexts/AppsHubBannerContext";
import ManagerPhysicalShortcuts from "@/components/ManagerPhysicalShortcuts";
import ThemeToggle from "@/components/ThemeToggle";

const INSET_FROM_EDGE = "1.75rem";

function HouseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function AppsHubButton({
  className,
  style,
  variant = "default",
  compact = false,
}: {
  className?: string;
  style?: CSSProperties;
  variant?: "default" | "onSidebar";
  /** Smaller hit target for VS Code sidebar rail */
  compact?: boolean;
}) {
  const backgroundColor =
    variant === "onSidebar"
      ? "var(--vscode-input-background, var(--vscode-editor-background))"
      : "var(--vscode-sidebar-background)";

  const dim = compact ? "2rem" : "3.25rem";
  const iconSize = compact ? 18 : 24;

  return (
    <Link
      href="/app"
      className={`flex shrink-0 items-center justify-center rounded-full border transition-all duration-150 hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] hover:scale-110 ${className ?? ""}`}
      style={{
        width: dim,
        height: dim,
        color: "var(--vscode-foreground)",
        backgroundColor,
        borderColor: "var(--vscode-panel-border)",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.12)",
        ...style,
      }}
      title="Apps"
      aria-label="Apps"
    >
      <HouseIcon size={iconSize} />
    </Link>
  );
}

/** Floating on /app only; sidebar pages use AppsHubButton in VSCodeLayout. */
export default function AppsHubLink() {
  const pathname = usePathname();
  const { updateBannerVisible } = useAppsHubBanner();

  if (pathname !== "/app") {
    return null;
  }

  const top = updateBannerVisible ? "4.75rem" : INSET_FROM_EDGE;

  return (
    <div
      className="fixed z-[60] flex flex-col items-start gap-2"
      style={{
        left: INSET_FROM_EDGE,
        top,
      }}
    >
      <div className="w-[9rem]">
        <ThemeToggle />
      </div>
      <div className="flex flex-row items-center gap-3">
        <AppsHubButton />
        <ManagerPhysicalShortcuts />
      </div>
    </div>
  );
}
