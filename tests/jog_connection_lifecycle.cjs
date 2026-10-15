// Copyright 2026 ROBOTIS CO., LTD.
// SPDX-License-Identifier: Apache-2.0

// Run with Node and the UI's typescript dependency available in NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const slots = [];
let cursor = 0;
const effects = [];
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = value; }];
  },
  useRef(initial) {
    const index = cursor++;
    return slots[index] ??= { current: initial };
  },
  useCallback(callback, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
      slots[index] = { callback, dependencies };
    }
    return slots[index].callback;
  },
  useEffect(effect, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      });
    }
  },
};
const listeners = new Map();
const window = {
  addEventListener: (event, callback) => listeners.set(event, callback),
  removeEventListener: event => listeners.delete(event),
};
const document = { ...window, hidden: false };
const timers = [];
let interval;
let now = 1000;
let socket;
class WebSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  closed = false;
  constructor() { socket = this; }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.closed = true; }
}
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../cyclo_manager_ui/hooks/useJogConnection.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, {
  exports: exportsObject, window, document, WebSocket, console,
  performance: { now: () => now },
  setTimeout: callback => { timers.push(callback); return timers.length; },
  clearTimeout() {}, setInterval(callback) { interval = callback; return 1; }, clearInterval() {},
  require(name) {
    if (name === 'react') return react;
    if (name === '@/hooks/usePolling') return { usePolling() {} };
    if (name === '@/lib/api') return { getBringupStatus() {} };
    if (name === '@/lib/websocketUtils') return { getWebSocketBaseUrl: () => 'ws://test' };
    if (name === '@/lib/jog') return {
      COMMAND_MIN_INTERVAL_MS: 90, JOG_HEARTBEAT_INTERVAL_MS: 100, FEEDBACK_TIMEOUT_MS: 700,
      JOG_PREPARE_TIMEOUT_MS: 5000,
    };
    throw new Error(`Unexpected import ${name}`);
  },
});
function render() {
  cursor = 0;
  const hook = exportsObject.useJogConnection('robot');
  effects.splice(0).forEach(effect => effect());
  return hook;
}
function feedback(ready, generation = 'one') {
  socket.onmessage({ data: JSON.stringify({ state: {
    publishers_prepared: ready, robot: { ready: true, generation },
  } }) });
  return render();
}
render();
timers.shift()();
socket.onopen();
let hook = feedback(false);
assert.equal(socket.sent.filter(message => message.kind === 'enable').length, 0);
hook.setEnabled(true);
hook = render();
assert.equal(hook.preparing, true);
assert.equal(hook.enabled, false);
assert.equal(socket.sent.at(-1).kind, 'enable');
const before = socket.sent.length;
hook.command({ kind: 'base', x: 0.1, y: 0, yaw: 0 });
assert.equal(socket.sent.length, before, 'motion must not queue while preparing');
listeners.get('blur')();
hook = feedback(true);
assert.equal(hook.enabled, false, 'late readiness must not undo focus-loss disarm');
assert.equal(hook.preparing, false);
assert.equal(socket.sent.at(-1).kind, 'stop');
assert.equal(socket.closed, false, 'focus loss must preserve the Jog connection');
hook.setEnabled(true);
hook = feedback(true);
assert.equal(hook.enabled, true);
hook.command({ kind: 'base', x: 0.1, y: 0, yaw: 0 });
assert.equal(socket.sent.at(-1).kind, 'base');
hook.stop(true);
hook = render();
assert.equal(hook.enabled, false);
assert.equal(socket.closed, false);
hook.setEnabled(true);
hook = feedback(false, 'two');
assert.equal(hook.enabled, false, 'generation change must disarm pending enable');
assert.equal(hook.preparing, false);
hook.setEnabled(true);
for (let i = 0; i < 9; i++) {
  now += 500;
  hook = feedback(false, 'two');
  interval();
}
assert.equal(hook.preparing, true);
now += 500;
interval();
hook = render();
assert.equal(hook.preparing, false, 'preparation must time out even with fresh feedback');
assert.equal(hook.enabled, false);
assert.match(hook.error, /Jog preparation timed out/);
assert.equal(socket.closed, true);
hook = feedback(true, 'two');
assert.equal(hook.enabled, false, 'late acknowledgement must not re-enable after timeout');
// Reconnect and check a late acknowledgement arriving before the timer callback.
hook.reconnect();
hook = render();
timers.shift()();
socket.onopen();
hook = feedback(false, 'two');
hook.setEnabled(true);
now += 5000;
hook = feedback(true, 'two');
assert.equal(hook.enabled, false);
assert.equal(hook.preparing, false);
assert.match(hook.error, /Jog preparation timed out/);
assert.equal(socket.closed, true);
// A slow enable sends no state messages while the server prepares publishers.
hook.reconnect();
hook = render();
timers.shift()();
socket.onopen();
hook = feedback(false);
hook.setEnabled(true);
now += 800;
interval();
hook = render();
assert.equal(hook.preparing, true, '700 ms feedback timeout must not interrupt preparation');
assert.equal(socket.closed, false);
now += 1200;
interval();
hook = feedback(true);
assert.equal(hook.enabled, true, 'preparation can succeed after two silent seconds');
now += 800;
interval();
hook = render();
assert.equal(socket.closed, true, 'normal feedback timeout resumes after preparation');
assert.match(hook.error, /Jog feedback timed out/);
// Silence for the entire preparation period must report the preparation deadline.
hook.reconnect();
hook = render();
timers.shift()();
socket.onopen();
hook = feedback(false);
hook.setEnabled(true);
for (let i = 0; i < 9; i++) {
  now += 500;
  interval();
}
hook = render();
assert.equal(socket.closed, false);
assert.equal(hook.preparing, true);
now += 500;
interval();
hook = render();
assert.equal(socket.closed, true);
assert.equal(hook.preparing, false);
assert.match(hook.error, /Jog preparation timed out/);
slots.forEach(slot => slot?.cleanup?.());
assert.equal(socket.closed, true);
assert.equal(socket.sent.at(-1).kind, 'stop');
console.log('PASS Jog hook: lazy Enable, preparation acknowledgement, focus-loss race, re-enable, generation reset, timeout, unmount');
