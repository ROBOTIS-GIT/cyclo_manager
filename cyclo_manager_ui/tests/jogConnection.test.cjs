// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compile = file => ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const source = compile('hooks/useJogConnection.ts');
const constants = { exports: {} };
vm.runInNewContext(compile('lib/jog.ts'), constants);

// Drive the hook through browser events, server replies and a deterministic clock.
// No network or robot is involved. Hook slots survive explicit renders.
function fixture(statusRequest = () => Promise.resolve({ ready: true }), container = 'ai_worker') {
  let now = 0, timerId = 0, cursor = 0, value;
  const timers = new Map(), slots = [], effects = [], sockets = [], statusRequests = [], statusContainers = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) {
      const i = cursor++;
      return slots[i] ??= { current: initial };
    },
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useCallback(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { callback, deps };
      return slots[i].callback;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: effect() };
      });
    },
  };
  const window = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  const schedule = (run, delay, interval = false) => {
    timers.set(++timerId, { run, at: now + delay, interval: interval ? delay : 0 });
    return timerId;
  };
  class Socket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = {
    exports: {}, window, document, WebSocket: Socket, AbortController, performance: { now: () => now },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
    require: name => {
      if (name === 'react') return react;
      if (name === '@/lib/jog') return constants.exports;
      if (name === '@/lib/websocketUtils') return { getWebSocketBaseUrl: () => 'ws://mock' };
      if (name === '@/hooks/usePolling') return polling.exports;
      if (name === '@/lib/api') return { getBringupStatus: (selected, signal) => {
        statusContainers.push(selected);
        statusRequests.push(signal);
        return statusRequest(signal);
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  const polling = { ...context, exports: {} };
  vm.runInNewContext(compile('hooks/usePolling.ts'), polling);
  vm.runInNewContext(source, context);
  const render = () => {
    cursor = 0;
    value = context.exports.useJogConnection(container);
    while (effects.length) effects.shift()();
    return value;
  };
  const advance = ms => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.run();
    }
    now = end;
  };
  render(); advance(0);
  const socket = sockets[0];
  socket.readyState = Socket.OPEN;
  socket.onopen();
  const reply = (robot = { ready: true, generation: 'run-1' }) => {
    socket.onmessage({ data: JSON.stringify({ state: { robot } }) });
    render();
  };
  reply(); value.setEnabled(true); render(); advance(90);
  return {
    get jog() { return value; }, socket, advance, reply, render, statusRequests, statusContainers,
    event: type => { window.dispatchEvent(new Event(type)); render(); },
    hide: () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); render(); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
    joints: () => socket.sent.filter(message => message.kind === 'joint'),
  };
}

test('held input heartbeats continue without waiting for status replies', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'coarse');
  assert.deepEqual(f.socket.sent.at(-1), { kind: 'joint', joint: 'head_joint1', direction: 1, resolution: 'coarse' });
  f.advance(210);
  assert.equal(f.joints().length, 3);
  f.jog.releaseJoint();
  assert.equal(f.socket.sent.at(-1).kind, 'release');
  const count = f.socket.sent.length;
  f.reply(); f.advance(300);
  assert.equal(f.socket.sent.length, count);
  f.unmount();
});

test('short press sends release immediately even without a status reply', () => {
  const f = fixture();
  f.jog.pressJoint('lift_joint', -1, 'fine');
  f.advance(10); f.jog.releaseJoint();
  assert.equal(f.socket.sent.at(-1).kind, 'release');
  f.advance(500);
  assert.equal(f.joints().length, 1);
  assert.equal(f.socket.sent.at(-1).kind, 'release');
  f.unmount();
});

test('release cancels a press that could not enter a blocked transport', () => {
  const f = fixture();
  f.socket.bufferedAmount = 1;
  f.jog.pressJoint('head_joint1', 1, 'normal');
  f.jog.releaseJoint();
  assert.equal(f.socket.sent.at(-1).kind, 'release');
  f.socket.bufferedAmount = 0;
  f.advance(400);
  assert.equal(f.joints().length, 0);
  f.unmount();
});

test('blocked transport keeps only the latest held intent and does not queue heartbeats', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'normal');
  f.socket.bufferedAmount = 1;
  f.advance(300);
  f.jog.pressJoint('head_joint1', -1, 'coarse');
  assert.equal(f.joints().length, 1);
  f.socket.bufferedAmount = 0;
  f.advance(10);
  assert.equal(f.joints().length, 2);
  assert.equal(f.joints().at(-1).direction, -1);
  assert.equal(f.joints().at(-1).resolution, 'coarse');
  f.unmount();
});

