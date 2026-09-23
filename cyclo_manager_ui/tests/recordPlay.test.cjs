// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const sources = Object.fromEntries(['lib/recordPlay.ts', 'hooks/useRecordPlay.ts', 'app/record-play/page.tsx'].map(file => [file, compile(file)]));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const idle = { phase: 'idle', active: false, error: null, owner: null, robot: null, recording_id: null,
  elapsed: 0, duration: 0, return_duration: 0, cycle: 0, repeats: 1, messages: 0, rate: 1, arrival_tolerance_deg: 0.5 };
const bag = (id, name) => ({ id, name, groups: ['arm_l'], topics: ['/left'], messages: 10, duration: 1, created_at: '2026-09-23T00:00:00Z' });

// Small hook-slot fixture, as in navigation.test.cjs: exercise the real page,
// hook and API adapter while replacing only React scheduling and transport.
function fixture({ recordings = [bag('a', 'First motion'), bag('b', 'Second motion')], state = idle, feedbackReady = false } = {}) {
  let cursor = 0, tree, api, mounted = true, tick, now = 10000;
  const slots = [], effects = [], calls = [], confirmations = [];
  const same = (left, right) => left?.length === right.length && right.every((item, index) => Object.is(item, left[index]));
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, next => {
      assert.ok(mounted, 'Unmounted component must not update state');
      slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;
    }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => {
      slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
    }); },
  };
  const f = {
    confirmed: true, state, recordings, calls, confirmations, feedbackReady,
    load: async () => ({ state: f.state, recordings: f.recordings, groups: [], feedback_ready: f.feedbackReady, storage: '/bags' }),
    status: async () => f.state,
    command: async () => f.state,
    remove: async id => { f.recordings = f.recordings.filter(item => item.id !== id); return f.state; },
  };
  const request = async config => {
    calls.push(config);
    if (config.method === 'DELETE') return f.remove(decodeURIComponent(config.url.split('/').at(-1)));
    if (config.method === 'POST') return f.command(config);
    if (config.url === '/record_play/status') return f.status();
    if (config.url === '/record_play') return f.load();
    return f.state;
  };
  const jsx = (type, props) => ({ type, props });
  let hook, library;
  const requireMock = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/lib/api') return { request };
    if (name === '@/lib/recordPlay') return library;
    if (name === '@/hooks/useRecordPlay') return { useRecordPlay: () => (api = hook.useRecordPlay()) };
    if (name === '@/lib/websocketUtils') return { getWebSocketBaseUrl: () => 'ws://mock', maintainWebSocket: () => () => {} };
    if (name === '@/components/StatusBadge') return { default: 'StatusBadge' };
    if (name === '@/components/ui/controlStyles') return {};
    throw new Error(`Unexpected import: ${name}`);
  };
  const load = file => {
    const context = { exports: {}, require: requireMock, Error, Date: class extends Date { static now() { return now; } },
      window: { confirm: message => { confirmations.push(message); return f.confirmed; } },
      setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {},
    };
    vm.runInNewContext(sources[file], context); return context.exports;
  };
  library = load('lib/recordPlay.ts'); hook = load('hooks/useRecordPlay.ts');
  const page = load('app/record-play/page.tsx');
  f.render = () => { cursor = 0; tree = page.default(); while (effects.length) effects.shift()(); return tree; };
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  f.nodes = () => nodes(tree);
  f.descendants = nodes;
  f.deleteButton = name => f.nodes().find(node => node.type === 'button' && node.props['aria-label'] === `Delete recording ${name}`);
  f.details = () => f.nodes().find(node => node.type === 'h2' && node.props.children === 'Record your first motion');
  f.api = () => api;
  f.tick = () => { now += 3000; tick(); };
  f.unmount = () => { for (const slot of slots) slot?.cleanup?.(); mounted = false; };
  f.render();
  return f;
}

async function ready(options) { const f = fixture(options); await flush(); f.render(); return f; }

test('named confirmation can cancel deletion; missing ROS feedback does not disable it', async () => {
  const f = await ready();
  assert.equal(f.deleteButton('First motion').props.disabled, false);
  f.confirmed = false; f.deleteButton('First motion').props.onClick(); await flush();
  assert.match(f.confirmations[0], /First motion/);
  assert.match(f.confirmations[0], /permanently/);
  assert.equal(f.calls.filter(item => item.method === 'DELETE').length, 0);
});

test('delete removes disk API target, selects remaining row and clears last-row details', async () => {
  const f = await ready();
  f.deleteButton('First motion').props.onClick(); await flush(); f.render();
  assert.equal(f.deleteButton('First motion'), undefined);
  assert.ok(f.nodes().some(node => node.type === 'h2' && node.props.children === 'Second motion'));
  assert.equal(f.calls.find(item => item.method === 'DELETE').url, '/record_play/recordings/a');
  f.deleteButton('Second motion').props.onClick(); await flush(); f.render();
  assert.ok(f.details());
  assert.equal(f.nodes().filter(node => node.type === 'button' && String(node.props['aria-label']).startsWith('Delete recording')).length, 0);
  assert.equal(f.calls.some(item => item.method === 'POST'), false, 'Deleting must not start or stop robot motion');
});

