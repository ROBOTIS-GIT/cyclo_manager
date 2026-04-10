"use client";

import { useEffect, useState } from "react";
import { getCycloManagerVersion } from "@/lib/api";
import type { CycloManagerVersionResponse } from "@/types/api";
import { useAppsHubBanner } from "@/contexts/AppsHubBannerContext";

export type CycloManagerUpdateAnnouncementProps = {
  /** When true, banner and Apps hub offset are hidden even if an update exists. */
  suppressed?: boolean;
  /** Fires when the top update strip is shown or hidden (for content `pt-14`, etc.). */
  onBannerVisibilityChange?: (visible: boolean) => void;
};

export default function CycloManagerUpdateAnnouncement({
  suppressed = false,
  onBannerVisibilityChange,
}: CycloManagerUpdateAnnouncementProps) {
  const [info, setInfo] = useState<CycloManagerVersionResponse | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const { setUpdateBannerVisible } = useAppsHubBanner();

  useEffect(() => {
    getCycloManagerVersion()
      .then((data) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  const bannerVisible = !suppressed && !!info?.update_available;

  useEffect(() => {
    setUpdateBannerVisible(bannerVisible);
    return () => setUpdateBannerVisible(false);
  }, [bannerVisible, setUpdateBannerVisible]);

  useEffect(() => {
    onBannerVisibilityChange?.(bannerVisible);
  }, [bannerVisible, onBannerVisibilityChange]);

  if (!info?.update_available) {
    return null;
  }

  return (
    <>
      {!suppressed && (
        <div
          className="fixed top-0 left-0 right-0 z-50 p-3 flex flex-wrap items-center justify-center gap-3 shadow-md"
          style={{
            backgroundColor: "var(--vscode-badge-background, #4dabf7)",
            color: "var(--vscode-badge-foreground, #fff)",
          }}
        >
          <span className="text-sm font-medium">
            cyclo_manager {info.current} → {info.latest}
          </span>
          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            className="px-3 py-1.5 rounded text-sm font-medium border border-white/50 hover:bg-white/20"
          >
            Update available
          </button>
        </div>
      )}

      {showInstructions && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[70]"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="rounded-lg border shadow-xl w-[28rem] flex flex-col overflow-hidden"
            style={{
              backgroundColor: "var(--vscode-editor-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "var(--vscode-panel-border)" }}
            >
              <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
                How to update cyclo_manager
              </h2>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="p-1 rounded hover:opacity-80"
                style={{
                  color: "var(--vscode-foreground)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div
              className="px-4 py-2 flex gap-4 text-sm"
              style={{
                borderBottom: "1px solid var(--vscode-panel-border)",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              <span>
                Current:{" "}
                <span className="font-mono font-medium" style={{ color: "var(--vscode-foreground)" }}>
                  {info.current}
                </span>
              </span>
              <span>
                Latest:{" "}
                <span className="font-mono font-medium" style={{ color: "var(--vscode-foreground)" }}>
                  {info.latest}
                </span>
              </span>
            </div>
            <div className="p-4 space-y-4 text-sm" style={{ color: "var(--vscode-foreground)" }}>
              <div>
                <p className="mb-1.5">1. Use below command in host</p>
                <div
                  className="rounded overflow-hidden border"
                  style={{
                    borderColor: "var(--vscode-panel-border)",
                    backgroundColor: "var(--vscode-editor-background)",
                  }}
                >
                  <div
                    className="px-3 py-1.5 text-xs font-medium"
                    style={{
                      backgroundColor: "var(--vscode-sidebar-background)",
                      borderBottom: "1px solid var(--vscode-panel-border)",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    bash
                  </div>
                  <pre
                    className="p-3 text-xs font-mono overflow-x-auto m-0"
                    style={{
                      color: "var(--vscode-editor-foreground, var(--vscode-foreground))",
                      fontFamily: "var(--vscode-editor-font-family, ui-monospace, monospace)",
                    }}
                  >
                    cyclo_manager update
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
