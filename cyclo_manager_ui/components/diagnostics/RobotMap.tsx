import type { CSSProperties, ReactNode } from "react";
import { deviceLocation, deviceStatus, groupLabel, statusLabel, statusSymbol, handStatus, type HandGroup, type HandSide, type DeviceEntry, type Freshness } from "./diagnosticView";
import styles from "./diagnostics.module.css";

// Front-view photo coordinates follow the user's joint-location diagram.
// Shoulder pitch is inboard of roll; wrist yaw is above the wrist pitch housing.
const followerArmPositions: Record<number, { right: number; left: number; y: number }> = {
  1: { right: 43, left: 58, y: 17 },
  2: { right: 36, left: 65, y: 17 },
  3: { right: 37.3, left: 63.3, y: 27.5 },
  4: { right: 37.3, left: 63.3, y: 32.5 },
  5: { right: 37.3, left: 63.3, y: 41 },
  6: { right: 37.3, left: 63.3, y: 46 },
  7: { right: 37.3, left: 63.3, y: 52.5 },
  8: { right: 37.3, left: 63.3, y: 58.5 },
};
// Keep the photo anchors above separate from the selectable callouts.
// Even spacing leaves room for both shoulder joints and the wrist cluster.
const followerArmCalloutY = [0, 13, 20, 27.5, 34.5, 41.5, 48.5, 55.5, 62.5];

// Coordinates are percentages of each transparent, square leader asset.
// The right arm is on the viewer's left; the left arm mirrors it.
const leaderArtworks: Record<string, { src: string; joints: Record<number, [number, number]> }> = {
  a2: { src: "/diagnostics/leader-a2-transparent.png", joints: {
    1: [32.1, 9.2], 2: [18, 9.2], 3: [16.5, 29], 4: [18, 36],
    5: [16.5, 50.7], 6: [18, 57.3], 7: [18, 63.4], 8: [22.5, 88.5],
  } },
  lg2: { src: "/diagnostics/leader-lg2-transparent.png", joints: {
    1: [26.5, 7.2], 2: [19.8, 7.2], 3: [19.8, 36.8], 4: [19.8, 42],
    5: [19.8, 63.8], 6: [19.8, 69.1], 7: [19.8, 76.2], 8: [32, 88.4],
  } },
  a1: { src: "/diagnostics/leader-a1-transparent.png", joints: {
    1: [25.3, 13.7], 2: [13.5, 13.7], 3: [13.5, 39], 4: [13.5, 44.4],
    5: [13.5, 61], 6: [13.5, 67.5], 7: [24.2, 70.8], 8: [25.5, 83],
  } },
};
const leaderArmCalloutY = [0, 10, 19, 33, 42, 55, 64, 73, 85];
const leaderFrame = { x: 20, y: 45, width: 560, height: 560 };

