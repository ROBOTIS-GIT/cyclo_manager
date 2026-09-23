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

import { useEffect, useRef } from "react";

type PollingCallback = (isActive: () => boolean, signal: AbortSignal) => void | Promise<void>;

interface PollingOptions {
  enabled?: boolean;
  immediate?: boolean;
  resetKey?: unknown;
  skipIfRunning?: boolean;
}

export function usePolling(
  callback: PollingCallback,
  intervalMs: number,
  { enabled = true, immediate = true, resetKey, skipIfRunning = false }: PollingOptions = {}
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let pending = false;
    const controller = new AbortController();
    const isActive = () => active;
    const run = async () => {
      if (skipIfRunning && pending) return;
      pending = true;
      try {
        await callbackRef.current(isActive, controller.signal);
      } finally {
        pending = false;
      }
    };

    if (immediate) {
      void run();
    }

    const interval = setInterval(() => void run(), intervalMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [enabled, immediate, intervalMs, resetKey, skipIfRunning]);
}
