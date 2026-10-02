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

import { useCallback, useState } from "react";
import { getBashrc, getDockerContainerLogs, updateBashrc } from "@/lib/api";

export function useContainerSettings() {
  const [settingsContainer, setSettingsContainer] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"log" | "bashrc">("log");
  const [logsByContainer, setLogsByContainer] = useState<Record<string, string>>({});
  const [loadingLogsFor, setLoadingLogsFor] = useState<string | null>(null);
  const [logErrors, setLogErrors] = useState<Record<string, string>>({});
  const [bashrcContent, setBashrcContent] = useState("");
  const [bashrcLoading, setBashrcLoading] = useState(false);
  const [bashrcSaving, setBashrcSaving] = useState(false);
  const [bashrcError, setBashrcError] = useState<string | null>(null);

  const fetchLogs = useCallback(async (name: string) => {
    if (logsByContainer[name]) return;
    setLoadingLogsFor(name);
    try {
      const res = await getDockerContainerLogs(name, 100);
      setLogsByContainer((p) => ({ ...p, [name]: res.logs }));
    } catch (err) {
      setLogErrors((p) => ({ ...p, [name]: err instanceof Error ? err.message : "Failed" }));
    } finally {
      setLoadingLogsFor(null);
    }
  }, [logsByContainer]);

  const loadBashrc = useCallback(async (name: string) => {
    setBashrcLoading(true);
    setBashrcError(null);
    try {
      const res = await getBashrc(name);
      setBashrcContent(res.content ?? "");
    } catch (err) {
      setBashrcError(err instanceof Error ? err.message : "Failed to load bashrc");
    } finally {
      setBashrcLoading(false);
    }
  }, []);

  const handleSaveBashrc = async () => {
    if (!settingsContainer) return;
    setBashrcSaving(true);
    setBashrcError(null);
    try {
      await updateBashrc(settingsContainer, bashrcContent);
      await loadBashrc(settingsContainer);
    } catch (err) {
      setBashrcError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBashrcSaving(false);
    }
  };

  const openLog = useCallback((name: string) => {
    setSettingsContainer(name);
    setSettingsTab("log");
    fetchLogs(name);
  }, [fetchLogs]);

  const openBashrc = useCallback((name: string) => {
    setSettingsContainer(name);
    setSettingsTab("bashrc");
    setBashrcContent("");
    setBashrcError(null);
    loadBashrc(name);
  }, [loadBashrc]);

  return {
    settingsContainer, setSettingsContainer, settingsTab,
    logsByContainer, loadingLogsFor, logErrors,
    bashrcContent, setBashrcContent, bashrcLoading, bashrcSaving, bashrcError,
    handleSaveBashrc, openLog, openBashrc,
  };
}

export type ContainerSettings = ReturnType<typeof useContainerSettings>;
