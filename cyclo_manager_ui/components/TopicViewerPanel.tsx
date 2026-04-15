"use client";

import { useState, useEffect, useCallback } from "react";
import { useROS2TopicWebSocket } from "@/lib/websocket";
import { ros2Unsubscribe, getROS2TopicInfo } from "@/lib/api";

const PANEL_STYLES: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  maxHeight: "100%",
  backgroundColor: "var(--vscode-editor-background)",
  border: "1px solid var(--vscode-panel-border)",
  borderRadius: "4px",
  overflow: "hidden",
} as const;

const HEADER_STYLES: React.CSSProperties = {
  padding: "8px 12px",
  backgroundColor: "var(--vscode-titleBar-activeBackground)",
  borderBottom: "1px solid var(--vscode-panel-border)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexShrink: 0,
} as const;

const CONTENT_STYLES: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  position: "relative",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

const SCROLLABLE_CONTENT_STYLES: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  overflow: "auto",
  padding: "12px",
} as const;

const ERROR_STYLES: React.CSSProperties = {
  padding: "8px 12px",
  backgroundColor: "rgba(244, 135, 113, 0.1)",
  color: "var(--vscode-errorForeground)",
  fontSize: "12px",
  flexShrink: 0,
} as const;

const ERROR_BANNER_STYLES: React.CSSProperties = {
  padding: "8px",
  marginBottom: "12px",
  backgroundColor: "rgba(244, 135, 113, 0.1)",
  color: "var(--vscode-errorForeground)",
  fontSize: "12px",
  borderRadius: "4px",
} as const;

const TEXT_STYLES = {
  topic: {
    fontSize: "12px",
    fontWeight: "500",
    color: "var(--vscode-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  msgType: {
    fontSize: "10px",
    color: "var(--vscode-descriptionForeground)",
  } as React.CSSProperties,
  timestamp: {
    fontSize: "10px",
    color: "var(--vscode-descriptionForeground)",
    marginLeft: "auto",
  } as React.CSSProperties,
  description: {
    color: "var(--vscode-descriptionForeground)",
    fontSize: "12px",
  } as React.CSSProperties,
  code: {
    fontFamily: "monospace",
    fontSize: "12px",
    color: "var(--vscode-foreground)",
    backgroundColor: "var(--vscode-editor-background)",
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  } as React.CSSProperties,
} as const;

// Types
interface TopicViewerPanelProps {
  container: string;
  topic: string;
  msgType: string;
  onClose: () => void;
}

// Utility functions
function formatData(data: unknown): string {
  if (data === null || data === undefined) {
    return "null";
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

// Sub-components
interface CloseButtonProps {
  onClick: () => void;
}

function CloseButton({ onClick }: CloseButtonProps) {
  const buttonStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: "var(--vscode-foreground)",
    cursor: "pointer",
    fontSize: "16px",
    padding: "0 4px",
    lineHeight: "1",
    flexShrink: 0,
  };

  return (
    <button
      onClick={onClick}
      style={buttonStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--vscode-toolbar-hoverBackground)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      ×
    </button>
  );
}

type TabId = "data" | "info";

interface HeaderProps {
  topic: string;
  msgType: string;
  lastUpdateTime: Date | null;
  onClose: () => void;
}

function Header({ topic, msgType, lastUpdateTime, onClose }: HeaderProps) {
  return (
    <div style={HEADER_STYLES}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
        <span style={TEXT_STYLES.topic} title={topic}>
          {topic}
        </span>
        <span style={TEXT_STYLES.msgType}>({msgType})</span>
        {lastUpdateTime && (
          <span style={TEXT_STYLES.timestamp}>
            Last updated: {lastUpdateTime.toLocaleTimeString()}
          </span>
        )}
      </div>
      <CloseButton onClick={onClose} />
    </div>
  );
}

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const tabBase: React.CSSProperties = {
    padding: "6px 14px",
    fontSize: "12px",
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: "var(--vscode-descriptionForeground)",
    borderRadius: "2px",
  };
  const tabActive: React.CSSProperties = {
    ...tabBase,
    color: "var(--vscode-foreground)",
    backgroundColor: "var(--vscode-editor-background)",
  };
  return (
    <div
      style={{
        display: "flex",
        gap: "2px",
        padding: "4px 12px 8px",
        borderBottom: "1px solid var(--vscode-panel-border)",
      }}
    >
      <button
        type="button"
        style={activeTab === "data" ? tabActive : tabBase}
        onClick={() => onTabChange("data")}
      >
        Data
      </button>
      <button
        type="button"
        style={activeTab === "info" ? tabActive : tabBase}
        onClick={() => onTabChange("info")}
      >
        Info
      </button>
    </div>
  );
}

