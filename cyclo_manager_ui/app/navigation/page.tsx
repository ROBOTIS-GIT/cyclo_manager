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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  controlService,
  getServiceStatus,
  publishROS2Topic,
} from "@/lib/api";
import { useROS2TopicWebSocket } from "@/lib/websocket";
import type { ServiceStatusResponse } from "@/types/api";
import StatusBadge from "@/components/StatusBadge";
import FixedLogPanel from "@/components/FixedLogPanel";
import * as THREE from "three";
// @ts-ignore
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const CONTAINER = "ai_worker";
const NAVIGATION_SERVICE = "ai_worker_navigation";
const MAP_SAVE_SERVICE = "ai_worker_map_save";
const STATUS_POLL_MS = 2000;
const DEFAULT_MAP_NAME = "map";
const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 2000;
const MAP_DISPLAY_ROTATION = Math.PI;
const CLICK_DRAG_THRESHOLD_PX = 8;
const TF_AXIS_LENGTH = 0.2;
const LOG_PANEL_DEFAULT_WIDTH = 420;
const LOG_PANEL_MIN_WIDTH = 320;
const LOG_PANEL_MAX_WIDTH = 600;
const MAP_PANEL_DEFAULT_WIDTH = 820;
const MAP_PANEL_MIN_WIDTH = 420;
const MAP_PANEL_MAX_WIDTH = 1200;
const SIDE_PANEL_TOTAL_WIDTH = 820;
const CONTENT_GRID_GAP_PX = 16;
const MAP_RESIZE_HANDLE_WIDTH_PX = 8;
const LOG_RESIZE_HANDLE_WIDTH_PX = 8;
const ROS2_WS_FAST_TOPIC_OPTIONS = { throttleMs: 100 };
const ROS2_WS_MAP_TOPIC_OPTIONS = { throttleMs: 300 };
const GOAL_REACHED_XY_TOLERANCE_M = 0.2;
const GOAL_REACHED_YAW_TOLERANCE_RAD = 0.4;
const IDLE_LAYER_PRESET = {
  map: false,
  globalCostmap: false,
  localCostmap: false,
  scan: false,
  globalPlan: false,
  goalPose: false,
  tf: false,
  robotModel: false,
};
const MAPPING_LAYER_PRESET = {
  map: true,
  globalCostmap: false,
  localCostmap: false,
  scan: true,
  globalPlan: false,
  goalPose: false,
  tf: false,
  robotModel: true,
};
const NAVIGATION_LAYER_PRESET = {
  map: true,
  globalCostmap: true,
  localCostmap: true,
  scan: true,
  globalPlan: true,
  goalPose: true,
  tf: false,
  robotModel: true,
};

type OrbitControlsType = InstanceType<typeof OrbitControls>;
type LayerPreset = typeof IDLE_LAYER_PRESET;
type MapInteractionMode = "view" | "goal" | "initial";

const TOPICS = [
  { topic: "/map", msgType: "nav_msgs/msg/OccupancyGrid" },
  { topic: "/global_costmap/costmap", msgType: "nav_msgs/msg/OccupancyGrid" },
  { topic: "/local_costmap/costmap", msgType: "nav_msgs/msg/OccupancyGrid" },
  { topic: "/scan", msgType: "sensor_msgs/msg/LaserScan" },
  { topic: "/amcl_pose", msgType: "geometry_msgs/msg/PoseWithCovarianceStamped" },
  { topic: "/odom", msgType: "nav_msgs/msg/Odometry" },
  { topic: "/plan", msgType: "nav_msgs/msg/Path" },
  { topic: "/goal_pose", msgType: "geometry_msgs/msg/PoseStamped" },
  { topic: "/tf", msgType: "tf2_msgs/msg/TFMessage" },
  { topic: "/tf_static", msgType: "tf2_msgs/msg/TFMessage" },
  { topic: "/robot_description", msgType: "std_msgs/msg/String" },
] as const;
const DISPLAY_TOPICS = TOPICS.filter(({ topic }) => topic !== "/amcl_pose" && topic !== "/odom");

type OccupancyGrid = {
  header?: { frame_id?: string };
  info?: {
    resolution?: number;
    width?: number;
    height?: number;
    origin?: Pose;
  };
  data?: number[];
};

type Pose = {
  position?: { x?: number; y?: number; z?: number };
  orientation?: { x?: number; y?: number; z?: number; w?: number };
};

type PoseStamped = {
  header?: { frame_id?: string };
  pose?: Pose;
};

type LaserScan = {
  header?: { frame_id?: string };
  angle_min?: number;
  angle_increment?: number;
  range_min?: number;
  range_max?: number;
  ranges?: Array<number | null>;
};

type PathMsg = {
  poses?: PoseStamped[];
};

type TransformStamped = {
  header?: { frame_id?: string };
  child_frame_id?: string;
  transform?: {
    translation?: { x?: number; y?: number; z?: number };
    rotation?: { x?: number; y?: number; z?: number; w?: number };
  };
};

type TfMsg = {
  transforms?: TransformStamped[];
};

type MapViewProps = {
  map: OccupancyGrid | null;
  globalCostmap: OccupancyGrid | null;
  localCostmap: OccupancyGrid | null;
  scan: LaserScan | null;
  pose: Pose | null;
  plan: PathMsg | null;
  goalPose: PoseStamped | null;
  tf: TfMsg | null;
  tfStatic: TfMsg | null;
  robotDescription: string | null;
  showMap: boolean;
  showGlobalCostmap: boolean;
  showLocalCostmap: boolean;
  showScan: boolean;
  showGlobalPlan: boolean;
  showGoalPose: boolean;
  showTf: boolean;
  tfAvailable: boolean;
  showRobotModel: boolean;
  interactionDisabled: boolean;
  interactionMode: MapInteractionMode;
  onMapPose: (x: number, y: number, yaw: number) => void;
};

function messageData<T>(value: unknown): T | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  if (outer.available === false) return null;
  const data = "data" in outer ? outer.data : outer;
  if (!data || typeof data !== "object") return null;
  return data as T;
}

function messageString(value: unknown): string | null {
  if (value && typeof value === "object") {
    const outer = value as Record<string, unknown>;
    if (typeof outer.data === "string") return outer.data;
    if (outer.data && typeof outer.data === "object") {
      const data = outer.data as Record<string, unknown>;
      if (typeof data.data === "string") return data.data;
    }
  }

  const data = messageData<{ data?: unknown }>(value);
  if (typeof data?.data === "string") return data.data;
  return typeof value === "string" ? value : null;
}

