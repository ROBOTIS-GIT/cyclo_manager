import type { DiagnosticBus, DiagnosticDevice, Measurement } from "@/lib/diagnostics";

export type DeviceEntry = { key: string; device: DiagnosticDevice; bus: DiagnosticBus };
export type DeviceStatus = "ok" | "warning" | "error" | "communication" | "unknown" | "stale" | "pending";
export type Freshness = { live: boolean };
export type HandSide = "right" | "left";
export type HandGroup = { side: HandSide; controller: DeviceEntry; motors: DeviceEntry[] };

export function handGroupsFor(physical: DeviceEntry[], motors: DeviceEntry[]): HandGroup[] {
  return physical.flatMap(controller => {
    const match = /^hand_([rl])_controller$/.exec(controller.device.name);
    if (!controller.device.expected || !controller.device.sync_mapping || !match) return [];
    return [{ side: match[1] === "r" ? "right" as const : "left" as const, controller,
      motors: motors.filter(motor => motor.bus.real_port === controller.bus.real_port && motor.device.comm_id === controller.device.id) }];
  });
}

export function handStatus(hand: HandGroup, now: number, freshness: Freshness): DeviceStatus {
  const states = [hand.controller, ...hand.motors].map(entry => deviceStatus(entry.device, now, freshness, entry.bus));
  // An unverified controller or uninspected child must never imply a healthy hand.
  return (["error", "communication", "warning", "stale", "unknown", "pending"] as const).find(state => states.includes(state))
    ?? (hand.motors.length ? "ok" : "unknown");
}

export function handJointLabel(id: number, controllerId: number) {
  const offset = id - controllerId - 1;
  if (offset < 0 || offset >= 25) return `Hand DXL · ID ${id}`;
  const finger = ["Thumb", "Index", "Middle", "Ring", "Pinky"][Math.floor(offset / 5)];
  const joint = (offset < 5 ? ["CMC", "MCP yaw", "MCP pitch", "IP", "Tip"] : ["MCP roll", "MCP pitch", "PIP", "DIP", "Tip"])[offset % 5];
  return `${finger} · ${joint}`;
}
export const FRESHNESS_SECONDS = 3;

