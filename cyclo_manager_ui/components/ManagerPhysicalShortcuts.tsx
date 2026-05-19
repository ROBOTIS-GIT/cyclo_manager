"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";

function useCycloIntelligenceUrl(): string {
  const [cycloIntelligenceUrl, setCycloIntelligenceUrl] = useState("http://localhost:8088/");

  useEffect(() => {
    setCycloIntelligenceUrl(`http://${window.location.hostname}:8088/`);
  }, []);

  return cycloIntelligenceUrl;
}

function shortcutStyle(
  variant: "default" | "onSidebar",
  compact: boolean
): CSSProperties {
  const backgroundColor =
    variant === "onSidebar"
      ? "var(--vscode-input-background, var(--vscode-editor-background))"
      : "var(--vscode-sidebar-background)";
  const dim = compact ? "2rem" : "3.25rem";
  return {
    width: dim,
    height: dim,
    color: "var(--vscode-foreground)",
    backgroundColor,
    borderColor: "var(--vscode-panel-border)",
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.12)",
  };
}

/** Circular M (→ /home) and C (→ Cyclo Intelligence :8088) beside the Apps home icon. */
export default function ManagerPhysicalShortcuts({
  variant = "default",
  compact = false,
}: {
  variant?: "default" | "onSidebar";
  compact?: boolean;
}) {
  const cycloIntelligenceUrl = useCycloIntelligenceUrl();
  const base = shortcutStyle(variant, compact);
  const className = `flex shrink-0 items-center justify-center rounded-full border font-semibold transition-all duration-150 hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] hover:scale-110 ${
    compact ? "text-xs" : "text-lg"
  }`;

  return (
    <>
      <Link
        href="/home"
        title="Cyclo Manager"
        aria-label="Cyclo Manager"
        className={className}
        style={base}
      >
        M
      </Link>
      <a
        href={cycloIntelligenceUrl}
        title="Cyclo Intelligence"
        aria-label="Cyclo Intelligence"
        className={`${className} no-underline`}
        style={{ ...base, color: "var(--vscode-foreground)" }}
      >
        C
      </a>
    </>
  );
}
