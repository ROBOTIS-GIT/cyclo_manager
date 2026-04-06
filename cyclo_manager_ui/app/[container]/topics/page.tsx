"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getROS2Topics } from "@/lib/api";
import type { ROS2TopicStatus } from "@/types/api";
import TopicViewerPanel from "@/components/TopicViewerPanel";

const CONTAINER_STYLES = {
  backgroundColor: "var(--vscode-sidebar-background)",
  borderColor: "var(--vscode-panel-border)",
} as const;

export default function TopicsPage() {
  const params = useParams();
  const container = (params.container as string) ?? "";

  const [topics, setTopics] = useState<ROS2TopicStatus[]>([]);
  const [topicSearch, setTopicSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<{
    topic: string;
    msgType: string;
  } | null>(null);

  const loadTopics = useCallback(async () => {
    if (!container) return;
    try {
      setLoading(true);
      setError(null);
      const res = await getROS2Topics(container);
      setTopics(res.topics ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load topics");
    } finally {
      setLoading(false);
    }
  }, [container]);

  if (!container) {
    return (
      <div style={{ color: "var(--vscode-foreground)" }}>
        Missing container. <Link href="/home" className="underline">Back to Home</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0" style={{ minHeight: "calc(100vh - 100px)" }}>
      <h1 className="text-xl font-semibold shrink-0" style={{ color: "var(--vscode-foreground)" }}>
        {container} — ROS2 Topics
      </h1>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={loadTopics}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded"
          style={{
            backgroundColor: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-secondaryForeground)",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Loading..." : "Topic list"}
        </button>
      </div>

      {error && (
        <div
          className="px-3 py-2 text-sm rounded border shrink-0"
          style={{
            color: "var(--vscode-errorForeground)",
            backgroundColor: "rgba(244,135,113,0.1)",
            borderColor: "rgba(244,135,113,0.3)",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="rounded border flex flex-col overflow-hidden flex-1 min-h-0"
        style={{ ...CONTAINER_STYLES, minHeight: 200 }}
      >
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div
            className="overflow-hidden border-r flex-shrink-0 flex flex-col"
            style={{ width: "280px", borderColor: "var(--vscode-panel-border)", maxHeight: "100%" }}
          >
            <input
              type="text"
              placeholder="Search topics..."
              value={topicSearch}
              onChange={(e) => setTopicSearch(e.target.value)}
              className="m-2 px-2 py-1.5 text-sm rounded border-0"
              style={{
                backgroundColor: "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                outline: "1px solid var(--vscode-input-border)",
              }}
            />
            <div className="overflow-auto flex-1 min-h-0">
            {topics.length === 0 && !loading && !error && (
              <div className="p-3 text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                Click &quot;Topic list&quot; to discover topics
              </div>
            )}
            {topics
              .filter((t) =>
                !topicSearch ||
                t.topic.toLowerCase().includes(topicSearch.toLowerCase()) ||
                t.msg_type.toLowerCase().includes(topicSearch.toLowerCase())
              )
              .map((t) => (
              <button
                key={t.topic}
                type="button"
                onClick={() =>
                  setSelectedTopic(selectedTopic?.topic === t.topic ? null : { topic: t.topic, msgType: t.msg_type })
                }
                className="block w-full text-left px-3 py-2 text-sm truncate border-b"
                style={{
                  borderColor: "var(--vscode-panel-border)",
                  color: selectedTopic?.topic === t.topic ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                  backgroundColor: selectedTopic?.topic === t.topic ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {t.topic}
                <span className="block text-xs opacity-80">{t.msg_type}</span>
              </button>
            ))}
            </div>
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            {selectedTopic ? (
              <TopicViewerPanel
                container={container}
                topic={selectedTopic.topic}
                msgType={selectedTopic.msgType}
                onClose={() => setSelectedTopic(null)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
                Select a topic
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
