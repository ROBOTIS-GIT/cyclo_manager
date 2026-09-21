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

import { useRef, useState } from "react";
import type { PointerEvent } from "react";

const JOYSTICK_DEADZONE = 0.12;
const THUMB_CLEARANCE_PX = 32;

export default function JogJoystick({ disabled, onMove, onStop }: {
  disabled: boolean;
  onMove: (forward: number, left: number) => void;
  onStop: () => void;
}) {
  const pointer = useRef<number | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const update = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const radius = box.width / 2 - THUMB_CLEARANCE_PX;
    let x = (event.clientX - box.left - box.width / 2) / radius;
    let y = (event.clientY - box.top - box.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    const magnitude = Math.hypot(x, y);
    const scaled = magnitude <= JOYSTICK_DEADZONE ? 0
      : (magnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
    setPosition({ x: x * radius, y: y * radius });
    onMove(magnitude ? -y / magnitude * scaled : 0, magnitude ? -x / magnitude * scaled : 0);
  };
  const release = () => {
    if (pointer.current === null) return;
    pointer.current = null;
    setPosition({ x: 0, y: 0 });
    onStop();
  };
  return (
    <div className="flex justify-center select-none">
      <div role="group" aria-label="Translation joystick: drag to move, release to stop"
        aria-disabled={disabled}
        className="relative w-full max-w-56 aspect-square rounded-full border touch-none"
        style={{ background: "var(--vscode-editor-background)", borderColor: "var(--vscode-panel-border)", opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "grab" }}
        onPointerDown={event => {
          if (disabled || pointer.current !== null) return;
          event.preventDefault(); pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId); update(event);
        }}
        onPointerMove={event => { if (!disabled && pointer.current === event.pointerId) update(event); }}
        onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      >
        <div className="absolute left-1/2 top-1/2 w-14 h-14 -ml-7 -mt-7 rounded-full border pointer-events-none"
          style={{ transform: `translate(${disabled ? 0 : position.x}px, ${disabled ? 0 : position.y}px)`, background: "var(--vscode-button-background)", borderColor: "var(--vscode-focusBorder)" }} />
      </div>
    </div>
  );
}
