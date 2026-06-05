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
import { getServiceLogs, getServiceStatus, publishCmdVel } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

const JOG_CONTAINER = "ai_worker";
const ROBOT_SERVICE_NAME = "ai_worker_bringup";
const CMD_VEL_TOPIC = "/cmd_vel";
const BRINGUP_START_LOG = "[ai_worker_bringup] Starting service...";
const CONTROLLER_CONFIGURED_LOG =
    "[spawner_swerve_drive_controller]: Configured and activated swerve_drive_controller";
const LINEAR_SPEED = 0.4;
const ANGULAR_SPEED = 0.8;
const REPEAT_INTERVAL_MS = 120;
const STATUS_POLL_INTERVAL_MS = 2000;
const READY_LOG_TAIL_LINES = 1000;

type JogCommand = {
    id: "forward" | "left" | "stop" | "right" | "backward";
    label: string;
    hint: string;
    linearX: number;
    angularZ: number;
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
    {
        id: "forward",
        label: "↑",
        hint: "Forward",
        linearX: LINEAR_SPEED,
        angularZ: 0,
        gridClass: "col-start-2 row-start-1",
    },
    {
        id: "left",
        label: "←",
        hint: "Turn left",
        linearX: 0,
        angularZ: ANGULAR_SPEED,
        gridClass: "col-start-1 row-start-2",
    },
    {
        id: "stop",
        label: "■",
        hint: "Stop",
        linearX: 0,
        angularZ: 0,
        gridClass: "col-start-2 row-start-2",
    },
    {
        id: "right",
        label: "→",
        hint: "Turn right",
        linearX: 0,
        angularZ: -ANGULAR_SPEED,
        gridClass: "col-start-3 row-start-2",
    },
    {
        id: "backward",
        label: "↓",
        hint: "Backward",
        linearX: -LINEAR_SPEED,
        angularZ: 0,
        gridClass: "col-start-2 row-start-3",
    },
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
                startJog(command);
            }}
            onPointerUp={(event) => {
                event.preventDefault();
                stopJog();
            }}
            onPointerCancel={() => stopJog()}
            onPointerLeave={() => {
                if (active) stopJog();
            }}
            className={`${className} border font-semibold transition-colors disabled:cursor-not-allowed`}
            style={{
                color: active
                    ? "var(--vscode-button-foreground)"
                    : "var(--vscode-foreground)",
                backgroundColor: active
                    ? "var(--vscode-button-background)"
                    : "var(--vscode-button-secondaryBackground)",
                borderColor: active
                    ? "var(--vscode-focusBorder)"
                    : "var(--vscode-panel-border)",
                opacity: disabled ? 0.45 : 1,
                boxShadow: active
                    ? "inset 0 0 0 2px var(--vscode-focusBorder), inset 0 3px 8px rgba(0, 0, 0, 0.35)"
                    : "0 1px 0 rgba(255, 255, 255, 0.06)",
                transform: active ? "translateY(1px) scale(0.97)" : "translateY(0) scale(1)",
                transition: "background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 80ms ease",
            }}
        >
            {command.label}
        </button>
    );
}

function JogDesktopControls({
    commands,
    activeCommand,
    disabled,
    startJog,
    stopJog,
}: JogControlsProps) {
    return (
        <div
            className="hidden md:grid grid-cols-3 grid-rows-3 gap-3 select-none"
            style={{ touchAction: "none" }}
        >
            {commands.map((command) => (
                <JogButton
                    key={command.id}
                    command={command}
                    active={activeCommand === command.id}
                    disabled={disabled}
                    startJog={startJog}
                    stopJog={stopJog}
                    className={`${command.gridClass} h-24 w-24 text-3xl`}
                />
            ))}
        </div>
    );
}

