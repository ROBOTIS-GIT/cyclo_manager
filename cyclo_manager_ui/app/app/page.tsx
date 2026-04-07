"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/contexts/ThemeContext";

export default function AppHubPage() {
  const { theme } = useTheme();
  const [physicalUrl, setPhysicalUrl] = useState("http://localhost:80/");

  useEffect(() => {
    setPhysicalUrl(`http://${window.location.hostname}:80/`);
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col p-6"
      style={{ backgroundColor: "var(--vscode-editor-background)" }}
    >
      <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0">
        <header className="w-full flex justify-center shrink-0 pb-5 pt-0">
          <img
            src="/cyclo_logo.png"
            alt="CYCLO"
            className="h-14 sm:h-16 w-auto max-w-[min(100%,34rem)] object-contain"
            draggable={false}
            style={{
              filter: theme === "dark" ? "invert(1)" : undefined,
            }}
          />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0 w-full">
          <div className="flex flex-row flex-wrap justify-center gap-6">
            <Link href="/home">
              <div
                className="rounded-lg border-2 p-6 cursor-pointer w-[32rem] max-w-[calc(100vw-3rem)] h-[32rem] max-h-[min(32rem,70vh)] flex flex-col items-stretch min-h-0 hover:border-[var(--vscode-focusBorder)] transition-colors"
                style={{
                  backgroundColor: "var(--vscode-sidebar-background)",
                  borderColor: "var(--vscode-panel-border)",
                }}
              >
                <div className="shrink-0 flex justify-center w-full px-2 pt-0 pb-1">
                  <img
                    src="/manager_logo.png"
                    alt="Cyclo Manager"
                    draggable={false}
                    className="max-w-full w-auto h-auto object-contain object-top"
                    style={{
                      maxHeight: "min(10rem, 28vh)",
                      filter: theme === "dark" ? "invert(1)" : undefined,
                    }}
                  />
                </div>
              </div>
            </Link>
            <a href={physicalUrl} className="no-underline">
              <div
                className="rounded-lg border-2 p-6 cursor-pointer w-[32rem] max-w-[calc(100vw-3rem)] h-[32rem] max-h-[min(32rem,70vh)] flex flex-col items-stretch min-h-0 hover:border-[var(--vscode-focusBorder)] transition-colors"
                style={{
                  backgroundColor: "var(--vscode-sidebar-background)",
                  borderColor: "var(--vscode-panel-border)",
                  color: "inherit",
                }}
              >
                <div className="shrink-0 flex justify-center w-full px-2 pt-0 pb-1">
                  <img
                    src="/physical_ai_tools_logo.png"
                    alt="Physical AI Tools"
                    draggable={false}
                    className="max-w-full w-auto h-auto object-contain object-top"
                    style={{
                      maxHeight: "min(10rem, 28vh)",
                      filter: theme === "dark" ? "invert(1)" : undefined,
                    }}
                  />
                </div>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