export default function RobotMap({ entries, profile, selected, onSelect, now, freshness, hands = [], onSelectHand, navigation }: {
  navigation?: ReactNode;
  hands?: HandGroup[]; onSelectHand?: (side: HandSide) => void;
  entries: DeviceEntry[]; profile: string; selected?: string; onSelect: (key: string) => void; now: number; freshness: Freshness;
}) {
  const leader = leaderArtworks[profile];
  const wheeled = ["w2", "sg2", "sh5"].includes(profile);
  const handArtwork = profile === "sh5" ? "/diagnostics/ai-worker-sh5-transparent.png"
    : profile === "bh5" ? "/diagnostics/ai-worker-bh5-transparent.png" : undefined;
  const robotPhoto = wheeled ? "/diagnostics/ai-worker-wheeled-transparent.png" : "/diagnostics/ai-worker-fixed-transparent.png";
  // Retain the original pixels outside the grippers, including every joint and
  // wrist adapter. Both source assets share the same 895 × 1756 canvas.
  const handRegions = wheeled
    ? [{ x: 140, y: 930, width: 190, height: 330 }, { x: 615, y: 930, width: 190, height: 330 }]
    : [{ x: 120, y: 955, width: 190, height: 365 }, { x: 600, y: 955, width: 190, height: 365 }];
  const positioned = entries.flatMap(entry => {
    if (hands.some(hand => hand.controller.key === entry.key)) return [];
    const location = deviceLocation(entry.device);
    let { x, y } = location;
    let anchor: { x: number; y: number } | undefined;
    let boardLabel: string | undefined;
    if (leader) {
      const joystick = entry.device.expected && entry.device.kind !== "dxl"
        ? /^sensorxel_([lr])_joy$/.exec(entry.device.name) : null;
      if (joystick) {
        const left = joystick[1] === "l";
        const [gripX, gripY] = leader.joints[8];
        anchor = {
          x: leaderFrame.x + (left ? 100 - gripX : gripX) / 100 * leaderFrame.width,
          y: leaderFrame.y + gripY / 100 * leaderFrame.height,
        };
        // Joysticks sit at the joint-8 trigger; keep their buttons below the handles.
        x = left ? 64 : 36;
        y = 95;
        boardLabel = "JOY";
      } else {
        const joint = location.joint;
        const point = joint === undefined ? undefined : leader.joints[joint];
        if (!point) return [];
        const [armX, armY] = point;
        const left = location.group === "left";
        const imageX = left ? 100 - armX : armX;
        anchor = { x: leaderFrame.x + imageX / 100 * leaderFrame.width, y: leaderFrame.y + armY / 100 * leaderFrame.height };
        // All leader joints use aligned outer callouts, like the follower map.
        x = left ? 93 : 7;
        y = leaderArmCalloutY[joint!];
      }
    } else {
      const arm = location.joint === undefined ? undefined : followerArmPositions[location.joint];
      if (arm) {
        x = (location.group === "left" ? arm.left : arm.right) + (wheeled ? 1 : 0);
        y = arm.y - (wheeled ? 1 : 0);
        anchor = { x: x * 6, y: y * 6.5 };
        x = location.group === "left" ? 77 : 24;
        y = followerArmCalloutY[location.joint!] - (wheeled ? 1 : 0);
      } else if (location.group === "head") {
        x = wheeled ? 51.5 : 50.5;
        y = entry.device.id === 62 ? 7.5 : 13;
        anchor = { x: x * 6, y: y * 6.5 };
        x += entry.device.id === 62 ? 11 : -11;
      } else if (location.group === "lift") {
        x = wheeled ? 51.5 : 50.5;
        y = wheeled ? 72.5 : 73.5;
        anchor = { x: x * 6, y: y * 6.5 };
        x += 15;
      } else if (wheeled && location.group === "base" && [101, 103, 105].includes(entry.device.id)) {
        x = entry.device.id === 101 ? 64 : entry.device.id === 103 ? 38 : 51.5;
        y = 80;
        anchor = { x: x * 6, y: y * 6.5 };
        // Preserve the shared height of the three steering motors.
        x = entry.device.id === 101 ? 78 : entry.device.id === 103 ? 24 : 59.5;
      } else if (entry.device.expected && entry.device.kind === "sensor" && entry.device.name === "imu") {
        x = wheeled ? 51.5 : 50.5;
        y = 83;
        boardLabel = "IMU";
      } else if (entry.device.expected && entry.device.kind === "controller" && entry.device.name === "led") {
        x = wheeled ? 46.5 : 45.5;
        y = 22.5;
        boardLabel = "LED";
      } else if (entry.device.expected && entry.device.kind === "controller" && entry.device.name.includes("rcu")) {
        x = wheeled ? 51.5 : 50.5;
        y = 87.5;
        boardLabel = "RCU";
      }
    }
    return x === undefined || y === undefined ? [] : [{ entry, location, x, y, boardLabel, anchor }];
  });
  const positionedKeys = new Set([...positioned.map(({ entry }) => entry.key), ...hands.map(hand => hand.controller.key)]);
  const unpositioned = entries.filter(e => !positionedKeys.has(e.key));
  const trays = [
    { label: "Sensors & controllers", devices: unpositioned.filter(e => e.device.expected && e.device.kind !== "dxl") },
    { label: "Base & other DXL", devices: unpositioned.filter(e => e.device.expected && e.device.kind === "dxl") },
    { label: "Additional devices", devices: unpositioned.filter(e => !e.device.expected) },
  ].filter(tray => tray.devices.length);
  return <div className={styles.mapContent}>
    {navigation}
    <div className={styles.robotCanvas} data-photo="true" data-leader={!!leader}>
      <svg viewBox="0 0 600 650" className={styles.robotArtwork} aria-hidden="true">
        <defs><radialGradient id="robot-halo"><stop stopColor="var(--map-halo)" stopOpacity="var(--map-halo-opacity)"/><stop offset="1" stopColor="var(--map-halo)" stopOpacity="0"/></radialGradient></defs>
        <ellipse cx="300" cy="340" rx="230" ry="300" fill="url(#robot-halo)"/>
        <path d="M300 65V615M80 325H520" stroke="currentColor" opacity=".08" strokeDasharray="3 8"/>
        {leader ? <image href={leader.src} {...leaderFrame}/> : handArtwork ?
          <svg x="150" y="30" width="300" height="588" viewBox="0 0 895 1756">
            <defs>
              <mask id={`original-grippers-${profile}`} maskUnits="userSpaceOnUse" x="0" y="0" width="895" height="1756">
                <rect width="895" height="1756" fill="white"/>
                {handRegions.map((region, index) => <rect key={index} {...region} fill="black"/>)}
              </mask>
              {handRegions.map((region, index) => <clipPath key={index} id={`replacement-gripper-${profile}-${index}`}>
                <rect {...region}/>
              </clipPath>)}
            </defs>
            <image href={robotPhoto} width="895" height="1756" mask={`url(#original-grippers-${profile})`}/>
            {handRegions.map((region, index) => <g key={index} clipPath={`url(#replacement-gripper-${profile}-${index})`}>
              <image href={`${handArtwork}?v=side-photo`} width="895" height="1756"
                transform={`translate(${2 * region.x + region.width} 0) scale(-1 1)`}/>
            </g>)}
          </svg> : <image href={robotPhoto} x="150" y="30" width="300" height="588"/>}
        {positioned.map(({ entry, anchor, x, y }) => anchor && Math.hypot(anchor.x - x * 6, anchor.y - y * 6.5) > 1 &&
          <g key={entry.key} className={styles.markerConnection} data-status={deviceStatus(entry.device, now, freshness, entry.bus)} data-selected={selected === entry.key}>
            <line x1={anchor.x} y1={anchor.y} x2={x * 6} y2={y * 6.5} className={styles.markerConnector}/>
            <circle cx={anchor.x} cy={anchor.y} r="3" className={styles.markerAnchor}/>
          </g>)}
      </svg>
      {positioned.map(({ entry, location, x, y, boardLabel }) => {
        const state = deviceStatus(entry.device, now, freshness, entry.bus);
        return <button key={entry.key} type="button" className={styles.marker} data-board={!!boardLabel} data-status={state} data-selected={selected === entry.key}
          style={{ left: `${x}%`, top: `${y}%` } as CSSProperties} onClick={() => onSelect(entry.key)}
          aria-label={`${location.label}, ID ${entry.device.id}, ${statusLabel[state]}`} aria-pressed={selected === entry.key}
          title={`${location.label} · ID ${entry.device.id} · ${statusLabel[state]}`}>
          <span>{boardLabel ?? entry.device.id}</span><small>{statusSymbol[state]}</small>
        </button>;
      })}
      {hands.map(hand => {
        const state = handStatus(hand, now, freshness);
        return <button key={hand.controller.key} className={`${styles.marker} ${styles.handOverview}`} data-board="true" data-status={state}
          style={{ left: hand.side === "right" ? (wheeled ? "38%" : "37%") : (wheeled ? "64%" : "63%"), top: wheeled ? "55%" : "58%" }} onClick={() => onSelectHand?.(hand.side)}
          title={`${hand.side === "right" ? "Right hand" : "Left hand"} · ${statusLabel[state]}`}
          aria-label={`${hand.side === "right" ? "Right" : "Left"} hand, ${statusLabel[state]}, open hand map`}>
          <span>{hand.side === "right" ? "RH" : "LH"}</span><small>{statusSymbol[state]}</small>
        </button>;
      })}
    </div>
    {trays.map(tray => <div className={styles.boardTray} key={tray.label}>
      <h3 className={styles.boardTrayTitle}>{tray.label}<span>{tray.devices.length}</span></h3>
      <div className={styles.boardGrid}>{tray.devices.map(entry => {
        const state = deviceStatus(entry.device, now, freshness, entry.bus);
        const location = deviceLocation(entry.device);
        return <button key={entry.key} className={styles.boardButton} data-selected={entry.key === selected} onClick={() => onSelect(entry.key)} aria-pressed={entry.key === selected}>
          <span className={styles.statusDot} data-status={state}>{statusSymbol[state]}</span>
          <span><strong>{location.label}</strong><small>{groupLabel[location.group]} · ID {entry.device.id} · {statusLabel[state]}</small></span>
        </button>;
      })}</div>
    </div>)}
  </div>;
}