function yawFromPose(pose: Pose | null): number {
  const q = pose?.orientation;
  if (!q) return 0;
  const x = q.x ?? 0;
  const y = q.y ?? 0;
  const z = q.z ?? 0;
  const w = q.w ?? 1;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

function orientationFromYaw(yaw: number) {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function isGoalReached(current: Pose | null, goal: PoseStamped | null): boolean {
  const currentPosition = current?.position;
  const goalPose = goal?.pose;
  const goalPosition = goalPose?.position;
  if (!currentPosition || !goalPosition) return false;
  const dx = Number(currentPosition.x ?? 0) - Number(goalPosition.x ?? 0);
  const dy = Number(currentPosition.y ?? 0) - Number(goalPosition.y ?? 0);
  const distance = Math.hypot(dx, dy);
  const yawError = Math.abs(normalizeAngle(yawFromPose(current) - yawFromPose(goalPose)));
  return distance <= GOAL_REACHED_XY_TOLERANCE_M && yawError <= GOAL_REACHED_YAW_TOLERANCE_RAD;
}

function rosTimestampNow() {
  const nowMs = Date.now();
  const sec = Math.floor(nowMs / 1000);
  const nanosec = Math.floor((nowMs % 1000) * 1_000_000);
  return { sec, nanosec };
}

function gridMeta(grid: OccupancyGrid | null) {
  const info = grid?.info;
  const width = Number(info?.width ?? 0);
  const height = Number(info?.height ?? 0);
  const resolution = Number(info?.resolution ?? 0);
  const originX = Number(info?.origin?.position?.x ?? 0);
  const originY = Number(info?.origin?.position?.y ?? 0);
  const originYaw = yawFromPose(info?.origin ?? null);
  if (!width || !height || !resolution) return null;
  return { width, height, resolution, originX, originY, originYaw };
}

function poseFromBaseLinkTf(tf: TfMsg | null): Pose | null {
  return buildTfFramePoses(tf, "map").find(({ frame }) => frame === "base_link")?.pose ?? null;
}

function normalizeFrameId(frameId: string | undefined): string {
  return (frameId ?? "").replace(/^\//, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function poseFromTransform(transform: TransformStamped): Pose {
  return {
    position: transform.transform?.translation,
    orientation: transform.transform?.rotation,
  };
}

function buildTfFramePoses(tf: TfMsg | null, rootFrame = "map"): Array<{ frame: string; pose: Pose }> {
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

function mergeTfMessages(...messages: Array<TfMsg | null>): TfMsg | null {
  const transforms = messages.flatMap((message) => message?.transforms ?? []);
  return transforms.length > 0 ? { transforms } : null;
}

function updateTfBuffer(buffer: Map<string, TransformStamped>, message: TfMsg | null): boolean {
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

function tfMessageFromBuffer(buffer: Map<string, TransformStamped>): TfMsg | null {
  const transforms = [...buffer.values()];
  return transforms.length > 0 ? { transforms } : null;
}

function scanCellsForGrid(
  grid: OccupancyGrid,
  scan: LaserScan | null,
  scanPose: Pose | null,
  framePose: Pose | null
): Set<number> | null {
  const meta = gridMeta(grid);
  if (!meta || !scan?.ranges?.length || !scanPose) return null;
  const frameYaw = framePose ? yawFromPose(framePose) : 0;
  const frameCos = Math.cos(frameYaw);
  const frameSin = Math.sin(frameYaw);
  const frameX = Number(framePose?.position?.x ?? 0);
  const frameY = Number(framePose?.position?.y ?? 0);
  const originYaw = meta.originYaw;
  const originCos = Math.cos(originYaw);
  const originSin = Math.sin(originYaw);
  const scanX = Number(scanPose.position?.x ?? 0);
  const scanY = Number(scanPose.position?.y ?? 0);
  const scanYaw = yawFromPose(scanPose);
  const min = Number(scan.range_min ?? 0.02);
  const max = Number(scan.range_max ?? 20);
  const angleMin = Number(scan.angle_min ?? 0);
  const inc = Number(scan.angle_increment ?? 0);
  const cells = new Set<number>();

  scan.ranges.forEach((range, index) => {
    const r = Number(range);
    if (!Number.isFinite(r) || r < min || r > max) return;
    const angle = scanYaw + angleMin + inc * index;
    const mapX = scanX + Math.cos(angle) * r;
    const mapY = scanY + Math.sin(angle) * r;
    const frameDx = mapX - frameX;
    const frameDy = mapY - frameY;
    const gridFrameX = frameCos * frameDx + frameSin * frameDy;
    const gridFrameY = -frameSin * frameDx + frameCos * frameDy;
    const originDx = gridFrameX - meta.originX;
    const originDy = gridFrameY - meta.originY;
    const localX = originCos * originDx + originSin * originDy;
    const localY = -originSin * originDx + originCos * originDy;
    const cellX = Math.floor(localX / meta.resolution);
    const cellY = Math.floor(localY / meta.resolution);
    if (cellX < 0 || cellX >= meta.width || cellY < 0 || cellY >= meta.height) return;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cellX + dx;
        const y = cellY + dy;
        if (x < 0 || x >= meta.width || y < 0 || y >= meta.height) continue;
        cells.add(x + y * meta.width);
      }
    }
  });

  return cells;
}

function makeOccupancyTexture(
  grid: OccupancyGrid,
  alpha: number,
  mode: "map" | "globalCostmap" | "localCostmap",
  highlightedCells: Set<number> | null = null
): THREE.CanvasTexture | null {
  const meta = gridMeta(grid);
  if (!meta || !grid.data || grid.data.length < meta.width * meta.height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = meta.width;
  canvas.height = meta.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(meta.width, meta.height);
  for (let y = 0; y < meta.height; y += 1) {
    for (let x = 0; x < meta.width; x += 1) {
      const srcIndex = (meta.width - 1 - x) + (meta.height - 1 - y) * meta.width;
      const dstIndex = (x + y * meta.width) * 4;
      const value = grid.data[srcIndex] ?? -1;
      let r = 118;
      let g = 118;
      let b = 118;
      let a = alpha;
      if (mode === "map") {
        if (value < 0) {
          r = 150; g = 150; b = 150; a = 210;
        } else if (value === 0) {
          r = 245; g = 245; b = 245; a = 255;
        } else {
          r = 28; g = 28; b = 28; a = 255;
        }
      } else if (mode === "globalCostmap") {
        if (value < 0) {
          r = 12; g = 15; b = 15; a = 210;
        } else if (value === 0) {
          r = 10; g = 13; b = 13; a = 205;
        } else {
          const normalized = Math.min(Math.max(value, 0), 100) / 100;
          const gray = Math.round(220 - normalized * 205);
          r = gray; g = gray; b = gray; a = Math.round(95 + normalized * 150);
        }
      } else if (mode === "localCostmap") {
        if (highlightedCells?.has(srcIndex)) {
          r = 220; g = 28; b = 28; a = 215;
        } else if (value <= 20) {
          a = 0;
        } else if (value < 70) {
          r = 220; g = 28; b = 28; a = 215;
        } else {
          r = 245; g = 124; b = 0; a = 235;
        }
      } else if (value > 0) {
        r = 255; g = Math.max(32, 180 - value); b = 36; a = alpha;
      } else {
        a = 0;
      }
      image.data[dstIndex] = r;
      image.data[dstIndex + 1] = g;
      image.data[dstIndex + 2] = b;
      image.data[dstIndex + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Points ||
      child instanceof THREE.Line ||
      child instanceof THREE.Sprite
    ) {
      child.geometry?.dispose();
      const material = child.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) {
        material.forEach((item) => {
          const texture = (item as THREE.MeshBasicMaterial).map;
          texture?.dispose();
          item.dispose();
        });
      } else {
        const texture = (material as THREE.MeshBasicMaterial | undefined)?.map;
        texture?.dispose();
        material?.dispose();
      }
    }
  });
}

function makeGridPlane(
  grid: OccupancyGrid,
  mode: "map" | "globalCostmap" | "localCostmap",
  z: number,
  rotateDisplay = false,
  framePose: Pose | null = null,
  highlightedCells: Set<number> | null = null
): THREE.Mesh | null {
  const meta = gridMeta(grid);
  const texture = makeOccupancyTexture(grid, mode === "map" ? 255 : 170, mode, highlightedCells);
  if (!meta || !texture) return null;
  const width = meta.width * meta.resolution;
  const height = meta.height * meta.resolution;
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: mode !== "map",
    opacity: mode === "map" ? 1 : 0.82,
    depthWrite: mode === "map",
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const originYaw = meta.originYaw;
  const originCos = Math.cos(originYaw);
  const originSin = Math.sin(originYaw);
  const gridCenterX = meta.originX + originCos * (width / 2) - originSin * (height / 2);
  const gridCenterY = meta.originY + originSin * (width / 2) + originCos * (height / 2);
  const frameYaw = framePose ? yawFromPose(framePose) : 0;
  const frameCos = Math.cos(frameYaw);
  const frameSin = Math.sin(frameYaw);
  const frameX = Number(framePose?.position?.x ?? 0);
  const frameY = Number(framePose?.position?.y ?? 0);
  mesh.position.set(
    frameX + frameCos * gridCenterX - frameSin * gridCenterY,
    frameY + frameSin * gridCenterX + frameCos * gridCenterY,
    z
  );
  mesh.rotation.z = frameYaw + originYaw;
  if (rotateDisplay) {
    mesh.rotation.z += MAP_DISPLAY_ROTATION;
  }
  mesh.userData.mapTexture = texture;
  return mesh;
}

function makeLine(points: THREE.Vector3[], color: number, lineWidth = 2): THREE.Line | null {
  if (points.length < 2) return null;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
  return new THREE.Line(geometry, material);
}

function makePoseMarker(pose: Pose, color: number, z: number): THREE.Group {
  const group = new THREE.Group();
  const x = Number(pose.position?.x ?? 0);
  const y = Number(pose.position?.y ?? 0);
  const yaw = yawFromPose(pose);
  group.position.set(x, y, z);
  group.rotation.z = yaw;

  const body = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86 })
  );
  group.add(body);

  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0.26, 0);
  arrowShape.lineTo(-0.1, 0.13);
  arrowShape.lineTo(-0.04, 0);
  arrowShape.lineTo(-0.1, -0.13);
  arrowShape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  arrow.position.z = 0.01;
  group.add(arrow);
  return group;
}

