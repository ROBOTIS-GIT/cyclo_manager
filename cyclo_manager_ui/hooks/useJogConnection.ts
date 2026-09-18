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
import { getWebSocketBaseUrl } from "@/lib/websocketUtils";

export type JogResolution = "normal" | "fine" | "coarse";

export type JogCommand =
  | { kind: "idle" | "stop" }
  | { kind: "base"; x: number; y: number; yaw: number }
  | { kind: "joint"; joint: string; direction: -1 | 1; mode: "hold" | "step"; resolution: JogResolution };

export type JogJoint = {
  name: string; group: string; topic: string; unit: "m" | "rad";
  lower: number; upper: number; speed: number;
  position: number | null; target: number | null; available: boolean;
};
export type JogState = {
  robot_type: string; base_supported: boolean; feedback_fresh: boolean;
  feedback_age: number | null; description_available: boolean;
  base: [number, number, number]; joints: JogJoint[]; wheels: Record<string, number>;
};

const JOINT_HOLD_DELAY_MS = 350;

export function useJogConnection(robot: string, running: boolean) {
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
    let disposed = false;
    let inFlight = false;
    let lastReply = performance.now();
    let lastSend = -Infinity;
    let hidden = document.hidden;
    let pending: JogCommand | null = null;
    const ws = new WebSocket(`${getWebSocketBaseUrl()}/ws/jog/${robot}`);
    const disarm = () => {
      cancelJointPress();
      enabledRef.current = false;
      desired.current = { kind: "idle" };
      setEnabledState(false);
      setConnected(false);
      setState(null);
    };
    const pump = () => {
      if (disposed || inFlight || ws.readyState !== WebSocket.OPEN) return;
      // Flush a stop on tab exit, then let the stopped session stay idle.
      if (hidden && desired.current.kind !== "stop") return;
      if (desired.current.kind !== "stop" && performance.now() - lastSend < 90) return;
      // One unacknowledged message: motion never builds up in a browser queue.
      pending = desired.current;
      inFlight = true;
      lastSend = performance.now();
      ws.send(JSON.stringify(pending));
    };
    pumpRef.current = pump;
    ws.onopen = () => {
      if (disposed) return;
      disarm();
      setError(null);
      lastReply = performance.now();
      pump();
    };
    ws.onmessage = event => {
      if (disposed) return;
      try {
        const message = JSON.parse(event.data) as { state?: JogState; error?: string };
        inFlight = false;
        lastReply = performance.now();
        if (message.error) {
          setError(message.error);
          disarm();
          ws.close();
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
        ws.close();
      }
    };
    ws.onerror = () => {
      if (!disposed) { setError("Jog connection failed."); disarm(); }
    };
    ws.onclose = () => {
      if (!disposed) { disarm(); setError(previous => previous ?? "Jog disconnected. Reconnect to continue."); }
    };
    const timer = setInterval(() => {
      if (hidden) return;
      if (ws.readyState === WebSocket.OPEN && performance.now() - lastReply > 700) {
        setError("Jog feedback timed out. Reconnect to continue.");
        disarm();
        ws.close();
        return;
      }
      pump();
    }, 100);
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
      clearInterval(timer);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", blur);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("visibilitychange", visibility);
      // Ordered after any outstanding command; the server also stops on close.
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ kind: "stop" }));
      ws.close();
    };
  }, [robot, attempt, stop, cancelJointPress, releaseJoint]);

  return {
    state, connected,
    enabled: running && connected && enabled, error, command, pressJoint, releaseJoint, stop, setEnabled,
    reconnect: () => { stop(true); setState(null); setConnected(false); setAttempt(n => n + 1); },
  };
}
