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

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
// @ts-ignore
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  LaserScan,
  MapInteractionMode,
  OccupancyGrid,
  PathMsg,
  PolygonStamped,
  Pose,
  PoseStamped,
  TfMsg,
} from "@/lib/ros_types";
import {
  buildTfFramePoses,
  normalizeFrameId,
  orientationFromYaw,
  yawFromPose,
} from "@/lib/tf_utils";

const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 2000;
const MAP_DISPLAY_ROTATION = Math.PI;
const CLICK_DRAG_THRESHOLD_PX = 8;
const TF_AXIS_LENGTH = 0.2;

type OrbitControlsType = InstanceType<typeof OrbitControls>;

type MapViewerProps = {
  map: OccupancyGrid | null;
  globalCostmap: OccupancyGrid | null;
  localCostmap: OccupancyGrid | null;
  scan: LaserScan | null;
  pose: Pose | null;
  plan: PathMsg | null;
  goalPose: PoseStamped | null;
  footprint: PolygonStamped | null;
  tf: TfMsg | null;
  showMap: boolean;
  showGlobalCostmap: boolean;
  showLocalCostmap: boolean;
  showScan: boolean;
  showGlobalPlan: boolean;
  showGoalPose: boolean;
  showTf: boolean;
  showRobotModel: boolean;
  interactionDisabled: boolean;
  interactionMode: MapInteractionMode;
  editorActive: boolean;
  viewKey?: string;
  waitingLabel?: string;
  onEditorMapPoint: (x: number, y: number) => void;
  onMapPose: (x: number, y: number, yaw: number) => void;
};

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
  mesh.rotation.z = frameYaw + originYaw + MAP_DISPLAY_ROTATION;
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

