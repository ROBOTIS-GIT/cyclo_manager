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

import { useRef } from "react";
import type { ReactNode } from "react";

import { btn, button, secondary } from "@/components/ui/controlStyles";

export function HoldButton({ children, label, disabled, onStart, onStop }: {
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

export function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return <label className="block mt-4 text-sm"><span className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums" style={secondary}>{value.toFixed(2)} {unit}</span></span>
    <input className="w-full mt-2" style={{ accentColor: "var(--vscode-focusBorder)" }} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>;
}
