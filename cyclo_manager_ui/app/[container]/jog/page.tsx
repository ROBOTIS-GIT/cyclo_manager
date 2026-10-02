// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

"use client";

import { useParams } from "next/navigation";
import JogPage from "@/components/jog/JogPage";

export default function ContainerJogPage() {
  const { container } = useParams<{ container: string }>();
  return <JogPage key={container} container={container} />;
}
