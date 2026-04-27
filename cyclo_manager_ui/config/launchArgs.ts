/**
 * Launch arguments configuration for ROS2 bringup services.
 * ai_worker_bringup dispatches to the follower launch (sg2/bg2/sh5/bh5) via /run/robot_type
 * and launch args from the UI.
 */

export type LaunchArgType = "bool" | "string";

export interface LaunchArgDef {
  key: string;
  label: string;
  type: LaunchArgType;
  default: string;
}

export interface LaunchArgsConfig {
  serviceId: string;
  /** Used for localStorage key when different configs share serviceId (e.g. SG2 vs BG2) */
  storageKey?: string;
  title: string;
  args: LaunchArgDef[];
}

/**
 * Build default args Record from config
 */
export function getDefaultArgs(config: LaunchArgsConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of config.args) {
    out[def.key] = def.default;
  }
  return out;
}

/**
 * Merge stored args with config defaults (missing keys get defaults)
 */
export function mergeWithDefaults(
  config: LaunchArgsConfig,
  stored: Record<string, string> | null
): Record<string, string> {
  const defaults = getDefaultArgs(config);
  if (!stored) return { ...defaults };
  return { ...defaults, ...stored };
}

/** ai_worker_bringup - SG2 variant (model contains sg2 -> ffw_sg2_follower_ai.launch.py) */
export const FOLLOWER_BRINGUP_SG2_CONFIG: LaunchArgsConfig = {
  serviceId: "ai_worker_bringup",
  storageKey: "ai_worker_bringup_sg2",
  title: "Follower Bringup (SG2) Launch Arguments",
  args: [
    { key: "start_rviz", label: "Start RViz", type: "bool", default: "false" },
    { key: "use_sim", label: "Use Simulation", type: "bool", default: "false" },
    { key: "use_mock_hardware", label: "Use Mock Hardware", type: "bool", default: "false" },
    { key: "mock_sensor_commands", label: "Mock Sensor Commands", type: "bool", default: "false" },
    { key: "port_name", label: "Port Name", type: "string", default: "/dev/follower" },
    { key: "launch_cameras", label: "Launch Cameras", type: "bool", default: "true" },
    { key: "launch_lidar", label: "Launch Lidar", type: "bool", default: "true" },
    { key: "init_position", label: "Init Position", type: "bool", default: "true" },
    { key: "model", label: "Model", type: "string", default: "ffw_sg2_rev1_follower" },
    { key: "use_head_eef_tracker", label: "Use Head EEF Tracker", type: "bool", default: "false" },
    { key: "init_position_file", label: "Init Position File", type: "string", default: "ffw_sg2_follower_initial_positions.yaml" },
    { key: "ros2_control_type", label: "ROS2 Control Type", type: "string", default: "ffw_sg2_follower" },
  ],
};

/** ai_worker_bringup - BG2 variant (model contains bg2 -> ffw_bg2_follower_ai.launch.py) */
export const FOLLOWER_BRINGUP_BG2_CONFIG: LaunchArgsConfig = {
  serviceId: "ai_worker_bringup",
  storageKey: "ai_worker_bringup_bg2",
  title: "Follower Bringup (BG2) Launch Arguments",
  args: [
    { key: "start_rviz", label: "Start RViz", type: "bool", default: "false" },
    { key: "use_sim", label: "Use Simulation", type: "bool", default: "false" },
    { key: "use_mock_hardware", label: "Use Mock Hardware", type: "bool", default: "false" },
    { key: "mock_sensor_commands", label: "Mock Sensor Commands", type: "bool", default: "false" },
    { key: "port_name", label: "Port Name", type: "string", default: "/dev/follower" },
    { key: "launch_cameras", label: "Launch Cameras", type: "bool", default: "true" },
    { key: "init_position", label: "Init Position", type: "bool", default: "true" },
    { key: "model", label: "Model", type: "string", default: "ffw_bg2_rev4_follower" },
    { key: "use_head_eef_tracker", label: "Use Head EEF Tracker", type: "bool", default: "false" },
    { key: "init_position_file", label: "Init Position File", type: "string", default: "ffw_bg2_follower_initial_positions.yaml" },
    { key: "ros2_control_type", label: "ROS2 Control Type", type: "string", default: "ffw_bg2_follower" },
  ],
};

