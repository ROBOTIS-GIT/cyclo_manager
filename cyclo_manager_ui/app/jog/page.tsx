// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Howon Kim

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getServiceLogs, getServiceStatus, publishCmdVel } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

const JOG_CONTAINER = "ai_worker";
const ROBOT_SERVICE_NAME = "ai_worker_bringup";
const CMD_VEL_TOPIC = "/cmd_vel";
const MOBILE_ROBOT_MODEL = "Mobile";
const BRINGUP_START_LOG = "[ai_worker_bringup] Starting service...";
const CONTROLLER_CONFIGURED_LOG =
  "[spawner_swerve_drive_controller]: Configured and activated swerve_drive_controller";
const DEFAULT_LINEAR_SPEED = 0.3;
const DEFAULT_ANGULAR_SPEED = 0.6;
const SPEED_STEP = 0.1;
const REPEAT_INTERVAL_MS = 120;
const STATUS_POLL_INTERVAL_MS = 2000;
const READY_LOG_TAIL_LINES = 3000;
const ZERO_VELOCITY = { linearX: 0, angularZ: 0 };

type JogCommand = {
  id: "forward" | "left" | "stop" | "right" | "backward";
  label: string;
  hint: string;
  linearDirection: -1 | 0 | 1;
  angularDirection: -1 | 0 | 1;
  gridClass: string;
};

type JogControlsProps = {
  commands: JogCommand[];
  activeCommand: JogCommand["id"] | null;
  disabled: boolean;
  startJog: (command: JogCommand) => void;
  stopJog: () => void;
};

const JOG_COMMANDS: JogCommand[] = [
  { id: "forward", label: "↑", hint: "Forward", linearDirection: 1, angularDirection: 0, gridClass: "col-start-2 row-start-1" },
  { id: "left", label: "←", hint: "Turn left", linearDirection: 0, angularDirection: 1, gridClass: "col-start-1 row-start-2" },
  { id: "stop", label: "■", hint: "Stop", linearDirection: 0, angularDirection: 0, gridClass: "col-start-2 row-start-2" },
  { id: "right", label: "→", hint: "Turn right", linearDirection: 0, angularDirection: -1, gridClass: "col-start-3 row-start-2" },
  { id: "backward", label: "↓", hint: "Backward", linearDirection: -1, angularDirection: 0, gridClass: "col-start-2 row-start-3" },
];

function JogButton({
  command,
  active,
  disabled,
  startJog,
  stopJog,
  className,
}: {
  command: JogCommand;
  active: boolean;
  disabled: boolean;
  startJog: (command: JogCommand) => void;
  stopJog: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      title={command.hint}
      aria-label={command.hint}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Some mobile webviews can reject pointer capture.
        }
        startJog(command);
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Capture may already be released after a cancellation.
        }
        stopJog();
      }}
      onPointerCancel={stopJog}
      onPointerLeave={() => {
        if (active) stopJog();
      }}
      className={`${className} border font-semibold transition-colors disabled:cursor-not-allowed`}
      style={{
        color: active ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)",
        backgroundColor: active ? "var(--vscode-button-background)" : "var(--vscode-button-secondaryBackground)",
        borderColor: active ? "var(--vscode-focusBorder)" : "var(--vscode-panel-border)",
        opacity: disabled ? 0.45 : 1,
        boxShadow: active
          ? "inset 0 0 0 2px var(--vscode-focusBorder), inset 0 3px 8px rgba(0, 0, 0, 0.35)"
          : "0 1px 0 rgba(255, 255, 255, 0.06)",
        transform: active ? "translateY(1px) scale(0.97)" : "translateY(0) scale(1)",
      }}
    >
      {command.label}
    </button>
  );
}

function JogDesktopControls(props: JogControlsProps) {
  return (
    <div className="hidden md:grid grid-cols-3 grid-rows-3 gap-3 select-none" style={{ touchAction: "none" }}>
      {props.commands.map((command) => (
        <JogButton
          key={command.id}
          command={command}
          active={props.activeCommand === command.id}
          disabled={props.disabled}
          startJog={props.startJog}
          stopJog={props.stopJog}
          className={`${command.gridClass} h-24 w-24 text-3xl`}
        />
      ))}
    </div>
  );
}

