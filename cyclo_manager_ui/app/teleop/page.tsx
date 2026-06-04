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
import { getServiceStatus, publishCmdVel } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

const TELEOP_CONTAINER = "ai_worker";
const ROBOT_SERVICE_NAME = "ai_worker_bringup";
const CMD_VEL_TOPIC = "/cmd_vel";
const LINEAR_SPEED = 0.4;
const ANGULAR_SPEED = 0.8;
const REPEAT_INTERVAL_MS = 120;
const STATUS_POLL_INTERVAL_MS = 2000;

type JogCommand = {
    id: "forward" | "left" | "stop" | "right" | "backward";
    label: string;
    hint: string;
    linearX: number;
    angularZ: number;
    gridClass: string;
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

export default function TeleopPage() {
    const [activeCommand, setActiveCommand] = useState<JogCommand["id"] | null>(null);
    const [robotRunning, setRobotRunning] = useState(false);
    const [statusText, setStatusText] = useState("Ready");
    const [error, setError] = useState<string | null>(null);
    const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let disposed = false;

        const loadRobotStatus = async () => {
            try {
                const serviceStatus = await getServiceStatus(TELEOP_CONTAINER, ROBOT_SERVICE_NAME);
                if (disposed) return;
                setRobotRunning(serviceStatus.is_up);
            } catch {
                if (disposed) return;
                setRobotRunning(false);
            }
        };

        void loadRobotStatus();
        const interval = setInterval(loadRobotStatus, STATUS_POLL_INTERVAL_MS);
        return () => {
            disposed = true;
            clearInterval(interval);
        };
    }, []);

    const publish = useCallback(async (linearX: number, angularZ: number) => {
        try {
            await publishCmdVel(TELEOP_CONTAINER, {
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
        if (publishStop && robotRunning) {
            void publish(0, 0);
        }
    }, [publish, robotRunning]);

    const startJog = useCallback((command: JogCommand) => {
        if (!robotRunning) return;
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
    }, [publish, robotRunning]);

    useEffect(() => {
        if (!robotRunning) {
            stopJog(false);
            setStatusText("Robot off");
        } else if (!activeCommand) {
            setStatusText("Ready");
        }
    }, [activeCommand, robotRunning, stopJog]);

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
            publishCmdVel(TELEOP_CONTAINER, {
                topic: CMD_VEL_TOPIC,
                linear_x: 0,
                angular_z: 0,
            }).catch(() => { });
        };
    }, []);

    const disabled = !robotRunning;

    return (
        <div className="h-full min-h-[320px] flex flex-col overflow-hidden">
            <header
                className="shrink-0 border-b px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderColor: "var(--vscode-panel-border)" }}
            >
                <h1
                    className="text-base font-semibold"
                    style={{ color: "var(--vscode-foreground)" }}
                >
                    Teleop
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
                        <StatusBadge status={robotRunning} dotOnly />
                        <span className="font-medium">{TELEOP_CONTAINER}</span>
                        <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                            {robotRunning ? "Robot on" : "Robot off"}
                        </span>
                    </div>
                </div>
            </header>
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-5 p-4">
                <div
                    className="grid grid-cols-3 grid-rows-3 gap-3 select-none"
                    style={{ touchAction: "none" }}
                >
                    {JOG_COMMANDS.map((command) => {
                        const active = activeCommand === command.id;
                        return (
                            <button
                                key={command.id}
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
                                    if (activeCommand === command.id) stopJog();
                                }}
                                className={`${command.gridClass} h-20 w-20 sm:h-24 sm:w-24 border text-3xl font-semibold transition-colors disabled:cursor-not-allowed`}
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
                                }}
                            >
                                {command.label}
                            </button>
                        );
                    })}
                </div>
                <div
                    className="w-full max-w-md border px-3 py-2 text-sm"
                    style={{
                        color: robotRunning && error ? "var(--vscode-errorForeground)" : "var(--vscode-descriptionForeground)",
                        backgroundColor: "var(--vscode-sidebar-background)",
                        borderColor: "var(--vscode-panel-border)",
                    }}
                >
                    {robotRunning ? error ?? statusText : "Robot off"}
                </div>
            </div>
        </div>
    );
}
