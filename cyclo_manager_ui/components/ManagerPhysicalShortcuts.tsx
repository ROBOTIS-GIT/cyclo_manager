"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";

function usePhysicalAiToolsUrl(): string {
  const [url, setUrl] = useState("http://localhost:80/");
  useEffect(() => {
    setUrl(`http://${window.location.hostname}:80/`);
  }, []);
  return url;
}

function shortcutStyle(variant: "default" | "onSidebar"): CSSProperties {
  const backgroundColor =
    variant === "onSidebar"
      ? "var(--vscode-input-background, var(--vscode-editor-background))"
      : "var(--vscode-sidebar-background)";
  return {
    width: "3.25rem",
    height: "3.25rem",
    color: "var(--vscode-foreground)",
    backgroundColor,
    borderColor: "var(--vscode-panel-border)",
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.12)",
  };
}

/** Circular M (→ /home) and P (→ physical AI tools :80) beside the Apps home icon. */
export default function ManagerPhysicalShortcuts({
  variant = "default",
}: {
  variant?: "default" | "onSidebar";
}) {
  const physicalUrl = usePhysicalAiToolsUrl();
  const base = shortcutStyle(variant);
  const className =
    "flex shrink-0 items-center justify-center rounded-full border text-lg font-semibold transition-opacity hover:opacity-90";

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
        href={physicalUrl}
        title="Physical AI Tools"
        aria-label="Physical AI Tools"
        className={`${className} no-underline`}
        style={{ ...base, color: "var(--vscode-foreground)" }}
      >
        P
      </a>
    </>
  );
}