function JogMobileControls({
    commands,
    activeCommand,
    disabled,
    startJog,
    stopJog,
}: JogControlsProps) {
    const commandById = Object.fromEntries(commands.map((command) => [command.id, command])) as
        Record<JogCommand["id"], JogCommand>;
    const rows: JogCommand["id"][][] = [
        ["forward"],
        ["left", "stop", "right"],
        ["backward"],
    ];

    return (
        <div
            className="md:hidden w-full max-w-sm select-none"
            style={{ touchAction: "none" }}
        >
            <div className="grid grid-cols-3 gap-2.5">
                {rows.map((row, rowIndex) => {
                    const isSingle = row.length === 1;
                    return (
                        <div key={`row-${rowIndex}`} className="col-span-3 grid grid-cols-3 gap-2.5">
                            {isSingle && <div aria-hidden />}
                            {row.map((id) => {
                                const command = commandById[id];
                                return (
                                    <JogButton
                                        key={command.id}
                                        command={command}
                                        active={activeCommand === command.id}
                                        disabled={disabled}
                                        startJog={startJog}
                                        stopJog={stopJog}
                                        className="aspect-square w-full text-3xl"
                                    />
                                );
                            })}
                            {isSingle && <div aria-hidden />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function JogPage() {
    const [activeCommand, setActiveCommand] = useState<JogCommand["id"] | null>(null);
    const [robotRunning, setRobotRunning] = useState(false);
    const [controllerReady, setControllerReady] = useState(false);
    const [statusText, setStatusText] = useState("Ready");
    const [error, setError] = useState<string | null>(null);
    const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const warmedUpRef = useRef(false);
    const statusPollInFlightRef = useRef(false);

    const robotReady = robotRunning && controllerReady;

    const resetControllerReady = useCallback(() => {
        warmedUpRef.current = false;
        setControllerReady(false);
    }, []);

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

                const logsResponse = await getServiceLogs(
                    JOG_CONTAINER,
                    ROBOT_SERVICE_NAME,
                    READY_LOG_TAIL_LINES
                );
                if (disposed) return;
                const startIndex = logsResponse.logs.lastIndexOf(BRINGUP_START_LOG);
                const currentRunLogs =
                    startIndex >= 0 ? logsResponse.logs.slice(startIndex) : "";
                if (currentRunLogs.includes(CONTROLLER_CONFIGURED_LOG)) {
                    setControllerReady(true);
                } else {
                    resetControllerReady();
                }
            } catch {
                if (disposed) return;
                setRobotRunning(false);
                resetControllerReady();
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

    const publish = useCallback(async (linearX: number, angularZ: number) => {
        try {
            await publishCmdVel(JOG_CONTAINER, {
                topic: CMD_VEL_TOPIC,
                linear_x: linearX,
                angular_z: angularZ,
            });
            setError(null);
            setStatusText(
                `linear.x ${linearX.toFixed(2)} m/s · angular.z ${angularZ.toFixed(2)} rad/s`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to publish /cmd_vel");
        }
    }, []);

    const stopJog = useCallback((publishStop = true) => {
        if (repeatRef.current) {
            clearInterval(repeatRef.current);
            repeatRef.current = null;
        }
        setActiveCommand(null);
        if (publishStop && robotReady) {
            void publish(0, 0);
        }
    }, [publish, robotReady]);

    const startJog = useCallback((command: JogCommand) => {
        if (!robotReady) return;
        if (repeatRef.current) {
            clearInterval(repeatRef.current);
            repeatRef.current = null;
        }
        setActiveCommand(command.id);
        void publish(command.linearX, command.angularZ);
        if (command.id !== "stop") {
            repeatRef.current = setInterval(() => {
                void publish(command.linearX, command.angularZ);
            }, REPEAT_INTERVAL_MS);
        }
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
            const key = event.key.toLowerCase();
            const command =
                key === "w" ? JOG_COMMANDS[0] :
                    key === "a" ? JOG_COMMANDS[1] :
                        key === " " ? JOG_COMMANDS[2] :
                            key === "d" ? JOG_COMMANDS[3] :
                                key === "s" ? JOG_COMMANDS[4] :
                                    null;
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
        return () => {
            if (repeatRef.current) clearInterval(repeatRef.current);
            publishCmdVel(JOG_CONTAINER, {
                topic: CMD_VEL_TOPIC,
                linear_x: 0,
                angular_z: 0,
            }).catch(() => { });
        };
    }, []);

    const disabled = !robotReady;
    const controlsProps = {
        commands: JOG_COMMANDS,
        activeCommand,
        disabled,
        startJog,
        stopJog,
    };

    return (
        <div className="h-full min-h-[320px] flex flex-col overflow-hidden">
            <header
                className="shrink-0 border-b px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                style={{ borderColor: "var(--vscode-panel-border)" }}
            >
                <h1
                    className="text-base font-semibold"
                    style={{ color: "var(--vscode-foreground)" }}
                >
                    Jog
                </h1>
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className="h-8 px-2.5 border flex items-center gap-2 text-sm"
                        style={{
                            color: "var(--vscode-foreground)",
                            backgroundColor: "var(--vscode-sidebar-background)",
                            borderColor: "var(--vscode-panel-border)",
                        }}
                    >
                        <StatusBadge status={robotReady} dotOnly />
                        <span className="font-medium">{JOG_CONTAINER}</span>
                        <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                            {robotReady ? "Robot on" : "Robot off"}
                        </span>
                    </div>
                </div>
            </header>
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-5 p-4">
                <JogDesktopControls {...controlsProps} />
                <JogMobileControls {...controlsProps} />
                <div
                    className="w-full max-w-md border px-3 py-2 text-sm"
                    style={{
                        color: robotReady && error ? "var(--vscode-errorForeground)" : "var(--vscode-descriptionForeground)",
                        backgroundColor: "var(--vscode-sidebar-background)",
                        borderColor: "var(--vscode-panel-border)",
                    }}
                >
                    {robotReady ? error ?? statusText : "Robot off"}
                </div>
            </div>
        </div>
    );
}
