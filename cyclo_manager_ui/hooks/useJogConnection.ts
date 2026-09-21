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
  COMMAND_MIN_INTERVAL_MS, FEEDBACK_TIMEOUT_MS, JOG_POLL_INTERVAL_MS, JOINT_HOLD_DELAY_MS,
} from "@/lib/jog";
import type { JogCommand, JogResolution, JogState } from "@/lib/jog";
import { getWebSocketBaseUrl } from "@/lib/websocketUtils";

export function useJogConnection(robot: string | null, running: boolean) {
  const [state, setState] = useState<JogState | null>(null);
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const desired = useRef<JogCommand>({ kind: "idle" });
  const enabledRef = useRef(false);
  const pumpRef = useRef<() => void>(() => {});
  const jointPress = useRef<{ timer: ReturnType<typeof setTimeout>; holding: boolean } | null>(null);

  const cancelJointPress = useCallback(() => {
    const press = jointPress.current;
    if (press) clearTimeout(press.timer);
    jointPress.current = null;
    return press?.holding ?? false;
  }, []);

  const stop = useCallback((disarm = false) => {
    cancelJointPress();
    desired.current = { kind: "stop" };
    if (disarm) {
      enabledRef.current = false;
      setEnabledState(false);
    }
    pumpRef.current();
  }, [cancelJointPress]);

  const command = useCallback((value: JogCommand) => {
    if (!running || !enabledRef.current) return;
    cancelJointPress();
    desired.current = value;
    pumpRef.current();
  }, [cancelJointPress, running]);

  const pressJoint = useCallback((joint: string, direction: -1 | 1, resolution: JogResolution) => {
    if (!running || !enabledRef.current) return;
    cancelJointPress();
    // Start with one bounded step, then repeat feedback-relative goals when
    // the button remains pressed. Never accumulate targets in the browser.
    desired.current = { kind: "joint", joint, direction, mode: "step", resolution };
    pumpRef.current();
    const press = {
      holding: false,
      timer: setTimeout(() => {
        if (jointPress.current !== press || !enabledRef.current) return;
        press.holding = true;
        desired.current = { kind: "joint", joint, direction, mode: "hold", resolution };
        pumpRef.current();
      }, JOINT_HOLD_DELAY_MS),
    };
    jointPress.current = press;
  }, [cancelJointPress, running]);

  const releaseJoint = useCallback(() => {
    // A tap completes its single step; releasing a hold stops repeated motion.
    if (cancelJointPress()) stop();
  }, [cancelJointPress, stop]);

  const setEnabled = useCallback((value: boolean) => {
    if (!value) { stop(true); return; }
    if (!connected || !running) return;
    desired.current = { kind: "idle" };
    enabledRef.current = true;
    setEnabledState(true);
  }, [connected, running, stop]);

  useEffect(() => {
    // Hydration must read the saved robot before opening any connection.
    if (robot === null) return;
    let disposed = false;
    let inFlight = false;
    let lastReply = performance.now();
    let lastSend = -Infinity;
    let hidden = document.hidden;
    let pending: JogCommand | null = null;
    let ws: WebSocket | null = null;
    const disarm = () => {
      cancelJointPress();
      enabledRef.current = false;
      desired.current = { kind: "idle" };
      setEnabledState(false);
      setConnected(false);
      setState(null);
    };
    const pump = () => {
      if (disposed || inFlight || ws?.readyState !== WebSocket.OPEN) return;
      // Flush a stop on tab exit, then let the stopped session stay idle.
      if (hidden && desired.current.kind !== "stop") return;
      if (desired.current.kind !== "stop" && performance.now() - lastSend < COMMAND_MIN_INTERVAL_MS) return;
      // One unacknowledged message: motion never builds up in a browser queue.
      pending = desired.current;
      inFlight = true;
      lastSend = performance.now();
      ws.send(JSON.stringify(pending));
    };
    pumpRef.current = pump;
    // Strict Mode immediately cleans up its first effect pass. Defer only
    // connection creation so that pass can cancel before opening a socket.
    const connectTimer = setTimeout(() => {
      if (disposed) return;
      const socket = new WebSocket(`${getWebSocketBaseUrl()}/ws/jog/${robot}`);
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
          inFlight = false;
          lastReply = performance.now();
          if (message.error) {
            setError(message.error);
            disarm();
            socket.close();
            return;
          }
          if (message.state) { setState(message.state); setConnected(true); }
          const sent = pending;
          if (sent === desired.current && (sent?.kind === "stop" || (sent?.kind === "joint" && sent.mode === "step"))) {
            desired.current = { kind: "idle" };
          } else if (sent !== desired.current) {
            // A release/stop that arrived during the request is sent immediately.
            pump();
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
    }, JOG_POLL_INTERVAL_MS);
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
      releaseJoint();
      const input = desired.current;
      if (input.kind === "base" || (input.kind === "joint" && input.mode === "hold")) stop();
    };
    const cancel = () => stop();
    window.addEventListener("blur", blur);
    window.addEventListener("cyclo:jog-stop", blur);
    window.addEventListener("pagehide", blur);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      cancelJointPress();
      enabledRef.current = false;
      desired.current = { kind: "idle" };
      pumpRef.current = () => {};
      clearTimeout(connectTimer);
      clearInterval(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("cyclo:jog-stop", blur);
      window.removeEventListener("pagehide", blur);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("visibilitychange", visibility);
      // Ordered after any outstanding command; the server also stops on close.
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: "stop" }));
      ws?.close();
    };
  }, [robot, attempt, stop, cancelJointPress, releaseJoint]);

  return {
    state, connected,
    enabled: running && connected && enabled, error, command, pressJoint, releaseJoint, stop, setEnabled,
    reconnect: () => { stop(true); setState(null); setConnected(false); setAttempt(n => n + 1); },
  };
}
