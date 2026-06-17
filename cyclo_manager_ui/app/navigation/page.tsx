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
  cancelNavigateToPoseGoal,
  controlService,
  getServiceStatus,
  publishROS2Topic,
  sendNavigateToPoseGoal,
} from "@/lib/api";
import { useROS2TopicWebSocket } from "@/lib/websocket";
import type { ServiceStatusResponse } from "@/types/api";
import { MapEditorControls, useMapEditor } from "@/components/MapEditor";
import { MapViewer } from "@/components/MapViewer";
import { NavigationSidePanel } from "@/components/NavigationSidePanel";
import { NavigationToolbar } from "@/components/NavigationToolbar";
import type {
  LaserScan,
  MapInteractionMode,
  OccupancyGrid,
  PathMsg,
  PolygonStamped,
  Pose,
  PoseStamped,
  TfMsg,
  TransformStamped,
} from "@/lib/ros_types";
import {
  mergeTfMessages,
  orientationFromYaw,
  poseFromBaseLinkTf,
  tfMessageFromBuffer,
  updateTfBuffer,
  yawFromPose,
} from "@/lib/tf_utils";
import FixedLogPanel from "@/components/FixedLogPanel";

const CONTAINER = "ai_worker";
const NAVIGATION_SERVICE = "ai_worker_navigation";
const MAP_SAVE_SERVICE = "ai_worker_map_save";
const SERVICE_MODE_STORAGE_KEY = "cyclo.navigation.serviceMode";
const STATUS_POLL_MS = 2000;
const DEFAULT_MAP_NAME = "map";
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

type LayerPreset = typeof IDLE_LAYER_PRESET;
type NavigationServiceMode = "mapping" | "navigation";

const TOPICS = [
  { topic: "/map", msgType: "nav_msgs/msg/OccupancyGrid" },
  { topic: "/global_costmap/costmap", msgType: "nav_msgs/msg/OccupancyGrid" },
  { topic: "/local_costmap/costmap", msgType: "nav_msgs/msg/OccupancyGrid" },
  { topic: "/local_costmap/published_footprint", msgType: "geometry_msgs/msg/PolygonStamped" },
  { topic: "/scan", msgType: "sensor_msgs/msg/LaserScan" },
  { topic: "/amcl_pose", msgType: "geometry_msgs/msg/PoseWithCovarianceStamped" },
  { topic: "/plan", msgType: "nav_msgs/msg/Path" },
  { topic: "/goal_pose", msgType: "geometry_msgs/msg/PoseStamped" },
  { topic: "/tf", msgType: "tf2_msgs/msg/TFMessage" },
  { topic: "/tf_static", msgType: "tf2_msgs/msg/TFMessage" },
] as const;
const DISPLAY_TOPICS = TOPICS.filter(
  ({ topic }) => topic !== "/amcl_pose" && topic !== "/tf_static"
);

