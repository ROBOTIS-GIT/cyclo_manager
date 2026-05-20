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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AppsHubBannerContextValue = {
  updateBannerVisible: boolean;
  setUpdateBannerVisible: (visible: boolean) => void;
};

const AppsHubBannerContext = createContext<AppsHubBannerContextValue | null>(null);

export function AppsHubBannerProvider({ children }: { children: ReactNode }) {
  const [updateBannerVisible, setUpdateBannerVisibleState] = useState(false);
  const setUpdateBannerVisible = useCallback((visible: boolean) => {
    setUpdateBannerVisibleState(visible);
  }, []);
  const value = useMemo(
    () => ({ updateBannerVisible, setUpdateBannerVisible }),
    [updateBannerVisible, setUpdateBannerVisible]
  );
  return (
    <AppsHubBannerContext.Provider value={value}>
      {children}
    </AppsHubBannerContext.Provider>
  );
}

export function useAppsHubBanner(): AppsHubBannerContextValue {
  const ctx = useContext(AppsHubBannerContext);
  if (!ctx) {
    throw new Error("useAppsHubBanner must be used within AppsHubBannerProvider");
  }
  return ctx;
}
