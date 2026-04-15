"use client";

import { usePathname } from "next/navigation";
import { AppsHubBannerProvider } from "@/contexts/AppsHubBannerContext";
import AppsHubLink from "@/components/AppsHubLink";
import VSCodeLayout from "./VSCodeLayout";

export default function ConditionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <AppsHubBannerProvider>
      <>
        <AppsHubLink />
        {pathname === "/home" || pathname === "/app" ? (
          children
        ) : (
          <VSCodeLayout>{children}</VSCodeLayout>
        )}
      </>
    </AppsHubBannerProvider>
  );
}
