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

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import {
  sendTerminalJson,
  sendTerminalText,
  subscribeTerminal,
} from "@/lib/terminalConnection";

interface Props {
  wsUrl: string;
  isActive: boolean;
}

export function XTerminal({ wsUrl, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let cleanupFn: (() => void) | null = null;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        scrollback: 10000,
        cursorBlink: true,
        fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
        fontSize: 13,
        theme: { background: "#1e1e1e", foreground: "#cccccc", cursor: "#ffffff" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      fitRef.current = fit;

      const sendResize = () => {
        sendTerminalJson(wsUrl, { type: "resize", cols: term.cols, rows: term.rows });
      };

      const unsubscribe = subscribeTerminal(
        wsUrl,
        (data) => {
          if (!disposed) term.write(data);
        },
        () => {
          if (!disposed) term.write("\r\n\x1b[2mConnection closed\x1b[0m\r\n");
        },
        () => {
          if (!disposed) {
            term.clear();
            sendResize();
          }
        }
      );

      term.onData((data) => {
        sendTerminalText(wsUrl, data);
      });
      term.onResize(({ cols, rows }) => {
        sendTerminalJson(wsUrl, { type: "resize", cols, rows });
      });

      const observer = new ResizeObserver(() => { if (!disposed) fit.fit(); });
      observer.observe(containerRef.current!);

      cleanupFn = () => {
        observer.disconnect();
        unsubscribe();
        term.dispose();
        fitRef.current = null;
      };

      if (disposed) {
        cleanupFn();
        cleanupFn = null;
      }
    })();

    return () => {
      disposed = true;
      cleanupFn?.();
      cleanupFn = null;
    };
  }, [wsUrl]);

  useEffect(() => {
    if (isActive) requestAnimationFrame(() => fitRef.current?.fit());
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        padding: "4px",
        overflow: "hidden",
        visibility: isActive ? "visible" : "hidden",
        pointerEvents: isActive ? "auto" : "none",
      }}
    />
  );
}
