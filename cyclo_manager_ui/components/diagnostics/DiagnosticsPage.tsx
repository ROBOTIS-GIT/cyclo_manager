"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  acceptSession, diagnosticActive, getDiagnosticProfiles,
  calibrateTactile, clearMultiTurn, getDiagnosticSession, inspectDiagnosticProfile, startDiagnostic, stopDiagnostic,
  type DiagnosticConfiguration, type DiagnosticProfile,
  type DiagnosticSession, type TactileCalibration,
} from "@/lib/diagnostics";
import { getServiceStatus } from "@/lib/api/services";
import { getSystemProfile } from "@/config/systemProfiles";
import { usePolling } from "@/hooks/usePolling";
import { getWebSocketBaseUrl, maintainWebSocket, parseWebSocketMessage } from "@/lib/websocketUtils";
import RobotMap from "./RobotMap";
import HandMap from "./HandMap";
import DeviceDetails from "./DeviceDetails";
import InspectionScope from "./InspectionScope";
import ConnectionDevices from "./ConnectionDevices";
import { canCalibrateTactile, handGroupsFor, handStatus, type HandSide, communicationOrder, inspectionCounts, deviceLocation, deviceStatus, entriesFor, handEntriesFor, FRESHNESS_SECONDS, groupLabel, statusLabel, statusSymbol, type Freshness } from "./diagnosticView";
import styles from "./diagnostics.module.css";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function CalibrationModal({ result, label, action, onClose }: { result: TactileCalibration; label: string; action: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const title = result.state === "failed" ? `${action} failed` : `${action} result unconfirmed`;
  return <dialog ref={dialog} className={styles.calibrationModal} aria-labelledby="calibration-title" onClose={onClose}>
    <h2 id="calibration-title">{title}</h2>
    <p className={styles.calibrationDevice}>{label}</p>
    <p>{result.message}</p>
    <button type="button" autoFocus onClick={() => dialog.current?.close()}>Close</button>
  </dialog>;
}

export default function DiagnosticsPage({ container }: { container: string }) {
  const [profiles, setProfiles] = useState<DiagnosticProfile[]>([]);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [profile, setProfile] = useState("w1");
  const [preview, setPreview] = useState<DiagnosticConfiguration | null>(null);
  const [ports, setPorts] = useState<Record<string, string>>({});
  const [baudRates, setBaudRates] = useState<Record<string, string>>({});
  const [editingPorts, setEditingPorts] = useState<Record<string, boolean>>({});
  const [session, setSession] = useState<DiagnosticSession | null>(null);
  const latestSession = useRef<DiagnosticSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [bringupBlocked, setBringupBlocked] = useState("Checking bringup status…");
  const [busy, setBusy] = useState(false);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState<{ label: string; action: string; result: TactileCalibration } | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [selection, setSelection] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  const [mapPart, setMapPart] = useState<"robot" | HandSide>("robot");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLElement>(null);
  const active = diagnosticActive(session);
  const id = session?.id;
  const supported = container === "ai_worker";

  const receiveSession = useCallback((next: DiagnosticSession | null) => {
    const previous = latestSession.current;
    const accepted = acceptSession(previous, next);
    if (accepted === previous) return;
    // Keep revision metadata to reject late live updates after stop, without
    // retaining completed measurements or logs in the page's state.
    const current = accepted && !diagnosticActive(accepted)
      ? { ...accepted, snapshot: null, stderr: [], error: accepted.state === "failed" ? accepted.error : null }
      : accepted;
    latestSession.current = current;
    setSession(current);
    if (current && diagnosticActive(current)) {
      setProfile(current.profile);
      if (current.snapshot && (!previous?.snapshot || previous.id !== current.id)) {
        setPorts(Object.fromEntries(current.snapshot.buses.flatMap(bus => bus.systems.map(system => [system, bus.port]))));
        setBaudRates(Object.fromEntries(current.snapshot.buses.flatMap(bus => bus.systems.map(system => [system, String(bus.baud_rate)]))));
      }
    } else if (diagnosticActive(previous)) {
      setSelection(""); setFilter("all"); setQuery("");
    }
  }, []);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    getDiagnosticProfiles(container).then(result => {
      if (cancelled) return;
      setProfiles(result.profiles);
    }).catch(e => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [container, supported, connectionAttempt]);

  useEffect(() => {
    if (!profiles.some(p => p.id === profile && p.available)) return;
    const controller = new AbortController();
    inspectDiagnosticProfile(container, profile, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPreview(result);
      setPorts(previous => Object.fromEntries(result.buses.flatMap(bus => bus.systems.map(system => [system, previous[system] ?? bus.port]))));
      setPreviewError(null);
    }).catch(e => { if (!controller.signal.aborted) { setPreview(null); setPreviewError(errorText(e)); } });
    return () => controller.abort();
  }, [container, profile, profiles]);

  usePolling(async (isActive, signal) => {
    try {
      const result = await getDiagnosticSession(container, signal);
      if (!isActive()) return;
      receiveSession(result.session);
    } catch (e) { if (isActive()) setError(errorText(e)); }
  }, 3000, { enabled: supported, resetKey: container, skipIfRunning: true });

  async function checkBringup() {
    const system = getSystemProfile(container);
    if (!system) throw new Error("Unsupported container");
    const names = [system.robotServiceName, system.leaderServiceName].filter((n): n is string => !!n);
    const results = await Promise.all(names.map(name => getServiceStatus(container, name)));
    return results.some(result => result.is_up) ? "Stop robot and leader bringup in System before starting a check." : "";
  }
  usePolling(async isActive => {
    try { const reason = await checkBringup(); if (isActive()) setBringupBlocked(reason); }
    catch { if (isActive()) setBringupBlocked("Unable to verify bringup status. Check the agent connection."); }
  }, 2000, { enabled: supported, resetKey: container, skipIfRunning: true });
  usePolling(() => { setNow(Date.now() / 1000); }, 1000);

  useEffect(() => {
    if (!id || !active) return;
    return maintainWebSocket(() => {
      const ws = new WebSocket(`${getWebSocketBaseUrl()}/ws/${encodeURIComponent(container)}/diagnostics/${encodeURIComponent(id)}`);
      ws.onmessage = event => {
        try {
          const message = parseWebSocketMessage(event);
          if (message.type === "snapshot") {
            const next = message.data as DiagnosticSession;
            if (next.id !== id) throw new Error("Incompatible diagnostic result");
            receiveSession(next);
          }
        } catch (e) { setError(errorText(e)); }
      };
      return ws;
    });
  }, [container, id, active, receiveSession]);

  async function start() {
    setBusy(true); setError(null);
    try {
      const rates = Object.fromEntries(Object.entries(baudRates).map(([system, value]) => {
        const rate = Number(value);
        if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(rate) || rate <= 0) throw new Error("Enter a positive whole number for the baud rate.");
        return [system, rate];
      }));
      const reason = await checkBringup();
      setBringupBlocked(reason);
      if (reason) return;
      const next = await startDiagnostic(container, profile, ports, rates);
      setEditingPorts({});
      receiveSession(next);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!id) return;
    setBusy(true); setError(null);
    try {
      const next = await stopDiagnostic(container, id);
      receiveSession(next);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  if (!supported) return <p>Diagnostics are available for the AI Worker container. <Link href="/ai_worker/diagnostics">Open AI Worker diagnostics</Link></p>;
  const selectedProfile = active && session ? session.profile : profile;
  const profileInfo = profiles.find(item => item.id === selectedProfile);
  const unavailableReason = profileInfo && !profileInfo.available ? profileInfo.reason : null;
  const profileError = profileInfo && !profileInfo.available
    ? unavailableReason?.endsWith(".xacro")
      ? `Xacro file not found: ${unavailableReason}`
      : `Unable to load robot configuration: ${unavailableReason || "Robot description is unavailable."}`
    : null;
  const displayedSnapshot = active ? session?.snapshot : null;
  const freshness: Freshness = { live: active };
  const configuration = displayedSnapshot ?? (preview?.profile === selectedProfile ? preview : null);
  const settingsConfiguration = active ? configuration : preview?.profile === selectedProfile ? preview : null;
  const physicalEntries = entriesFor(configuration?.buses);
  const handEntries = handEntriesFor(configuration?.buses);
  const entries = [...physicalEntries, ...handEntries];
  const hands = ["sh5", "bh5"].includes(selectedProfile) ? handGroupsFor(physicalEntries, handEntries) : [];
  const activeHand = hands.find(hand => hand.side === mapPart);
  const mapEntries = activeHand ? [activeHand.controller, ...activeHand.motors]
    : physicalEntries.filter(entry => !hands.some(hand => hand.controller.key === entry.key));
  const selectionEntries = view === "map" ? mapEntries : entries;
  const selectedEntry = selectionEntries.find(e => e.key === selection) ?? selectionEntries[0];
  const calibrationEnabled = canCalibrateTactile(selectedEntry, now, freshness);
  async function calibrateSelected() {
    if (!id || !selectedEntry || !calibrationEnabled || calibrationBusy) return;
    const device = selectedEntry.device;
    if (device.comm_id === undefined) return;
    const label = `${deviceLocation(device).label} · ID ${device.id}`;
    setCalibrationBusy(true); setCalibrationResult(null); setError(null);
    try {
      const result = await calibrateTactile(container, id, device.system, device.comm_id, device.id);
      if (result.state !== "sent") setCalibrationResult({ label, action: "Calibration", result });
    } catch (e) {
      setCalibrationResult({ label, action: "Calibration", result: { state: "unconfirmed", message: errorText(e) } });
    }
    finally { setCalibrationBusy(false); }
  }
  const clearEnabled = !!selectedEntry && active && selectedEntry.bus.state === "open"
    && selectedEntry.device.expected && selectedEntry.device.kind === "dxl"
    && selectedEntry.device.state === "online" && !!selectedEntry.device.model_name?.toLowerCase().startsWith("ym")
    && !["stale", "communication", "pending"].includes(deviceStatus(selectedEntry.device, now, freshness, selectedEntry.bus));
  async function clearSelected() {
    if (!id || !selectedEntry || !clearEnabled || clearBusy) return;
    const device = selectedEntry.device;
    const label = `${deviceLocation(device).label} · ID ${device.id}`;
    setClearBusy(true); setCalibrationResult(null);
    try {
      const result = await clearMultiTurn(container, id, device.system, device.id);
      if (result.state !== "sent") setCalibrationResult({ label, action: "Multi-turn clear", result });
    } catch (e) {
      setCalibrationResult({ label, action: "Multi-turn clear", result: { state: "unconfirmed", message: errorText(e) } });
    } finally { setClearBusy(false); }
  }
  const expected = entries.filter(e => e.device.expected);
  const attention = entries.filter(e => !["ok", "pending"].includes(deviceStatus(e.device, now, freshness, e.bus)));
  const busErrors = configuration?.buses.filter(b => b.error || b.state === "error") ?? [];
  const hasResult = !!displayedSnapshot;
  const stale = active && !!displayedSnapshot && now - displayedSnapshot.updated_at > FRESHNESS_SECONDS;
  const responding = expected.filter(e => e.device.state === "online" && !["stale", "communication"].includes(deviceStatus(e.device, now, freshness, e.bus))).length;
  const failed = session?.profile === selectedProfile && session.state === "failed";
  const runLabel = active ? session?.state === "stopping" ? "Stopping…" : stale ? "Stale data" : hasResult ? "Checking" : "Connecting…"
    : failed ? "Check failed" : "Not started";
  const visibleEntries = entries.filter(entry => {
    const location = deviceLocation(entry.device);
    const matchesFilter = filter === "all" || (filter === "attention" ? attention.includes(entry) : location.group === filter);
    const text = `${location.label} ${entry.device.id} ${entry.device.name} ${entry.device.model_name ?? ""} ${entry.bus.port}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  });
  function selectDevice(key: string) {
    setSelection(key);
    if (detailRef.current && visualRef.current && detailRef.current.offsetTop > visualRef.current.offsetTop + 100) {
      detailRef.current.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    }
  }
  function selectMapPart(part: "robot" | HandSide) {
    setMapPart(part); setView("map");
    const hand = hands.find(item => item.side === part);
    setSelection(hand?.controller.key ?? physicalEntries[0]?.key ?? "");
  }
  function showAttention() { setFilter("attention"); setQuery(""); setView("list"); }

  const robotStates = physicalEntries
    .filter(entry => !hands.some(hand => hand.controller.key === entry.key))
    .map(entry => deviceStatus(entry.device, now, freshness, entry.bus));
  const robotIssue = hasResult ? (["error", "communication", "warning", "stale", "unknown"] as const)
    .find(state => robotStates.includes(state)) : undefined;
  const mapNavigation = !!hands.length && <div className={styles.mapTabs} role="group" aria-label="Robot region">
    <button aria-pressed={!activeHand} onClick={() => selectMapPart("robot")}>
      Robot
      {robotIssue && <i className={styles.mapTabIssue} data-status={robotIssue} aria-label={statusLabel[robotIssue]} title={statusLabel[robotIssue]}>{statusSymbol[robotIssue]}</i>}
    </button>
    {(["right", "left"] as const).map(side => {
      const hand = hands.find(item => item.side === side);
      if (!hand) return null;
      const state = handStatus(hand, now, freshness);
      const hasIssue = hasResult && state !== "ok" && state !== "pending";
      return <button key={side} aria-pressed={activeHand?.side === side} onClick={() => selectMapPart(side)}>
        {side === "right" ? "Right hand" : "Left hand"}
        {hasIssue && <i className={styles.mapTabIssue} data-status={state} aria-label={statusLabel[state]} title={statusLabel[state]}>{statusSymbol[state]}</i>}
      </button>;
    })}
  </div>;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <h1>Diagnostics</h1>
    </header>

    <section className={styles.toolbar} aria-label="Check settings">
      <InspectionScope configuration={settingsConfiguration} robotSelector={
      <><label className={styles.modelSelect}>
        <select aria-label="Type" value={selectedProfile} disabled={active || busy || !profiles.length} onChange={e => {
          setProfile(e.target.value); setMapPart("robot"); setPreview(null); setPreviewError(null); setPorts({}); setBaudRates({}); setEditingPorts({}); setSelection(""); setFilter("all"); setQuery("");
        }}>
          {!profiles.length && <option value="w1">Loading profiles…</option>}
          {profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      </>
      } communication={
      <div className={styles.topPortSettings} tabIndex={-1} aria-label="Port settings">
        <div className={styles.topPortGrid}>
          {settingsConfiguration?.buses.flatMap(bus => bus.systems.map(system => ({ bus, system }))).sort((a, b) => communicationOrder(a.system) - communicationOrder(b.system)).map(({ bus, system }) => {
            const value = active ? bus.port : ports[system] ?? bus.port;
            const originalBus = preview?.profile === selectedProfile ? preview.buses.find(item => item.systems.includes(system)) : undefined;
            const original = originalBus?.port;
            const baud = active ? String(bus.baud_rate) : baudRates[system] ?? String(bus.baud_rate);
            const invalidBaud = !/^[0-9]+$/.test(baud) || !Number.isSafeInteger(Number(baud)) || Number(baud) <= 0;
            const changed = originalBus !== undefined && (value !== originalBus.port || Number(baud) !== originalBus.baud_rate);
            const editing = !!editingPorts[system] && !active;
            return <div className={styles.portInput} key={`${bus.real_port}:${system}`}>
              <div className={styles.portControl} data-editing={editing}>
                <span className={styles.inspectionCounts} title="Devices configured in Xacro">{inspectionCounts(bus, system)}</span>
                {editing ? <label className={styles.communicationField}><input title="Port" placeholder="Port" autoFocus aria-label={`${system} Port`} value={value} disabled={busy} onChange={e => setPorts(p => ({ ...p, [system]: e.target.value }))}/></label>
                  : <div className={styles.portDisplay}><span title={value}>{value || "Not set"}</span></div>}
                {editing ? <label className={styles.baudField}><input title="Baud rate (bps)" placeholder="Baud rate" aria-label={`${system} Baud rate`} inputMode="numeric" aria-invalid={invalidBaud} value={baud} disabled={busy} onChange={e => setBaudRates(p => ({ ...p, [system]: e.target.value }))}/><span>bps</span></label>
                  : <span className={styles.portBaud} aria-label="Baud rate">{Number(baud) >= 1_000_000 ? `${Number(baud) / 1_000_000} Mbps` : `${Number(baud) / 1000} kbps`}</span>}
                <div className={styles.communicationActions}><button className={styles.portEditButton} aria-label={`${system} Port ${editing ? "Finish editing" : "Change"}`} disabled={active || busy || (editing && invalidBaud)} title={active ? "Stop the check to change connection settings" : undefined} onClick={() => setEditingPorts(p => ({ ...p, [system]: !editing }))}>{editing ? "Done" : "Change"}</button>
                <ConnectionDevices key={`${selectedProfile}:${system}`} bus={bus} system={system}/>
                {changed && !active && <button className={styles.portEditButton} disabled={busy} onClick={() => { setPorts(p => ({ ...p, [system]: original! })); setBaudRates(p => ({ ...p, [system]: String(originalBus!.baud_rate) })); setEditingPorts(p => ({ ...p, [system]: false })); }}>Reset defaults</button>}</div>
              </div>
              {editing && invalidBaud && <small className={styles.portOverrideNote} role="alert">Enter a positive whole number for the baud rate.</small>}
            </div>;
          })}
        </div>
        {!settingsConfiguration && !profileError && !previewError && <span className={styles.infoNote}>Loading ports…</span>}
      </div>
      } actions={
      <div className={styles.toolbarActions}>
        {active ? <button className={styles.stopButton} onClick={stop} disabled={busy || session?.state === "stopping"}>■ {busy || session?.state === "stopping" ? "Stopping…" : "Stop check"}</button>
          : <button className={styles.primaryButton} onClick={start} disabled={busy || !!bringupBlocked || !preview || preview.profile !== profile}>▷ {busy ? "Connecting…" : "Start check"}</button>}
      </div>
      }/>
    </section>
    {!active && bringupBlocked && <p className={styles.infoNote}>{bringupBlocked}</p>}
    {profileError && <div className={styles.alert} role="alert">{profileError}<button onClick={() => setConnectionAttempt(v => v + 1)}>Retry</button></div>}
    {(error || previewError) && <div className={styles.alert} role="alert">{error || previewError}<button onClick={() => { setError(null); setPreviewError(null); setConnectionAttempt(v => v + 1); }}>Reconnect</button>{error && <button onClick={() => setError(null)}>Dismiss</button>}</div>}
    {session?.profile === selectedProfile && session.error && <div className={styles.alert} role="alert">{session.error}</div>}
    <div className={styles.workspace}>
      <section ref={visualRef} className={styles.visualPanel} aria-label="Device status">
        <div className={styles.panelHeader}>
          <div className={styles.inspectionStatus} aria-label="Check status">
            <span className={styles.runState} data-status={failed ? "error" : stale ? "warning" : "pending"} data-live={active && !stale}>{runLabel}</span>
            {hasResult && <>
              <span>Responding {responding}/{expected.length}</span>
              <button onClick={showAttention} data-status={attention.length || busErrors.length ? "warning" : "ok"} title="Show only devices needing attention">Needs attention {attention.length} <span aria-hidden="true">↗</span></button>
            </>}
          </div>
          <div className={styles.viewSwitch} aria-label="View mode"><button aria-pressed={view === "map"} onClick={() => setView("map")}>Robot map</button><button aria-pressed={view === "list"} onClick={() => setView("list")}>Device list</button></div>
        </div>
        <div className={styles.legend}>{(["ok", "warning", "error", "communication", "unknown", "pending"] as const).map(state => <span key={state}><i data-status={state}>{statusSymbol[state]}</i>{statusLabel[state]}</span>)}</div>
        {!configuration ? <div className={styles.emptyDetail}><span>◎</span><p>{profileError || previewError ? "Unable to load the devices to check." : "Loading devices…"}</p></div>
          : view === "map" ? activeHand
            ? <HandMap navigation={mapNavigation} hand={activeHand} selected={selectedEntry?.key} onSelect={selectDevice} now={now} freshness={freshness}/>
            : <RobotMap navigation={mapNavigation} entries={physicalEntries} profile={selectedProfile} selected={selectedEntry?.key} onSelect={selectDevice} now={now} freshness={freshness} hands={hands} onSelectHand={selectMapPart}/>
          : <div className={styles.listView}>
            <div className={styles.listTools}><input aria-label="Search devices" placeholder="Search by name, ID, or model" value={query} onChange={e => setQuery(e.target.value)}/>
              <select aria-label="Filter devices" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All devices ({entries.length})</option><option value="attention">Needs attention ({attention.length})</option>
                {Object.entries(groupLabel).filter(([group]) => entries.some(e => deviceLocation(e.device).group === group)).map(([group, label]) => <option value={group} key={group}>{label}</option>)}
              </select></div>
            <div className={styles.deviceList}>{Object.entries(groupLabel).map(([group, label]) => {
              const devices = visibleEntries.filter(entry => deviceLocation(entry.device).group === group)
                .sort((a, b) => a.device.id - b.device.id);
              if (!devices.length) return null;
              return <section className={styles.deviceGroup} key={group} aria-label={label}>
                <h3>{label}<span>{devices.length}</span></h3>
                <div className={styles.deviceCardGrid}>{devices.map(entry => {
                  const location = deviceLocation(entry.device);
                  const name = location.label.startsWith(`${label} · `) ? location.label.slice(label.length + 3) : location.label;
                  const state = deviceStatus(entry.device, now, freshness, entry.bus);
                  return <button key={entry.key} className={styles.deviceListItem} data-selected={entry.key === selectedEntry?.key}
                    aria-label={`${location.label}, ID ${entry.device.id}, ${statusLabel[state]}`} aria-pressed={entry.key === selectedEntry?.key}
                    onClick={() => selectDevice(entry.key)}>
                    <span className={styles.deviceCardTop}><span className={styles.deviceCardId}>ID {entry.device.id}</span>
                      <span className={styles.deviceCardStatus} data-status={state}><i aria-hidden="true">{statusSymbol[state]}</i>{statusLabel[state]}</span>
                    </span>
                    <strong className={styles.deviceCardName}>{name}</strong>
                  </button>;
                })}</div>
              </section>;
            })}</div>
            {!visibleEntries.length && <div className={styles.emptyList}>{filter === "attention" ? busErrors.length ? "Some devices could not be checked because their port failed. Select a device to see the connection error." : hasResult ? "No devices need attention." : "Start a check to see devices that need attention." : "No devices match your search."}</div>}
          </div>}
      </section>
      <aside ref={detailRef} className={styles.detailPanel} aria-label="Selected device details" tabIndex={-1}>
        <button className={styles.backToMap} onClick={() => visualRef.current?.scrollIntoView({ block: "start" })}>← Back to {view === "map" ? "robot map" : "device list"}</button>
        <DeviceDetails entry={selectedEntry} now={now} freshness={freshness} onCalibrate={calibrateSelected}
          calibrationEnabled={calibrationEnabled} calibrationBusy={calibrationBusy} onClearMultiTurn={clearSelected}
          clearEnabled={clearEnabled} clearBusy={clearBusy}/>
      </aside>
    </div>

    {active && !!session?.stderr?.length && <details className={styles.settings}><summary>Worker logs</summary><pre>{session.stderr.join("")}</pre></details>}
    {calibrationResult && <CalibrationModal {...calibrationResult} onClose={() => setCalibrationResult(null)}/>}
  </div>;
}