function JogMobileControls(props: JogControlsProps) {
  const commandById = Object.fromEntries(
    props.commands.map((command) => [command.id, command])
  ) as Record<JogCommand["id"], JogCommand>;
  const rows: JogCommand["id"][][] = [["forward"], ["left", "stop", "right"], ["backward"]];

  return (
    <div className="md:hidden w-full max-w-sm select-none" style={{ touchAction: "none" }}>
      <div className="grid grid-cols-3 gap-2.5">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="col-span-3 grid grid-cols-3 gap-2.5">
            {row.length === 1 && <div aria-hidden />}
            {row.map((id) => (
              <JogButton
                key={id}
                command={commandById[id]}
                active={props.activeCommand === id}
                disabled={props.disabled}
                startJog={props.startJog}
                stopJog={props.stopJog}
                className="aspect-square w-full text-3xl"
              />
            ))}
            {row.length === 1 && <div aria-hidden />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeedSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium" style={{ color: "var(--vscode-foreground)" }}>
        <span>{label}</span>
        <span className="tabular-nums" style={{ color: "var(--vscode-descriptionForeground)" }}>{value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={SPEED_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="w-full"
        style={{ accentColor: "var(--vscode-focusBorder)" }}
      />
    </label>
  );
}

export default function JogPage() {
  const router = useRouter();
  const [activeCommand, setActiveCommand] = useState<JogCommand["id"] | null>(null);
  const [robotRunning, setRobotRunning] = useState(false);
  const [controllerReady, setControllerReady] = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [linearSpeed, setLinearSpeed] = useState(DEFAULT_LINEAR_SPEED);
  const [angularSpeed, setAngularSpeed] = useState(DEFAULT_ANGULAR_SPEED);
  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeCommandRef = useRef<JogCommand["id"] | null>(null);
  const jogGenerationRef = useRef(0);
  const stopGenerationRef = useRef(0);
  const speedRef = useRef({ linearSpeed: DEFAULT_LINEAR_SPEED, angularSpeed: DEFAULT_ANGULAR_SPEED });
  const warmedUpRef = useRef(false);
  const statusPollInFlightRef = useRef(false);
  const robotReady = robotRunning && controllerReady;

  const resetControllerReady = useCallback(() => {
    warmedUpRef.current = false;
    setControllerReady(false);
  }, []);

  useEffect(() => {
    speedRef.current = { linearSpeed, angularSpeed };
  }, [angularSpeed, linearSpeed]);

  useEffect(() => {
    let disposed = false;
    const loadRobotStatus = async () => {
      if (statusPollInFlightRef.current) return;
      statusPollInFlightRef.current = true;
      try {
        const serviceStatus = await getServiceStatus(JOG_CONTAINER, ROBOT_SERVICE_NAME);
        if (disposed) return;
        setRobotRunning(serviceStatus.is_up);
        if (!serviceStatus.is_up) {
          resetControllerReady();
          return;
        }
        const logs = await getServiceLogs(JOG_CONTAINER, ROBOT_SERVICE_NAME, READY_LOG_TAIL_LINES);
        if (disposed) return;
        const startIndex = logs.logs.lastIndexOf(BRINGUP_START_LOG);
        const currentRunLogs = startIndex >= 0 ? logs.logs.slice(startIndex) : "";
        if (currentRunLogs.includes(CONTROLLER_CONFIGURED_LOG)) {
          setControllerReady(true);
        } else {
          resetControllerReady();
        }
      } catch {
        if (!disposed) {
          setRobotRunning(false);
          resetControllerReady();
        }
      } finally {
        statusPollInFlightRef.current = false;
      }
    };
    void loadRobotStatus();
    const interval = setInterval(loadRobotStatus, STATUS_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      statusPollInFlightRef.current = false;
      clearInterval(interval);
    };
  }, [resetControllerReady]);

  const sendCmdVel = useCallback(async (linearX: number, angularZ: number) => {
    await publishCmdVel({ topic: CMD_VEL_TOPIC, linear_x: linearX, angular_z: angularZ });
  }, []);

  const publish = useCallback(async (
    linearX: number,
    angularZ: number,
    generation = jogGenerationRef.current
  ) => {
    const isStop = linearX === 0 && angularZ === 0;
    try {
      await sendCmdVel(linearX, angularZ);
      if (generation === jogGenerationRef.current || (isStop && activeCommandRef.current === null)) {
        setError(null);
        setStatusText(`linear.x ${linearX.toFixed(2)} m/s · angular.z ${angularZ.toFixed(2)} rad/s`);
      }
      if (!isStop && activeCommandRef.current === null && stopGenerationRef.current > generation) {
        await sendCmdVel(0, 0);
        setError(null);
        setStatusText("Ready");
      }
    } catch (err) {
      if (generation === jogGenerationRef.current || activeCommandRef.current === null) {
        setError(err instanceof Error ? err.message : "Failed to publish /cmd_vel");
      }
    }
  }, [sendCmdVel]);

  const stopJog = useCallback((publishStop = true) => {
    if (repeatRef.current) {
      clearInterval(repeatRef.current);
      repeatRef.current = null;
    }
    const generation = jogGenerationRef.current + 1;
    jogGenerationRef.current = generation;
    stopGenerationRef.current = generation;
    activeCommandRef.current = null;
    setActiveCommand(null);
    if (publishStop && robotReady) {
      void publish(ZERO_VELOCITY.linearX, ZERO_VELOCITY.angularZ, generation);
    }
  }, [publish, robotReady]);

  const startJog = useCallback((command: JogCommand) => {
    if (!robotReady) return;
    if (repeatRef.current) clearInterval(repeatRef.current);
    const generation = jogGenerationRef.current + 1;
    jogGenerationRef.current = generation;
    activeCommandRef.current = command.id;
    const publishCommand = () => {
      const speed = speedRef.current;
      void publish(
        command.linearDirection * speed.linearSpeed,
        command.angularDirection * speed.angularSpeed,
        generation
      );
    };
    setActiveCommand(command.id);
    publishCommand();
    if (command.id !== "stop") repeatRef.current = setInterval(publishCommand, REPEAT_INTERVAL_MS);
  }, [publish, robotReady]);

  useEffect(() => {
    if (!robotReady) {
      stopJog(false);
      setStatusText("Robot off");
    } else if (!activeCommand) {
      setStatusText("Ready");
    }
  }, [activeCommand, robotReady, stopJog]);

  useEffect(() => {
    if (!robotReady || warmedUpRef.current) return;
    warmedUpRef.current = true;
    void publish(0, 0);
  }, [publish, robotReady]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const command =
        event.key.toLowerCase() === "w" ? JOG_COMMANDS[0] :
          event.key.toLowerCase() === "a" ? JOG_COMMANDS[1] :
            event.key === " " ? JOG_COMMANDS[2] :
              event.key.toLowerCase() === "d" ? JOG_COMMANDS[3] :
                event.key.toLowerCase() === "s" ? JOG_COMMANDS[4] : null;
      if (!command) return;
      event.preventDefault();
      startJog(command);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!["w", "a", "s", "d", " "].includes(event.key.toLowerCase())) return;
      event.preventDefault();
      stopJog();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startJog, stopJog]);

  useEffect(() => {
    const stopActiveJog = () => {
      if (activeCommandRef.current !== null) stopJog();
    };
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") stopActiveJog();
    };
    window.addEventListener("pointerup", stopActiveJog);
    window.addEventListener("pointercancel", stopActiveJog);
    window.addEventListener("touchend", stopActiveJog);
    window.addEventListener("touchcancel", stopActiveJog);
    window.addEventListener("blur", stopActiveJog);
    window.addEventListener("pagehide", stopActiveJog);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.removeEventListener("pointerup", stopActiveJog);
      window.removeEventListener("pointercancel", stopActiveJog);
      window.removeEventListener("touchend", stopActiveJog);
      window.removeEventListener("touchcancel", stopActiveJog);
      window.removeEventListener("blur", stopActiveJog);
      window.removeEventListener("pagehide", stopActiveJog);
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [stopJog]);

  useEffect(() => () => {
    if (repeatRef.current) clearInterval(repeatRef.current);
    publishCmdVel({ topic: CMD_VEL_TOPIC, linear_x: 0, angular_z: 0 }).catch(() => { });
  }, []);

  const openMobileSystem = useCallback(() => {
    localStorage.setItem(`robot_type_${JOG_CONTAINER}`, MOBILE_ROBOT_MODEL);
    router.push(`/${JOG_CONTAINER}/system`);
  }, [router]);

  const controlsProps = { commands: JOG_COMMANDS, activeCommand, disabled: !robotReady, startJog, stopJog };
  const statusMessage = robotReady ? error ?? statusText : "Robot off";

  return (
    <div className="h-full min-h-[320px] flex flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ borderColor: "var(--vscode-panel-border)" }}>
        <h1 className="text-base font-semibold" style={{ color: "var(--vscode-foreground)" }}>Jog</h1>
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={openMobileSystem}
            className="h-8 px-3 border text-sm font-semibold transition-colors"
            style={{ color: "var(--vscode-button-foreground)", backgroundColor: "var(--vscode-button-background)", borderColor: "var(--vscode-focusBorder)" }}
            title="Open System with Mobile robot selected"
          >
            ON/OFF
          </button>
          <div className="h-8 px-2.5 border flex items-center gap-2 text-sm" style={{ color: "var(--vscode-foreground)", backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}>
            <StatusBadge status={robotReady} dotOnly />
            <span className="font-medium">{JOG_CONTAINER}</span>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-5 p-4">
        <JogDesktopControls {...controlsProps} />
        <JogMobileControls {...controlsProps} />
        <div className="w-full max-w-md h-[3.25rem] sm:h-9 border px-3 text-sm flex items-center overflow-hidden" style={{ color: robotReady && error ? "var(--vscode-errorForeground)" : "var(--vscode-descriptionForeground)", backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}>
          <span className="line-clamp-2 min-w-0 sm:line-clamp-1 sm:truncate">
            {statusMessage}
          </span>
        </div>
        <div className="w-full max-w-md border p-3 grid gap-3" style={{ backgroundColor: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" }}>
          <SpeedSlider label="Linear" value={linearSpeed} min={0.1} max={0.5} onChange={setLinearSpeed} />
          <SpeedSlider label="Angular" value={angularSpeed} min={0.1} max={1.0} onChange={setAngularSpeed} />
        </div>
      </div>
    </div>
  );
}
