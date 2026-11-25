import type { DiagnosticDevice } from "@/lib/diagnostics";
import { measurementText, type Freshness } from "./diagnosticView";
import styles from "./diagnostics.module.css";

const modes = {
  unknown: "Unknown",
  sync_disabled: "Bypass · direct DXL access",
  sync_table: "SyncTable enabled",
};

export default function HandDetails({ device, now, freshness }: { device: DiagnosticDevice; now: number; freshness: Freshness }) {
  const hand = device.hand!;
  return <div className={styles.boardDetails}>
    <dl className={styles.boardReadings}>
      <div><dt>Hand access</dt><dd>{modes[hand.mode]}</dd></div>
      <div><dt>Table Sync Enable</dt><dd>{measurementText(device.fields["Table Sync Enable"], now, freshness)}</dd></div>
    </dl>
  </div>;
}
