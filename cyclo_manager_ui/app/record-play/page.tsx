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
// Author: Hyungyu Kim

"use client";

import { useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { surface, secondary, button as neutral, danger, btn } from "@/components/ui/controlStyles";
import { useRecordPlay } from "@/hooks/useRecordPlay";
import { GROUP_LABELS, PHASE_LABELS, recordingTime, type Recording } from "@/lib/recordPlay";

const border = { borderColor: "var(--vscode-panel-border)" };
const control = neutral;
const primary = { ...neutral, background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)" };
const button = `${btn} inline-flex items-center justify-center gap-2`;
const field = "w-full rounded border p-1.5 text-sm disabled:opacity-50";

function TransportIcon({ stop = false }: { stop?: boolean }) {
  return <span aria-hidden="true">{stop ? "■" : "▶"}</span>;
}

type RepeatMode = "once" | "repeat" | "infinite";

export default function RecordPlayPage() {
  const api = useRecordPlay();
  const [tab, setTab] = useState<"play" | "record">("play");
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [rate, setRate] = useState(1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("once");
  const [repeats, setRepeats] = useState(5);
  const [arrivalTolerance, setArrivalTolerance] = useState(0.5);
  const { overview, state } = api;
  const recordings = overview?.recordings ?? [];
  const activeRecording = overview?.recordings.find(item => item.id === state?.recording_id);
  const activeMotion = !!state?.active && state.phase !== "recording";
  const recording = (activeMotion ? activeRecording : undefined)
    ?? recordings.find(item => item.id === selected) ?? recordings[0];
  const supportedGroups = overview?.groups ?? [];
  const chosen = groups.filter(group => supportedGroups.some(item => item.id === group));
  const active = !!state?.active;
  const locked = active || api.busy;
  const available = api.connected;
  const canPlay = available && !!overview?.feedback_ready;
  const sameRecording = !!recording && state?.recording_id === recording.id;
  const shownRate = activeMotion ? state.rate ?? 1 : rate;
  const shownMode = activeMotion ? state.repeats === 0 ? "infinite" : state.repeats === 1 ? "once" : "repeat" : repeatMode;
  const shownRepeats = activeMotion && state.repeats > 0 ? state.repeats : repeats;
  const shownArrivalTolerance = activeMotion ? state.arrival_tolerance_deg ?? 0.5 : arrivalTolerance;
  const showProgress = sameRecording && (activeMotion || (state?.phase === "completed" && rate === (state.rate ?? 1)));
  const elapsed = showProgress ? state?.elapsed ?? 0 : 0;
  const duration = sameRecording && active && state?.duration ? state.duration : (recording?.duration ?? 0) / shownRate;
  const progress = duration ? Math.min(100, elapsed / duration * 100) : 0;
  const phaseLabel = sameRecording && state ? PHASE_LABELS[state.phase] : "Ready to play";
  const transitioning = sameRecording && activeMotion && (state.phase === "preparing" || state.phase === "returning");
  const error = api.error || state?.error;
  const isRecording = active && state?.phase === "recording";
  const command = { recording_id: recording?.id, rate, repeats: repeatMode === "infinite" ? 0 : repeatMode === "repeat" ? repeats : 1,
    arrival_tolerance_deg: arrivalTolerance };

  async function save() {
    const result = await api.action("stop");
    if (result?.recording_id && result.phase !== "error") {
      setSelected(result.recording_id); setTab("play"); setName("");
    }
  }

  async function removeRecording(item: Recording) {
    if (!window.confirm(`Delete "${item.name}"? This permanently deletes the recording and its rosbag files.`)) return;
    if (await api.removeRecording(item.id)) {
      setSelected(current => current === item.id ? "" : current);
    }
  }

  const stopButton = <button type="button" className={button} style={danger}
    disabled={!activeMotion || api.busy} onClick={() => void api.action("stop")}>
    <TransportIcon stop />Stop
  </button>;

  return <div className="h-full overflow-auto min-w-0" style={{ color: "var(--vscode-foreground)", background: "var(--vscode-editor-background)" }}>
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b" style={surface}>
      <div>
        <h1 className="text-lg font-semibold">Record & Play</h1>
        <div className="flex items-center gap-2 text-xs mt-1" style={secondary}>
          <StatusBadge status={api.connected} dotOnly label={api.connected ? "Connected" : "Disconnected"} />
          {api.connected ? "Server connected" : "Server disconnected"}
        </div>
        <div className="flex items-center gap-2 text-xs mt-1" style={secondary} aria-live="polite">
          <StatusBadge status={!!overview?.feedback_ready} dotOnly label="Controller feedback" />
          Controller feedback: {overview ? overview.feedback_ready ? "Available" : "Unavailable" : "Checking…"}
        </div>
      </div>
    </header>

    {error && <div role="alert" className="m-4 break-words rounded border p-3 text-sm" style={danger}>{error}</div>}

    <div className="p-2 md:p-5">
      <div role="tablist" aria-label="Record & Play mode" className="flex gap-2 mb-4">
        {([{ value: "play", label: "Playback", active: activeMotion }, { value: "record", label: "New recording", active: isRecording }] as const).map(item =>
          <button type="button" key={item.value} role="tab" id={`rp-${item.value}-tab`}
            aria-controls={`rp-${item.value}-panel`} aria-selected={tab === item.value} disabled={api.busy}
            className={`${button} flex-1 sm:flex-none whitespace-nowrap`} style={tab === item.value ? primary : neutral}
            onClick={() => setTab(item.value)}>
            {item.label}
            {item.active && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
          </button>)}
      </div>

      <div id="rp-play-panel" role="tabpanel" aria-labelledby="rp-play-tab" hidden={tab !== "play"}>
        {isRecording && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm" style={surface}>
          <span>Recording in progress <span className="ml-2 tabular-nums" style={secondary}>{recordingTime(state.elapsed)}</span></span>
          <button className="underline underline-offset-4" onClick={() => setTab("record")}>View recording</button>
        </div>}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
          <section className="order-2 min-w-0 overflow-hidden rounded-lg border lg:order-1" aria-label="Recordings" style={surface}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={border}>
              <h2 className="text-sm font-semibold">Recordings</h2>
              <span className="text-xs tabular-nums" style={secondary}>{recordings.length}</span>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 lg:max-h-[32rem]">
              {recordings.map(item => <div key={item.id}
                className="mb-1 flex w-full min-w-0 items-start rounded-lg border transition-colors last:mb-0"
                style={item.id === recording?.id ? { ...border, background: "var(--vscode-editor-background)", borderColor: "var(--vscode-focusBorder)" } : border}>
                <button type="button" aria-pressed={item.id === recording?.id} disabled={locked}
                  className="min-w-0 flex-1 rounded-lg px-3 py-3 text-left disabled:cursor-not-allowed"
                  style={{ opacity: locked && item.id !== recording?.id ? .5 : 1 }}
                  onClick={() => setSelected(item.id)}>
                  <span className="block break-words text-sm font-medium">{item.name}</span>
                  <span className="mt-1.5 flex items-start justify-between gap-3 text-xs" style={secondary}>
                    <span className="min-w-0 break-words">{item.groups.map(group => GROUP_LABELS[group] ?? group).join(" · ")}</span>
                    <span className="shrink-0 tabular-nums">{recordingTime(item.duration)}</span>
                  </span>
                </button>
                <button type="button" aria-label={`Delete recording ${item.name}`} title={`Delete ${item.name}`}
                  className="mr-2 mt-2 inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 text-xs hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  style={neutral} disabled={!available || locked}
                  onClick={() => void removeRecording(item)}>
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                  </svg>
                  Delete
                </button>
              </div>)}
              {!recordings.length && <p className="px-3 py-6 text-center text-sm" style={secondary}>No recordings yet</p>}
            </div>
          </section>

          <section className="order-1 min-w-0 lg:order-2" aria-label="Playback controls">
            {recording ? <div className="overflow-hidden rounded-lg border" style={surface}>
              <div className="border-b p-4 md:p-5" style={border}>
                <h2 className="min-w-0 break-words font-semibold">{recording.name}</h2>
                <p className="mt-1.5 text-xs leading-relaxed" style={secondary}>{recording.groups.map(group => GROUP_LABELS[group] ?? group).join(" · ")}</p>
              </div>

              <div className="p-4 md:p-5">
                <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite">
                  <span className="flex items-center gap-2" style={secondary}>
                    {sameRecording && activeMotion && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--vscode-focusBorder)" }} />}
                    {phaseLabel}
                  </span>
                  {showProgress && (state?.cycle ?? 0) > 0 && <span className="tabular-nums" style={secondary}>Play {state!.cycle} / {state!.repeats || "∞"}</span>}
                </div>
                <div className="mt-4 flex flex-wrap items-baseline gap-2 tabular-nums">
                  <span className="text-4xl font-medium tracking-tight">{recordingTime(elapsed)}</span>
                  <span className="text-sm" style={secondary}>/ {recordingTime(duration)}</span>
                </div>
                <div role="progressbar" aria-label="Playback progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}
                  className="mt-4 h-1 overflow-hidden rounded-full" style={{ background: "var(--vscode-panel-border)" }}>
                  <div className="h-full transition-[width] duration-300" style={{ width: `${progress}%`, background: "var(--vscode-focusBorder)" }} />
                </div>
                <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <button type="button" className={button} style={primary} disabled={!canPlay || locked}
                    onClick={() => void api.action("play", command)}><TransportIcon />Play</button>
                  {stopButton}
                </div>
                <p className="mt-2.5 text-xs leading-relaxed" style={secondary}>
                  {transitioning ? `Moving to start pose · ${state.return_duration.toFixed(1)} s planned` : "Play moves to the start pose automatically."}
                </p>
              </div>

              <fieldset className="grid grid-cols-2 gap-3 border-t p-4 md:p-5" disabled={locked} style={border}>
                <legend className="sr-only">Playback settings</legend>
                <label className="min-w-0 text-xs" style={secondary}>Speed
                  <select aria-label="Playback speed" className={`${field} mt-2`} style={control} value={shownRate} onChange={event => setRate(Number(event.target.value))}>
                    <option value={0.5}>0.5×</option><option value={1}>1×</option>
                  </select>
                </label>
                <label className="min-w-0 text-xs" style={secondary}>Playback
                  <select aria-label="Repeat mode" className={`${field} mt-2`} style={control} value={shownMode} onChange={event => setRepeatMode(event.target.value as RepeatMode)}>
                    <option value="once">Once</option><option value="repeat">Repeat</option><option value="infinite">Infinite</option>
                  </select>
                </label>
                {shownMode === "repeat" && <label className="col-span-2 flex flex-wrap items-center justify-between gap-3 text-xs" style={secondary}>Total plays
                  <input aria-label="Total plays" type="number" min={1} max={10000} className="w-24 rounded border p-1.5 text-sm tabular-nums" style={control} value={shownRepeats}
                    onChange={event => setRepeats(Math.max(1, Math.min(10000, Math.trunc(Number(event.target.value)) || 1)))} />
                </label>}
                <label className="col-span-2 flex flex-wrap items-center justify-end gap-3 text-xs" style={secondary}>
                  <span className="text-right">Arrival tolerance<span className="mt-1 block">Linear joints: 1 mm</span></span>
                  <select aria-label="Arrival tolerance" className="w-24 rounded border p-1.5 text-sm disabled:opacity-50" style={control}
                    value={shownArrivalTolerance} onChange={event => setArrivalTolerance(Number(event.target.value))}>
                    <option value={0.5}>0.5°</option><option value={1}>1°</option><option value={2}>2°</option><option value={3}>3°</option>
                  </select>
                </label>
                {shownMode !== "once" && <p className="col-span-2 text-xs leading-relaxed" style={secondary}>Returns to the start pose between plays.</p>}
              </fieldset>

              <details className="border-t px-4 py-3 text-xs md:px-5" style={{ ...border, ...secondary }}>
                <summary className="cursor-pointer py-1">Recording details</summary>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                  <dt>Recorded</dt><dd>{new Date(recording.created_at).toLocaleString("en-US")}</dd>
                  <dt>Messages</dt><dd className="tabular-nums">{recording.messages.toLocaleString("en-US")}</dd>
                  <dt>Storage</dt><dd className="break-all">{overview?.storage ?? "/cyclo_manager_ros_bags"}</dd>
                </dl>
                {!!recording.omitted_groups?.length && <p className="mt-3">Excluded (no messages): {recording.omitted_groups.map(group => GROUP_LABELS[group] ?? group).join(", ")}</p>}
                <div className="mt-4 border-t pt-3" style={border}><p className="mb-2 font-medium">Recorded topics</p>{recording.topics.map(topic => <code key={topic} className="mt-1.5 block break-all">{topic}</code>)}</div>
              </details>
            </div> : <div className="rounded-lg border px-6 py-12 text-center" style={surface}>
              <h2 className="font-semibold">{activeMotion ? "Playback in progress" : "Record your first motion"}</h2>
              <p className="mt-2 text-sm" style={secondary}>{activeMotion ? PHASE_LABELS[state.phase] : "Capture joint motion, then replay it here."}</p>
              <div className="mt-5">{activeMotion ? stopButton : <button className={button} style={primary} onClick={() => setTab("record")}>New recording</button>}</div>
            </div>}
          </section>
        </div>
      </div>

      <div id="rp-record-panel" role="tabpanel" aria-labelledby="rp-record-tab" hidden={tab !== "record"}>
        {activeMotion && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm" style={surface}>
          <span>{PHASE_LABELS[state.phase]} · {activeRecording?.name ?? state.robot?.toUpperCase()}</span>
          <button className="underline underline-offset-4" onClick={() => setTab("play")}>View playback</button>
        </div>}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <section className="order-2 min-w-0 rounded-lg border p-4 md:p-5 lg:order-1" style={surface} aria-label="Recording setup">
            <label className="block text-sm font-medium">Recording name
              <input className={`${field} mt-2`} style={control} value={name} maxLength={80} disabled={locked} placeholder="pick-and-place-01" onChange={event => setName(event.target.value)} />
            </label>
            <div className="mb-3 mt-6 flex justify-between text-sm"><h2 className="font-medium">Trajectory topics</h2><span className="text-xs" style={secondary}>{chosen.length} selected</span></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {supportedGroups.map(group => <div key={group.id} className="min-w-0 rounded-lg border px-3 py-2" style={chosen.includes(group.id) ? { ...border, background: "var(--vscode-editor-background)" } : border}>
                <label className="flex min-h-10 items-center gap-2.5 text-sm">
                  <input type="checkbox" checked={chosen.includes(group.id)} disabled={locked} onChange={event => setGroups(previous => event.target.checked ? [...previous, group.id] : previous.filter(value => value !== group.id))} />
                  <span className="break-all">{group.label}{group.recommended && <small className="ml-2" style={secondary}>Recommended</small>}</span>
                </label>
                <div className="flex flex-wrap items-start justify-between gap-x-3 text-xs" style={secondary}>
                  <span className="flex min-h-8 items-center gap-1.5"><StatusBadge status={group.receiving} dotOnly label={group.receiving ? "Publisher detected" : "No publisher"} />{group.receiving ? "Publisher detected" : "No publisher"}</span>
                  <details className="min-w-0 max-w-full basis-full">
                    <summary className="min-h-8 cursor-pointer py-1.5" aria-label={`Topic for ${group.label}`}>Topic</summary>
                    <code className="block select-text break-all pb-2">{group.topic}</code>
                  </details>
                </div>
              </div>)}
            </div>
            {!supportedGroups.length && <p className="rounded-lg border p-5 text-sm" style={{ ...border, ...secondary }}>No JointTrajectory topics discovered.</p>}
          </section>
          <section className="order-1 min-w-0 rounded-lg border p-4 md:p-5 lg:order-2" style={surface} aria-label="Recording controls">
            <p className="flex items-center gap-2 text-xs" style={secondary}>{isRecording && <span className="h-2 w-2 rounded-full bg-red-500" />} {isRecording ? "Recording" : "Ready to record"}</p>
            <div className="mt-4 text-4xl font-medium tabular-nums tracking-tight">{recordingTime(isRecording ? state.elapsed : 0)}</div>
            <p className="mt-2 text-xs tabular-nums" style={secondary}>{isRecording ? `${state.messages.toLocaleString("en-US")} messages` : `${chosen.length} topics`}</p>
            <div className="mt-6 flex flex-col gap-2">
              <button type="button" className={button} style={primary} disabled={!available || locked || !chosen.length || !name.trim()} onClick={() => void api.action("record", { name: name.trim(), groups: chosen })}><span aria-hidden="true">●</span>recording start</button>
              <button type="button" className={button} style={danger} disabled={!isRecording || api.busy} onClick={() => void save()}><TransportIcon stop />stop and save</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>;
}