test('recording and playback disable deletion; buttons are siblings', async () => {
  for (const phase of ['recording', 'preparing', 'playing']) {
    const f = await ready({ state: { ...idle, active: true, phase, recording_id: 'a' } });
    assert.equal(f.deleteButton('First motion').props.disabled, true);
    assert.equal(f.deleteButton('Second motion').props.disabled, true);
    for (const button of f.nodes().filter(node => node.type === 'button')) {
      assert.equal(f.descendants(button.props.children).filter(node => node.type === 'button').length, 0);
    }
  }
});

test('busy deletion disables all delete actions and API failure keeps the recording with an error', async () => {
  const f = await ready(); const pending = deferred(); f.remove = () => pending.promise;
  f.deleteButton('First motion').props.onClick(); f.render();
  assert.equal(f.deleteButton('First motion').props.disabled, true);
  assert.equal(f.deleteButton('Second motion').props.disabled, true);
  pending.reject(new Error('Recording is active')); await flush(); f.render();
  assert.ok(f.deleteButton('First motion'));
  assert.equal(f.api().busy, false);
  assert.equal(f.api().error, 'Recording is active');
});

test('deletion waits for an older overview before refreshing and removes confirmed rows even if refresh fails', async () => {
  const f = await ready(); const oldOverview = deferred(); const snapshot = await f.load();
  f.load = () => oldOverview.promise; f.tick(); await flush();
  f.deleteButton('First motion').props.onClick(); await flush();
  f.load = async () => { throw new Error('Server unavailable'); };
  oldOverview.resolve(snapshot); await flush(); f.render();
  assert.equal(f.deleteButton('First motion'), undefined);
  assert.equal(f.deleteButton('Second motion').props.disabled, true, 'Disconnected server disables deletion');
  assert.equal(f.api().busy, false);
});

test('unmount ignores a late delete response without refreshing or setting state', async () => {
  const f = await ready(); const pending = deferred(); f.remove = () => pending.promise;
  const removal = f.api().removeRecording('a'); f.unmount();
  const count = f.calls.length; pending.resolve(idle); await removal;
  assert.equal(f.calls.length, count);
});

const toleranceSelect = f => f.nodes().find(node => node.type === 'select' && node.props['aria-label'] === 'Arrival tolerance');
const playbackSettings = f => f.nodes().find(node => node.type === 'fieldset' && f.descendants(node).includes(toleranceSelect(f)));

test('arrival tolerance defaults to 0.5 degrees and offers explicit angular choices', async () => {
  const f = await ready();
  const select = toleranceSelect(f);
  assert.equal(select.props.value, 0.5);
  const options = f.descendants(select).filter(node => node.type === 'option');
  assert.deepEqual(Array.from(options, node => node.props.value), [0.5, 1, 2, 3]);
  assert.deepEqual(Array.from(options, node => node.props.children), ['0.5°', '1°', '2°', '3°']);
  assert.equal(playbackSettings(f).props.disabled, false);
  assert.ok(f.nodes().some(node => node.type === 'span' && node.props.children === 'Linear joints: 1 mm'));
});

test('Play sends the default or selected arrival tolerance as a number', async () => {
  for (const value of [0.5, 1, 2, 3]) {
    const f = await ready({ feedbackReady: true });
    if (value !== 0.5) {
      toleranceSelect(f).props.onChange({ target: { value: String(value) } }); f.render();
    }
    const play = f.nodes().find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Play'));
    assert.equal(play.props.disabled, false);
    play.props.onClick(); await flush();
    const command = f.calls.find(item => item.method === 'POST' && item.url === '/record_play/play');
    assert.equal(command.data.arrival_tolerance_deg, value);
    assert.equal(typeof command.data.arrival_tolerance_deg, 'number');
  }
});

test('active jobs show the server arrival tolerance and lock the selection, including older states', async () => {
  for (const phase of ['loading', 'preparing', 'playing', 'returning', 'settling']) {
    for (const configured of [undefined, 2]) {
      const f = await ready({ state: { ...idle, active: true, phase, recording_id: 'a', arrival_tolerance_deg: configured } });
      assert.equal(toleranceSelect(f).props.value, configured ?? 0.5);
      assert.equal(playbackSettings(f).props.disabled, true);
    }
  }
});

test('a job started elsewhere overrides this page\'s local tolerance while active', async () => {
  const f = await ready();
  toleranceSelect(f).props.onChange({ target: { value: '1' } }); f.render();
  f.state = { ...idle, active: true, phase: 'playing', recording_id: 'a', arrival_tolerance_deg: 3 };
  f.tick(); await flush(); f.render();
  assert.equal(toleranceSelect(f).props.value, 3);
  assert.equal(playbackSettings(f).props.disabled, true);
});