/** ai_worker_bringup - SH5 variant (ffw_sh5_follower_ai.launch.py) */
export const FOLLOWER_BRINGUP_SH5_CONFIG: LaunchArgsConfig = {
  serviceId: "ai_worker_bringup",
  storageKey: "ai_worker_bringup_sh5",
  title: "Follower Bringup (SH5) Launch Arguments",
  args: [
    { key: "start_rviz", label: "Start RViz", type: "bool", default: "false" },
    { key: "use_sim", label: "Use Simulation", type: "bool", default: "false" },
    { key: "use_mock_hardware", label: "Use Mock Hardware", type: "bool", default: "false" },
    { key: "mock_sensor_commands", label: "Mock Sensor Commands", type: "bool", default: "false" },
    { key: "port_name", label: "Port Name", type: "string", default: "/dev/follower" },
    { key: "launch_cameras", label: "Launch Cameras", type: "bool", default: "true" },
    { key: "init_position", label: "Init Position", type: "bool", default: "true" },
    { key: "model", label: "Model", type: "string", default: "ffw_sh5_rev1_follower" },
    { key: "use_head_eef_tracker", label: "Use Head EEF Tracker", type: "bool", default: "false" },
    { key: "init_position_file", label: "Init Position File", type: "string", default: "ffw_sh5_follower_initial_positions.yaml" },
  ],
};

/** ai_worker_bringup - BH5 variant (ffw_bh5_follower_ai.launch.py) */
export const FOLLOWER_BRINGUP_BH5_CONFIG: LaunchArgsConfig = {
  serviceId: "ai_worker_bringup",
  storageKey: "ai_worker_bringup_bh5",
  title: "Follower Bringup (BH5) Launch Arguments",
  args: [
    { key: "start_rviz", label: "Start RViz", type: "bool", default: "false" },
    { key: "use_sim", label: "Use Simulation", type: "bool", default: "false" },
    { key: "use_mock_hardware", label: "Use Mock Hardware", type: "bool", default: "false" },
    { key: "mock_sensor_commands", label: "Mock Sensor Commands", type: "bool", default: "false" },
    { key: "port_name", label: "Port Name", type: "string", default: "/dev/follower" },
    { key: "launch_cameras", label: "Launch Cameras", type: "bool", default: "true" },
    { key: "init_position", label: "Init Position", type: "bool", default: "true" },
    { key: "model", label: "Model", type: "string", default: "ffw_bh5_rev1_follower" },
    { key: "use_head_eef_tracker", label: "Use Head EEF Tracker", type: "bool", default: "false" },
    { key: "init_position_file", label: "Init Position File", type: "string", default: "ffw_bh5_follower_initial_positions.yaml" },
    { key: "ros2_control_type", label: "ROS2 Control Type", type: "string", default: "ffw_bh5_follower" },
  ],
};

/** avatar_bringup - ffw_lg2_leader_ai.launch.py */
export const LG2_LEADER_AI_CONFIG: LaunchArgsConfig = {
  serviceId: "avatar_bringup",
  title: "avatar_bringup Launch Arguments",
  args: [
    { key: "description_file", label: "Description File (URDF/XACRO)", type: "string", default: "ffw_lg2_leader.urdf.xacro" },
  ],
};

/** Follower model picked on the System page (maps to API `robot_type` lowercase). */
export type FollowerRobotModel = "SG2" | "BG2" | "SH5" | "BH5";

export type FollowerRobotApiType = "sg2" | "bg2" | "sh5" | "bh5";

const FOLLOWER_ROBOT_MODELS: readonly FollowerRobotModel[] = ["SG2", "BG2", "SH5", "BH5"];

export function isFollowerRobotModel(v: string | null | undefined): v is FollowerRobotModel {
  if (v == null) return false;
  return (FOLLOWER_ROBOT_MODELS as readonly string[]).includes(v);
}

export function followerModelToApi(kind: FollowerRobotModel): FollowerRobotApiType {
  switch (kind) {
    case "SG2":
      return "sg2";
    case "BG2":
      return "bg2";
    case "SH5":
      return "sh5";
    case "BH5":
      return "bh5";
  }
}

export function getFollowerLaunchConfig(kind: FollowerRobotModel): LaunchArgsConfig {
  switch (kind) {
    case "SG2":
      return FOLLOWER_BRINGUP_SG2_CONFIG;
    case "BG2":
      return FOLLOWER_BRINGUP_BG2_CONFIG;
    case "SH5":
      return FOLLOWER_BRINGUP_SH5_CONFIG;
    case "BH5":
      return FOLLOWER_BRINGUP_BH5_CONFIG;
  }
}

/** localStorage key: `robot_type_${container}` (System page). */
export function getStoredFollowerRobotModel(container: string): FollowerRobotModel {
  if (typeof window === "undefined" || !container) return "SG2";
  const stored = localStorage.getItem(`robot_type_${container}`);
  return isFollowerRobotModel(stored) ? stored : "SG2";
}
