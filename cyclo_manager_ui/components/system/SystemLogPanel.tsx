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
import FixedLogPanel from "@/components/FixedLogPanel";
import { useAnsiConverter } from "@/hooks/useAnsiConverter";
import { getDockerContainerLogs } from "@/lib/api";
import type { SystemProfile } from "@/config/systemProfiles";
import {
  CYCLO_INTELLIGENCE_CONTAINER, CYCLO_INTELLIGENCE_SERVICE,
  ZENOH_DAEMON_CONTAINER, type SystemLogTarget,
} from "@/config/systemServices";

function ZenohLog({ onClose }: { onClose: () => void }) {
  const convert = useAnsiConverter();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getDockerContainerLogs(ZENOH_DAEMON_CONTAINER, 200)
      .then(response => { if (active) setContent(response.logs); })
      .catch(() => { if (active) setContent("Failed to load logs."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="flex flex-col h-full rounded border overflow-hidden" style={{ backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--vscode-panel-border)" }}>
        <span className="text-sm font-medium" style={{ color: "var(--vscode-foreground)" }}>Zenoh Daemon — Log</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:opacity-80"
          style={{ color: "var(--vscode-foreground)", background: "none", border: "none", cursor: "pointer" }}
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>Loading logs...</p>
        ) : (
          <pre
            className="text-xs font-mono whitespace-pre-wrap break-words"
            style={{ backgroundColor: "var(--vscode-textCodeBlock-background)", color: "var(--vscode-foreground)", padding: "0.75rem", borderRadius: "4px" }}
            dangerouslySetInnerHTML={{ __html: convert.toHtml(content) }}
          />
        )}
      </div>
    </div>
  );
}

interface Props {
  target: SystemLogTarget | null;
  container: string;
  profile: SystemProfile;
  onClose: () => void;
}

export default function SystemLogPanel({ target, container, profile, onClose }: Props) {
  if (!target) return null;
  const service = target === "robot" ? profile.robotServiceName
    : target === "leader" ? profile.leaderServiceName : CYCLO_INTELLIGENCE_SERVICE;
  if (target === "leader" && !service) return null;

  return (
    <div className="system-log-panel" style={{
      flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column",
    }}>
      {target === "zenoh" ? <ZenohLog onClose={onClose} /> : <FixedLogPanel
        key={target}
        container={target === "intelligence" ? CYCLO_INTELLIGENCE_CONTAINER : container}
        service={service!}
        onClose={onClose}
      />}
    </div>
  );
}