interface ErrorMessageProps {
  message: string;
}

function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div style={ERROR_STYLES}>
      {message}
    </div>
  );
}

interface TopicContentProps {
  topicData: any;
  status: string;
}

function TopicContent({ topicData, status }: TopicContentProps) {
  if (!topicData) {
    return (
      <div style={TEXT_STYLES.description}>
        {status === "connecting" ? "Connecting..." : "No data received yet"}
      </div>
    );
  }

  if (topicData.available === false) {
    return (
      <div>
        <div style={ERROR_BANNER_STYLES}>
          Topic is not available (no messages received or data is stale)
        </div>
        {topicData.data === null || topicData.data === undefined ? (
          <div style={TEXT_STYLES.description}>
            Waiting for messages... (Topic may not be publishing or message type mismatch)
          </div>
        ) : (
          <pre style={TEXT_STYLES.code}>{formatData(topicData.data)}</pre>
        )}
      </div>
    );
  }

  if (topicData.data !== null && topicData.data !== undefined) {
    return <pre style={TEXT_STYLES.code}>{formatData(topicData.data)}</pre>;
  }

  return <div style={TEXT_STYLES.description}>No data available</div>;
}

interface TopicInfoContentProps {
  container: string;
  topic: string;
}

function TopicInfoContent({ container, topic }: TopicInfoContentProps) {
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    if (!container || !topic) return;
    try {
      setLoading(true);
      setError(null);
      const res = await getROS2TopicInfo(container, topic);
      setInfo(res.info ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load topic info");
    } finally {
      setLoading(false);
    }
  }, [container, topic]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  if (loading && !info) {
    return <div style={TEXT_STYLES.description}>Loading topic info...</div>;
  }
  if (error) {
    return (
      <div>
        <div style={ERROR_BANNER_STYLES}>{error}</div>
        <button
          type="button"
          onClick={loadInfo}
          className="text-xs px-2 py-1 rounded mt-2"
          style={{
            backgroundColor: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-secondaryForeground)",
            border: "none",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <pre
      style={{
        ...TEXT_STYLES.code,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {info ?? "(empty)"}
    </pre>
  );
}

// Main component
export default function TopicViewerPanel({
  container,
  topic,
  msgType,
  onClose,
}: TopicViewerPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("data");

  const { topicData, status } = useROS2TopicWebSocket(container, topic, {
    onError: (err: Error) => setError(err.message),
  });

  // Unsubscribe on unmount
  useEffect(() => {
    return () => {
      ros2Unsubscribe(container, topic).catch(() => {});
    };
  }, [container, topic]);

  // Update last update time when data changes
  useEffect(() => {
    if (topicData) {
      setLastUpdateTime(new Date());
    }
  }, [topicData]);

  return (
    <div style={PANEL_STYLES}>
      <Header topic={topic} msgType={msgType} lastUpdateTime={lastUpdateTime} onClose={onClose} />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div style={CONTENT_STYLES}>
        {error && <ErrorMessage message={error} />}
        <div style={SCROLLABLE_CONTENT_STYLES}>
          {activeTab === "data" ? (
            <TopicContent topicData={topicData} status={status} />
          ) : (
            <TopicInfoContent container={container} topic={topic} />
          )}
        </div>
      </div>
    </div>
  );
}
