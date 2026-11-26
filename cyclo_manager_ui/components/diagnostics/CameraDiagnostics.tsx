"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { cameraActive, cameraStreamUrl, getCameraSession, startCameraCheck, stopCameraCheck, type CameraStreamReading, type CameraSession, type CameraView } from "@/lib/cameraDiagnostics";
import styles from "./diagnostics.module.css";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function CameraDiagnostics({ container, visible, viewerReady, bringupBlocked, checkBringup }: {
  container: string; visible: boolean; viewerReady: boolean; bringupBlocked: string; checkBringup: () => Promise<string>;
}) {
  const [session, setSession] = useState<CameraSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ sessionId: string; cameraId: string } | null>(null);
  const [streamFailure, setStreamFailure] = useState<{ key: string; retryAt: number } | null>(null);
  const [streamView, setStreamView] = useState<CameraView>("color");
  const [now, setNow] = useState(Date.now() / 1000);
  const active = cameraActive(session);
  function receive(next: CameraSession | null) {
    setSession(previous => {
      if (previous && next && (previous.id === next.id ? previous.revision > next.revision : previous.started_at > next.started_at)) return previous;
      return next && !cameraActive(next) ? { ...next, snapshot: null } : next;
    });
  }
  usePolling(async (isActive, signal) => {
    try {
      const result = await getCameraSession(container, signal);
      if (isActive()) { receive(result.session); setConnectionError(null); }
    } catch (e) { if (isActive()) setConnectionError(errorText(e)); }
  }, 1000, { enabled: visible, resetKey: container, skipIfRunning: true });
  usePolling(() => setNow(Date.now() / 1000), 1000, { enabled: visible });

  async function toggle() {
    setBusy(true); setError(null);
    try {
      if (active && session) receive(await stopCameraCheck(container, session.id));
      else {
        const reason = await checkBringup();
        if (reason) { setError(reason); return; }
        receive(await startCameraCheck(container));
      }
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const cameras = active ? session?.snapshot?.cameras ?? [] : [];
  const stale = !!connectionError || (!!session?.snapshot && now - session.snapshot.updated_at > 5);
  const issue = error || connectionError || session?.error || (active ? session?.snapshot?.discovery_errors?.join(" ") : null);
  const emptyMessage = issue
    ? /^(No RealSense cameras detected|No cameras detected\.)/.test(issue) && !session?.snapshot?.discovery_errors?.length ? "No cameras detected" : issue
    : !active && bringupBlocked ? bringupBlocked
    : active || busy ? "Finding cameras…" : "No cameras detected";
  const selected = (selection?.sessionId === session?.id ? cameras.find(camera => (camera.id ?? camera.serial) === selection?.cameraId) : undefined) ?? cameras[0];
  function cameraStatus(camera: CameraStreamReading) {
    const delayed = camera.state === "streaming" && (!camera.last_frame_at || now - camera.last_frame_at >= 5);
    return {
      status: stale || delayed ? "warning" : camera.state === "streaming" ? "ok" : camera.state === "error" ? "communication" : "pending",
      label: stale ? "Connection lost" : delayed ? "No frames" : camera.state === "streaming" ? "Streaming" : camera.state === "error" ? "Stream error" : "Connecting…",
      message: stale ? "Waiting for the agent connection" : camera.error || (delayed ? "Waiting for new frames" : "Waiting for frames…"),
    };
  }
  const selectedReading = selected?.streams?.[streamView] ?? (streamView === "color" ? selected : undefined);
  const selectedStatus = selectedReading ? cameraStatus(selectedReading) : null;
  const streamKey = `${session?.id}:${selected?.id ?? selected?.serial}:${streamView}`;
  const streamFailed = streamFailure?.key === streamKey && now < streamFailure.retryAt;

  return <>
    <div className={styles.cameraToolbar}>
      <button className={active ? styles.stopButton : styles.primaryButton} onClick={toggle}
        title={!active && !viewerReady ? "Waiting for the diagnostics page connection" : undefined}
        disabled={busy || session?.state === "stopping" || (!active && (!viewerReady || !!bringupBlocked))}>
        {busy ? active ? "Stopping…" : "Connecting…" : active ? "■ Stop check" : "▷ Start check"}
      </button>
    </div>
    {!!cameras.length && issue && <div className={styles.alert} role="alert">{issue}</div>}
    <section className={styles.cameraSelection} aria-label="Detected cameras">
      {!cameras.length ? <div className={styles.cameraEmpty} role={issue ? "alert" : "status"}>{emptyMessage}</div>
      : <div className={styles.cameraChoices} role="group" aria-label="Select camera">
        {cameras.map(camera => {
          const { status, label } = cameraStatus(camera);
          return <button type="button" key={camera.id || camera.serial || camera.name} aria-pressed={camera === selected}
            aria-controls="camera-stream-preview" onClick={() => setSelection({ sessionId: session!.id, cameraId: camera.id ?? camera.serial })}>
            <strong>{camera.name || "Camera"}</strong>
            <span className={styles.cameraSerial}>Serial {camera.serial || "Unavailable"}</span>
            <span className={styles.cameraStatus} data-status={status}><i aria-hidden="true"/>{label}</span>
          </button>;
        })}
      </div>}
    </section>
    <article id="camera-stream-preview" className={styles.cameraCard} aria-label="Selected camera stream">
      <header><div className={styles.cameraStreamHeading}>
        <strong>{selected?.name || "Camera stream"}</strong>
        <div className={styles.viewSwitch} role="group" aria-label="Stream type">
          <button type="button" aria-pressed={streamView === "color"} onClick={() => setStreamView("color")}>Color</button>
          <button type="button" aria-pressed={streamView === "depth"} disabled={!selected?.streams?.depth} onClick={() => setStreamView("depth")}>Depth</button>
        </div>
      </div>
        <div className={styles.cameraStreamStatus}>
          {selectedReading && selectedStatus?.status === "ok" && <span className={styles.cameraFps}>
            Camera {selectedReading.camera_fps == null ? "—" : selectedReading.camera_fps} fps · Received {selectedReading.fps == null ? "—" : selectedReading.fps} fps
          </span>}
          {selectedStatus && <span className={styles.cameraStatus} data-status={selectedStatus.status}><i aria-hidden="true"/>{selectedStatus.label}</span>}
        </div>
      </header>
      <div className={styles.cameraPreview}>
        {visible && selected && session && selectedStatus?.status === "ok" && !streamFailed
          // A persistent MJPEG connection receives frames independently of status polling.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={streamKey} src={cameraStreamUrl(container, session.id, selected.id ?? selected.serial, streamView)} alt={`${selected.name} · ${selected.serial} live ${streamView} stream`}
            onError={() => setStreamFailure({ key: streamKey, retryAt: Date.now() / 1000 + 2 })}/>
          : <span role={selectedStatus?.status === "communication" ? "alert" : undefined}>
            {streamFailed ? "Reconnecting to the video stream…" : selectedStatus?.message || selected?.error || (active ? "Waiting for a camera stream…" : "Start a check to view the camera stream.")}
          </span>}
      </div>
      {selected && <footer><span>Serial <b>{selected.serial || "Unavailable"}</b></span>
        {selected.usb && <span>USB <b>{selected.usb}</b></span>}
        {selectedReading?.width && <span>{selectedReading.width} × {selectedReading.height}</span>}
        {streamView === "color" && selected.view && <span>{selected.view}</span>}
        {selectedReading?.configured_fps != null && <span>Configured {selectedReading.configured_fps} fps</span>}
      </footer>}
    </article>
  </>;
}
