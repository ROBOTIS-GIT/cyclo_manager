import { communicationIssue, deviceLocation, deviceStatus, issueText, measurementText, modelAssessment, statusLabel, statusSymbol, temperatureFields, temperatureLabel, validMeasurement, type DeviceEntry, type Freshness } from "./diagnosticView";
import styles from "./diagnostics.module.css";
import BoardDetails from "./BoardDetails";

export default function DeviceDetails({ entry, now, freshness, onCalibrate, calibrationEnabled = false, calibrationBusy = false }: {
  entry?: DeviceEntry; now: number; freshness: Freshness; onCalibrate?: () => void;
  calibrationEnabled?: boolean; calibrationBusy?: boolean;
}) {
  if (!entry) return <div className={styles.emptyDetail}><span>◎</span><h3>Select a device</h3><p>Select a marker or a device in the list<br/>to view its status.</p></div>;
  const { device, bus } = entry;
  const location = deviceLocation(device);
  const state = deviceStatus(device, now, freshness, bus);
  const connectionIssue = state === "communication" ? communicationIssue(entry) : null;
  const fields = device.fields ?? {};
  const errors = Object.entries(fields).filter(([name]) => name === "Hardware Error Status" || name === "Error Code");
  const model = modelAssessment(device, now, freshness, bus);
  const mismatch = model.match === "Mismatch";
  const missingDefinition = model.definition === "Unavailable";
  const issue = state === "ok" ? null : issueText(entry, now, freshness);
  const redundantModelIssue = (mismatch && issue === "Model number differs from configuration") ||
    (missingDefinition && issue === "Unknown model: register reads skipped");
  return <>
    <div className={styles.detailHeader}>
      <div className={styles.detailTitle}><h3>{location.label}</h3><span className={styles.idBadge}>ID {device.id}</span></div>
      <p>{device.model_name ?? (device.model_number ? `Model ${device.model_number}` : "Model not identified")}</p>
      <span className={styles.statusBadge} data-status={state}>{statusSymbol[state]} {statusLabel[state]}</span>
      <dl className={styles.deviceMeta}>
        <div><dt>Port</dt><dd>{bus.port}</dd></div>
        <div><dt>Source</dt><dd>{device.expected ? "Configured in Xacro" : "Additional device · identification only"}</dd></div>
        <div><dt>Last response</dt><dd>{device.last_seen ? new Date(device.last_seen * 1000).toLocaleTimeString("en-GB", { hour12: false }) : "No response recorded"}</dd></div>
      </dl>
    </div>
    {connectionIssue ? <div className={styles.detailBody}>
      <h4 className={styles.portErrorTitle}>{connectionIssue.title}</h4>
      <p className={styles.deviceMessage} data-status={state}>{connectionIssue.message}</p>
      {connectionIssue.raw && <details className={styles.rawDetails}><summary>Error details</summary><p>{connectionIssue.raw}</p></details>}
    </div> : state === "pending" ? <div className={styles.emptyDetail}>
      <h3>{device.state === "not_checked" ? "Not checked" : "Waiting for check"}</h3>
      <p>{device.state === "not_checked" ? (device.message || "This device could not be checked.") : freshness.live ? "Waiting for the device to respond." : "Start a check to view device status."}</p>
    </div> : <div className={styles.detailBody}>
      {mismatch && <div className={styles.deviceMessage} data-status="error" role="status">
        <strong>Model mismatch</strong><br/>Expected: {device.expected_model} · Detected: {model.detected}
      </div>}
      {missingDefinition && <div className={styles.deviceMessage} data-status="unknown" role="status">
        <strong>Model definition unavailable</strong><br/>No .model definition is available for detected model {model.detected}.
      </div>}
      {issue && !redundantModelIssue && <p className={styles.deviceMessage} data-status={state}>{issue}</p>}
      {(device.kind === "dxl" || device.kind === "tactile") ? <div className={styles.measurements}>
        <div className={styles.measurement} data-status={fields["Present Input Voltage"]?.status}><span>Input voltage</span><strong>{measurementText(fields["Present Input Voltage"], now, freshness)}</strong>
          <small>Configured range {measurementText(fields["Min Voltage Limit"], now, freshness)} ~ {measurementText(fields["Max Voltage Limit"], now, freshness)}</small></div>
        {temperatureFields(device).length ? temperatureFields(device).map(([name, field]) => <div className={styles.measurement} key={name} data-status={field.status}>
          <span>{temperatureLabel(name)}</span><strong>{measurementText(field, now, freshness)}</strong>
          <small>Configured limit {measurementText(fields[name.replace("Present ", "") + " Limit"], now, freshness)}</small>
        </div>) : <div className={styles.measurement}><span>Temperature</span><strong>Not measured</strong><small>Available after the device responds</small></div>}
      </div> : <BoardDetails device={device} now={now} freshness={freshness}/>}
      {(device.kind === "dxl" || device.kind === "tactile") && <div className={styles.errorReadout}><span>Hardware errors</span>
        <div className={styles.errorValues}>{errors.length ? errors.map(([name, field]) => {
          const current = validMeasurement(field, now, freshness) && field.raw !== null;
          const result = current ? (field.raw === 0 ? "None" : field.message || "Reported error") : measurementText(field, now, freshness);
          const code = current ? `0x${field.raw!.toString(16).toUpperCase().padStart(2, "0")}` : null;
          return <div key={name}><strong data-status={field.status}>{result}{code && ` · ${code}`}</strong></div>;
        }) : <strong>Not measured</strong>}</div>
      </div>}
      {device.kind === "tactile" && <div className={styles.pressureReadout}>
        <header><span>Pressure readings · raw</span>
          <button type="button" className={styles.portEditButton} onClick={onCalibrate}
            disabled={!calibrationEnabled || calibrationBusy}
            aria-label={`Calibrate ${location.label}, ID ${device.id}`}>
            {calibrationBusy ? "Calibrating…" : "Calibrate"}
          </button>
        </header>
        <div>{Array.from({ length: 9 }, (_, i) => <div key={i}><small>{i + 1}</small><strong>{measurementText(fields[`Present Pressure ${i + 1}`], now, freshness)}</strong></div>)}</div>
      </div>}
      <details className={styles.rawDetails}><summary>Technical details · raw registers</summary>
        <p>{device.system} / {device.name}</p><p>Model number {device.model_number ?? "Unknown"} · Failures {device.failures ?? 0} · Packet error {device.packet_error ?? 0}</p>
        {Object.entries(fields).map(([name, field]) => <div key={name}><span>{name}</span><strong>{measurementText(field, now, freshness)}</strong><small>{field.status}{field.message && ` · ${field.message}`}</small></div>)}
      </details>
    </div>}
  </>;
}
