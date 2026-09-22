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
function fixture() {
  let now = 0, timerId = 0, cursor = 0, value;
  const timers = new Map(), slots = [], effects = [], sockets = [];
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
    sent = [];
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = {
    exports: {}, window, document, WebSocket: Socket, performance: { now: () => now },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
    require: name => {
      if (name === 'react') return react;
      if (name === '@/lib/jog') return constants.exports;
      if (name === '@/lib/websocketUtils') return { getWebSocketBaseUrl: () => 'ws://mock' };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  const render = () => {
    cursor = 0;
    value = context.exports.useJogConnection();
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
    get jog() { return value; }, socket, advance, reply, render,
    event: type => { window.dispatchEvent(new Event(type)); render(); },
    hide: () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); render(); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
    joints: () => socket.sent.filter(message => message.kind === 'joint'),
  };
}

test('press starts continuous input without a hold delay and repeats until release', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'coarse');
  assert.deepEqual(f.socket.sent.at(-1), { kind: 'joint', joint: 'head_joint1', direction: 1, resolution: 'coarse' });
  f.reply(); f.advance(110); f.reply(); f.advance(100);
  assert.equal(f.joints().length, 3); // All three inputs precede the old 350 ms transition.
  f.reply(); f.jog.releaseJoint();
  assert.equal(f.socket.sent.at(-1).kind, 'stop');
  f.reply(); f.advance(100);
  assert.equal(f.socket.sent.at(-1).kind, 'idle');
  assert.equal(f.joints().length, 3);
  f.unmount();
});

test('short press releases before the first reply and flushes stop immediately after it', () => {
  const f = fixture();
  f.jog.pressJoint('lift_joint', -1, 'fine');
  f.advance(10); f.jog.releaseJoint();
  assert.equal(f.socket.sent.at(-1).kind, 'joint');
  f.reply();
  assert.equal(f.socket.sent.at(-1).kind, 'stop');
  f.reply(); f.advance(500);
  assert.equal(f.joints().length, 1);
  assert.equal(f.socket.sent.at(-1).kind, 'idle');
  f.unmount();
});

test('release before a queued press is sent cancels that movement entirely', () => {
  const f = fixture();
  f.advance(10); // An idle request is now in flight.
  f.jog.pressJoint('head_joint1', 1, 'normal');
  f.jog.releaseJoint(); f.reply();
  assert.equal(f.socket.sent.at(-1).kind, 'stop');
  f.reply(); f.advance(400);
  assert.equal(f.joints().length, 0);
  f.unmount();
});

test('pointer release, cancellation, focus loss and tab exit stop continuous input', () => {
  for (const event of ['pointerup', 'pointercancel', 'blur', 'pagehide', 'cyclo:jog-stop', 'hidden']) {
    const f = fixture();
    f.jog.pressJoint('head_joint1', 1, 'normal'); f.reply();
    if (event === 'hidden') f.hide();
    else f.event(event);
    assert.equal(f.socket.sent.at(-1).kind, 'stop', event);
    if (!event.startsWith('pointer')) assert.equal(f.jog.enabled, false, event);
    f.reply(); f.advance(400);
    assert.equal(f.joints().length, 1, event);
    assert.equal(f.socket.readyState, 1, event);
    f.unmount();
  }
});

test('unmount sends stop after an outstanding input and cancels all periodic work', () => {
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

test('missing replies close and disarm without queuing further motion', () => {
  const f = fixture();
  f.jog.pressJoint('head_joint1', 1, 'normal');
  f.advance(800); f.render();
  assert.equal(f.jog.enabled, false);
  assert.match(f.jog.error, /timed out/);
  assert.equal(f.socket.readyState, 3);
  assert.equal(f.joints().length, 1);
  f.unmount();
});
