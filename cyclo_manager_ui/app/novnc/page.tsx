"use client";

import { useEffect, useState } from "react";

const SIDEBAR_WIDTH = 200;
const TITLE_BAR_HEIGHT = 49;

const NOVNC_PATH = "/vnc.html?autoconnect=true&resize=scale";
const NOVNC_PORT = 8090;

function getNoVNCUrl(): string {
  if (typeof window === "undefined") return "";
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${NOVNC_PORT}${NOVNC_PATH}`;
}

export default function NoVNCPage() {
  const envUrl = process.env.NEXT_PUBLIC_NOVNC_URL;
  const [url, setUrl] = useState<string>(() => envUrl ?? "");

  useEffect(() => {
    if (envUrl) return;
    setUrl(getNoVNCUrl());
  }, [envUrl]);

  return (
    <div
      className="overflow-hidden"
      style={{
        position: "fixed",
        left: SIDEBAR_WIDTH,
        top: TITLE_BAR_HEIGHT,
        right: 0,
        bottom: 0,
        backgroundColor: "var(--vscode-editor-background)",
      }}
    >
      {url ? (
        <iframe
          src={url}
          title="noVNC - Remote Desktop"
          className="w-full h-full block"
          style={{ border: "none" }}
        />
      ) : null}
    </div>
  );
}
