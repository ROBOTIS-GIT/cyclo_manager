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

import { memo, useRef, useState, useLayoutEffect } from "react";
import { useAnsiConverter } from "@/hooks/useAnsiConverter";
import type { LogBlock } from "@/lib/logBuffer";

interface LogViewerProps {
  blocks: readonly LogBlock[];
  resetKey: number;
  emptyMessage?: string;
}

const LogLine = memo(function LogLine({ text, lineNumber, convert }: {
  text: string;
  lineNumber: number;
  convert: ReturnType<typeof useAnsiConverter>;
}) {
  return <div data-log-line={lineNumber}
    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", minHeight: "18px" }}
    dangerouslySetInnerHTML={{ __html: convert.toHtml(text) || "\u00a0" }} />;
});

// Unchanged blocks skip even the per-line React element creation and comparison.
const LogBlockView = memo(function LogBlockView({ block, last, convert }: {
  block: LogBlock;
  last: boolean;
  convert: ReturnType<typeof useAnsiConverter>;
}) {
  return <>{block.lines.map((line, index) => {
    // Keep the unfinished empty fragment in the buffer, but do not display it as a log line.
    if (last && index === block.lines.length - 1 && line === "") return null;
    return <LogLine key={block.firstLine + index} lineNumber={block.firstLine + index} text={line} convert={convert} />;
  })}</>;
});

export default function LogViewer({ blocks, resetKey,
  emptyMessage = "No logs available." }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const previousReset = useRef(-1);
  const [showBottom, setShowBottom] = useState({ key: -1, visible: false });
  const convert = useAnsiConverter();

  const captureAnchor = () => {
    const viewport = scrollRef.current;
    const children = linesRef.current?.children;
    if (!viewport || !children?.length) { anchor.current = null; return; }
    const top = viewport.getBoundingClientRect().top;
    let low = 0, high = children.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (children[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
      else high = mid;
    }
    const element = children[low] as HTMLElement;
    anchor.current = { id: element.dataset.logLine!, offset: element.getBoundingClientRect().top - top };
  };

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (previousReset.current !== resetKey) {
      previousReset.current = resetKey;
      following.current = true;
    }
    if (following.current) viewport.scrollTop = viewport.scrollHeight;
    else if (anchor.current) {
      const element = linesRef.current?.querySelector<HTMLElement>(`[data-log-line="${anchor.current.id}"]`);
      if (element) viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.current.offset;
      else viewport.scrollTop = 0; // The line being read has left the retained window.
    }
    captureAnchor();
  }, [blocks, resetKey, convert]);

  return (
    <div className="relative flex h-full min-h-0 flex-col" style={{ background: "var(--vscode-editor-background)" }}>
      <div ref={scrollRef} role="region" aria-label="Log output" tabIndex={0}
        className="min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-xs"
        style={{ overflowAnchor: "none", lineHeight: "18px" }}
        onScroll={() => {
          const viewport = scrollRef.current!;
          following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 32;
          setShowBottom({ key: resetKey, visible: !following.current });
          captureAnchor();
        }}>
        <div ref={linesRef}>
          {blocks.length ? blocks.map((block, index) => (
            <LogBlockView key={block.id} block={block} last={index === blocks.length - 1} convert={convert} />
          )) : <p style={{ color: "var(--vscode-descriptionForeground)" }}>{emptyMessage}</p>}
        </div>
      </div>
      {showBottom.key === resetKey && showBottom.visible && <button className="absolute bottom-3 right-3 rounded px-3 py-1 text-xs shadow"
        style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" }}
        onClick={() => {
          const viewport = scrollRef.current;
          if (viewport) viewport.scrollTop = viewport.scrollHeight;
          following.current = true;
          setShowBottom({ key: resetKey, visible: false });
        }}>Scroll to bottom ↓</button>}
    </div>
  );
}
