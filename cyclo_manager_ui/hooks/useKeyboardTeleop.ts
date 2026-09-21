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

import { useEffect } from "react";
import type { JogCommand } from "@/lib/jog";

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const MOTION_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

type KeyboardTeleopOptions = {
  enabled: boolean;
  mode: "joystick" | "keyboard";
  section: "base" | "joints";
  linearSpeed: number;
  angularSpeed: number;
  onCommand: (command: JogCommand) => void;
  onStop: () => void;
  onDisable: () => void;
};

export function useKeyboardTeleop({
  enabled, mode, section, linearSpeed, angularSpeed, onCommand, onStop, onDisable,
}: KeyboardTeleopOptions) {
  useEffect(() => {
    const keys = new Set<string>();
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (
      ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(target.tagName) || target.isContentEditable
    );
    const publishKeys = () => {
      const x = Number(keys.has("w") || keys.has("arrowup")) - Number(keys.has("s") || keys.has("arrowdown"));
      const y = Number(keys.has("a") || keys.has("arrowleft")) - Number(keys.has("d") || keys.has("arrowright"));
      const yaw = Number(keys.has("q")) - Number(keys.has("e"));
      if (!(x || y || yaw)) { onStop(); return; }
      const norm = Math.max(1, Math.hypot(x, y));
      onCommand({ kind: "base", x: x / norm * linearSpeed, y: y / norm * linearSpeed, yaw: yaw * angularSpeed });
    };
    const down = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === " ") { event.preventDefault(); keys.clear(); onDisable(); return; }
      const key = event.key.toLowerCase();
      if (section !== "base" && window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
      if (mode !== "keyboard" || !enabled || !MOTION_KEYS.has(key)) return;
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
      if (keys.size) onStop();
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear);
    };
  }, [section, mode, enabled, linearSpeed, angularSpeed, onCommand, onStop, onDisable]);
}
