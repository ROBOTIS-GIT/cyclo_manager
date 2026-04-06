/**
 * Launch arguments configuration for ROS2 bringup services.
 * ai_worker_bringup dispatches to ffw_bg2_follower_ai or ffw_sg2_follower_ai
 * based on model in launch_args.
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

/** avatar_bringup - ffw_lg2_leader_ai.launch.py */
export const LG2_LEADER_AI_CONFIG: LaunchArgsConfig = {
  serviceId: "avatar_bringup",
  title: "avatar_bringup Launch Arguments",
  args: [
    { key: "description_file", label: "Description File (URDF/XACRO)", type: "string", default: "ffw_lg2_leader.urdf.xacro" },
  ],
};
