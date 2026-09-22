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
import {
  COMMAND_MIN_INTERVAL_MS, FEEDBACK_TIMEOUT_MS, JOG_HEARTBEAT_INTERVAL_MS,
} from "@/lib/jog";
import type { JogCommand, JogResolution, JogState } from "@/lib/jog";
import { getWebSocketBaseUrl } from "@/lib/websocketUtils";

export function useJogConnection() {
  const [state, setState] = useState<JogState | null>(null);
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const desired = useRef<JogCommand>({ kind: "idle" });
  const enabledRef = useRef(false);
  const pumpRef = useRef<() => void>(() => {});

  const stop = useCallback((disarm = false) => {
    desired.current = { kind: "stop" };
    if (disarm) {
      enabledRef.current = false;
      setEnabledState(false);
    }
    pumpRef.current();
  }, []);

  const command = useCallback((value: JogCommand) => {
    if (!enabledRef.current) return;
    desired.current = value;
    pumpRef.current();
  }, []);

  const pressJoint = useCallback((joint: string, direction: -1 | 1, resolution: JogResolution) => {
    command({ kind: "joint", joint, direction, resolution });
  }, [command]);

  const releaseJoint = useCallback(() => {
    if (desired.current.kind !== "joint") return;
    desired.current = { kind: "release" };
    pumpRef.current();
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    if (!value) { stop(true); return; }
    if (!connected || !state?.robot.ready) return;
    desired.current = { kind: "idle" };
    enabledRef.current = true;
    setEnabledState(true);
  }, [connected, state?.robot.ready, stop]);

  useEffect(() => {
    let disposed = false;
    let lastReply = performance.now();
    let lastSend = -Infinity;
    let lastSent: JogCommand | null = null;
    let hidden = document.hidden;
    let generation: string | null = null;
    let ws: WebSocket | null = null;
    const disarm = () => {
      enabledRef.current = false;
      desired.current = { kind: "idle" };
      setEnabledState(false);
      setConnected(false);
      setState(null);
    };
    const pump = () => {
      if (disposed || ws?.readyState !== WebSocket.OPEN) return;
      // Flush a stop on tab exit, then let the stopped session stay idle.
      if (hidden && desired.current.kind !== "stop") return;
      const input = desired.current;
      const motion = input.kind === "joint" || input.kind === "base";
      if (input.kind === "idle" && lastSent?.kind === "idle") return;
      if (motion) {
        // Coalesce pointer changes and never add held inputs to a blocked transport.
        if (ws.bufferedAmount > 0) return;
        if ((lastSent?.kind === "joint" || lastSent?.kind === "base")
            && performance.now() - lastSend < COMMAND_MIN_INTERVAL_MS) return;
      }
      lastSend = performance.now();
      ws.send(JSON.stringify(input));
      lastSent = input;
      if (input.kind === "stop" || input.kind === "release") {
        desired.current = { kind: "idle" };
        lastSent = desired.current;
      }
    };
    pumpRef.current = pump;
    // Strict Mode immediately cleans up its first effect pass. Defer only
    // connection creation so that pass can cancel before opening a socket.
    const connectTimer = setTimeout(() => {
      if (disposed) return;
      const socket = new WebSocket(`${getWebSocketBaseUrl()}/ws/jog`);
      ws = socket;
      socket.onopen = () => {
        if (disposed) return;
        disarm();
        setError(null);
        lastReply = performance.now();
        pump();
      };
      socket.onmessage = event => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data) as { state?: JogState; error?: string };
          lastReply = performance.now();
          if (message.error) {
            setError(message.error);
            disarm();
            socket.close();
            return;
          }
          if (message.state) {
            if (generation !== message.state.robot.generation || !message.state.robot.ready) {
              enabledRef.current = false;
              setEnabledState(false);
              desired.current = { kind: "idle" };
            }
            generation = message.state.robot.generation;
            setState(message.state); setConnected(true);
          }
        } catch {
          setError("Invalid Jog feedback. Reconnect to continue.");
          disarm();
          socket.close();
        }
      };
      socket.onerror = () => {
        if (!disposed) { setError("Jog connection failed."); disarm(); }
      };
      socket.onclose = () => {
        if (!disposed) { disarm(); setError(previous => previous ?? "Jog disconnected. Reconnect to continue."); }
      };
    }, 0);
    const timer = setInterval(() => {
      if (hidden) return;
      if (ws?.readyState === WebSocket.OPEN && performance.now() - lastReply > FEEDBACK_TIMEOUT_MS) {
        setError("Jog feedback timed out. Reconnect to continue.");
        disarm();
        ws.close();
        return;
      }
      pump();
    }, JOG_HEARTBEAT_INTERVAL_MS);
    const blur = () => stop(true);
    const visibility = () => {
      hidden = document.hidden;
      if (hidden) {
        stop(true);
      } else {
        // Time spent in a background tab is not a missing server reply.
        // Resume feedback only; operation still needs explicit enabling.
        lastReply = performance.now();
        pump();
      }
    };
    const release = () => {
      const input = desired.current;
      if (input.kind === "joint") releaseJoint();
      else if (input.kind === "base") stop();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("cyclo:jog-stop", blur);
    window.addEventListener("pagehide", blur);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      enabledRef.current = false;
      desired.current = { kind: "idle" };
      pumpRef.current = () => {};
      clearTimeout(connectTimer);
      clearInterval(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("cyclo:jog-stop", blur);
      window.removeEventListener("pagehide", blur);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("visibilitychange", visibility);
      // Ordered after any outstanding command; the server also stops on close.
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: "stop" }));
      ws?.close();
    };
  }, [attempt, releaseJoint, stop]);

  return {
    state, connected,
    enabled: connected && !!state?.robot.ready && enabled, error, command, pressJoint, releaseJoint, stop, setEnabled,
    reconnect: () => { stop(true); setState(null); setConnected(false); setAttempt(n => n + 1); },
  };
}
