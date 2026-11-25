"use client";

import { useParams } from "next/navigation";
import DiagnosticsPage from "@/components/diagnostics/DiagnosticsPage";

export default function Page() {
  const { container } = useParams<{ container: string }>();
  return <DiagnosticsPage key={container} container={container} />;
}
