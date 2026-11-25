import type { ReactNode } from "react";
import { deviceLocation, deviceStatus, statusLabel, statusSymbol, type Freshness, type HandGroup } from "./diagnosticView";
import styles from "./diagnostics.module.css";

// Illustration anchors on the cleaned right-hand image, as percentages.
// MCP roll sits at the palm; the thumb CMC and yaw share one housing.
const anchors: Record<number, [number, number]> = {
  1: [46, 78], 2: [51, 84], 3: [61, 81.5], 4: [73, 81.5], 5: [86, 80],
  6: [52, 59], 7: [51, 50], 8: [51, 41], 9: [51, 27], 10: [51, 12],
  11: [40, 56], 12: [40, 48], 13: [40, 38], 14: [40, 24], 15: [40, 9],
  16: [29, 59], 17: [29, 50], 18: [29, 40], 19: [29, 26], 20: [29, 12],
  21: [17, 65], 22: [18, 58], 23: [18, 47], 24: [18, 34], 25: [18, 20],
};
const frame = { x: 40, y: 25, width: 720, height: 675 };

export default function HandMap({ hand, selected, onSelect, now, freshness, navigation }: {
  navigation?: ReactNode;
  hand: HandGroup; selected?: string; onSelect: (key: string) => void; now: number; freshness: Freshness;
}) {
  const mirror = hand.side === "left";
  const flip = (x: number) => mirror ? 800 - x : x;
  const points = hand.motors.flatMap(entry => {
    const joint = entry.device.id - hand.controller.device.id;
    const point = anchors[joint];
    if (!point) return [];
    return [{ entry, x: flip(frame.x + point[0] / 100 * frame.width), y: frame.y + point[1] / 100 * frame.height }];
  });
  points.push({ entry: hand.controller, x: flip(frame.x + .30 * frame.width), y: frame.y + .79 * frame.height });
  const placed = new Set(points.map(point => point.entry.key));
  const others = hand.motors.filter(entry => !placed.has(entry.key));
  return <div className={styles.mapContent}>
    {navigation}
    <div className={styles.handCanvas}>
      <svg viewBox="0 0 800 720" className={styles.robotArtwork} aria-hidden="true">
        <defs><radialGradient id="hand-halo"><stop stopColor="var(--map-halo)" stopOpacity="var(--map-halo-opacity)"/><stop offset="1" stopColor="var(--map-halo)" stopOpacity="0"/></radialGradient></defs>
        <ellipse cx="400" cy="340" rx="310" ry="320" fill="url(#hand-halo)"/>
        <image href="/diagnostics/hand-right-transparent.png" {...frame} transform={mirror ? "translate(800 0) scale(-1 1)" : undefined}/>
      </svg>
      {points.map(({ entry, x, y }) => {
        const state = deviceStatus(entry.device, now, freshness, entry.bus);
        const label = deviceLocation(entry.device).label;
        return <button key={entry.key} className={styles.marker} data-board={entry.key === hand.controller.key} data-status={state} data-selected={selected === entry.key}
          style={{ left: `${x / 8}%`, top: `${y / 7.2}%` }} onClick={() => onSelect(entry.key)}
          aria-label={`${label}, ID ${entry.device.id}, ${statusLabel[state]}`} aria-pressed={selected === entry.key}
          title={`${label} · ID ${entry.device.id} · ${statusLabel[state]}`}>
          <span>{entry.key === hand.controller.key ? "Hand controller" : entry.device.id}</span><small>{statusSymbol[state]}</small>
        </button>;
      })}
    </div>
    {!!others.length && <div className={styles.boardGrid}>{others.map(entry => <button key={entry.key} className={styles.boardButton} onClick={() => onSelect(entry.key)}>
      ID {entry.device.id} · {statusLabel[deviceStatus(entry.device, now, freshness, entry.bus)]}
    </button>)}</div>}
  </div>;
}