test('pointer events release joints while focus loss and tab exit send stop', () => {
  for (const event of ['pointerup', 'pointercancel', 'blur', 'pagehide', 'cyclo:jog-stop', 'hidden']) {
    const f = fixture();
    f.jog.pressJoint('head_joint1', 1, 'normal');
    if (event === 'hidden') f.hide();
    else f.event(event);
    assert.equal(f.socket.sent.at(-1).kind, event.startsWith('pointer') ? 'release' : 'stop', event);
    if (!event.startsWith('pointer')) assert.equal(f.jog.enabled, false, event);
    f.reply(); f.advance(400);
    assert.equal(f.joints().length, 1, event);
    assert.equal(f.socket.readyState, 1, event);
    f.unmount();
  }
});

test('release and a new press are sent in order without waiting for status', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'normal');
  f.jog.releaseJoint();
  f.jog.pressJoint('head_joint1', -1, 'normal');
  assert.deepEqual(f.socket.sent.slice(-3).map(message => message.kind), ['joint', 'release', 'joint']);
  f.jog.stop(true); f.render();
  assert.equal(f.jog.enabled, false);
  assert.equal(f.socket.sent.at(-1).kind, 'stop');
  f.unmount();
});

test('pointer release and cancellation still send stop for the base', () => {
  for (const event of ['pointerup', 'pointercancel']) {
    const f = fixture();
    f.jog.command({ kind: 'base', x: 0.1, y: 0, yaw: 0 });
    f.event(event);
    assert.equal(f.socket.sent.at(-1).kind, 'stop', event);
    f.unmount();
  }
});

test('unmount sends stop and cancels all periodic work', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'normal'); f.unmount();
  assert.equal(f.socket.sent.at(-1).kind, 'stop');
  assert.equal(f.socket.readyState, 3);
  const count = f.socket.sent.length;
  f.reply(); f.advance(1000);
  assert.equal(f.socket.sent.length, count);
});

test('changed or unavailable bringup disarms a held input', () => {
  for (const robot of [{ ready: true, generation: 'run-2' }, { ready: false, generation: 'run-1' }]) {
    const f = fixture();
    f.jog.pressJoint('head_joint1', 1, 'normal'); f.reply(robot);
    assert.equal(f.jog.enabled, false);
    f.advance(400);
    assert.equal(f.joints().length, 1);
    f.unmount();
  }
});

test('missing status closes and disarms even while inputs are still being sent', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'normal');
  f.advance(800); f.render();
  assert.equal(f.jog.enabled, false);
  assert.match(f.jog.error, /timed out/);
  assert.equal(f.socket.readyState, 3);
  assert.ok(f.joints().length > 1);
  const count = f.socket.sent.length;
  f.advance(1000);
  assert.equal(f.socket.sent.length, count);
  f.unmount();
});

test('bringup GET polls only while connected and is cancelled on unmount', async () => {
  const f = fixture();
  assert.equal(f.statusRequests.length, 1);
  await new Promise(setImmediate);
  for (let i = 0; i < 4; i++) { f.reply(); f.advance(500); }
  assert.equal(f.statusRequests.length, 2);
  f.unmount();
  assert.ok(f.statusRequests.every(signal => signal.aborted));
  f.advance(5000);
  assert.equal(f.statusRequests.length, 2);
});

test('slow bringup GETs never overlap and failed requests can be retried', async () => {
  let reject;
  const f = fixture(() => new Promise((_, fail) => { reject = fail; }));
  for (let i = 0; i < 10; i++) { f.reply(); f.advance(500); }
  assert.equal(f.statusRequests.length, 1);
  reject(new Error('Agent request timed out'));
  await new Promise(setImmediate);
  for (let i = 0; i < 2; i++) { f.reply(); f.advance(500); }
  assert.equal(f.statusRequests.length, 2);
  f.socket.close(); f.render();
  assert.ok(f.statusRequests.every(signal => signal.aborted));
  f.advance(5000);
  assert.equal(f.statusRequests.length, 2);
  f.unmount();
});

test('GET and WebSocket stay bound to the page container across independent windows', () => {
  const left = fixture(undefined, 'ai_worker');
  const right = fixture(undefined, 'open_manipulator');
  assert.equal(left.socket.url, 'ws://mock/ws/jog?container=ai_worker');
  assert.equal(right.socket.url, 'ws://mock/ws/jog?container=open_manipulator');
  assert.deepEqual(left.statusContainers, ['ai_worker']);
  assert.deepEqual(right.statusContainers, ['open_manipulator']);
  left.unmount();
  assert.equal(right.socket.readyState, 1);
  right.unmount();
});
