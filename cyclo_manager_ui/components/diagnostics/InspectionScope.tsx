"use client";

import { useId, useState, type ReactNode } from "react";
import type { DiagnosticConfiguration } from "@/lib/diagnostics";
import styles from "./diagnostics.module.css";

export default function InspectionScope({ configuration, robotSelector, communication, actions }: {
  configuration: DiagnosticConfiguration | null;
  robotSelector: ReactNode; communication: ReactNode; actions: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const settingsId = useId();
  return <section className={styles.scopeSummary} aria-label="Robot check settings">
    <header className={styles.scopeHeader}>
      {robotSelector}{actions}
      <button type="button" className={styles.settingsToggle} aria-expanded={expanded} aria-controls={settingsId} onClick={() => setExpanded(value => !value)}>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> Connection settings
      </button>
    </header>
    <div id={settingsId} className={styles.scopeDisclosure} hidden={!expanded}>
      {configuration && <p className={styles.scopeSource}>Source <code>{configuration.description}</code></p>}
      <dl className={styles.scopeRows}>
        <div className={styles.communicationRow}><dt>Checklist</dt><dd className={styles.scopeCommunication}>{communication}</dd></div>
      </dl>
    </div>
  </section>;
}
