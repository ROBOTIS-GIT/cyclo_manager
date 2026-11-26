import { API_BASE_URL, request } from "@/lib/api/client";

export type CameraView = "color" | "depth";
export type CameraStreamReading = {
  state: "starting" | "streaming" | "error";
  error: string | null;
  width?: number; height?: number; configured_fps?: number;
  fps: number | null; camera_fps: number | null; frames_received: number; last_frame_at: number | null;
};
export type CameraReading = CameraStreamReading & {
  id?: string; backend?: "realsense" | "zed"; view?: string;
  serial: string; name: string; usb: string;
  streams?: Partial<Record<CameraView, CameraStreamReading>>;
};
export type CameraSession = {
  id: string; state: string; started_at: number; revision: number; error: string | null;
  snapshot: { cameras: CameraReading[]; updated_at: number; discovery_errors?: string[] } | null;
};
export const cameraActive = (session: CameraSession | null) =>
  !!session && ["starting", "running", "stopping"].includes(session.state);
const base = (container: string) => `/${encodeURIComponent(container)}/diagnostics/cameras/sessions`;
export const cameraStreamUrl = (container: string, id: string, cameraId: string, view: CameraView = "color") =>
  `${API_BASE_URL}${base(container)}/${encodeURIComponent(id)}/cameras/${encodeURIComponent(cameraId)}/stream?view=${view}`;
export const getCameraSession = (container: string, signal?: AbortSignal) => request<{ session: CameraSession | null }>({
  url: `${base(container)}/current`, timeout: 5000, signal,
});
export const startCameraCheck = (container: string) => request<CameraSession>({
  method: "POST", url: base(container), timeout: 10000,
});
export const stopCameraCheck = (container: string, id: string) => request<CameraSession>({
  method: "POST", url: `${base(container)}/${encodeURIComponent(id)}/stop`, timeout: 10000,
});
