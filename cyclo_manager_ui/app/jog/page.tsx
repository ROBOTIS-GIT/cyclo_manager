// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getRunningRobotContainers, robotPageUrl } from "@/lib/robotContainers";
import { btn, button, secondary } from "@/components/ui/controlStyles";

export default function JogEntryPage() {
  const router = useRouter();
  const [containers, setContainers] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    const timer = setTimeout(() => {
      void getRunningRobotContainers().then(names => {
        if (disposed) return;
        if (names.length === 1) router.replace(robotPageUrl(names[0], "jog"));
        else setContainers(names);
      }).catch(() => {
        if (!disposed) setError("Failed to connect to the manager.");
      });
    }, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [attempt, router]);

  return <div className="p-5">
    <h1 className="text-lg font-semibold">Jog</h1>
    <p className="mt-3 text-sm" style={secondary}>
      {error ?? (containers === null ? "Checking robot containers…" : containers.length ? "Select a robot container" : "No robot container is running.")}
    </p>
    <div className="mt-4 flex flex-wrap gap-2">
      {containers?.map(container => <Link key={container} href={robotPageUrl(container, "jog")} className={btn} style={button}>{container}</Link>)}
      {(error || containers?.length === 0) && <button className={btn} style={button}
        onClick={() => { setError(null); setContainers(null); setAttempt(n => n + 1); }}>Retry</button>}
    </div>
  </div>;
}