function makeFootprintMarker(footprint: PolygonStamped, framePose: Pose | null): THREE.Group | null {
  const sourcePoints = footprint.polygon?.points ?? [];
  const polygonPoints = sourcePoints
    .map((point) => ({
      x: Number(point.x ?? 0),
      y: Number(point.y ?? 0),
      z: Number(point.z ?? 0),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  if (polygonPoints.length < 3) return null;

  const group = new THREE.Group();
  const yaw = framePose ? yawFromPose(framePose) : 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const frameX = Number(framePose?.position?.x ?? 0);
  const frameY = Number(framePose?.position?.y ?? 0);
  const frameZ = Number(framePose?.position?.z ?? 0);
  const transformPoint = (point: { x: number; y: number; z: number }) => (
    new THREE.Vector3(
      frameX + cos * point.x - sin * point.y,
      frameY + sin * point.x + cos * point.y,
      frameZ + point.z + 0.18
    )
  );
  const points = polygonPoints.map(transformPoint);
  points.push(points[0].clone());

  const line = makeLine(points, 0x38bdf8, 3);
  if (line) group.add(line);

  const shape = new THREE.Shape();
  polygonPoints.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  fill.position.set(frameX, frameY, frameZ + 0.17);
  fill.rotation.z = yaw;
  group.add(fill);
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
  meta: ReturnType<typeof gridMeta>,
  roll = 0
): void {
  if (!meta) return;
  const width = meta.width * meta.resolution;
  const height = meta.height * meta.resolution;
  const center = new THREE.Vector3(meta.originX + width / 2, meta.originY + height / 2, 0);
  const maxDim = Math.max(width, height, 1);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distanceForHeight = height / (2 * Math.tan(halfFov));
  const distanceForWidth = width / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.1));
  const distance = Math.max(distanceForHeight, distanceForWidth, maxDim) * 1.12;
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.position.set(center.x, center.y, distance);
  camera.lookAt(center);
  camera.near = CAMERA_NEAR;
  camera.far = Math.max(CAMERA_FAR, maxDim * 10);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function applyTopViewRoll(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsType,
  roll: number
): void {
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(controls.target);
  controls.update();
}

export function MapViewer({
  map,
  globalCostmap,
  localCostmap,
  scan,
  pose,
  plan,
  goalPose,
  footprint,
  tf,
  showMap,
  showGlobalCostmap,
  showLocalCostmap,
  showScan,
  showGlobalPlan,
  showGoalPose,
  showTf,
  showRobotModel,
  interactionDisabled,
  interactionMode,
  editorActive,
  viewKey,
  waitingLabel = "Waiting for /map",
  onEditorMapPoint,
  onMapPose,
}: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);
  const layersRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fitMapKeyRef = useRef<string | null>(null);
  const viewRollRef = useRef(0);
  const viewRotateDragRef = useRef<{ clientX: number; roll: number } | null>(null);
  const latestFootprintRef = useRef<PolygonStamped | null>(null);
  const tfSyncedFootprintRef = useRef<PolygonStamped | null>(null);
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
    camera.up.set(0, 1, 0);
    camera.position.set(0, 0, 10);
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
    controls.enableRotate = true;
    controls.screenSpacePanning = true;
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
      : editorActive
        ? "cursor-cell"
        : interactionMode === "view"
          ? "cursor-grab"
          : "cursor-crosshair";
    renderer.domElement.className = `block w-full h-full ${cursor}`;
    if (controls) {
      controls.enabled = !interactionDisabled && !editorActive && interactionMode === "view";
    }
  }, [editorActive, interactionDisabled, interactionMode]);

  useEffect(() => {
    latestFootprintRef.current = footprint;
  }, [footprint]);

  useEffect(() => {
    tfSyncedFootprintRef.current = latestFootprintRef.current;
  }, [tf]);

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
    const tfSyncedFootprint = tfSyncedFootprintRef.current;
    const tfFramePoses = buildTfFramePoses(tf, "map");
    const tfFramePoseByName = new Map(tfFramePoses.map(({ frame, pose: framePose }) => [frame, framePose]));
    if (showMap) {
      const mapPlane = map ? makeGridPlane(map, "map", 0) : null;
      if (mapPlane) layers.add(mapPlane);
    }

    if (showGlobalCostmap) {
      if (globalCostmap) {
        const plane = makeGridPlane(globalCostmap, "globalCostmap", 0.03);
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
        const plane = makeGridPlane(localCostmap, "localCostmap", 0.1, localFramePose, scanCells);
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

    if (showTf && tf?.transforms?.length) {
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

    if (showRobotModel && tfSyncedFootprint?.polygon?.points?.length) {
      const footprintFrame = normalizeFrameId(tfSyncedFootprint.header?.frame_id);
      const footprintFramePose = footprintFrame && footprintFrame !== "map"
        ? tfFramePoseByName.get(footprintFrame) ?? null
        : null;
      const footprintMarker = makeFootprintMarker(tfSyncedFootprint, footprintFramePose);
      if (footprintMarker) layers.add(footprintMarker);
    }

    if (pose?.position) {
      layers.add(makePoseMarker(
        pose,
        showRobotModel && tfSyncedFootprint?.polygon?.points?.length ? 0x60a5fa : 0x007acc,
        0.16
      ));
    }

    const fitKey = viewKey ?? "default";
    if (meta && fitMapKeyRef.current !== fitKey) {
      fitCameraToMap(camera, controls, meta, viewRollRef.current);
      fitMapKeyRef.current = fitKey;
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
    viewKey,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!renderer || !camera || !controls) return;

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
      if (editorActive) {
        const point = mapPointFromEvent(event);
        if (point) onEditorMapPoint(point.x, point.y);
        return;
      }
      if (!interactionDisabled && interactionMode === "view" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        viewRotateDragRef.current = {
          clientX: event.clientX,
          roll: viewRollRef.current,
        };
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
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
      const viewRotateDrag = viewRotateDragRef.current;
      if (viewRotateDrag) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const nextRoll = viewRotateDrag.roll - (event.clientX - viewRotateDrag.clientX) * 0.01;
        viewRollRef.current = nextRoll;
        applyTopViewRoll(camera, controls, nextRoll);
        return;
      }
      if (interactionDisabled || interactionMode === "view") return;
      const pointerDown = pointerDownRef.current;
      if (!pointerDown) return;
      const point = mapPointFromEvent(event);
      if (!point) return;
      setDragPreviewPose(previewPoseFromDrag(pointerDown, point, event.clientX, event.clientY));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (viewRotateDragRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        viewRotateDragRef.current = null;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }
        return;
      }
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
      viewRotateDragRef.current = null;
      pointerDownRef.current = null;
      setDragPreviewPose(null);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown, { capture: true });
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [editorActive, interactionDisabled, interactionMode, map, onEditorMapPoint, onMapPose, pose]);

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
          {waitingLabel}
        </div>
      )}
    </div>
  );
}
