"use client";

import { useEffect, useRef, useState } from "react";
import { useROS2TopicWebSocket } from "@/lib/websocket";
import * as THREE from "three";
// @ts-ignore
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// @ts-ignore
import URDFLoader from "urdf-loader";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 400;
const SCENE_BACKGROUND = 0x1e1e1e;
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1000;
const CAMERA_INITIAL_POSITION = { x: 1.5, y: 1.5, z: 1.5 };
const GROUND_SIZE = 20;
const GRID_DIVISIONS = 20;
const AXES_SIZE = 2;
const CAMERA_DISTANCE_MULTIPLIER = 2.5;
const CAMERA_POSITION_OFFSET = 0.7;
const URDF_MIN_STRING_LENGTH = 100;
const ROBOT_ROTATION_X = -Math.PI / 2;

const URDF_LOADER_PACKAGES: Record<string, string> = {
  ffw_description: "/assets/ffw_description",
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
type URDFRobotRef = {
  setJointValue: (name: string, ...values: number[]) => boolean;
  setJointValues: (values: Record<string, number | number[]>) => boolean;
  joints?: Record<string, THREE.Object3D>;
} | null;

function getMeshesForJoint(joint: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const childLink = joint.children[0];
  if (childLink) {
    childLink.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshes.push(obj);
    });
  }
  return meshes;
}

interface Robot3DViewerProps {
  container: string;
  robotDescriptionTopic?: string;
  jointStatesTopic?: string;
  className?: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function extractRobotDescriptionString(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (obj.data && typeof obj.data === "string") return obj.data;
    for (const value of Object.values(obj)) {
      if (typeof value === "string" && value.length > URDF_MIN_STRING_LENGTH) {
        return value;
      }
    }
  }
  return null;
}

function parseJointStateToValues(data: unknown): Record<string, number> | null {
  const raw = data;
  const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!msg || typeof msg !== "object") return null;
  // Handle nested: ROS2TopicDataResponse has .data = payload, or payload may be nested
  const m = (msg as Record<string, unknown>).data !== undefined && typeof (msg as Record<string, unknown>).data === "object"
    ? ((msg as Record<string, unknown>).data as Record<string, unknown>)
    : (msg as Record<string, unknown>);
  const namesArr = (m.name ?? m.names ?? (m as Record<string, unknown>).joint_names) as unknown;
  const positionsArr = (m.position ?? m.positions ?? (m as Record<string, unknown>).joint_positions) as unknown;
  const names: string[] = Array.isArray(namesArr) ? namesArr.map(String) : [];
  const positions: number[] = Array.isArray(positionsArr) ? positionsArr.map(Number) : [];
  if (names.length === 0 || positions.length !== names.length) return null;
  const values: Record<string, number> = {};
  names.forEach((name: string, i: number) => {
    values[name] = positions[i];
  });
  return values;
}

function removeUrdfRobotsFromScene(scene: THREE.Scene): void {
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((c) => {
    if (c.userData.isUrdfRobot) toRemove.push(c);
  });
  toRemove.forEach((c) => {
    scene.remove(c);
    c.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  });
}

