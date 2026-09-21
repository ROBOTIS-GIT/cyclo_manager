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

import { useEffect, useRef, useState } from "react";
import { checkCameraFrame } from "@/lib/api";

export default function CameraStatusRow({ label, topic, publisher }: {
  label: string; topic: string; publisher: boolean | null;
}) {
  const pending = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ received: boolean; checked_at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => pending.current?.abort(), [topic]);
  async function check() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setChecking(true); setError(null); setResult(null);
    try {
      const response = await checkCameraFrame(topic, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Frame check failed");
    } finally {
      if (!controller.signal.aborted) { setChecking(false); pending.current = null; }
    }
  }
  return <div className="border-t py-2 text-sm" style={{ borderColor: "var(--vscode-panel-border)" }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span style={{ color: "var(--vscode-descriptionForeground)" }}>{label}</span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs">{publisher === null ? "—" : publisher ? "Publisher detected" : "Not detected"}</span>
        <button type="button" className="rounded border px-2 py-1 text-xs disabled:opacity-50" disabled={checking}
          style={{ background: "var(--vscode-button-secondaryBackground)", borderColor: "var(--vscode-panel-border)" }}
          onClick={() => void check()}>{checking ? "Checking…" : "Check frame"}</button>
      </div>
    </div>
    {result && <p className="mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
      Last frame check: {result.received ? "Received" : "No frame within 3 s"} · {new Date(result.checked_at * 1000).toLocaleTimeString()}
    </p>}
    {error && <p role="alert" className="mt-1 break-words text-xs" style={{ color: "var(--vscode-errorForeground)" }}>{error}</p>}
  </div>;
}
