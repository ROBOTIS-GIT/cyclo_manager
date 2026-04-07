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
