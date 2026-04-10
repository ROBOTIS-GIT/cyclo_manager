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
      className={`flex shrink-0 items-center justify-center rounded-full border transition-opacity hover:opacity-90 ${className ?? ""}`}
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

/** Floating on /home and /app; sidebar pages use AppsHubButton in VSCodeLayout. */
export default function AppsHubLink() {
  const pathname = usePathname();
  const { updateBannerVisible } = useAppsHubBanner();

  if (pathname !== "/home" && pathname !== "/app") {
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
