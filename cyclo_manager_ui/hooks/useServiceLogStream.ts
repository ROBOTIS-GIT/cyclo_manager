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

import { useCallback, useEffect, useRef, useState } from "react";
import { getServiceLogSnapshot } from "@/lib/api";
import { createLogsWebSocket } from "@/lib/logWebsocket";
import { appendLogBlocks, limitLogBlocks, MAX_LOG_LINES, MAX_LOG_CHARS, type LogBlock } from "@/lib/logBuffer";

export type LogBuffer = {
  blocks: LogBlock[];
  charCount: number;
  logId: string | null;
  end: number;
  revision: number;
};
const emptyBuffer = (): LogBuffer => ({ blocks: [], charCount: 0, logId: null, end: 0, revision: 0 });
const boundedBuffer = (buffer: LogBuffer): LogBuffer => {
  const { blocks, charCount } = limitLogBlocks(buffer.blocks, buffer.charCount);
  return { ...buffer, blocks, charCount };
};

// Each mounted panel owns its history cache; live logs are never collected in the background.
export function useServiceLogStream(container: string, service: string, logId: string | null,
  cache: Map<string, LogBuffer>) {
  const [buffer, setBuffer] = useState<LogBuffer>(() => logId ? cache.get(logId) ?? emptyBuffer() : emptyBuffer());
  const bufferRef = useRef(buffer);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [disconnected, setDisconnected] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(logId ? true : null);
  const [loading, setLoading] = useState(false);
  const active = useRef(false);
  const historyRequest = useRef<AbortController | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const reloadRef = useRef<() => void>(() => {});

  const commit = useCallback((next: LogBuffer) => {
    bufferRef.current = next;
    setBuffer(next);
  }, []);
  const report = useCallback((source: string, message?: string) => {
    setErrors(previous => {
      const next = { ...previous };
      if (message) next[source] = message;
      else delete next[source];
      return next;
    });
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (!logId || historyRequest.current) return;
    const request = new AbortController();
    historyRequest.current = request;
    setLoading(true);
    report("history");
    try {
      const snapshot = await getServiceLogSnapshot(container, service, logId, request.signal);
      if (!active.current || request.signal.aborted) return;
      commit(boundedBuffer({ ...emptyBuffer(), blocks: appendLogBlocks([], snapshot.logs),
        charCount: snapshot.logs.length, logId: snapshot.log_id,
        revision: bufferRef.current.revision + 1 }));
    } catch (error) {
      if (active.current && !request.signal.aborted) report("history", error instanceof Error ? error.message : "Could not read log.");
    } finally {
      if (historyRequest.current === request) {
        historyRequest.current = null;
        if (active.current) setLoading(false);
      }
    }
  }, [container, service, logId, commit, report]);

  useEffect(() => {
    active.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let permanent = false;
    let pending = "";
    let receivedEnd = bufferRef.current.end;
    let supportedLive = true;
    let pendingBreaks = 0;

    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!pending) return;
      const current = bufferRef.current;
      const next = { ...current, blocks: appendLogBlocks(current.blocks, pending),
        charCount: current.charCount + pending.length, end: receivedEnd };
      pending = "";
      pendingBreaks = 0;
      commit(boundedBuffer(next));
    };
    const reset = (id: string | null = null, cursor = 0) => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      pending = "";
      receivedEnd = cursor;
      pendingBreaks = 0;
      historyRequest.current?.abort();
      historyRequest.current = null;
      setLoading(false);
      commit({ ...emptyBuffer(), logId: id, end: cursor,
        revision: bufferRef.current.revision + 1 });
    };
    const connect = () => {
      if (!active.current) return;
      clearTimeout(timer);
      permanent = false;
      const current = bufferRef.current;
      // Legacy cursors have no execution identity; start a fresh tail on reconnect.
      if (!supportedLive) reset();
      setDisconnected(false);
      const ws = createLogsWebSocket(container, service, {
        resume: supportedLive && current.logId ? { logId: current.logId, cursor: current.end } : undefined,
        onOpen: () => {
          if (socket.current !== ws || !active.current) return;
          setDisconnected(false);
          report("connection");
        },
        onError: error => { if (active.current && socket.current === ws) report("connection", error.message); },
        onEvent: event => {
          if (!active.current || socket.current !== ws || permanent) return;
          failures = 0;
          if (["logs", "reset", "state", "heartbeat"].includes(event.type)) report("connection");
          if (event.type === "capabilities") {
            supportedLive = event.history === true;
            setSupported(supportedLive);
          } else if (event.type === "reset") {
            reset(event.log_id ?? null, event.cursor ?? 0);
          } else if (event.type === "logs") {
            const text = event.logs ?? event.data ?? "";
            const current = bufferRef.current;
            if (event.log_id && current.logId !== event.log_id) reset(event.log_id, event.start_cursor ?? 0);
            if (typeof event.end_cursor === "number" && event.end_cursor <= receivedEnd) return;
            if (event.log_id && typeof event.start_cursor === "number" && event.start_cursor !== receivedEnd) {
              report("read", "Log position changed. Reload to continue.");
              permanent = true;
              ws.close(1000);
              return;
            }
            if (!text) return;
            // Count only new text so oversized bursts flush before the pending buffer grows.
            let newBreaks = 0;
            for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) newBreaks++;
            receivedEnd = event.end_cursor ?? event.cursor ?? receivedEnd;
            pending += text;
            pendingBreaks += newBreaks;
            if (pending.length >= MAX_LOG_CHARS || pendingBreaks >= MAX_LOG_LINES) flush();
            else if (!flushTimer) flushTimer = setTimeout(flush, 100);
          } else if (event.type === "error") {
            report(event.source ?? "connection", event.message ?? event.data ?? "Log stream error.");
            if (event.retryable === false) permanent = true;
          } else if (event.type === "recovered") report(event.source ?? "connection");
        },
        onClose: event => {
          if (!active.current || socket.current !== ws) return;
          flush();
          const retry = !permanent && ![1000, 1001, 1008].includes(event.code);
          setDisconnected(!retry);
          if (retry) {
            timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** failures++));
          }
        },
      });
      socket.current = ws;
    };
    reloadRef.current = () => {
      clearTimeout(timer);
      socket.current?.close(1000);
      socket.current = null;
      setErrors({});
      reset();
      if (logId) { cache.delete(logId); void loadSnapshot(); }
      else connect();
    };
    if (logId) {
      if (!cache.has(logId)) void loadSnapshot();
    } else connect();
    return () => {
      active.current = false;
      clearTimeout(timer);
      clearTimeout(flushTimer);
      historyRequest.current?.abort();
      historyRequest.current = null;
      socket.current?.close(1000);
      socket.current = null;
      const current = bufferRef.current;
      if (logId && current.logId === logId) {
        cache.delete(logId);
        cache.set(logId, current);
        if (cache.size > 3) cache.delete(cache.keys().next().value!);
      }
    };
  }, [container, service, logId, cache, commit, report, loadSnapshot]);

  return {
    buffer, error: Object.values(errors).join(" · "), disconnected, supported, loading,
    reload: () => reloadRef.current(),
  };
}