function messageData<T>(value: unknown): T | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  if (outer.available === false) return null;
  const data = "data" in outer ? outer.data : outer;
  if (!data || typeof data !== "object") return null;
  return data as T;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readStoredServiceMode(): NavigationServiceMode {
  if (typeof window === "undefined") return "navigation";
  return window.localStorage.getItem(SERVICE_MODE_STORAGE_KEY) === "mapping" ? "mapping" : "navigation";
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
  const [showPgmFix, setShowPgmFix] = useState(false);
  const [tfBufferRevision, setTfBufferRevision] = useState(0);
  const [serviceMode, setServiceMode] = useState<NavigationServiceMode>(readStoredServiceMode);
  const mapEditor = useMapEditor({
    open: showPgmFix,
    mapName,
    onMessage: setMessage,
  });

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
  const { topicData: footprintData } = useROS2TopicWebSocket(
    CONTAINER,
    showRobotModel ? "/local_costmap/published_footprint" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS
  );
  const { topicData: scanData } = useROS2TopicWebSocket(
    CONTAINER,
    showScan ? "/scan" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS
  );
  const { topicData: amclData } = useROS2TopicWebSocket(CONTAINER, "/amcl_pose", ROS2_WS_FAST_TOPIC_OPTIONS);
  const { topicData: planData } = useROS2TopicWebSocket(CONTAINER, showGlobalPlan ? "/plan" : null);
  const { topicData: goalPoseData } = useROS2TopicWebSocket(CONTAINER, showGoalPose ? "/goal_pose" : null);
  const { topicData: tfData } = useROS2TopicWebSocket(CONTAINER, "/tf", ROS2_WS_FAST_TOPIC_OPTIONS);
  const { topicData: tfStaticData } = useROS2TopicWebSocket(CONTAINER, "/tf_static");
  const map = useMemo(() => messageData<OccupancyGrid>(mapData), [mapData]);
  const globalCostmap = useMemo(() => messageData<OccupancyGrid>(globalCostmapData), [globalCostmapData]);
  const localCostmap = useMemo(() => messageData<OccupancyGrid>(localCostmapData), [localCostmapData]);
  const footprint = useMemo(() => messageData<PolygonStamped>(footprintData), [footprintData]);
  const scan = useMemo(() => messageData<LaserScan>(scanData), [scanData]);
  const amclPose = useMemo(() => messageData<{ pose?: { pose?: Pose } }>(amclData), [amclData]);
  const plan = useMemo(() => messageData<PathMsg>(planData), [planData]);
  const topicGoalPose = useMemo(() => messageData<PoseStamped>(goalPoseData), [goalPoseData]);
  const tf = useMemo(() => messageData<TfMsg>(tfData), [tfData]);
  const tfStatic = useMemo(() => messageData<TfMsg>(tfStaticData), [tfStaticData]);
  const latestTf = useMemo(() => mergeTfMessages(tfStatic, tf), [tf, tfStatic]);
  const bufferedTf = useMemo(() => (
    tfMessageFromBuffer(tfBufferRef.current) ?? latestTf
  ), [latestTf, tfBufferRevision]);
  const fallbackPose = amclPose?.pose?.pose ?? null;
  const goalPose = hideReachedGoalPose ? null : (lastGoalPose ?? topicGoalPose);
  const topicBaseLinkPose = useMemo(() => poseFromBaseLinkTf(bufferedTf), [bufferedTf]);
  const baseLinkPose = topicBaseLinkPose ?? lastBaseLinkPose;
  const currentPose = baseLinkPose ?? fallbackPose;
  const running = status?.is_up ?? false;
  const mode = running ? "running" : "idle";
  const displayedMap = showPgmFix ? mapEditor.map : map;
  const mapViewKey = showPgmFix
    ? `editor:${mapEditor.selectedPath || "none"}`
    : `ros:${mode}:${mapName || DEFAULT_MAP_NAME}`;
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
    window.localStorage.setItem(SERVICE_MODE_STORAGE_KEY, serviceMode);
  }, [serviceMode]);

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
    if (running) {
      applyLayerPreset(serviceMode === "mapping" ? MAPPING_LAYER_PRESET : NAVIGATION_LAYER_PRESET);
      return;
    }
    applyLayerPreset(IDLE_LAYER_PRESET);
  }, [applyLayerPreset, running, serviceMode]);

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
      setStatus((current) => current);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(loadStatus, STATUS_POLL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [loadStatus]);

  const runCommand = useCallback(async (label: string, action: () => Promise<string | void>) => {
    setBusy(label);
    try {
      const nextMessage = await action();
      setMessage(nextMessage || `${label} complete`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(null);
      void loadStatus();
    }
  }, [loadStatus]);

  const startMapping = useCallback(async () => {
    setServiceMode("mapping");
    await controlService(CONTAINER, NAVIGATION_SERVICE, "restart", {
      map_name: mapName,
    }, undefined, "map");
    applyLayerPreset(MAPPING_LAYER_PRESET);
  }, [applyLayerPreset, mapName]);

  const startSavedMapNavigation = useCallback(async () => {
    setServiceMode("navigation");
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
      await sendNavigateToPoseGoal(CONTAINER, { pose: poseStamped });
      setMessage(`Goal ${x.toFixed(2)}, ${y.toFixed(2)}, yaw ${(yaw * 180 / Math.PI).toFixed(0)} deg`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Goal publish failed");
    }
  }, []);

  const cancelGoal = useCallback(async () => {
    await cancelNavigateToPoseGoal(CONTAINER);
    setLastGoalPose(null);
    setHideReachedGoalPose(true);
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
    if (topic === "/local_costmap/published_footprint") return !!footprint?.polygon?.points?.length;
    if (topic === "/scan") return !!scan;
    if (topic === "/plan") return !!plan;
    if (topic === "/goal_pose") return !!goalPose;
    if (topic === "/tf") return !!tf?.transforms?.length;
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
        <NavigationToolbar
          busy={busy}
          clickMode={clickMode}
          mapName={mapName}
          mode={mode}
          running={running}
          showLogs={showLogs}
          showPgmFix={showPgmFix}
          onCancel={() => runCommand("Cancel", cancelGoal)}
          onFixToggle={() => setShowPgmFix((value) => !value)}
          onMapping={() => runCommand("Mapping", startMapping)}
          onNavigation={() => runCommand("Navigation", startSavedMapNavigation)}
          onSaveMap={() => runCommand("Save map", saveMap)}
          onStop={() => runCommand("Stop", stopNavigationService)}
          setClickMode={setClickMode}
          setMapName={setMapName}
          setShowLogs={setShowLogs}
        />
      </header>
      {showPgmFix && (
        <div
          className="shrink-0 border mb-4 p-3"
          style={{
            borderColor: "var(--vscode-panel-border)",
            backgroundColor: "var(--vscode-sideBar-background)",
          }}
        >
          <MapEditorControls
            files={mapEditor.files}
            selectedPath={mapEditor.selectedPath}
            setSelectedPath={mapEditor.setSelectedPath}
            tool={mapEditor.tool}
            setTool={mapEditor.setTool}
            brushSize={mapEditor.brushSize}
            setBrushSize={mapEditor.setBrushSize}
            busy={mapEditor.busy}
            image={mapEditor.image}
            dirty={mapEditor.dirty}
            canUndo={mapEditor.canUndo}
            undo={mapEditor.undo}
            save={mapEditor.save}
          />
        </div>
      )}
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
        <MapViewer
          map={displayedMap}
          globalCostmap={showPgmFix ? null : globalCostmap}
          localCostmap={showPgmFix ? null : localCostmap}
          scan={showPgmFix ? null : scan}
          pose={showPgmFix ? null : currentPose}
          plan={showPgmFix ? null : plan}
          goalPose={showPgmFix ? null : goalPose}
          footprint={showPgmFix ? null : footprint}
          tf={showPgmFix ? null : bufferedTf}
          showMap={showPgmFix ? true : showMap}
          showGlobalCostmap={showPgmFix ? false : showGlobalCostmap}
          showLocalCostmap={showPgmFix ? false : showLocalCostmap}
          showScan={showPgmFix ? false : showScan}
          showGlobalPlan={showPgmFix ? false : showGlobalPlan}
          showGoalPose={showPgmFix ? false : showGoalPose}
          showTf={showPgmFix ? false : showTf}
          showRobotModel={showPgmFix ? false : showRobotModel}
          interactionDisabled={posePublishBusy || (showPgmFix && mapEditor.busy)}
          interactionMode={showPgmFix ? "view" : clickMode}
          editorActive={showPgmFix && !!mapEditor.map && mapEditor.tool !== "view"}
          viewKey={mapViewKey}
          waitingLabel={showPgmFix ? "Select a PGM" : "Waiting for /map"}
          onEditorMapPoint={mapEditor.editAtMapPoint}
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
        <NavigationSidePanel
          displayTopics={DISPLAY_TOPICS}
          hasTopicData={hasTopicData}
          mapName={mapName}
          status={status}
          showGlobalCostmap={showGlobalCostmap}
          showGlobalPlan={showGlobalPlan}
          showGoalPose={showGoalPose}
          showLocalCostmap={showLocalCostmap}
          showMap={showMap}
          showRobotModel={showRobotModel}
          showScan={showScan}
          showTf={showTf}
          setShowGlobalCostmap={setShowGlobalCostmap}
          setShowGlobalPlan={setShowGlobalPlan}
          setShowGoalPose={setShowGoalPose}
          setShowLocalCostmap={setShowLocalCostmap}
          setShowMap={setShowMap}
          setShowRobotModel={setShowRobotModel}
          setShowScan={setShowScan}
          setShowTf={setShowTf}
        />
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
