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

import { useAnsiConverter } from "@/hooks/useAnsiConverter";
import type { ContainerSettings } from "@/hooks/dashboard/useContainerSettings";
import type { DockerContainerInfo } from "@/types/api";

export default function ContainerSettingsModal({ container: settingsDocker, settings }: {
  container: DockerContainerInfo;
  settings: ContainerSettings;
}) {
  const {
    setSettingsContainer, settingsTab, loadingLogsFor, logErrors, logsByContainer,
    bashrcContent, setBashrcContent, bashrcLoading, bashrcSaving, bashrcError, handleSaveBashrc,
  } = settings;
  const convert = useAnsiConverter();
  return (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="rounded-lg border shadow-xl w-[min(42rem,calc(100vw-24px))] h-[min(28rem,calc(100dvh-32px))] flex flex-col overflow-hidden"
            style={{ backgroundColor: "var(--vscode-editor-background)", borderColor: "var(--vscode-panel-border)" }}
          >
            {/* header */}
            <div className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "var(--vscode-panel-border)" }}>
              <h2 className="font-semibold" style={{ color: "var(--vscode-foreground)" }}>
                {settingsDocker.name}
              </h2>
              <button onClick={() => setSettingsContainer(null)}
                className="p-1 rounded hover:opacity-80"
                style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {/* body */}
            <div className="flex-1 overflow-auto p-4">
              {settingsTab === "log" && (
                <div>
                  {loadingLogsFor === settingsDocker.name && (
                    <p style={{ color: "var(--vscode-descriptionForeground)" }}>Loading logs...</p>
                  )}
                  {logErrors[settingsDocker.name] && (
                    <p style={{ color: "var(--vscode-errorForeground)" }}>{logErrors[settingsDocker.name]}</p>
                  )}
                  {logsByContainer[settingsDocker.name] && (
                    <pre
                      className="text-xs p-3 rounded overflow-auto font-mono whitespace-pre-wrap break-words"
                      style={{ backgroundColor: "var(--vscode-textCodeBlock-background)", color: "var(--vscode-foreground)" }}
                      dangerouslySetInnerHTML={{ __html: convert.toHtml(logsByContainer[settingsDocker.name]) }}
                    />
                  )}
                </div>
              )}
              {settingsTab === "bashrc" && (
                <div className="space-y-2">
                  {bashrcError && (
                    <div className="px-2 py-1.5 rounded text-xs"
                      style={{ color: "var(--vscode-errorForeground)", backgroundColor: "rgba(244,135,113,0.1)", border: "1px solid rgba(244,135,113,0.3)" }}>
                      {bashrcError}
                    </div>
                  )}
                  {bashrcLoading ? (
                    <p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading ~/.bashrc...</p>
                  ) : (
                    <>
                      <textarea
                        value={bashrcContent}
                        onChange={(e) => setBashrcContent(e.target.value)}
                        className="w-full min-h-[200px] p-2 text-xs font-mono rounded resize-y"
                        style={{
                          border: "1px solid var(--vscode-input-border)",
                          backgroundColor: "var(--vscode-input-background)",
                          color: "var(--vscode-input-foreground)",
                        }}
                        spellCheck={false}
                      />
                      <button
                        onClick={handleSaveBashrc}
                        disabled={bashrcLoading || bashrcSaving}
                        className="px-3 py-1.5 text-sm rounded disabled:opacity-50"
                        style={{ backgroundColor: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" }}
                      >
                        {bashrcSaving ? "Saving…" : "Save"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
  );
}