function makeTfAxes(pose: Pose, label: string): THREE.Group {
  const group = new THREE.Group();
  group.position.set(
    Number(pose.position?.x ?? 0),
    Number(pose.position?.y ?? 0),
    Number(pose.position?.z ?? 0) + 0.08
  );
  group.rotation.z = yawFromPose(pose);

  const xAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(TF_AXIS_LENGTH, 0, 0)], 0xef4444);
  const yAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, TF_AXIS_LENGTH, 0)], 0x22c55e);
  const zAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, TF_AXIS_LENGTH)], 0x3b82f6);
  if (xAxis) group.add(xAxis);
  if (yAxis) group.add(yAxis);
  if (zAxis) group.add(zAxis);

  const sprite = makeTfLabelSprite(label);
  sprite.position.set(0, -TF_AXIS_LENGTH * 0.85, 0.012);
  group.add(sprite);
  return group;
}

function makeTfLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.font = "22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(TF_AXIS_LENGTH * 1.8, TF_AXIS_LENGTH * 0.45, 1);
  return sprite;
}

function fitCameraToMap(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsType,
  meta: ReturnType<typeof gridMeta>
): void {
  if (!meta) return;
  const width = meta.width * meta.resolution;
  const height = meta.height * meta.resolution;
  const center = new THREE.Vector3(meta.originX + width / 2, meta.originY + height / 2, 0);
  const maxDim = Math.max(width, height, 1);
  camera.up.set(0, 0, 1);
  camera.position.set(center.x, center.y - maxDim * 0.78, maxDim * 0.92);
  camera.lookAt(center);
  camera.near = CAMERA_NEAR;
  camera.far = Math.max(CAMERA_FAR, maxDim * 10);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function MapView({
  map,
  globalCostmap,
  localCostmap,
  scan,
  pose,
  plan,
  goalPose,
  tf,
  tfStatic,
  robotDescription,
  showMap,
  showGlobalCostmap,
  showLocalCostmap,
  showScan,
  showGlobalPlan,
  showGoalPose,
  showTf,
  tfAvailable,
  showRobotModel,
  interactionDisabled,
  interactionMode,
  onMapPose,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);
  const layersRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const didFitInitialMapRef = useRef(false);
  const [dragPreviewPose, setDragPreviewPose] = useState<Pose | null>(null);
  // Freeze each LaserScan in display coordinates until the next scan or map geometry change.
  const scanProjectionRef = useRef<{ scan: LaserScan; mapKey: string | null; points: number[] } | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const pointerDownRef = useRef<{ clientX: number; clientY: number; mapX: number; mapY: number } | null>(null);

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl || rendererRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1b1b);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, 1, CAMERA_NEAR, CAMERA_FAR);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -10, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x1b1b1b, 1);
    renderer.domElement.className = "block w-full h-full cursor-grab";
    containerEl.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const layers = new THREE.Group();
    scene.add(layers);
    layersRef.current = layers;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controlsRef.current = controls;

    const resize = () => {
      const width = containerEl.clientWidth || 1;
      const height = containerEl.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(containerEl);

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      controls.dispose();
      disposeObject(layers);
      renderer.dispose();
      if (renderer.domElement.parentNode === containerEl) {
        containerEl.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    const controls = controlsRef.current;
    if (!renderer) return;
    const cursor = interactionDisabled
      ? "cursor-wait"
      : interactionMode === "view"
        ? "cursor-grab"
        : "cursor-crosshair";
    renderer.domElement.className = `block w-full h-full ${cursor}`;
    if (controls) {
      controls.enabled = !interactionDisabled && interactionMode === "view";
    }
  }, [interactionDisabled, interactionMode]);

  useEffect(() => {
    const scene = sceneRef.current;
    const layers = layersRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !layers || !camera || !controls) return;

    disposeObject(layers);
    layers.clear();

    const meta = gridMeta(map);
    const mapKey = meta ? `${meta.width}:${meta.height}:${meta.resolution}:${meta.originX}:${meta.originY}` : null;
    const tfFramePoses = buildTfFramePoses(mergeTfMessages(tfStatic, tf), "map");
    const tfFramePoseByName = new Map(tfFramePoses.map(({ frame, pose: framePose }) => [frame, framePose]));
    if (showMap) {
      const mapPlane = map ? makeGridPlane(map, "map", 0, true) : null;
      if (mapPlane) layers.add(mapPlane);
    }

    if (showGlobalCostmap) {
      if (globalCostmap) {
        const plane = makeGridPlane(globalCostmap, "globalCostmap", 0.03, true);
        if (plane) layers.add(plane);
      }
    }

    if (showLocalCostmap) {
      if (localCostmap) {
        const localFrame = normalizeFrameId(localCostmap.header?.frame_id);
        const localFramePose = localFrame && localFrame !== "map"
          ? tfFramePoseByName.get(localFrame) ?? null
          : null;
        const scanFrame = normalizeFrameId(scan?.header?.frame_id) || "base_link";
        const scanPose = tfFramePoseByName.get(scanFrame) ?? pose;
        const scanCells = scanCellsForGrid(localCostmap, scan, scanPose, localFramePose);
        const plane = makeGridPlane(localCostmap, "localCostmap", 0.1, true, localFramePose, scanCells);
        if (plane) layers.add(plane);
      }
    }

    if (showGlobalPlan && plan?.poses?.length) {
      const points = plan.poses
        .map((p) => p.pose?.position)
        .filter((p): p is NonNullable<Pose["position"]> => !!p)
        .map((p) => new THREE.Vector3(Number(p.x ?? 0), Number(p.y ?? 0), 0.09));
      const planLine = makeLine(points, 0x0e7fd1, 3);
      if (planLine) layers.add(planLine);
    }

    if (showGoalPose && goalPose?.pose?.position) {
      layers.add(makePoseMarker(goalPose.pose, 0xf59e0b, 0.14));
    }

    if (dragPreviewPose?.position) {
      layers.add(makePoseMarker(dragPreviewPose, interactionMode === "initial" ? 0x22c55e : 0xf59e0b, 0.2));
    }

    const robotX = Number(pose?.position?.x ?? 0);
    const robotY = Number(pose?.position?.y ?? 0);

    if (showScan && scan?.ranges?.length) {
      let points = scanProjectionRef.current?.scan === scan && scanProjectionRef.current.mapKey === mapKey
        ? scanProjectionRef.current.points
        : null;
      if (!points) {
        const scanFrame = normalizeFrameId(scan.header?.frame_id) || "base_link";
        const scanPose = tfFramePoseByName.get(scanFrame) ?? pose;
        const scanX = Number(scanPose?.position?.x ?? robotX);
        const scanY = Number(scanPose?.position?.y ?? robotY);
        const scanYaw = yawFromPose(scanPose);
        const min = Number(scan.range_min ?? 0.02);
        const max = Number(scan.range_max ?? 20);
        const angleMin = Number(scan.angle_min ?? 0);
        const inc = Number(scan.angle_increment ?? 0);
        points = [];
        scan.ranges.forEach((range, index) => {
          const r = Number(range);
          if (!Number.isFinite(r) || r < min || r > max) return;
          const angle = scanYaw + angleMin + inc * index;
          points.push(scanX + Math.cos(angle) * r, scanY + Math.sin(angle) * r, 0.11);
        });
        scanProjectionRef.current = { scan, mapKey, points };
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      const material = new THREE.PointsMaterial({ color: 0x22c55e, size: 0.045, sizeAttenuation: true });
      layers.add(new THREE.Points(geometry, material));
    }

    if (showTf && tfAvailable) {
      const framePoses = tfFramePoses.slice(0, 80);
      if (framePoses.length > 0) {
        framePoses.forEach(({ frame, pose: framePose }) => {
          layers.add(makeTfAxes(framePose, frame));
        });
      } else {
        layers.add(makeTfAxes({
          position: { x: robotX, y: robotY, z: 0 },
          orientation: pose?.orientation,
        }, "base_link"));
      }
    }

    if (pose?.position) {
      layers.add(makePoseMarker(pose, showRobotModel && robotDescription ? 0x60a5fa : 0x007acc, 0.16));
    }

    if (mapKey && !didFitInitialMapRef.current) {
      fitCameraToMap(camera, controls, meta);
      didFitInitialMapRef.current = true;
    }
  }, [
    globalCostmap,
    dragPreviewPose,
    goalPose,
    interactionMode,
    localCostmap,
    map,
    plan,
    pose,
    robotDescription,
    scan,
    showGlobalCostmap,
    showLocalCostmap,
    showGlobalPlan,
    showGoalPose,
    showMap,
    showRobotModel,
    showScan,
    showTf,
    tf,
    tfStatic,
    tfAvailable,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;

    const mapPointFromEvent = (event: PointerEvent): THREE.Vector3 | null => {
      const meta = gridMeta(map);
      if (!meta) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const point = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      if (!raycasterRef.current.ray.intersectPlane(plane, point)) return null;
      const width = meta.width * meta.resolution;
      const height = meta.height * meta.resolution;
      if (
        point.x < meta.originX ||
        point.x > meta.originX + width ||
        point.y < meta.originY ||
        point.y > meta.originY + height
      ) {
        return null;
      }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      return point;
    };

    const previewPoseFromDrag = (
      start: NonNullable<typeof pointerDownRef.current>,
      point: THREE.Vector3,
      clientX: number,
      clientY: number
    ): Pose => {
      const moved = Math.hypot(clientX - start.clientX, clientY - start.clientY);
      const yaw = moved > CLICK_DRAG_THRESHOLD_PX
        ? Math.atan2(point.y - start.mapY, point.x - start.mapX)
        : yawFromPose(pose);
      return {
        position: { x: start.mapX, y: start.mapY, z: 0 },
        orientation: orientationFromYaw(yaw),
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (interactionDisabled || interactionMode === "view") {
        pointerDownRef.current = null;
        setDragPreviewPose(null);
        return;
      }
      const point = mapPointFromEvent(event);
      if (!point) {
        pointerDownRef.current = null;
        setDragPreviewPose(null);
        return;
      }
      const pointerDown = {
        clientX: event.clientX,
        clientY: event.clientY,
        mapX: point.x,
        mapY: point.y,
      };
      pointerDownRef.current = pointerDown;
      setDragPreviewPose(previewPoseFromDrag(pointerDown, point, event.clientX, event.clientY));
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (interactionDisabled || interactionMode === "view") return;
      const pointerDown = pointerDownRef.current;
      if (!pointerDown) return;
      const point = mapPointFromEvent(event);
      if (!point) return;
      setDragPreviewPose(previewPoseFromDrag(pointerDown, point, event.clientX, event.clientY));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (interactionDisabled || interactionMode === "view" || event.button !== 0) return;
      const pointerDown = pointerDownRef.current;
      pointerDownRef.current = null;
      setDragPreviewPose(null);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      if (!pointerDown) return;
      const point = mapPointFromEvent(event);
      if (!point) return;
      const moved = Math.hypot(event.clientX - pointerDown.clientX, event.clientY - pointerDown.clientY);
      const yaw = moved > CLICK_DRAG_THRESHOLD_PX
        ? Math.atan2(point.y - pointerDown.mapY, point.x - pointerDown.mapX)
        : yawFromPose(pose);
      onMapPose(pointerDown.mapX, pointerDown.mapY, yaw);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      pointerDownRef.current = null;
      setDragPreviewPose(null);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [interactionDisabled, interactionMode, map, onMapPose, pose]);

  return (
    <div
      className="relative border min-h-0 overflow-hidden"
      style={{
        aspectRatio: "1 / 1",
        backgroundColor: "var(--vscode-editor-background)",
        borderColor: "var(--vscode-panel-border)",
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {showMap && !map && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
          style={{ color: "var(--vscode-descriptionForeground)" }}
        >
          Waiting for /map
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className="h-8 px-2 border flex items-center gap-2 text-xs font-medium"
      style={{
        color: "var(--vscode-foreground)",
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sidebar-background)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function ViewModeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2v20" />
      <path d="M2 12h20" />
      <path d="m5 9-3 3 3 3" />
      <path d="m19 9 3 3-3 3" />
      <path d="m9 5 3-3 3 3" />
      <path d="m9 19 3 3 3-3" />
    </svg>
  );
}

function LogIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export default function NavigationPage() {
  const posePublishBusyRef = useRef(false);
  const logResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const mapResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const contentGridRef = useRef<HTMLDivElement>(null);
  const tfBufferRef = useRef<Map<string, TransformStamped>>(new Map());
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null);
  const [mapName, setMapName] = useState(DEFAULT_MAP_NAME);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");
  const [lastGoalPose, setLastGoalPose] = useState<PoseStamped | null>(null);
  const [hideReachedGoalPose, setHideReachedGoalPose] = useState(false);
  const [lastBaseLinkPose, setLastBaseLinkPose] = useState<Pose | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showGlobalCostmap, setShowGlobalCostmap] = useState(false);
  const [showLocalCostmap, setShowLocalCostmap] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showGlobalPlan, setShowGlobalPlan] = useState(false);
  const [showGoalPose, setShowGoalPose] = useState(false);
  const [showTf, setShowTf] = useState(false);
  const [showRobotModel, setShowRobotModel] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logPanelWidth, setLogPanelWidth] = useState(LOG_PANEL_DEFAULT_WIDTH);
  const [mapPanelWidth, setMapPanelWidth] = useState(MAP_PANEL_DEFAULT_WIDTH);
  const [clickMode, setClickMode] = useState<MapInteractionMode>("view");
  const [posePublishBusy, setPosePublishBusy] = useState(false);
  const [tfBufferRevision, setTfBufferRevision] = useState(0);

  const { topicData: mapData } = useROS2TopicWebSocket(
    CONTAINER,
    showMap || clickMode !== "view" ? "/map" : null,
    ROS2_WS_MAP_TOPIC_OPTIONS
  );
  const { topicData: globalCostmapData } = useROS2TopicWebSocket(
    CONTAINER,
    showGlobalCostmap ? "/global_costmap/costmap" : null,
    ROS2_WS_MAP_TOPIC_OPTIONS
  );
  const { topicData: localCostmapData } = useROS2TopicWebSocket(
    CONTAINER,
    showLocalCostmap ? "/local_costmap/costmap" : null,
    ROS2_WS_MAP_TOPIC_OPTIONS
  );
  const { topicData: scanData } = useROS2TopicWebSocket(
    CONTAINER,
    showScan ? "/scan" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS
  );
  const { topicData: amclData } = useROS2TopicWebSocket(CONTAINER, "/amcl_pose", ROS2_WS_FAST_TOPIC_OPTIONS);
  const { topicData: odomData } = useROS2TopicWebSocket(CONTAINER, "/odom", ROS2_WS_FAST_TOPIC_OPTIONS);
  const { topicData: planData } = useROS2TopicWebSocket(CONTAINER, showGlobalPlan ? "/plan" : null);
  const { topicData: goalPoseData } = useROS2TopicWebSocket(CONTAINER, showGoalPose ? "/goal_pose" : null);
  const { topicData: tfData } = useROS2TopicWebSocket(CONTAINER, "/tf", ROS2_WS_FAST_TOPIC_OPTIONS);
  const { topicData: tfStaticData } = useROS2TopicWebSocket(CONTAINER, "/tf_static");
  const { topicData: robotDescriptionData } = useROS2TopicWebSocket(
    CONTAINER,
    showRobotModel ? "/robot_description" : null
  );

  const map = useMemo(() => messageData<OccupancyGrid>(mapData), [mapData]);
  const globalCostmap = useMemo(() => messageData<OccupancyGrid>(globalCostmapData), [globalCostmapData]);
  const localCostmap = useMemo(() => messageData<OccupancyGrid>(localCostmapData), [localCostmapData]);
  const scan = useMemo(() => messageData<LaserScan>(scanData), [scanData]);
  const amclPose = useMemo(() => messageData<{ pose?: { pose?: Pose } }>(amclData), [amclData]);
  const odom = useMemo(() => messageData<{ pose?: { pose?: Pose } }>(odomData), [odomData]);
  const plan = useMemo(() => messageData<PathMsg>(planData), [planData]);
  const topicGoalPose = useMemo(() => messageData<PoseStamped>(goalPoseData), [goalPoseData]);
  const tf = useMemo(() => messageData<TfMsg>(tfData), [tfData]);
  const tfStatic = useMemo(() => messageData<TfMsg>(tfStaticData), [tfStaticData]);
  const latestTf = useMemo(() => mergeTfMessages(tfStatic, tf), [tf, tfStatic]);
  const bufferedTf = useMemo(() => (
    tfMessageFromBuffer(tfBufferRef.current) ?? latestTf
  ), [latestTf, tfBufferRevision]);
  const robotDescription = useMemo(() => messageString(robotDescriptionData), [robotDescriptionData]);
  const fallbackPose = amclPose?.pose?.pose ?? null;
  const goalPose = hideReachedGoalPose ? null : (lastGoalPose ?? topicGoalPose);
  const topicBaseLinkPose = useMemo(() => poseFromBaseLinkTf(bufferedTf), [bufferedTf]);
  const baseLinkPose = topicBaseLinkPose ?? lastBaseLinkPose;
  const currentPose = baseLinkPose ?? fallbackPose;
  const running = status?.is_up ?? false;
  const mode = running ? "running" : "idle";
  const layersPanelWidth = SIDE_PANEL_TOTAL_WIDTH - logPanelWidth;
  const getMaxMapPanelWidth = useCallback(() => {
    const gridWidth = contentGridRef.current?.clientWidth ?? 0;
    if (!gridWidth) return MAP_PANEL_MAX_WIDTH;
    const reservedWidth = showLogs
      ? layersPanelWidth + logPanelWidth + MAP_RESIZE_HANDLE_WIDTH_PX + LOG_RESIZE_HANDLE_WIDTH_PX + CONTENT_GRID_GAP_PX * 4
      : 300 + MAP_RESIZE_HANDLE_WIDTH_PX + CONTENT_GRID_GAP_PX * 2;
    return clamp(gridWidth - reservedWidth, MAP_PANEL_MIN_WIDTH, MAP_PANEL_MAX_WIDTH);
  }, [layersPanelWidth, logPanelWidth, showLogs]);

  const contentGridStyle = {
    "--map-panel-width": `${mapPanelWidth}px`,
    ...(showLogs
      ? {
        "--layers-panel-width": `${layersPanelWidth}px`,
        "--log-panel-width": `${logPanelWidth}px`,
      }
      : {}),
  } as CSSProperties;

  const applyLayerPreset = useCallback((preset: LayerPreset) => {
    setShowMap(preset.map);
    setShowGlobalCostmap(preset.globalCostmap);
    setShowLocalCostmap(preset.localCostmap);
    setShowScan(preset.scan);
    setShowGlobalPlan(preset.globalPlan);
    setShowGoalPose(preset.goalPose);
    setShowTf(preset.tf);
    setShowRobotModel(preset.robotModel);
  }, []);

  useEffect(() => {
    const updatedStatic = updateTfBuffer(tfBufferRef.current, tfStatic);
    const updatedDynamic = updateTfBuffer(tfBufferRef.current, tf);
    if (updatedStatic || updatedDynamic) {
      setTfBufferRevision((value) => value + 1);
    }
  }, [tf, tfStatic]);

  useEffect(() => {
    if (topicBaseLinkPose) setLastBaseLinkPose(topicBaseLinkPose);
  }, [topicBaseLinkPose]);

  useEffect(() => {
    if (!lastGoalPose || !isGoalReached(currentPose, lastGoalPose)) return;
    setLastGoalPose(null);
    setHideReachedGoalPose(true);
    setMessage("Goal reached");
  }, [currentPose, lastGoalPose]);

  useEffect(() => {
    if (!running) applyLayerPreset(IDLE_LAYER_PRESET);
  }, [applyLayerPreset, running]);

  useEffect(() => {
    const resize = () => {
      setMapPanelWidth((width) => Math.min(width, getMaxMapPanelWidth()));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [getMaxMapPanelWidth]);

  const loadStatus = useCallback(async () => {
    try {
      const next = await getServiceStatus(CONTAINER, NAVIGATION_SERVICE);
      setStatus(next);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(loadStatus, STATUS_POLL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [loadStatus]);

  const runCommand = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
      setMessage(`${label} complete`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(null);
      void loadStatus();
    }
  }, [loadStatus]);

  const startMapping = useCallback(async () => {
    await controlService(CONTAINER, NAVIGATION_SERVICE, "restart", {
      map_name: mapName,
    }, undefined, "map");
    applyLayerPreset(MAPPING_LAYER_PRESET);
  }, [applyLayerPreset, mapName]);

  const startSavedMapNavigation = useCallback(async () => {
    await controlService(CONTAINER, NAVIGATION_SERVICE, "restart", {
      map_name: mapName,
    }, undefined, "nav");
    applyLayerPreset(NAVIGATION_LAYER_PRESET);
  }, [applyLayerPreset, mapName]);

  const stopNavigationService = useCallback(async () => {
    await controlService(CONTAINER, NAVIGATION_SERVICE, "down");
    applyLayerPreset(IDLE_LAYER_PRESET);
  }, [applyLayerPreset]);

  const saveMap = useCallback(async () => {
    await controlService(CONTAINER, MAP_SAVE_SERVICE, "restart", {
      map_name: mapName,
    });
  }, [mapName]);

  const sendGoal = useCallback(async (x: number, y: number, yaw: number) => {
    const orientation = orientationFromYaw(yaw);
    const poseStamped = {
      header: {
        frame_id: "map",
        stamp: rosTimestampNow(),
      },
      pose: {
        position: { x, y, z: 0 },
        orientation,
      },
    };
    setLastGoalPose({
      header: { frame_id: "map" },
      pose: poseStamped.pose,
    });
    setHideReachedGoalPose(false);
    try {
      await publishROS2Topic(CONTAINER, "/goal_pose", {
        msg_type: "geometry_msgs/msg/PoseStamped",
        data: poseStamped,
      });
      setMessage(`Goal ${x.toFixed(2)}, ${y.toFixed(2)}, yaw ${(yaw * 180 / Math.PI).toFixed(0)} deg`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Goal publish failed");
    }
  }, []);

  const sendInitialPose = useCallback(async (x: number, y: number, yaw: number) => {
    const orientation = orientationFromYaw(yaw);
    try {
      await publishROS2Topic(CONTAINER, "/initialpose", {
        msg_type: "geometry_msgs/msg/PoseWithCovarianceStamped",
        data: {
          header: {
            frame_id: "map",
            stamp: rosTimestampNow(),
          },
          pose: {
            pose: {
              position: { x, y, z: 0 },
              orientation,
            },
            covariance: [
              0.25, 0, 0, 0, 0, 0,
              0, 0.25, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0.0685,
            ],
          },
        },
      });
      setMessage(`Initial pose ${x.toFixed(2)}, ${y.toFixed(2)}, yaw ${(yaw * 180 / Math.PI).toFixed(0)} deg`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Initial pose publish failed");
    }
  }, []);

  const handleMapPose = useCallback((x: number, y: number, yaw: number) => {
    if (clickMode === "view") return;
    if (posePublishBusyRef.current) return;
    posePublishBusyRef.current = true;
    setPosePublishBusy(true);
    const publish = clickMode === "initial" ? sendInitialPose(x, y, yaw) : sendGoal(x, y, yaw);
    setClickMode("view");
    void publish.finally(() => {
      posePublishBusyRef.current = false;
      setPosePublishBusy(false);
    });
  }, [clickMode, sendGoal, sendInitialPose]);

  const handleMapResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    mapResizeRef.current = { startX: event.clientX, startWidth: mapPanelWidth };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizeStart = mapResizeRef.current;
      if (!resizeStart) return;
      const nextWidth = resizeStart.startWidth + moveEvent.clientX - resizeStart.startX;
      setMapPanelWidth(clamp(nextWidth, MAP_PANEL_MIN_WIDTH, getMaxMapPanelWidth()));
    };

    const handlePointerUp = () => {
      mapResizeRef.current = null;
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [getMaxMapPanelWidth, mapPanelWidth]);

  const handleLogResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    logResizeRef.current = { startX: event.clientX, startWidth: logPanelWidth };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const resizeStart = logResizeRef.current;
      if (!resizeStart) return;
      const nextWidth = resizeStart.startWidth + resizeStart.startX - moveEvent.clientX;
      setLogPanelWidth(clamp(nextWidth, LOG_PANEL_MIN_WIDTH, LOG_PANEL_MAX_WIDTH));
      setMapPanelWidth((width) => Math.min(width, getMaxMapPanelWidth()));
    };

    const handlePointerUp = () => {
      logResizeRef.current = null;
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [getMaxMapPanelWidth, logPanelWidth]);

  const hasTopicData = (topic: string) => {
    if (topic === "/map") return !!map;
    if (topic === "/global_costmap/costmap") return !!globalCostmap;
    if (topic === "/local_costmap/costmap") return !!localCostmap;
    if (topic === "/scan") return !!scan;
    if (topic === "/amcl_pose") return !!amclPose;
    if (topic === "/odom") return !!odom;
    if (topic === "/plan") return !!plan;
    if (topic === "/goal_pose") return !!goalPose;
    if (topic === "/tf") return !!tf?.transforms?.length;
    if (topic === "/tf_static") return !!tfStatic?.transforms?.length;
    if (topic === "/robot_description") return !!robotDescription;
    return false;
  };

  return (
    <div className="h-full min-h-[520px] flex flex-col overflow-hidden">
      <header
        className="shrink-0 border-b pb-3 mb-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3"
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <div className="min-w-0">
          <h1 className="text-base font-semibold" style={{ color: "var(--vscode-foreground)" }}>
            Navigation
          </h1>
          <div className="mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
            {message}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="h-8 px-2.5 border flex items-center gap-2 text-sm"
            style={{
              color: "var(--vscode-foreground)",
              backgroundColor: "var(--vscode-sidebar-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            <StatusBadge status={running} dotOnly />
            <span className="font-medium">{mode}</span>
          </div>
          <button
            type="button"
            disabled={busy !== null || running}
            onClick={() => runCommand("Mapping", startMapping)}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
              borderColor: "var(--vscode-focusBorder)",
            }}
          >
            Mapping
          </button>
          <button
            type="button"
            disabled={busy !== null || running}
            onClick={() => runCommand("Navigation", startSavedMapNavigation)}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
              borderColor: "var(--vscode-focusBorder)",
            }}
          >
            Navigation
          </button>
          <button
            type="button"
            onClick={() => setShowLogs((value) => !value)}
            title="Log"
            aria-label="Log"
            className="h-8 w-8 border cursor-pointer inline-flex items-center justify-center"
            style={{
              color: showLogs
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
              backgroundColor: showLogs
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              borderColor: showLogs
                ? "var(--vscode-panel-border)"
                : "var(--vscode-focusBorder)",
            }}
          >
            <LogIcon />
          </button>
          <button
            type="button"
            disabled={busy !== null || !running}
            onClick={() => runCommand("Stop", stopNavigationService)}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-secondaryForeground)",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            Stop
          </button>
          <input
            value={mapName}
            onChange={(event) => setMapName(event.currentTarget.value)}
            className="h-8 w-28 px-2 border text-sm"
            style={{
              color: "var(--vscode-input-foreground)",
              backgroundColor: "var(--vscode-input-background)",
              borderColor: "var(--vscode-input-border, var(--vscode-panel-border))",
            }}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => runCommand("Save map", saveMap)}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
              borderColor: "var(--vscode-focusBorder)",
            }}
          >
            Save Map
          </button>
          <div
            className="h-8 border grid grid-cols-3 overflow-hidden"
            style={{ borderColor: "var(--vscode-panel-border)" }}
          >
            {(["view", "goal", "initial"] as const).map((modeValue) => (
              <button
                key={modeValue}
                type="button"
                onClick={() => setClickMode(modeValue)}
                className="px-2 text-xs font-semibold inline-flex items-center justify-center"
                title={modeValue === "view" ? "View" : modeValue === "goal" ? "Goal" : "Initial"}
                aria-label={modeValue === "view" ? "View" : modeValue === "goal" ? "Goal" : "Initial"}
                style={{
                  color:
                    clickMode === modeValue
                      ? "var(--vscode-button-foreground)"
                      : "var(--vscode-foreground)",
                  backgroundColor:
                    clickMode === modeValue
                      ? "var(--vscode-button-background)"
                      : "var(--vscode-button-secondaryBackground)",
                }}
              >
                {modeValue === "view" ? <ViewModeIcon /> : modeValue === "goal" ? "Goal" : "Initial"}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div
        ref={contentGridRef}
        className={[
          "flex-1 min-h-0 grid grid-cols-1 gap-4",
          showLogs
            ? "xl:grid-cols-[var(--map-panel-width)_8px_var(--layers-panel-width)_8px_var(--log-panel-width)]"
            : "xl:grid-cols-[var(--map-panel-width)_8px_minmax(300px,1fr)]",
        ].join(" ")}
        style={contentGridStyle}
      >
        <MapView
          map={map}
          globalCostmap={globalCostmap}
          localCostmap={localCostmap}
          scan={scan}
          pose={currentPose}
          plan={plan}
          goalPose={goalPose}
          tf={bufferedTf}
          tfStatic={null}
          robotDescription={robotDescription}
          showMap={showMap}
          showGlobalCostmap={showGlobalCostmap}
          showLocalCostmap={showLocalCostmap}
          showScan={showScan}
          showGlobalPlan={showGlobalPlan}
          showGoalPose={showGoalPose}
          showTf={showTf}
          tfAvailable={!!bufferedTf?.transforms?.length}
          showRobotModel={showRobotModel}
          interactionDisabled={posePublishBusy}
          interactionMode={clickMode}
          onMapPose={handleMapPose}
        />
        <div
          className="hidden xl:block min-h-0 cursor-col-resize"
          onPointerDown={handleMapResizePointerDown}
          title="Resize map"
          aria-label="Resize map"
          role="separator"
          style={{ backgroundColor: "var(--vscode-panel-border)" }}
        />
        <aside className="min-h-0 flex flex-col gap-3">
          <div
            className="border p-3 grid gap-2"
            style={{
              color: "var(--vscode-foreground)",
              borderColor: "var(--vscode-panel-border)",
              backgroundColor: "var(--vscode-sidebar-background)",
            }}
          >
            <div className="text-xs font-semibold">Layers</div>
            <div className="flex flex-wrap gap-2">
              <Toggle label="Map" checked={showMap} onChange={setShowMap} />
              <Toggle label="Global costmap" checked={showGlobalCostmap} onChange={setShowGlobalCostmap} />
              <Toggle label="Local costmap" checked={showLocalCostmap} onChange={setShowLocalCostmap} />
              <Toggle label="Lidar" checked={showScan} onChange={setShowScan} />
              <Toggle label="Global plan" checked={showGlobalPlan} onChange={setShowGlobalPlan} />
              <Toggle label="Goal Pose" checked={showGoalPose} onChange={setShowGoalPose} />
              <Toggle label="TF" checked={showTf} onChange={setShowTf} />
              <Toggle label="Robot Model" checked={showRobotModel} onChange={setShowRobotModel} />
            </div>
          </div>
          <div
            className="border p-3 grid gap-2 text-xs"
            style={{
              color: "var(--vscode-foreground)",
              borderColor: "var(--vscode-panel-border)",
              backgroundColor: "var(--vscode-sidebar-background)",
            }}
          >
            <div className="font-semibold">Topics</div>
            {DISPLAY_TOPICS.map(({ topic }) => (
              <div key={topic} className="flex items-center justify-between gap-3">
                <span className="font-mono truncate">{topic}</span>
                <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                  {hasTopicData(topic) ? "live" : "wait"}
                </span>
              </div>
            ))}
          </div>
          <div
            className="border p-3 grid gap-2 text-xs shrink-0"
            style={{
              color: "var(--vscode-descriptionForeground)",
              borderColor: "var(--vscode-panel-border)",
              backgroundColor: "var(--vscode-sidebar-background)",
            }}
          >
            <div>
              Map name: <span className="font-mono">{mapName || "-"}</span>
            </div>
            <div>
              PID: <span className="font-mono">{status?.pid ?? "-"}</span>
            </div>
          </div>
        </aside>
        {showLogs && (
          <div
            role="separator"
            aria-label="Resize log panel"
            aria-orientation="vertical"
            className="hidden xl:flex min-h-0 cursor-col-resize items-stretch justify-center"
            onPointerDown={handleLogResizePointerDown}
          >
            <div
              className="w-px"
              style={{ backgroundColor: "var(--vscode-panel-border)" }}
            />
          </div>
        )}
        {showLogs && (
          <div className="min-h-[320px] min-w-0">
            <FixedLogPanel
              container={CONTAINER}
              service={NAVIGATION_SERVICE}
              onClose={() => setShowLogs(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
