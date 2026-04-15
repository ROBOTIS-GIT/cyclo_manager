"use client";

import { useRef, useState, useMemo, useLayoutEffect, useCallback } from "react";
import Convert from "ansi-to-html";
import { useTheme } from "@/contexts/ThemeContext";

interface LogViewerProps {
  logs: string;
  autoScroll?: boolean;
  className?: string;
}

export default function LogViewer({
  logs,
  autoScroll = true,
  className = "",
}: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const { theme } = useTheme();

  const convert = useMemo(() => {
    const isDark = theme === "dark";
    return new Convert({
      fg: isDark ? "#d4d4d4" : "#333333",
      bg: isDark ? "#1e1e1e" : "#ffffff",
      newline: false,
      escapeXML: true,
      stream: false,
      colors: isDark
        ? {
            0: "#000000", 1: "#cd3131", 2: "#0dbc79", 3: "#e5e510",
            4: "#2472c8", 5: "#bc3fbc", 6: "#11a8cd", 7: "#e5e5e5",
            8: "#666666", 9: "#f14c4c", 10: "#23d18b", 11: "#f5f543",
            12: "#3b8eea", 13: "#d670d6", 14: "#29b8db", 15: "#e5e5e5",
          }
        : {
            0: "#000000", 1: "#cd3131", 2: "#0dbc79", 3: "#e5e510",
            4: "#2472c8", 5: "#bc3fbc", 6: "#11a8cd", 7: "#333333",
            8: "#666666", 9: "#f14c4c", 10: "#23d18b", 11: "#f5f543",
            12: "#3b8eea", 13: "#d670d6", 14: "#29b8db", 15: "#333333",
          },
    });
  }, [theme]);

  const htmlLogs = useMemo(
    () => (logs ? convert.toHtml(logs) : "No logs available"),
    [logs, convert]
  );

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (autoScroll && isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [htmlLogs, autoScroll]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const isAtBottom = distanceFromBottom < 50;

    isAtBottomRef.current = isAtBottom;
    setShowScrollButton(!isAtBottom);
  }, []);

  return (
    <div
      className={`relative flex flex-col ${className}`}
      style={{
        height: "100%",
        minHeight: 0,
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="p-4 rounded"
        style={{
          fontFamily: "monospace",
          fontSize: "12px",
          backgroundColor: theme === "dark" ? "#1e1e1e" : "#ffffff",
          color: theme === "dark" ? "#d4d4d4" : "#333333",
          border: "1px solid var(--vscode-panel-border)",
          overflowY: "auto",
          overflowX: "auto",
          flex: 1,
          height: 0,
          minHeight: 0,
          maxHeight: "100%",
          position: "relative",
          overflowAnchor: "none",
          scrollBehavior: "auto"
        }}
      >
        <div
          className="font-mono whitespace-pre-wrap break-all"
          style={{
            margin: 0,
            display: "block",
            width: "100%",
            boxSizing: "border-box"
          }}
          dangerouslySetInnerHTML={{ __html: htmlLogs }}
        />
      </div>

      {showScrollButton && autoScroll && (
        <button
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              isAtBottomRef.current = true;
              setShowScrollButton(false);
            }
          }}
          className="absolute px-3 py-1 rounded text-xs shadow-md opacity-90 hover:opacity-100"
          style={{
            bottom: "16px",
            right: "16px",
            backgroundColor: "var(--vscode-button-background, #007acc)",
            color: "var(--vscode-button-foreground, white)",
            border: "none",
            cursor: "pointer",
            transition: "all 0.2s",
            zIndex: 100,
            pointerEvents: "auto",
          }}
        >
          ⬇ Scroll to Bottom
        </button>
      )}
    </div>
  );
}