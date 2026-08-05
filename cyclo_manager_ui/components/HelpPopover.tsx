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

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

const HELP_BTN_CLASS =
  "inline-flex items-center justify-center shrink-0 rounded-full border leading-none font-semibold cursor-pointer select-none hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)]";

const HELP_BTN_STYLE: CSSProperties = {
  width: "15px",
  height: "15px",
  fontSize: "10px",
  lineHeight: 1,
  borderColor: "var(--vscode-panel-border)",
  color: "var(--vscode-descriptionForeground)",
  backgroundColor: "var(--vscode-editor-background)",
};

const HELP_PANEL_STYLES: CSSProperties = {
  color: "var(--vscode-descriptionForeground)",
  backgroundColor: "var(--vscode-editor-background)",
  borderColor: "var(--vscode-panel-border)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
};

function computeHelpPosition(anchor: DOMRect): { top: number; left: number; width: number } {
  const panelWidth = Math.min(288, window.innerWidth - 24);
  let left = anchor.left;
  if (left + panelWidth > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - 12 - panelWidth);
  }
  return { top: anchor.bottom + 6, left, width: panelWidth };
}

export type HelpPopoverProps = {
  children: ReactNode;
  ariaLabel: string;
  buttonLabel?: string;
  disabled?: boolean;
  title?: string;
};

export default function HelpPopover({
  children,
  ariaLabel,
  buttonLabel = "?",
  disabled = false,
  title = "Help",
}: HelpPopoverProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const syncPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    setCoords(computeHelpPosition(button.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    syncPosition();
  }, [open, syncPosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("resize", syncPosition);
    return () => {
      window.removeEventListener("scroll", syncPosition, true);
      window.removeEventListener("resize", syncPosition);
    };
  }, [open, syncPosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${HELP_BTN_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        style={HELP_BTN_STYLE}
        aria-expanded={open}
        aria-controls={panelId}
        title={title}
      >
        {buttonLabel}
      </button>
      {typeof document !== "undefined" &&
        open &&
        coords &&
        createPortal(
          <div
            id={panelId}
            role="region"
            aria-label={ariaLabel}
            className="fixed z-[9999] text-xs leading-snug rounded border px-2.5 py-2"
            style={{
              ...HELP_PANEL_STYLES,
              top: coords.top,
              left: coords.left,
              width: coords.width,
            }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