function fitCameraToRobot(
  robot: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene
): void {
  const box = new THREE.Box3().setFromObject(robot);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDim * CAMERA_DISTANCE_MULTIPLIER;
  camera.position.set(
    center.x + distance * CAMERA_POSITION_OFFSET,
    center.y + distance * CAMERA_POSITION_OFFSET,
    center.z + distance * CAMERA_POSITION_OFFSET
  );
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  renderer.render(scene, camera);
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------
export default function Robot3DViewer({
  container,
  robotDescriptionTopic = "/robot_description",
  jointStatesTopic = "/joint_states",
  className = "",
}: Robot3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const robotRef = useRef<URDFRobotRef>(null);
  const highlightedMaterialsRef = useRef<Map<THREE.Mesh, { emissive: THREE.Color; emissiveIntensity: number }>>(new Map());
  const [robotDescription, setRobotDescription] = useState<string | null>(null);
  const [jointValues, setJointValues] = useState<Record<string, number>>({});
  const [highlightedJoint, setHighlightedJoint] = useState<string | null>(null);

  const { topicData: robotDescriptionData } = useROS2TopicWebSocket(container, robotDescriptionTopic);
  const { topicData: jointStatesData } = useROS2TopicWebSocket(container, jointStatesTopic);

  // Parse robot description from topic data
  useEffect(() => {
    if (!robotDescriptionData?.available) return;
    try {
      const str = extractRobotDescriptionString(robotDescriptionData.data);
      if (str?.length) {
        setRobotDescription((prev) => (prev === str ? prev : str));
      }
    } catch {
      // Ignore parse errors
    }
  }, [robotDescriptionData]);

  // Apply joint_states to robot and update jointValues for panel
  useEffect(() => {
    if (!jointStatesData?.available) return;
    try {
      const payload = jointStatesData.data ?? jointStatesData;
      const values = parseJointStateToValues(payload);
      if (values && Object.keys(values).length > 0) {
        setJointValues(values);
        if (robotRef.current) robotRef.current.setJointValues(values);
      }
    } catch {
      // Ignore parse errors
    }
  }, [jointStatesData]);

  const HIGHLIGHT_EMISSIVE = 0xff6600;
  const HIGHLIGHT_EMISSIVE_INTENSITY = 0.6;

  // Apply or remove highlight when highlightedJoint changes
  useEffect(() => {
    const robot = robotRef.current;
    if (!robot?.joints) return;

    const prev = highlightedMaterialsRef.current;

    // Restore previously highlighted meshes
    prev.forEach(({ emissive, emissiveIntensity }, mesh) => {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat && "emissive" in mat) {
        (mat as THREE.MeshStandardMaterial).emissive.copy(emissive);
        (mat as THREE.MeshStandardMaterial).emissiveIntensity = emissiveIntensity;
      }
    });
    prev.clear();

    if (!highlightedJoint || !robot.joints[highlightedJoint]) return;

    const jointObj = robot.joints[highlightedJoint];
    const meshes = getMeshesForJoint(jointObj);

    meshes.forEach((mesh) => {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat || !("emissive" in mat)) return;

      const m = mat as THREE.MeshStandardMaterial;
      prev.set(mesh, {
        emissive: m.emissive.clone(),
        emissiveIntensity: m.emissiveIntensity,
      });
      m.emissive.setHex(HIGHLIGHT_EMISSIVE);
      m.emissiveIntensity = HIGHLIGHT_EMISSIVE_INTENSITY;
    });
  }, [highlightedJoint]);

  // Init scene, camera, renderer, controls, animation loop
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl || rendererRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SCENE_BACKGROUND);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      CANVAS_WIDTH / CANVAS_HEIGHT,
      CAMERA_NEAR,
      CAMERA_FAR
    );
    camera.position.set(
      CAMERA_INITIAL_POSITION.x,
      CAMERA_INITIAL_POSITION.y,
      CAMERA_INITIAL_POSITION.z
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
    containerEl.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.2,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(GROUND_SIZE, GRID_DIVISIONS, 0x888888, 0x444444);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(AXES_SIZE);
    scene.add(axesHelper);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      controls.dispose();
      renderer.dispose();
      if (containerEl && renderer.domElement.parentNode === containerEl) {
        containerEl.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  // Load URDF and add robot to scene
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const controls = controlsRef.current;

    if (!robotDescription || !scene || !camera || !renderer || !controls) return;

    robotRef.current = null;
    removeUrdfRobotsFromScene(scene);

    try {
      const manager = new THREE.LoadingManager();

      manager.onLoad = () => {
        const robot = scene.children.find((c) => c.userData.isUrdfRobot);
        if (robot && camera && controls && renderer) {
          fitCameraToRobot(robot, camera, controls, renderer, scene);
        }
      };

      manager.onProgress = (url, loaded, total) => {
        console.log(`[Robot3DViewer] Loading ${loaded}/${total} - ${url}`);
      };

      manager.onError = (url) => {
        console.error(`[Robot3DViewer] Failed to load asset: ${url}`);
      };

      const loader = new URDFLoader(manager);
      loader.packages = URDF_LOADER_PACKAGES;

      const robot = loader.parse(robotDescription);
      robot.userData.isUrdfRobot = true;
      robotRef.current = robot as unknown as NonNullable<URDFRobotRef>;
      robot.rotation.x = ROBOT_ROTATION_X;

      scene.add(robot);
    } catch (error) {
      console.error("[Robot3DViewer] URDF Loading Error:", error);
    }
  }, [robotDescription]);

  const jointEntries = Object.entries(jointValues);
  const handleJointClick = (name: string) => {
    setHighlightedJoint((prev) => (prev === name ? null : name));
  };

  return (
    <div
      className={`flex flex-col border rounded overflow-hidden h-full min-h-0 ${className}`}
      style={{
        width: `${CANVAS_WIDTH}px`,
        backgroundColor: "var(--vscode-sidebar-background)",
        borderColor: "var(--vscode-panel-border)",
      }}
    >
      <div
        ref={containerRef}
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, flexShrink: 0 }}
      />
      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{
          borderTop: "1px solid var(--vscode-panel-border)",
          padding: "8px",
        }}
      >
        <div
          className="text-xs font-medium mb-2"
          style={{ color: "var(--vscode-descriptionForeground)" }}
        >
          Joint States
        </div>
        {jointEntries.length === 0 ? (
          <p
            className="text-xs"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            Waiting for joint_states...
          </p>
        ) : (
          <div className="space-y-1">
            {jointEntries.map(([name, value]) => (
              <button
                key={name}
                type="button"
                onClick={() => handleJointClick(name)}
                className="w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors"
                style={{
                  backgroundColor:
                    highlightedJoint === name
                      ? "var(--vscode-list-activeSelectionBackground)"
                      : "transparent",
                  color:
                    highlightedJoint === name
                      ? "var(--vscode-list-activeSelectionForeground, var(--vscode-foreground))"
                      : "var(--vscode-foreground)",
                }}
                onMouseEnter={(e) => {
                  if (highlightedJoint !== name) {
                    e.currentTarget.style.backgroundColor =
                      "var(--vscode-list-hoverBackground)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (highlightedJoint !== name) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
              >
                {name}: {Number(value).toFixed(3)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
