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
// Author: Howon Kim, Hyungyu Kim

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import JogJoystick from "@/components/JogJoystick";
import StatusBadge from "@/components/StatusBadge";
import { usePolling } from "@/hooks/usePolling";
import { useJogConnection } from "@/hooks/useJogConnection";
import type { JogJoint, JogResolution } from "@/hooks/useJogConnection";
import { getDockerContainers, getServiceStatus } from "@/lib/api";

const ROBOTS = ["sg2", "bg2", "sh5", "bh5", "f1", "f2", "mobile"];
const surface: CSSProperties = { background: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" };
const secondary: CSSProperties = { color: "var(--vscode-descriptionForeground)" };
const button: CSSProperties = { background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", borderColor: "var(--vscode-panel-border)" };
const danger: CSSProperties = { color: "var(--vscode-errorForeground)", borderColor: "var(--vscode-errorForeground)" };
const btn = "px-3 py-2 rounded border text-sm disabled:opacity-40 disabled:cursor-not-allowed";

function storedRobot() {
  if (typeof window === "undefined") return "sg2";
  const value = localStorage.getItem("robot_type_ai_worker") ?? "sg2";
  return ROBOTS.includes(value) ? value : "sg2";
}

function subscribeRobot(refresh: () => void) {
  window.addEventListener("focus", refresh);
  window.addEventListener("storage", refresh);
  return () => {
    window.removeEventListener("focus", refresh);
    window.removeEventListener("storage", refresh);
  };
}

function HoldButton({ children, label, disabled, onStart, onStop }: {
  children: ReactNode; label: string; disabled: boolean; onStart: () => void; onStop: () => void;
}) {
  const pressed = useRef(false);
  const release = () => { if (pressed.current) { pressed.current = false; onStop(); } };
  return <button type="button" className={`${btn} touch-none select-none min-w-11 min-h-11 active:brightness-125`} style={button}
    aria-label={label} disabled={disabled}
    onPointerDown={event => {
      event.preventDefault(); if (pressed.current) return;
      pressed.current = true; event.currentTarget.setPointerCapture(event.pointerId); onStart();
    }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
    onKeyDown={event => {
      if (![" ", "Enter"].includes(event.key) || event.repeat) return;
      event.preventDefault(); if (!pressed.current) { pressed.current = true; onStart(); }
    }}
    onKeyUp={event => { if ([" ", "Enter"].includes(event.key)) release(); }}
  >{children}</button>;
}

function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return <label className="block mt-4 text-sm"><span className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums" style={secondary}>{value.toFixed(2)} {unit}</span></span>
    <input className="w-full mt-2" style={{ accentColor: "var(--vscode-focusBorder)" }} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

function jointLabel(joint: JogJoint) {
  if (joint.name === "lift_joint") return "Lift";
  // Keep URDF names visible; pitch/yaw order varies between models.
  if (joint.group === "head") return `Neck ${joint.name.endsWith("1") ? "1" : "2"}`;
  if (joint.name.startsWith("gripper")) return joint.name.includes("_l_") ? "Left gripper" : "Right gripper";
  return `Joint ${joint.name.match(/\d+$/)?.[0] ?? ""}`;
}

function displayed(value: number | null, unit: string) {
  return value === null ? "—" : (unit === "m" ? value * 1000 : value * 180 / Math.PI).toFixed(1);
}

export default function JogPage() {
  const robot = useSyncExternalStore(subscribeRobot, storedRobot, () => "sg2");
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(true);
  const [robotError, setRobotError] = useState<string | null>(null);
  const [linearSpeed, setLinearSpeed] = useState(0.1);
  const [angularSpeed, setAngularSpeed] = useState(0.2);
  const [baseMode, setBaseMode] = useState<"joystick" | "keyboard">("joystick");
  const basePanel = useRef<HTMLDivElement>(null);
  const [jointResolution, setJointResolution] = useState<JogResolution>("normal");
  const [group, setGroup] = useState("body");
  const [activeJoint, setActiveJoint] = useState<string | null>(null);
  const pollInFlight = useRef(false);
  const jog = useJogConnection(robot, running);
  const { command, stop, enabled } = jog;

  const poll = useCallback(async (isActive: () => boolean) => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const result = await getDockerContainers(false);
      const exists = result.containers.some(container => container.name === "ai_worker");
      const up = exists && (await getServiceStatus("ai_worker", "ai_worker_bringup")).is_up;
      if (isActive()) {
        if (!up) stop(true);
        setRunning(up); setChecking(false); setRobotError(null);
      }
    } catch {
      if (isActive()) {
        stop(true);
        setRunning(false); setChecking(false); setRobotError("Cannot read robot service status.");
      }
    } finally { pollInFlight.current = false; }
  }, [stop]);
  usePolling(poll, 2000);

  const stopMotion = useCallback(() => { setActiveJoint(null); stop(); }, [stop]);
  const stopAll = useCallback(() => { setActiveJoint(null); stop(true); }, [stop]);
  const move = useCallback((x: number, y: number) => {
    if (baseMode !== "joystick") return;
    setActiveJoint(null);
    if (x === 0 && y === 0) { stop(); return; }
    command({ kind: "base", x: x * linearSpeed, y: y * linearSpeed, yaw: 0 });
  }, [baseMode, command, linearSpeed, stop]);
  const rotate = (direction: number) => {
    if (baseMode !== "joystick") return;
    setActiveJoint(null);
    command({ kind: "base", x: 0, y: 0, yaw: direction * angularSpeed });
  };
  const baseEnabled = enabled && !!jog.state?.base_supported;
  const jointSupported = robot !== "mobile";

  useEffect(() => {
    const keys = new Set<string>();
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (
      ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(target.tagName) || target.isContentEditable
    );
    const publishKeys = () => {
      const x = Number(keys.has("w") || keys.has("arrowup")) - Number(keys.has("s") || keys.has("arrowdown"));
      const y = Number(keys.has("a") || keys.has("arrowleft")) - Number(keys.has("d") || keys.has("arrowright"));
      const yaw = Number(keys.has("q")) - Number(keys.has("e"));
      if (!(x || y || yaw)) { stopMotion(); return; }
      const norm = Math.max(1, Math.hypot(x, y));
      command({ kind: "base", x: x / norm * linearSpeed, y: y / norm * linearSpeed, yaw: yaw * angularSpeed });
    };
    const down = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === " ") { event.preventDefault(); keys.clear(); stopAll(); return; }
      const key = event.key.toLowerCase();
      if (baseMode !== "keyboard" || !baseEnabled || !["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;
      event.preventDefault(); if (event.repeat) return;
      keys.add(key); publishKeys();
    };
    const up = (event: KeyboardEvent) => {
      if (!keys.delete(event.key.toLowerCase())) return;
      event.preventDefault(); publishKeys();
    };
    const clear = () => { keys.clear(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", clear);
    return () => {
      if (keys.size) stopMotion();
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear);
    };
  }, [baseMode, baseEnabled, linearSpeed, angularSpeed, command, stopMotion, stopAll]);

  const joints = jog.state?.joints ?? [];
  const tabs = [
    { id: "body", label: "Neck & lift", match: (j: JogJoint) => ["head", "lift"].includes(j.group) },
    { id: "arm_l", label: "Left arm", match: (j: JogJoint) => j.group === "arm_l" && !j.name.startsWith("gripper") },
    { id: "arm_r", label: "Right arm", match: (j: JogJoint) => j.group === "arm_r" && !j.name.startsWith("gripper") },
    { id: "gripper", label: "Grippers", match: (j: JogJoint) => j.name.startsWith("gripper") },
    { id: "hand_l", label: "Left hand", match: (j: JogJoint) => j.group === "hand_l" },
    { id: "hand_r", label: "Right hand", match: (j: JogJoint) => j.group === "hand_r" },
  ].filter(tab => tab.id === "body" || joints.some(tab.match));
  const currentTab = tabs.find(tab => tab.id === group) ?? tabs[0];
  const visible = joints.filter(currentTab.match);
  const base = jog.state?.base ?? [0, 0, 0];
  const error = robotError ?? jog.error;
  const bringupLabel = checking ? "Checking…" : robotError ? "Unavailable" : running ? "Running" : "Stopped";
  const controlsDisabled = checking || !running;

  return <div className="h-full overflow-auto" style={{ color: "var(--vscode-foreground)", background: "var(--vscode-editor-background)" }}>
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b" style={surface}>
      <div><h1 className="text-lg font-semibold">Jog <span className="text-sm font-normal ml-2" style={secondary}>{robot.toUpperCase()}</span></h1>
        <div className="flex items-center gap-2 text-xs mt-1" style={secondary}>
          <StatusBadge status={jog.connected} dotOnly label={jog.connected ? "Connected" : "Disconnected"} />
          {jog.connected ? "Server connected" : "Server disconnected"}
        </div>
        <div className="flex items-center gap-2 text-xs mt-1" style={secondary} aria-live="polite">
          <StatusBadge status={!controlsDisabled} dotOnly label={bringupLabel} />
          Robot bringup: {bringupLabel}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!jog.connected && <button type="button" className={btn} style={button} onClick={jog.reconnect}>Reconnect</button>}
        <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={enabled} disabled={!jog.connected || controlsDisabled} onChange={event => { setActiveJoint(null); jog.setEnabled(event.target.checked); }} />Enable jog</label>
        <button type="button" className={`${btn} font-semibold`} style={danger} onClick={stopAll}>■ Stop jog</button>
      </div>
    </header>
    {error && <div role="alert" className="m-4 p-3 border rounded text-sm" style={danger}>{error}</div>}
    {!running && !checking && <div className="mx-5 mt-4 text-sm" style={secondary}>Start the robot from System to use Jog.</div>}
    <fieldset aria-label="Jog controls" disabled={controlsDisabled} inert={controlsDisabled}
      className="grid grid-cols-1 lg:grid-cols-[minmax(260px,0.85fr)_minmax(300px,1.15fr)] gap-4 p-2 md:p-5 min-w-0 border-0"
      style={{ opacity: controlsDisabled ? 0.45 : 1 }}>
      <section className="p-4 md:p-5 rounded-lg border min-w-0" style={surface}>
        <div className="flex justify-between items-start gap-2 mb-5"><h2 className="font-semibold">Mobile base</h2>{jog.state && !jog.state.base_supported && <span className="text-xs" style={secondary}>Not supported</span>}</div>
        <div role="tablist" aria-label="Base input mode" className="flex gap-2 mb-4">
          {(["joystick", "keyboard"] as const).map(mode => <button key={mode} type="button" role="tab"
            id={`base-${mode}-tab`} aria-selected={baseMode === mode} aria-controls="base-input-panel"
            className={`${btn} flex-1`} style={baseMode === mode ? { ...button, color: "var(--vscode-button-foreground)", background: "var(--vscode-button-background)" } : button}
            onClick={() => { if (baseMode !== mode) { stopMotion(); setBaseMode(mode); } basePanel.current?.focus(); }}>
            {mode === "joystick" ? "Joystick" : "Keyboard"}
          </button>)}
        </div>
        <div ref={basePanel} id="base-input-panel" role="tabpanel" aria-labelledby={`base-${baseMode}-tab`} tabIndex={0}
          className="rounded focus-visible:outline-2 focus-visible:outline-offset-4" style={{ outlineColor: "var(--vscode-focusBorder)" }}>
          {baseMode === "joystick" ? <>
            <JogJoystick disabled={!baseEnabled} onMove={move} onStop={stopMotion} />
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              <HoldButton label="Rotate left" disabled={!baseEnabled} onStart={() => rotate(1)} onStop={stopMotion}>↶ Rotate left</HoldButton>
              <HoldButton label="Rotate right" disabled={!baseEnabled} onStart={() => rotate(-1)} onStop={stopMotion}>Rotate right ↷</HoldButton>
            </div>
          </> : <div className="min-h-72 flex flex-col items-center justify-center gap-5 text-xs" style={{ ...secondary, opacity: baseEnabled ? 1 : 0.4 }}>
            <p>Hold a key to move · release to stop</p>
            <div className="grid grid-cols-3 gap-x-5 gap-y-4 text-center">
              {[["Q", "Rotate left"], ["W / ↑", "Forward"], ["E", "Rotate right"], ["A / ←", "Left"], ["S / ↓", "Backward"], ["D / →", "Right"]].map(([key, label]) => <div key={key}>
                <kbd className="block rounded border px-3 py-3 text-sm mb-1" style={button}>{key}</kbd>{label}
              </div>)}
            </div>
            <p>Space to stop and disable Jog</p>
          </div>}
        </div>
        <Slider label="Translation speed" value={linearSpeed} min={0.05} max={0.3} step={0.05} unit="m/s" onChange={v => { stopMotion(); setLinearSpeed(v); }} />
        <Slider label="Rotation speed" value={angularSpeed} min={0.1} max={0.6} step={0.1} unit="rad/s" onChange={v => { stopMotion(); setAngularSpeed(v); }} />
        <div className="mt-5 pt-3 border-t grid grid-cols-3 gap-2 text-xs tabular-nums" style={{ ...secondary, borderColor: "var(--vscode-panel-border)" }}>
          <div>Forward<div className="mt-1">{base[0].toFixed(2)} m/s</div></div><div>Lateral<div className="mt-1">{base[1].toFixed(2)} m/s</div></div><div>Rotation<div className="mt-1">{base[2].toFixed(2)} rad/s</div></div>
        </div>
        <div className="mt-4 pt-3 border-t text-xs" style={{ ...secondary, borderColor: "var(--vscode-panel-border)" }}>
          <h3>Wheel steering angle</h3>
          {!jog.state?.feedback_fresh ? <p className="mt-2">Waiting for fresh joint feedback.</p> : <div className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
            {Object.entries(jog.state.wheels).map(([name, value]) => <div key={name}><div className="capitalize break-words">{name.replace("_wheel_steer", "")}</div><div className="mt-1">{displayed(value, "rad")}°</div></div>)}
          </div>}
        </div>
      </section>
      <fieldset aria-label="Joint jog controls" disabled={!jointSupported} inert={!jointSupported}
        className="@container p-4 md:p-5 rounded-lg border min-w-0" style={{ ...surface, opacity: jointSupported ? 1 : 0.45 }}>
        <div className="flex justify-between items-start gap-2 mb-4">
          <div><h2 className="font-semibold">Joint jog</h2>{!jointSupported && <p className="text-xs mt-1" style={secondary}>Mobile bringup supports base jog only.</p>}</div>
          <span className="flex items-center gap-2 text-xs" style={secondary}>
            {!jointSupported ? "Not supported" : <>
              <StatusBadge status={!!jog.state?.feedback_fresh} dotOnly label={jog.state?.feedback_fresh ? "Receiving joint states" : "No fresh joint states"} />
              /joint_states
            </>}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Joint groups">{tabs.map(tab => <button type="button" key={tab.id} className={btn} aria-pressed={currentTab.id === tab.id}
          style={currentTab.id === tab.id ? { ...button, color: "var(--vscode-button-foreground)", background: "var(--vscode-button-background)" } : button}
          onClick={() => { stopMotion(); setGroup(tab.id); }}>{tab.label}</button>)}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 pb-3 border-b text-sm" style={{ borderColor: "var(--vscode-panel-border)" }}>
          <label className="flex flex-wrap items-center justify-end gap-2 min-w-0">Increment
            <select aria-label="Joint increment" className="p-1.5 border rounded max-w-full" style={button}
              value={jointResolution}
              onChange={event => { stopMotion(); setJointResolution(event.target.value as JogResolution); }}>
              <option value="fine">1 mm / 0.1°</option>
              <option value="normal">10 mm / 1°</option>
              <option value="coarse">20 mm / 2°</option>
            </select>
          </label>
        </div>
        {jointSupported && visible.length === 0 && <div className="py-12 text-sm text-center" style={secondary}>{!running ? "Start the robot to load its joints." : !jog.state?.description_available ? "Waiting for robot description and joint limits…" : "No supported joints in this group."}</div>}
        <div className="mt-4 grid grid-cols-1 @min-[36rem]:grid-cols-2 gap-3">{visible.map(joint => {
          const unit = joint.unit === "m" ? "mm" : "°";
          const active = enabled && activeJoint === joint.name;
          const canMove = jointSupported && enabled && joint.available;
          const range = joint.upper - joint.lower;
          const positionRatio = joint.position === null || range <= 0 ? null
            : Math.max(0, Math.min(1, (joint.position - joint.lower) / range));
          const targetPending = canMove && joint.position !== null && joint.target !== null
            && Math.abs(joint.target - joint.position) > (joint.unit === "m" ? 0.0001 : Math.PI / 18000);
          const begin = (direction: -1 | 1) => {
            setActiveJoint(joint.name);
            jog.pressJoint(joint.name, direction, jointResolution);
          };
          const release = () => { setActiveJoint(null); jog.releaseJoint(); };
          return <article key={joint.name} aria-label={`${jointLabel(joint)} · ${joint.name}`}
            className="min-w-0 rounded-xl border p-4 md:p-5" style={{ background: "var(--vscode-editor-background)", borderColor: active ? "var(--vscode-focusBorder)" : "var(--vscode-panel-border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><h3 className="text-base font-semibold">{jointLabel(joint)}</h3><div className="mt-1 text-[11px] font-mono break-all" style={secondary}>{joint.name}</div></div>
              <div className="flex gap-2 shrink-0">
                <HoldButton label={`Decrease ${joint.name}`} disabled={!canMove || (joint.position !== null && joint.position <= joint.lower)} onStart={() => begin(-1)} onStop={release}>−</HoldButton>
                <HoldButton label={`Increase ${joint.name}`} disabled={!canMove || (joint.position !== null && joint.position >= joint.upper)} onStart={() => begin(1)} onStop={release}>+</HoldButton>
              </div>
            </div>
            <dl className="grid gap-4 mt-5 tabular-nums" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))" }}>
              <div className="min-w-0">
                <dt className="text-xs" style={secondary}>Current{!joint.available && <span className="ml-2" style={{ color: "var(--vscode-errorForeground)" }}>{joint.position === null ? "No feedback" : "Stale"}</span>}</dt>
                <dd className="flex flex-wrap items-baseline gap-x-1.5 mt-1.5"><span className="text-3xl font-semibold tracking-tight">{displayed(joint.position, joint.unit)}</span><span className="text-sm" style={secondary}>{unit}</span></dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs" style={secondary}>Target</dt>
                <dd className="flex flex-wrap items-baseline gap-x-1.5 mt-1.5" style={targetPending ? { color: "var(--vscode-focusBorder)" } : secondary}><span className="text-3xl font-medium tracking-tight">{displayed(joint.target, joint.unit)}</span><span className="text-sm">{unit}</span></dd>
              </div>
            </dl>
            <div className="mt-6">
              <div className="relative h-1.5 rounded-full" style={{ background: "var(--vscode-panel-border)" }}
                role={positionRatio === null ? undefined : "meter"} aria-label={`${jointLabel(joint)} position`}
                aria-valuemin={joint.lower} aria-valuemax={joint.upper}
                aria-valuenow={positionRatio === null ? undefined : joint.lower + positionRatio * range}
                aria-valuetext={`${displayed(joint.position, joint.unit)} ${unit}${!joint.available ? " (unavailable)" : ""}`}>
                {positionRatio !== null && <>
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${positionRatio * 100}%`, background: "var(--vscode-focusBorder)", opacity: joint.available ? 0.35 : 0.15 }} />
                  <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${positionRatio * 100}%`, background: joint.available ? "var(--vscode-focusBorder)" : "var(--vscode-descriptionForeground)", borderColor: "var(--vscode-editor-background)" }} />
                </>}
              </div>
              <div className="flex justify-between gap-3 mt-2 text-[11px] tabular-nums" style={secondary}><span>{displayed(joint.lower, joint.unit)} {unit}</span><span>{displayed(joint.upper, joint.unit)} {unit}</span></div>
            </div>
          </article>;
        })}</div>
      </fieldset>
    </fieldset>
  </div>;
}
