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

import { getWebSocketBaseUrl, maintainWebSocket } from "@/lib/websocketUtils";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRecordPlay, getRecordPlayStatus, recordPlayCommand } from "@/lib/recordPlay";
import type { RecordPlayOverview, RecordPlayState } from "@/lib/recordPlay";

export function useRecordPlay() {
  const [overview, setOverview] = useState<RecordPlayOverview | null>(null);
  const [state, setState] = useState<RecordPlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
  const owner = useRef("");
  const mounted = useRef(false);
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const update = useCallback((value: RecordPlayState) => { setState(value); }, []);

  useEffect(() => {
    const closeObserver = maintainWebSocket(() => new WebSocket(
      `${getWebSocketBaseUrl()}/record-play/watch`
    ));
    mounted.current = true;
    // Identify the originating page; server jobs do not depend on page lifetime.
    owner.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let disposed = false;
    let polling = false;
    let checkingStatus = false;
    let lastOverview = 0;
    const load = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await getRecordPlay();
        if (!disposed) { setOverview(value); update(value.state); setConnected(true); setConnectionError(null); }
      } catch (err) {
        if (!disposed) { setConnected(false); setConnectionError(err instanceof Error ? err.message : "Server unavailable"); }
      } finally { polling = false; lastOverview = Date.now(); }
    };
    refresh.current = load;
    const tick = async () => {
      if (checkingStatus) return;
      checkingStatus = true;
      try {
        const value = await getRecordPlayStatus();
        if (!disposed) { update(value); setConnected(true); }
      } catch {
        if (!disposed) setConnected(false);
      } finally { checkingStatus = false; }
      if (!disposed && Date.now() - lastOverview > 2000) void load();
    };
    void load();
    const timer = setInterval(() => void tick(), 500);
    return () => {
      closeObserver();
      disposed = true; mounted.current = false; refresh.current = null; clearInterval(timer);
    };
  }, [update]);

  const action = useCallback(async (kind: "record" | "play" | "stop", data?: object) => {
    const commandOwner = owner.current;
    setBusyOwner(commandOwner); setError(null);
    try {
      const value = await recordPlayCommand(kind, kind === "stop" ? undefined : { ...data, owner: commandOwner });
      if (mounted.current && owner.current === commandOwner) { update(value); await refresh.current?.(); }
      return value;
    } catch (err) {
      if (mounted.current && owner.current === commandOwner) setError(err instanceof Error ? err.message : "Command failed");
      return null;
    } finally { if (mounted.current && owner.current === commandOwner) setBusyOwner(null); }
  }, [update]);

  return {
    overview,
    state, error: error || connectionError, connected,
    busy: busyOwner !== null && busyOwner === owner.current, action, owner: owner.current,
  };
}