const buttonWithText = (f, text) => f.nodes().find(node => node.type === 'button'
  && (node.props.children === text || (Array.isArray(node.props.children) && node.props.children.includes(text))));
const playing = { ...idle, active: true, phase: 'playing', recording_id: 'a' };

test('successful Play and Record enable Stop immediately without waiting for an older overview', async () => {
  for (const kind of ['play', 'record']) {
    const f = await ready({ feedbackReady: true });
    const snapshot = await f.load(); const oldOverview = deferred(); const newOverview = deferred();
    f.load = () => oldOverview.promise; f.tick(); await flush();
    const acknowledged = { ...playing, phase: kind === 'record' ? 'recording' : 'playing' };
    f.command = async () => acknowledged;
    const command = f.api().action(kind, {}); await flush(); f.render();
    assert.equal(f.api().busy, false, 'Overview refresh must not hold command busy');
    assert.equal(buttonWithText(f, kind === 'play' ? 'Stop' : 'stop and save').props.disabled, false);
    assert.equal(await command, acknowledged);
    f.load = () => newOverview.promise;
    oldOverview.resolve(snapshot); await flush(); f.render();
    assert.equal(f.api().state.active, true, 'Older idle state must not replace the command response');
    assert.equal(buttonWithText(f, kind === 'play' ? 'Stop' : 'stop and save').props.disabled, false);
    f.unmount(); newOverview.resolve(snapshot); await flush();
  }
});

test('overview and status reads from before or during a command cannot replace its acknowledgment or connection state', async () => {
  for (const source of ['overview', 'status']) {
    for (const timing of ['before', 'during']) {
      for (const outcome of ['idle', 'error']) {
        const f = await ready({ feedbackReady: true }); const snapshot = await f.load();
        const oldRead = deferred(); const acknowledgment = deferred(); const fresh = deferred();
        if (source === 'overview') f.load = () => oldRead.promise;
        else { f.status = () => oldRead.promise; f.load = () => fresh.promise; }
        if (timing === 'before') { f.tick(); await flush(); }
        f.command = () => acknowledgment.promise;
        const command = f.api().action('play', {});
        if (timing === 'during') { f.tick(); await flush(); }
        acknowledgment.resolve(playing); await command;
        if (source === 'overview') f.load = () => fresh.promise;
        if (outcome === 'idle') oldRead.resolve(source === 'overview' ? snapshot : idle);
        else oldRead.reject(new Error('Old connection failed'));
        await flush(); f.render();
        assert.equal(f.api().state.active, true, `${source}/${timing}/${outcome}`);
        assert.equal(f.api().connected, true);
        assert.equal(f.api().error, null);
        assert.equal(buttonWithText(f, 'Stop').props.disabled, false);
        f.unmount(); fresh.resolve(snapshot); await flush();
      }
    }
  }
});

test('a successful Stop remains stopped after older playing overview and status results arrive', async () => {
  for (const source of ['overview', 'status']) {
    const f = await ready({ state: playing }); const snapshot = await f.load();
    const oldRead = deferred(); const fresh = deferred();
    if (source === 'overview') f.load = () => oldRead.promise;
    else { f.status = () => oldRead.promise; f.load = () => fresh.promise; }
    f.tick(); await flush();
    f.command = async () => idle;
    await f.api().action('stop'); f.render();
    assert.equal(f.api().busy, false);
    assert.equal(f.api().state.active, false);
    if (source === 'overview') f.load = () => fresh.promise;
    oldRead.resolve(source === 'overview' ? snapshot : playing); await flush(); f.render();
    assert.equal(f.api().state.active, false);
    assert.equal(buttonWithText(f, 'Stop').props.disabled, true);
    f.unmount(); fresh.resolve(snapshot); await flush();
  }
});

test('confirmed deletion removes the row immediately and late overview cannot resurrect it', async () => {
  const f = await ready(); const snapshot = await f.load();
  const oldOverview = deferred(); const fresh = deferred();
  f.load = () => oldOverview.promise; f.tick(); await flush();
  await f.api().removeRecording('a'); f.render();
  assert.equal(f.api().busy, false);
  assert.equal(f.deleteButton('First motion'), undefined);
  f.load = () => fresh.promise;
  oldOverview.resolve(snapshot); await flush(); f.render();
  assert.equal(f.deleteButton('First motion'), undefined);
  assert.ok(f.deleteButton('Second motion'));
  const calls = f.calls.length; f.unmount(); fresh.resolve(snapshot); await flush();
  assert.equal(f.calls.length, calls);
});

test('unmount cancels an overview refresh queued behind an older request', async () => {
  const f = await ready(); const snapshot = await f.load(); const oldOverview = deferred();
  f.load = () => oldOverview.promise; f.tick(); await flush();
  f.command = async () => playing;
  await f.api().action('play', {});
  const calls = f.calls.length; f.unmount(); oldOverview.resolve(snapshot); await flush();
  assert.equal(f.calls.length, calls, 'Queued refresh must not start another request after unmount');
});
