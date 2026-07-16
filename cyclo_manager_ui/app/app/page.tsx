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

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/contexts/ThemeContext";

export default function AppHubPage() {
  const { theme } = useTheme();
  const [intelligenceUrl, setIntelligenceUrl] = useState("http://localhost:7080/");

  useEffect(() => {
    setIntelligenceUrl(`http://${window.location.hostname}:7080/`);
  }, []);

  return (
    <>
      <div
        className="min-h-screen flex flex-col p-6"
        style={{ backgroundColor: "var(--vscode-editor-background)" }}
      >
        <div
          className="w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0"
        >
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
            <Link href="/dashboard">
              <div
                className="group rounded-lg border-2 p-5 cursor-pointer w-[min(40rem,calc(100vw-3rem))] h-[13rem] sm:h-[14rem] max-h-[min(14rem,38vh)] flex flex-col items-stretch justify-center min-h-0 hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] hover:scale-[1.02] transition-all duration-150"
                style={{
                  backgroundColor: "var(--vscode-sidebar-background)",
                  borderColor: "var(--vscode-panel-border)",
                }}
              >
                <div className="shrink-0 flex justify-center w-full px-2">
                  <img
                    src="/manager_logo.png"
                    alt="Cyclo Manager"
                    draggable={false}
                    className="max-w-full w-auto h-auto object-contain object-center group-hover:scale-110 transition-transform duration-150"
                    style={{
                      maxHeight: "min(7rem, 22vh)",
                      filter: theme === "dark" ? "invert(1)" : undefined,
                    }}
                  />
                </div>
              </div>
            </Link>
            <a href={intelligenceUrl} className="no-underline">
              <div
                className="group rounded-lg border-2 p-5 cursor-pointer w-[min(40rem,calc(100vw-3rem))] h-[13rem] sm:h-[14rem] max-h-[min(14rem,38vh)] flex flex-col items-stretch justify-center min-h-0 hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)] hover:scale-[1.02] transition-all duration-150"
                style={{
                  backgroundColor: "var(--vscode-sidebar-background)",
                  borderColor: "var(--vscode-panel-border)",
                  color: "inherit",
                }}
              >
                <div className="shrink-0 flex justify-center w-full px-2">
                  <img
                    src="/intelligence_logo.png"
                    alt="Cyclo Intelligence"
                    draggable={false}
                    className="max-w-full w-auto h-auto object-contain object-center group-hover:scale-110 transition-transform duration-150"
                    style={{
                      maxHeight: "min(7rem, 22vh)",
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
    </>
  );
}
