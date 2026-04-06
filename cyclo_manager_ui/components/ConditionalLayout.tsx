"use client";

import { usePathname } from "next/navigation";
import VSCodeLayout from "./VSCodeLayout";

export default function ConditionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === "/home") {
    return <>{children}</>;
  }

  return <VSCodeLayout>{children}</VSCodeLayout>;
}
