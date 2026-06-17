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
// Author: Howon Kim

import type { Pose, TfMsg, TransformStamped } from "@/lib/ros_types";

export function yawFromPose(pose: Pose | null): number {
  const q = pose?.orientation;
  if (!q) return 0;
  const x = q.x ?? 0;
  const y = q.y ?? 0;
  const z = q.z ?? 0;
  const w = q.w ?? 1;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

export function orientationFromYaw(yaw: number) {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

export function poseFromBaseLinkTf(tf: TfMsg | null): Pose | null {
  return buildTfFramePoses(tf, "map").find(({ frame }) => frame === "base_link")?.pose ?? null;
}

export function normalizeFrameId(frameId: string | undefined): string {
  return (frameId ?? "").replace(/^\//, "");
}

function poseFromTransform(transform: TransformStamped): Pose {
  return {
    position: transform.transform?.translation,
    orientation: transform.transform?.rotation,
  };
}

export function buildTfFramePoses(tf: TfMsg | null, rootFrame = "map"): Array<{ frame: string; pose: Pose }> {
  const transforms = tf?.transforms ?? [];
  const edges = new Map<string, TransformStamped>();
  const parentFrames = new Set<string>();
  transforms.forEach((transform) => {
    const child = normalizeFrameId(transform.child_frame_id);
    const parent = normalizeFrameId(transform.header?.frame_id);
    if (!child || !parent || !transform.transform) return;
    edges.set(child, transform);
    parentFrames.add(parent);
  });
  if (!parentFrames.has(rootFrame) && !edges.has(rootFrame)) return [];

  const resolved = new Map<string, Pose>([
    [rootFrame, { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }],
  ]);

  const resolveFrame = (frame: string, visiting = new Set<string>()): Pose | null => {
    const existing = resolved.get(frame);
    if (existing) return existing;
    if (visiting.has(frame)) return null;
    const edge = edges.get(frame);
    if (!edge) return null;
    const parent = normalizeFrameId(edge.header?.frame_id);
    visiting.add(frame);
    const parentPose = resolveFrame(parent, visiting);
    visiting.delete(frame);
    if (!parentPose) return null;

    const localPose = poseFromTransform(edge);
    const parentYaw = yawFromPose(parentPose);
    const localYaw = yawFromPose(localPose);
    const tx = Number(localPose.position?.x ?? 0);
    const ty = Number(localPose.position?.y ?? 0);
    const x = Number(parentPose.position?.x ?? 0) + Math.cos(parentYaw) * tx - Math.sin(parentYaw) * ty;
    const y = Number(parentPose.position?.y ?? 0) + Math.sin(parentYaw) * tx + Math.cos(parentYaw) * ty;
    const pose: Pose = {
      position: { x, y, z: Number(localPose.position?.z ?? 0) },
      orientation: {
        x: 0,
        y: 0,
        z: Math.sin((parentYaw + localYaw) / 2),
        w: Math.cos((parentYaw + localYaw) / 2),
      },
    };
    resolved.set(frame, pose);
    return pose;
  };

  for (const frame of edges.keys()) {
    resolveFrame(frame);
  }

  return [...resolved.entries()]
    .filter(([frame]) => frame !== rootFrame)
    .map(([frame, pose]) => ({ frame, pose }));
}

export function mergeTfMessages(...messages: Array<TfMsg | null>): TfMsg | null {
  const transforms = messages.flatMap((message) => message?.transforms ?? []);
  return transforms.length > 0 ? { transforms } : null;
}

export function updateTfBuffer(buffer: Map<string, TransformStamped>, message: TfMsg | null): boolean {
  let updated = false;
  for (const transform of message?.transforms ?? []) {
    const child = normalizeFrameId(transform.child_frame_id);
    const parent = normalizeFrameId(transform.header?.frame_id);
    if (!child || !parent || !transform.transform) continue;
    const existing = buffer.get(child);
    if (
      existing &&
      normalizeFrameId(existing.header?.frame_id) === parent &&
      JSON.stringify(existing.transform) === JSON.stringify(transform.transform)
    ) {
      continue;
    }
    buffer.set(child, transform);
    updated = true;
  }
  return updated;
}

export function tfMessageFromBuffer(buffer: Map<string, TransformStamped>): TfMsg | null {
  const transforms = [...buffer.values()];
  return transforms.length > 0 ? { transforms } : null;
}
