import type { DiagnosticDevice } from "@/lib/diagnostics";
import { measurementText, sampleIsStale, validMeasurement, type Freshness } from "./diagnosticView";
import styles from "./diagnostics.module.css";
import HandDetails from "./HandDetails";

const labels: Record<string, string> = {
  Error_Code: "Board error code", Firmware_Version_Major: "Firmware major", Firmware_Version_Minor: "Firmware minor",
  Millis: "Runtime counter", Sec_Since_Power_On: "Counter since power-on", Sec_Since_Reset: "Counter since reset",
  Estop_Input: "Emergency stop input", Remote_Connected: "Remote connection", System_State: "System state", Board_Temperature: "Board temperature",
  Host_Connection: "Host connection", Swerve_DXL1_Connection_Status: "Steering 1 connection", Swerve_DXL2_Connection_Status: "Steering 2 connection", Swerve_DXL3_Connection_Status: "Steering 3 connection",
  Motor1_Connection_Status: "Subordinate DXL connection",
  "IMU TIMESTAMP": "IMU timestamp", "IMU ACC SCALE": "Acceleration scale", "IMU GYRO SCALE": "Angular velocity scale",
  "IMU ACC X": "Acceleration X", "IMU ACC Y": "Acceleration Y", "IMU ACC Z": "Acceleration Z", "IMU ACC SUM": "Acceleration sum",
  "IMU GYRO X": "Angular velocity X", "IMU GYRO Y": "Angular velocity Y", "IMU GYRO Z": "Angular velocity Z",
  "JOYSTICK TACT SWITCH": "Joystick button", "JOYSTICK X VALUE": "Joystick X", "JOYSTICK Y VALUE": "Joystick Y",
  "Firmware Version": "Firmware version", "Present Input Voltage": "Input voltage", Status: "Controller status", "Realtime Tick": "Realtime tick",
  "Hardware Error Status": "Hardware error", "Min Voltage Limit": "Minimum voltage", "Max Voltage Limit": "Maximum voltage",
};
function label(name: string) {
  if (labels[name]) return labels[name];
  const led = /^Neopixel_Head_(Left|Right)_(Red|Green|Blue|Brightness|Mode)$/.exec(name);
  if (led) return `${led[1]} LED ${({ Red: "R", Green: "G", Blue: "B", Brightness: "Brightness", Mode: "Mode" })[led[2]]}`;
  return name;
}

export default function BoardDetails({ device, now, freshness }: { device: DiagnosticDevice; now: number; freshness: Freshness }) {
  if (!device.expected) return <p className={styles.infoNote}>Additional devices are checked for response and identity only.</p>;
  if (device.board_telemetry !== "supported") return <>{device.hand && <HandDetails device={device} now={now} freshness={freshness}/>}<p className={styles.infoNote}>{device.board_telemetry === "incompatible" ? "Detailed reads were skipped because the register layout does not match this model." : device.board_telemetry === "unsupported" ? "Detailed board reads are not supported for this model." : "Board readings are not available yet. Restart the check with the updated worker to read supported models."}</p></>;
  const fields = device.fields ?? {};
  const available = (name: string) => device.state === "online" && !!fields[name] && fields[name].raw !== null && validMeasurement(fields[name], now, freshness);
  const value = (name: string) => device.state !== "online" ? "Unavailable" : measurementText(fields[name], now, freshness);
  const error = fields.Error_Code;
  const activity = device.sample_activity;
  const activityFresh = available("IMU TIMESTAMP") && activity && !sampleIsStale(activity.observed_at, now, freshness);
  const common = new Set(["Error_Code", "Firmware_Version_Major", "Firmware_Version_Minor", "Table Sync Enable"]);
  return <div className={styles.boardDetails}>
    <dl className={styles.boardReadings}>
      {!device.hand && <div><dt>Board error code</dt><dd className={styles.boardErrorValue} data-status={available("Error_Code") && error.raw !== 0 ? "error" : undefined}>
        <span>{available("Error_Code") ? `0x${error.raw!.toString(16).toUpperCase().padStart(8, "0")}` : value("Error_Code")}</span>
      </dd></div>}
      {!device.hand && <div><dt>Firmware version</dt><dd>{available("Firmware_Version_Major") && available("Firmware_Version_Minor") ? `${fields.Firmware_Version_Major.raw}.${fields.Firmware_Version_Minor.raw}` : "Unavailable"}</dd></div>}
      {fields["IMU TIMESTAMP"] && <div><dt>IMU updates</dt><dd>{!activityFresh ? "Unavailable" : activity.state === "changed" ? "Timestamp changing" : activity.state === "unchanged" ? "Unchanged for at least 5 seconds" : "Observing changes"}</dd></div>}
      {Object.entries(fields).filter(([name]) => !common.has(name)).map(([name, field]) => <div key={name}><dt>{label(name)}</dt><dd>{value(name)}{available(name) && (name === "Hardware Error Status" || name === "Status") && field.message && <small>{field.message}</small>}{available(name) && field.unit === "raw" && name !== "Hardware Error Status" && name !== "Status" && <small>raw</small>}</dd></div>)}
    </dl>
    {!!device.board_skipped_fields?.length && <div className={styles.boardNote}>
      <p>Some readings were skipped because their model definitions are unavailable or ambiguous:</p>
      <ul>{device.board_skipped_fields.map(({ name, reason }) => <li key={name}>{label(name)} · {reason === "missing" ? "not found" : reason === "duplicate" ? "duplicate name" : "invalid address or size"}</li>)}</ul>
    </div>}
    {device.model_name === "ffw_g10_led" && <p className={styles.boardNote}>These are LED settings; they do not confirm that the LEDs are lit.</p>}
    {device.model_name === "ffw_g10_rcu" && <p className={styles.boardNote}>Connection status values are unverified. Subordinate DXL errors, voltage, and temperature are not read.</p>}
    {device.hand && <HandDetails device={device} now={now} freshness={freshness}/>}
  </div>;
}
