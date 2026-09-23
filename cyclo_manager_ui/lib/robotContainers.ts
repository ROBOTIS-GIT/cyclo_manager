// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

import { getSupportedRobotContainers } from "@/lib/api";

export type RobotPage = "system" | "jog";
export const robotPageUrl = (container: string, page: RobotPage) =>
  `/${encodeURIComponent(container)}/${page}`;

export async function getRunningRobotContainers(): Promise<string[]> {
  return (await getSupportedRobotContainers(true)).supported_robot_containers;
}
