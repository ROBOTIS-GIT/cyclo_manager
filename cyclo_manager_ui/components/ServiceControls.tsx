"use client";

import { useState } from "react";
import { controlService } from "@/lib/api";
import type { ServiceControlResponse } from "@/types/api";

interface ServiceControlsProps {
  container: string;
  service: string;
  isUp?: boolean;
  onActionComplete?: () => void;
}

export default function ServiceControls({
  container,
  service,
  isUp = false,
  onActionComplete,
}: ServiceControlsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: "up" | "down" | "restart") => {
    setLoading(action);
    setError(null);

    try {
      await controlService(container, service, action);
      onActionComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to control service");
    } finally {
      setLoading(null);
      // Clear error after 3 seconds
      setTimeout(() => setError(null), 3000);
    }
  };

  const buttonStyle = (isPrimary = false) => ({
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: "400",
    border: "none",
    borderRadius: "2px",
    cursor: loading !== null ? "not-allowed" : "pointer",
    opacity: loading !== null ? 0.5 : 1,
    backgroundColor: isPrimary
      ? "var(--vscode-button-background)"
      : "var(--vscode-button-secondaryBackground)",
    color: isPrimary
      ? "var(--vscode-button-foreground)"
      : "var(--vscode-button-secondaryForeground)",
    transition: "background-color 0.2s",
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {!isUp && (
          <button
            onClick={() => handleAction("up")}
            disabled={loading !== null}
            style={buttonStyle(true)}
            onMouseEnter={(e) => {
              if (loading === null) {
                e.currentTarget.style.backgroundColor = "var(--vscode-button-hoverBackground)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--vscode-button-background)";
            }}
          >
            {loading === "up" ? "Starting..." : "Start"}
          </button>
        )}
        {isUp && (
          <button
            onClick={() => handleAction("down")}
            disabled={loading !== null}
            style={buttonStyle()}
            onMouseEnter={(e) => {
              if (loading === null) {
                e.currentTarget.style.backgroundColor = "var(--vscode-button-secondaryHoverBackground)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--vscode-button-secondaryBackground)";
            }}
          >
            {loading === "down" ? "Stopping..." : "Stop"}
          </button>
        )}
        {isUp && (
          <button
            onClick={() => handleAction("restart")}
            disabled={loading !== null}
            style={buttonStyle()}
            onMouseEnter={(e) => {
              if (loading === null) {
                e.currentTarget.style.backgroundColor = "var(--vscode-button-secondaryHoverBackground)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--vscode-button-secondaryBackground)";
            }}
          >
            {loading === "restart" ? "Restarting..." : "Restart"}
          </button>
        )}
      </div>
      {error && (
        <div
          className="text-xs px-2 py-1 rounded"
          style={{
            color: "var(--vscode-errorForeground)",
            backgroundColor: "rgba(244, 135, 113, 0.1)",
            border: "1px solid rgba(244, 135, 113, 0.3)"
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
