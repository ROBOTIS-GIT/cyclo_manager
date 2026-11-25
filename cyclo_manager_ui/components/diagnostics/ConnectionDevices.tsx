import { useEffect, useId, useRef, useState } from "react";
import type { DiagnosticBus } from "@/lib/diagnostics";
import { inspectionDevices } from "./diagnosticView";
import styles from "./diagnostics.module.css";

const kinds: Record<string, string> = { dxl: "Motor", sensor: "Sensor", controller: "Controller" };

export default function ConnectionDevices({ bus, system }: { bus: DiagnosticBus; system: string }) {
  const devices = inspectionDevices(bus, system);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.type === "scroll" && event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      if (panelRef.current?.matches(":popover-open")) panelRef.current.hidePopover();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  function toggle() {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!panel || !button) return;
    if (panel.matches(":popover-open")) { panel.hidePopover(); return; }
    const anchor = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.maxHeight = "300px";
    panel.showPopover();
    const height = panel.getBoundingClientRect().height;
    const above = Math.max(0, anchor.top - 20);
    const below = Math.max(0, window.innerHeight - anchor.bottom - 20);
    const placeAbove = above >= height || above > below;
    const available = placeAbove ? above : below;
    panel.style.maxHeight = `${Math.min(300, available)}px`;
    panel.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
    panel.style.top = `${placeAbove ? anchor.top - 8 - Math.min(height, available) : anchor.bottom + 8}px`;
  }

  return <>
    <button ref={buttonRef} type="button" className={styles.portEditButton} aria-label={`${system} Details`}
      aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={toggle}>Details</button>
    <div ref={panelRef} id={id} popover="auto" role="dialog" aria-label={`${system} Device details`}
      className={styles.connectionPopover} onToggle={event => setOpen(event.newState === "open")}>
      <table aria-label="Device list">
        <thead><tr><th scope="col">Device</th><th scope="col">ID</th><th scope="col">Kind</th></tr></thead>
        <tbody>{devices.map(device => <tr key={device.id}><td>{device.name}</td><td>{device.id}</td><td>{kinds[device.kind] ?? device.kind}</td></tr>)}
          {!devices.length && <tr><td colSpan={3}>No direct devices to check.</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}
