"use client";

import { useTheme } from "@/contexts/ThemeContext";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const segmentBase =
    "flex-1 min-w-0 py-2 px-1 text-[11px] font-semibold leading-tight transition-colors border-none cursor-pointer";

  return (
    <div
      className="flex w-full rounded-lg overflow-hidden"
      style={{
        backgroundColor: "var(--vscode-input-background)",
        border: "1px solid var(--vscode-panel-border)",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
      }}
      role="group"
      aria-label="Color theme"
    >
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={segmentBase}
        style={{
          backgroundColor: theme === "light" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
          color: theme === "light" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
          borderRight: "1px solid var(--vscode-panel-border)",
        }}
        aria-pressed={theme === "light"}
        title="Light theme"
      >
        Light
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={segmentBase}
        style={{
          backgroundColor: theme === "dark" ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
          color: theme === "dark" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
        }}
        aria-pressed={theme === "dark"}
        title="Dark theme"
      >
        Dark
      </button>
    </div>
  );
}