export function sampleIsStale(updatedAt: number | null | undefined, now: number, freshness: Freshness) {
  if (!freshness.live) return false;
  if (!updatedAt) return true;
  return now - updatedAt > FRESHNESS_SECONDS;
}
export const statusLabel: Record<DeviceStatus, string> = {
  ok: "Healthy", warning: "Warning", error: "Error", communication: "Communication Error", unknown: "Unknown", stale: "Stale data", pending: "Not checked",
};
export const statusSymbol: Record<DeviceStatus, string> = {
  ok: "✓", warning: "!", error: "!", communication: "!", unknown: "?", stale: "◷", pending: "·",
};
export function portFailureText(error?: string | null) {
  if (/No such file|Errno 2\b/i.test(error ?? "")) return "Port not found. Check the port path and USB connection.";
  if (/Permission denied|Errno 13\b/i.test(error ?? "")) return "Permission denied. Check device access permissions in the container.";
  if (/busy|locked|in use|another diagnostic/i.test(error ?? "")) return "The port is busy or locked. Check for other diagnostic sessions or processes using it.";
  return "Unable to open or maintain the port connection. Check power, USB, and port settings.";
}
export function deviceStatus(device: DiagnosticDevice, now: number, freshness: Freshness, bus?: DiagnosticBus): DeviceStatus {
  if (bus?.error || bus?.state === "error") return "communication";
  if (!device.state || device.state === "pending" || device.state === "not_checked") return "pending";
  if (device.state === "offline" || Object.values(device.fields ?? {}).some(field => field.status === "read_error")) return "communication";
  if (device.state === "online" && sampleIsStale(device.last_seen, now, freshness)) return "stale";
  if (device.health === "error" || device.health === "warning") return device.health;
  if (device.expected && ["sensor", "controller"].includes(device.kind) && device.state === "online") {
    if (device.packet_error & 0x80) return "error";
    if (["hx5_d20_rl", "hx5_d20_rr"].includes(device.model_name ?? "")) {
      const required = ["Hardware Error Status", "Status", "Present Input Voltage", "Min Voltage Limit", "Max Voltage Limit"].map(name => device.fields?.[name]);
      if (device.board_telemetry !== "supported" || required.some(field => !field || field.value === null)) return "unknown";
      if (required.some(field => sampleIsStale(field!.last_success, now, freshness))) return "stale";
      return device.health === "ok" ? "ok" : "unknown";
    }
    const code = device.fields?.Error_Code;
    if (device.board_telemetry !== "supported" || !code || code.raw === null || code.value === null) return "unknown";
    if (sampleIsStale(code.last_success, now, freshness)) return "stale";
    return code.raw === 0 ? "ok" : "error";
  }
  if (device.state !== "online" || device.health !== "ok") return "unknown";
  return "ok";
}
export function communicationIssue({ device, bus }: DeviceEntry) {
  if ((bus.error || bus.state === "error") && /No module named ['\"]serial['\"]/i.test(bus.error ?? "")) return {
    title: "Diagnostic dependency missing",
    message: "The Python serial package is missing from the diagnostic environment. Device health could not be checked.",
    raw: bus.error,
  };
  if (bus.error || bus.state === "error") return {
    title: "Port connection failed",
    message: `Port unavailable · ${bus.port}. ${portFailureText(bus.error)} Device health could not be checked.`,
    raw: bus.error,
  };
  const failed = Object.entries(device.fields ?? {}).filter(([, field]) => field.status === "read_error");
  if (failed.length) {
    // Motor reads identify the failed transaction; other readings are invalidated.
    // Board workers can invalidate every field with the same error, so do not
    // guess which register actually caused the failure in that case.
    const primary = failed.filter(([, field]) => field.message !== "Device read interrupted");
    const name = primary.length === 1 ? primary[0][0] : undefined;
    return {
      title: name ? `Read failed · ${name}` : "Register read failed",
      message: "Register values could not be read. Check the device connection and communication settings. Device health could not be checked.",
      raw: device.message || primary[0]?.[1].message,
    };
  }
  return {
    title: "No PING response",
    message: "No successful device response. Check power, cables, baud rate, and device ID.",
    raw: device.message,
  };
}
export function measurementText(field: Measurement | undefined, now: number, freshness: Freshness) {
  if (!field) return "Not measured";
  if (field.status === "read_error") return "Read failed";
  if (field.value === null) return "Not measured";
  if (sampleIsStale(field.last_success, now, freshness)) return "Stale data";
  return `${Number(field.value.toFixed(1))}${field.unit === "raw" ? "" : ` ${field.unit}`}`;
}
export function validMeasurement(field: Measurement, now: number, freshness: Freshness) {
  return field.value !== null && field.status !== "read_error" && !sampleIsStale(field.last_success, now, freshness);
}
export function canCalibrateTactile(entry: DeviceEntry | undefined, now: number, freshness: Freshness) {
  if (!entry || !freshness.live) return false;
  const { device, bus } = entry;
  return device.expected && device.kind === "tactile" && device.comm_id !== undefined
    && device.state === "online" && device.access === "direct" && [250, 253].includes(device.model_number ?? -1)
    && !["communication", "stale", "pending"].includes(deviceStatus(device, now, freshness, bus));
}
export function modelAssessment(device: DiagnosticDevice, now: number, freshness: Freshness, bus?: DiagnosticBus) {
  const status = deviceStatus(device, now, freshness, bus);
  if (device.state !== "online" || device.model_number === undefined || status === "stale" || status === "communication") {
    return { match: "Not checked", definition: "Not checked", detected: null };
  }
  const match = device.expected_model === undefined ? "Not configured"
    : device.expected_model === device.model_number ? "Match" : "Mismatch";
  const definition = device.model_definition === "available" ? "Available"
    : device.model_definition === "unavailable" ? "Unavailable"
    : device.model_name ? "Available" : "Not reported";
  return { match, definition, detected: device.model_number };
}
export function temperatureFields(device: DiagnosticDevice) {
  return Object.entries(device.fields ?? {}).filter(([name]) => name.startsWith("Present ") && name.includes("Temperature"));
}
export function temperatureLabel(name: string) {
  return name.includes("Inverter") ? "Inverter temperature" : name.includes("Motor") ? "Motor temperature" : "Temperature";
}
export const groupLabel: Record<string, string> = {
  right: "Right arm", left: "Left arm", head: "Head", lift: "Lift", base: "Base", sensor: "Sensors & boards", other: "Other devices",
};
const followerJointNames = ["", "Shoulder pitch", "Shoulder roll", "Shoulder yaw", "Elbow", "Wrist yaw", "Wrist pitch", "Wrist roll", "Gripper"];
// Schematic locations follow the reviewed AI Worker profile ID convention.
// Additional discoveries never inherit a physical location from their ID alone.
export function deviceLocation(device: DiagnosticDevice): { group: string; label: string; joint?: number; x?: number; y?: number } {
  if (!device.expected) return { group: "other", label: `Additional device · ID ${device.id}` };
  if (device.comm_id !== undefined) return { group: "other", label: device.kind === "tactile" ? handJointLabel(device.id, device.comm_id).replace("Tip", "Tactile sensor") : handJointLabel(device.id, device.comm_id) };
  if (/^hand_[rl]_controller$/.test(device.name)) return { group: "sensor", label: `${device.name.includes("_r_") ? "Right" : "Left"} hand controller` };
  if (device.kind === "dxl" && device.name === `dxl${device.id}` && /follower|leader/.test(device.system)) {
    const left = device.id >= 31 && device.id <= 38;
    const right = device.id >= 1 && device.id <= 8;
    if (left || right) {
      const joint = left ? device.id - 30 : device.id;
      const group = left ? "left" : "right";
      const jointName = device.system.includes("follower") ? followerJointNames[joint] : joint === 8 ? "Gripper" : `Joint ${joint}`;
      return { group, joint, label: `${groupLabel[group]} · ${jointName}`,
        x: left ? 72 : 28, y: [0, 20, 27, 36, 47, 58, 69, 78, 89][joint] };
    }
    if (device.id === 61 || device.id === 62) return { group: "head", label: `Head · ${device.id === 61 ? "Pitch" : "Yaw"}`, x: device.id === 61 ? 45 : 55, y: 10 };
    if (device.id === 81) return { group: "lift", label: "Lift", x: 50, y: 61 };
    if ([101, 103, 105].includes(device.id)) return { group: "base", label: `Base · ${device.id === 101 ? "Left" : device.id === 103 ? "Right" : "Rear"} wheel steering` };
  }
  if (device.name === "led") return { group: "sensor", label: "Status LED" };
  if (device.name === "imu") return { group: "sensor", label: "IMU sensor" };
  if (device.name.includes("rcu")) return { group: "base", label: "RCU board" };
  if (device.name.includes("sensorxel")) return { group: "sensor", label: device.name.includes("_l_") ? "Left joystick" : "Right joystick" };
  return { group: device.kind === "dxl" ? "other" : "sensor", label: device.name };
}
export function inspectionDevices(bus: DiagnosticBus, system: string) {
  const direct = bus.devices.filter(device => device.expected && (device.system === system || device.aliases?.some(alias => alias.startsWith(`${system}/`))));
  const hand = handEntriesFor([bus]).map(entry => entry.device).filter(device => device.system === system);
  return [...direct, ...hand];
}
export function inspectionCounts(bus: DiagnosticBus, system: string) {
  const devices = inspectionDevices(bus, system);
  return Object.entries({ dxl: "DXL", tactile: "tactile sensor", sensor: "sensor", controller: "controller" })
    .map(([kind, label]) => ({ label, count: devices.filter(device => device.kind === kind).length }))
    .filter(item => item.count).map(item => `${item.count} ${item.label}${item.label === "DXL" || item.count === 1 ? "" : "s"}`).join(" · ") || "No devices to check";
}
export function communicationLabel(system: string) {
  if (/_leader_left$/.test(system)) return "Left leader";
  if (/_leader_right$/.test(system)) return "Right leader";
  if (/_leader$/.test(system)) return "Leader DXL";
  if (/_base_steer$/.test(system)) return "Wheel steering";
  if (/_base$/.test(system)) return "Wheel drive";
  if (/_sensor$/.test(system)) return "Sensors & LEDs";
  if (/_follower$/.test(system)) return "DXL";
  return system;
}
export function communicationOrder(system: string) {
  if (/_follower$|_leader(?:_left|_right)?$/.test(system)) return 0;
  if (/_base(?:_steer)?$/.test(system)) return 1;
  if (/_sensor$/.test(system)) return 2;
  return 3;
}
export function entriesFor(buses: DiagnosticBus[] = []): DeviceEntry[] {
  return buses.flatMap(bus => bus.devices.map(device => ({ key: `${bus.real_port}:${device.id}`, device, bus })));
}
function isHandController(device: DiagnosticDevice) {
  return device.kind === "controller" && [device.name, ...(device.aliases ?? []).map(alias => alias.split("/").at(-1) ?? "")]
    .some(name => name === "hand_l_controller" || name === "hand_r_controller");
}
export function handEntriesFor(buses: DiagnosticBus[] = []): DeviceEntry[] {
  return buses.flatMap(bus => bus.devices.flatMap(parent => {
    // Hand controllers are the controllers configured with SyncTable mappings.
    if (!isHandController(parent) || !parent.sync_mapping) return [];
    const configured = bus.virtual_devices.filter(v => ["virtual_dxl", "virtual_sensor"].includes(v.kind) && v.comm_id === parent.id);
    return configured.map(v => {
      const reading = parent.hand?.devices.find(d => d.id === v.id && d.system === v.system);
      const device: DiagnosticDevice = reading ? { ...reading, comm_id: parent.id } : {
        id: v.id, name: v.name, system: v.system, kind: v.kind === "virtual_sensor" ? "tactile" : "dxl", expected: true, comm_id: parent.id,
        state: parent.state === "offline" ? "not_checked" : "pending",
        health: "unknown", fields: {}, last_seen: null, failures: 0, packet_error: 0,
        message: parent.state === "offline"
          ? Object.values(parent.fields ?? {}).some(field => field.status === "read_error")
            ? "Hand controller could not be read; device was not checked."
            : "Hand controller did not respond; device was not checked."
          : "Hand device not yet checked through its controller",
      };
      return { key: `${bus.real_port}:hand:${parent.id}:${v.system}:${v.id}`, device, bus };
    });
  }));
}
export function issueText(entry: DeviceEntry, now: number, freshness: Freshness) {
  const status = deviceStatus(entry.device, now, freshness, entry.bus);
  if (status === "communication") {
    const issue = communicationIssue(entry);
    return `${issue.title}. ${issue.message}`;
  }
  if (status === "stale") return "No recent data received. Check the connection.";
  if (entry.device.hand) return entry.device.message || "Hand health could not be fully verified.";
  if (entry.device.kind !== "dxl" && entry.device.state === "online") {
    if (entry.device.packet_error & 0x80) return entry.device.message || "Hardware alert reported";
    const code = entry.device.fields?.Error_Code;
    if (code && validMeasurement(code, now, freshness) && code.raw !== null && code.raw !== 0)
      return `Board error code · 0x${code.raw.toString(16).toUpperCase()}. Detailed code meaning is unavailable.`;
    if (status === "ok") return "No reported board error.";
  }
  if (entry.device.message === "Board registers collected; status semantics not verified") return "Board error code is unavailable for a health assessment.";
  if (entry.device.message === "Board register layout unavailable; identification only") return "Only response and identity were checked because the board model or register layout is unsupported.";
  if (entry.device.message) return entry.device.message;
  if (entry.device.state === "offline") return "No PING response. Check power, cables, port, and device ID.";
  const failed = Object.entries(entry.device.fields ?? {}).find(([, f]) => ["error", "warning", "read_error", "unknown"].includes(f.status));
  if (failed) return `${failed[0]} · ${failed[1].message || "Reading needs attention"}`;
  if (status === "pending") return "Start a check to read device responses and status.";
  if (entry.device.kind !== "dxl") return "This device is checked for PING response and model identity only.";
  return status === "ok" ? "No issues found in the collected diagnostic readings." : "Some diagnostic readings are unsupported or unavailable.";
}
