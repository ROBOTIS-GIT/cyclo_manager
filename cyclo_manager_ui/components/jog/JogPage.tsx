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

import { useCallback, useRef, useState } from "react";
import JointJogCard from "@/components/JointJogCard";
import { HoldButton, Slider } from "@/components/JogControls";
import { surface, secondary, button, danger, btn } from "@/components/ui/controlStyles";
import JogJoystick from "@/components/JogJoystick";
import StatusBadge from "@/components/StatusBadge";
import { useJogConnection } from "@/hooks/useJogConnection";
import { useKeyboardTeleop } from "@/hooks/useKeyboardTeleop";
import {
  BASE_TRANSLATION, BASE_ROTATION,
  JOINT_INCREMENTS, formatJointPosition,
} from "@/lib/jog";
import type { JogJoint, JogResolution } from "@/lib/jog";


export default function JogPage({ container }: { container: string }) {
  const [linearSpeed, setLinearSpeed] = useState(BASE_TRANSLATION.initial);
  const [angularSpeed, setAngularSpeed] = useState(BASE_ROTATION.initial);
  const [baseMode, setBaseMode] = useState<"joystick" | "keyboard">("joystick");
  const [mobileSection, setMobileSection] = useState<"base" | "joints">("base");
  const basePanel = useRef<HTMLDivElement>(null);
  const [jointResolution, setJointResolution] = useState<JogResolution>("normal");
  const [group, setGroup] = useState("body");
  const [activeJoint, setActiveJoint] = useState<string | null>(null);
  const jog = useJogConnection(container);
  const { command, stop, enabled } = jog;

  const stopMotion = useCallback(() => { setActiveJoint(null); stop(); }, [stop]);
  const stopAll = useCallback(() => { setActiveJoint(null); stop(true); }, [stop]);
  const move = useCallback((x: number, y: number) => {
    if (baseMode !== "joystick") return;
    setActiveJoint(null);
    if (x === 0 && y === 0) { stop(); return; }
    command({ kind: "base", x: x * BASE_TRANSLATION.max, y: y * BASE_TRANSLATION.max, yaw: 0 });
  }, [baseMode, command, stop]);
  const rotate = (direction: number) => {
    if (baseMode !== "joystick") return;
    setActiveJoint(null);
    command({ kind: "base", x: 0, y: 0, yaw: direction * angularSpeed });
  };
  const baseEnabled = enabled && !!jog.state?.base_supported;
  const manipulator = !jog.state?.base_supported;

  useKeyboardTeleop({
    enabled: baseEnabled, mode: baseMode, section: mobileSection,
    linearSpeed, angularSpeed, onCommand: command, onStop: stopMotion, onDisable: stopAll,
  });

  const joints = jog.state?.joints ?? [];
  const tabs = Array.from(new Set(joints.map(j => j.group))).map(id => ({
    id, label: id === "unassigned" ? "Unassigned" : jog.state?.controllers.find(c => c.topic === id)?.label ?? id,
    match: (j: JogJoint) => j.group === id,
  }));
  const currentTab = tabs.find(tab => tab.id === group) ?? tabs[0];
  const visible = currentTab ? joints.filter(currentTab.match) : [];
  const base = jog.state?.base ?? [0, 0, 0];
  const error = jog.error;
  const robot = jog.state?.robot;
  const running = !!robot?.ready;
  const checking = !jog.connected;
  const controlsDisabled = !jog.connected || !running;

  return <div className="jog-page h-full overflow-auto" style={{ color: "var(--vscode-foreground)", background: "var(--vscode-editor-background)" }}>
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b" style={surface}>
      <div><h1 className="text-lg font-semibold">Jog <span className="text-sm font-normal ml-2" style={secondary}>{container}{robot?.model && ` · ${robot.model.toUpperCase()}`}</span></h1>
        <div className="flex items-center gap-2 text-xs mt-1" style={secondary}>
          <StatusBadge status={jog.connected} dotOnly label={jog.connected ? "Connected" : "Disconnected"} />
          {jog.connected ? "Server connected" : "Server disconnected"}
        </div>
        <div className="flex items-center gap-2 text-xs mt-1" style={secondary} aria-live="polite">
          <StatusBadge status={running} dotOnly label="Robot bringup" />
          Robot bringup: {checking ? "Checking…" : running ? "Running" : "Unavailable"}
        </div>
      </div>
      <div className="jog-actions flex flex-wrap items-center gap-3" style={surface}>
        {!jog.connected && <button type="button" className={btn} style={button} onClick={jog.reconnect}>Reconnect</button>}
        <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={enabled} disabled={!jog.connected || controlsDisabled} onChange={event => { setActiveJoint(null); jog.setEnabled(event.target.checked); }} />Enable jog</label>
        <button type="button" className={`${btn} font-semibold`} style={danger} onClick={stopAll}>■ Stop jog</button>
      </div>
    </header>
    {error && <div role="alert" className="m-4 p-3 border rounded text-sm" style={danger}>{error}</div>}
    {!running && !checking && <div className="mx-5 mt-4 text-sm" style={secondary}>{robot?.reason ?? "Waiting for robot bringup."}</div>}
    {running && joints.some(j => !j.topic) && <p className="px-5 mt-4 text-sm" style={secondary}>Some joints have no matching controller feedback for this robot profile.</p>}
    <div role="tablist" aria-label="Jog section" className={`${manipulator ? "hidden" : "grid"} grid-cols-2 gap-2 p-2 md:hidden`}>
      {(["base", "joints"] as const).map(section => <button type="button" role="tab" key={section}
        aria-selected={mobileSection === section} disabled={controlsDisabled} className={btn}
        style={mobileSection === section ? { ...button, background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" } : button}
        onClick={() => { stopMotion(); setMobileSection(section); }}>{section === "base" ? "Base" : "Joints"}</button>)}
    </div>
    <fieldset aria-label="Jog controls" disabled={controlsDisabled} inert={controlsDisabled}
      className={`grid grid-cols-1 ${manipulator ? "" : "lg:grid-cols-[minmax(260px,0.85fr)_minmax(300px,1.15fr)]"} gap-4 p-2 md:p-5 min-w-0 border-0`}
      style={{ opacity: controlsDisabled ? 0.45 : 1 }}>
      <section className={`${manipulator ? "hidden" : mobileSection === "base" ? "" : "hidden md:block"} p-4 md:p-5 rounded-lg border min-w-0`} style={surface}>
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
        {baseMode === "keyboard" && <Slider label="Translation speed" value={linearSpeed} min={BASE_TRANSLATION.min} max={BASE_TRANSLATION.max} step={BASE_TRANSLATION.step} unit="m/s" onChange={v => { stopMotion(); setLinearSpeed(v); }} />}
        <Slider label="Rotation speed" value={angularSpeed} min={BASE_ROTATION.min} max={BASE_ROTATION.max} step={BASE_ROTATION.step} unit="rad/s" onChange={v => { stopMotion(); setAngularSpeed(v); }} />
        <div className="mt-5 pt-3 border-t grid grid-cols-3 gap-2 text-xs tabular-nums" style={{ ...secondary, borderColor: "var(--vscode-panel-border)" }}>
          <div>Forward<div className="mt-1">{base[0].toFixed(2)} m/s</div></div><div>Lateral<div className="mt-1">{base[1].toFixed(2)} m/s</div></div><div>Rotation<div className="mt-1">{base[2].toFixed(2)} rad/s</div></div>
        </div>
        <div className="mt-4 pt-3 border-t text-xs" style={{ ...secondary, borderColor: "var(--vscode-panel-border)" }}>
          <h3>Wheel steering angle</h3>
          {!jog.state?.feedback_fresh ? <p className="mt-2">Waiting for fresh joint feedback.</p> : <div className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
            {Object.entries(jog.state.wheels).map(([name, value]) => <div key={name}><div className="capitalize break-words">{name.replace("_wheel_steer", "")}</div><div className="mt-1">{formatJointPosition(value, "rad")}°</div></div>)}
          </div>}
        </div>
      </section>
      <fieldset aria-label="Joint jog controls"
        className={`${manipulator || mobileSection === "joints" ? "" : "hidden md:block"} @container p-4 md:p-5 rounded-lg border min-w-0`} style={surface}>
        <div className="flex justify-between items-start gap-2 mb-4">
          <div><h2 className="font-semibold">Joint jog</h2></div>
          <span className="flex items-center gap-2 text-xs" style={secondary}>
            <>
              <StatusBadge status={!!jog.state?.feedback_fresh} dotOnly label={jog.state?.feedback_fresh ? "Receiving joint states" : "No fresh joint states"} />
              /joint_states
            </>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Joint groups">{tabs.map(tab => <button type="button" key={tab.id} className={`${btn} max-w-full break-all text-left`} aria-pressed={currentTab?.id === tab.id}
          style={currentTab?.id === tab.id ? { ...button, color: "var(--vscode-button-foreground)", background: "var(--vscode-button-background)" } : button}
          onClick={() => { stopMotion(); setGroup(tab.id); }}>{tab.label}</button>)}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 pb-3 border-b text-sm" style={{ borderColor: "var(--vscode-panel-border)" }}>
          <label className="flex flex-wrap items-center justify-end gap-2 min-w-0">Increment
            <select aria-label="Joint increment" className="p-1.5 border rounded max-w-full" style={button}
              value={jointResolution}
              onChange={event => { stopMotion(); setJointResolution(event.target.value as JogResolution); }}>
              {JOINT_INCREMENTS.map(increment => <option key={increment.value} value={increment.value}>
                {increment.millimetres} mm / {increment.degrees}°
              </option>)}
            </select>
          </label>
        </div>
        {visible.length === 0 && <div className="py-12 text-sm text-center" style={secondary}>{!running ? "Waiting for robot feedback." : !jog.state?.description_available ? "Waiting for robot description and joint limits…" : "No supported joints in this group."}</div>}
        <div className="mt-4 grid grid-cols-1 @min-[36rem]:grid-cols-2 gap-3">{visible.map(joint => (
          <JointJogCard key={joint.name} joint={joint} enabled={enabled}
            active={enabled && activeJoint === joint.name}
            onStart={direction => {
              setActiveJoint(joint.name);
              jog.pressJoint(joint.name, direction, jointResolution);
            }}
            onStop={() => { setActiveJoint(null); jog.releaseJoint(); }} />
        ))}</div>
      </fieldset>
    </fieldset>
  </div>;
}
