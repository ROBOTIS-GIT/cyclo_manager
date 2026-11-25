import { request } from "@/lib/api/client";

export type Measurement = {
  value: number | null; raw: number | null; unit: string; last_success: number | null;
  status: string; message: string; failures: number;
};
export type DiagnosticDevice = {
  id: number; name: string; system: string; kind: string; expected: boolean; aliases?: string[];
  comm_id?: number;
  sync_mapping?: Record<string, number>;
  state: string; health: string; model_number?: number; model_name?: string | null; expected_model?: number;
  model_definition?: "available" | "unavailable";
  fields: Record<string, Measurement>; last_seen: number | null; failures: number;
  message: string | null; packet_error: number;
  access?: "unavailable" | "direct_probe" | "direct" | "sync_table";
  hand?: {
    mode: "unknown" | "sync_disabled" | "sync_table";
    message: string | null;
    devices: DiagnosticDevice[];
  };
  board_telemetry?: "supported" | "unsupported" | "incompatible";
  board_skipped_fields?: { name: string; reason: "missing" | "duplicate" | "invalid_layout" }[];
  sample_activity?: { raw: number; observed_at: number; last_change: number; state: "observing" | "changed" | "unchanged" };
};
export type DiagnosticBus = {
  port: string; real_port: string; baud_rate: number; systems: string[];
  state?: string; error?: string | null; discovery_error?: string | null;
  devices: DiagnosticDevice[];
  virtual_devices: { id: number; name: string; system: string; kind: string; comm_id: number; reason: string }[];
};
export type DiagnosticConfiguration = {
  profile: string; label: string;
  description: string; buses: DiagnosticBus[];
  excluded: { system: string; name?: string; reason: string }[];
};
export type DiagnosticSnapshot = DiagnosticConfiguration & {
  state: string; health: string; sequence: number; updated_at: number;
  summary: { expected: number; responding: number; additional: number; errors: number; unknown: number; excluded: number };
};
export type DiagnosticSession = {
  id: string; profile: string; state: string; health: string;
  started_at: number; finished_at?: number; revision: number;
  snapshot: DiagnosticSnapshot | null; error: string | null; stderr: string[];
};
export type TactileCalibration = {
  state: "sent" | "failed" | "unconfirmed"; message: string;
};
export type DiagnosticProfile = { id: string; label: string; available: boolean; reason: string | null };
export const diagnosticActive = (session: DiagnosticSession | null) =>
  !!session && ["starting", "running", "stopping"].includes(session.state);
export function acceptSession(previous: DiagnosticSession | null, next: DiagnosticSession | null) {
  if (!next) return null;
  if (previous?.id === next.id && previous.revision > next.revision) return previous;
  if (previous && previous.id !== next.id && previous.started_at > next.started_at) return previous;
  return next;
}
const base = (container: string) => `/${encodeURIComponent(container)}/diagnostics`;
export const getDiagnosticProfiles = (container: string) => request<{ profiles: DiagnosticProfile[] }>({
  url: `${base(container)}/profiles`, timeout: 45000,
});
export const inspectDiagnosticProfile = (container: string, profile: string, signal?: AbortSignal) => request<DiagnosticConfiguration>({
  url: `${base(container)}/profiles/${encodeURIComponent(profile)}`, timeout: 45000, signal,
});
export const getDiagnosticSession = (container: string, signal?: AbortSignal) => request<{ session: DiagnosticSession | null }>({
  url: `${base(container)}/sessions/current`, timeout: 5000, signal,
});
export const startDiagnostic = (container: string, profile: string, ports: Record<string, string>, baud_rates: Record<string, number> = {}) => request<DiagnosticSession>({
  method: "POST", url: `${base(container)}/sessions`, data: { profile, ports, baud_rates }, timeout: 10000,
});
export const stopDiagnostic = (container: string, id: string) => request<DiagnosticSession>({
  method: "POST", url: `${base(container)}/sessions/${encodeURIComponent(id)}/stop`, timeout: 10000,
});
export const calibrateTactile = (container: string, id: string, system: string, controller_id: number, device_id: number) => request<TactileCalibration>({
  method: "POST", url: `${base(container)}/sessions/${encodeURIComponent(id)}/calibrate-tactile`,
  data: { system, controller_id, device_id }, timeout: 45000,
});
export const clearMultiTurn = (container: string, id: string, system: string, device_id: number) => request<TactileCalibration>({
  method: "POST", url: `${base(container)}/sessions/${encodeURIComponent(id)}/clear-multi-turn`,
  data: { system, device_id }, timeout: 45000,
});
