// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/websocketUtils.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(random = .5) {
  const timers = new Map(); let timerId = 0; let parses = 0;
  const context = { exports: {}, Error, Math: Object.assign(Object.create(Math), { random: () => random }),
    JSON: { parse: text => { parses++; return JSON.parse(text); } },
    setTimeout: (run, delay) => { timers.set(++timerId, { run, delay }); return timerId; },
    clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(compiled, context);
  const sockets = [], states = [];
  class Socket {
    listeners = new Map(); closes = [];
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
    message(value) { this.emit('message', { data: JSON.stringify(value) }); }
    close(code, reason) {
      assert(code === 1000 || (code >= 3000 && code <= 4999), 'Browser rejects client close code');
      this.closes.push({ code, reason });
    }
  }
  const connect = () => { const socket = new Socket(); sockets.push(socket); return socket; };
  const options = { onState: state => states.push(state) };
  return { timers, sockets, states, connect, options,
    parse: context.exports.parseWebSocketMessage, parseCount: () => parses,
    start: (factory = connect) => context.exports.maintainWebSocket(factory, options),
    tick: () => { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); timer.run(); },
    delay: () => { assert.equal(timers.size, 1); return [...timers.values()][0].delay; },
  };
}

test('exponential backoff remains capped even when every transport opens', () => {
  const f = fixture(), stop = f.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    f.sockets.at(-1).emit('open');
    f.sockets.at(-1).emit('close', { code: 1013 });
    assert.equal(f.delay(), delay); f.tick();
  }
  stop(); assert.equal(f.timers.size, 0);
});

test('only subscription ready resets backoff and clears last error', () => {
  const f = fixture(), stop = f.start();
  f.sockets[0].message({ type: 'error', data: 'Bridge down', retryable: true });
  f.sockets[0].emit('close', { code: 1013 }); f.tick();
  assert.equal(f.states.at(-1).error, 'Bridge down');
  f.sockets[1].emit('open');
  f.sockets[1].message({ type: 'data', data: { available: false } });
  f.sockets[1].emit('close', { code: 1006 }); assert.equal(f.delay(), 2000); f.tick();
  f.sockets[2].message({ type: 'ready' });
  assert.equal(f.states.at(-1).error, null); assert.equal(f.states.at(-1).status, 'connected');
  f.sockets[2].emit('close', { code: 1006 }); assert.equal(f.delay(), 1000); stop();
});

test('terminal server error stops retries even if close code is normal', () => {
  const f = fixture(), stop = f.start();
  f.sockets[0].message({ type: 'error', code: 'type_conflict', data: 'Wrong type', retryable: false });
  f.sockets[0].emit('close', { code: 1000 });
  assert.equal(f.timers.size, 0); assert.equal(f.states.at(-1).error, 'Wrong type');
  assert.equal(f.states.at(-1).status, 'error');
  stop.reconnect(); assert.equal(f.sockets.length, 2);
  assert.equal(f.states.at(-1).error, 'Wrong type');
  f.sockets[1].message({ type: 'ready' }); assert.equal(f.states.at(-1).error, null); stop();
});

test('policy close without an error frame is terminal', () => {
  const f = fixture(), stop = f.start();
  f.sockets[0].emit('close', { code: 1008, reason: 'Invalid request' });
  assert.equal(f.timers.size, 0); assert.equal(f.states.at(-1).error, 'Invalid request'); stop();
});

test('manual reconnect cancels pending retry and ignores old socket events', () => {
  const f = fixture(), stop = f.start();
  f.sockets[0].emit('close', { code: 1006 }); assert.equal(f.timers.size, 1);
  stop.reconnect(); assert.equal(f.timers.size, 0); assert.equal(f.sockets.length, 2);
  stop.reconnect(); assert.equal(f.sockets[1].closes.length, 1);
  f.sockets[1].message({ type: 'error', data: 'Old error', retryable: false });
  f.sockets[1].emit('close', { code: 1006 }); assert.equal(f.timers.size, 0);
  f.sockets[2].message({ type: 'ready' }); assert.equal(f.states.at(-1).error, null); stop();
});

test('dispose closes connecting socket and cancels all further work', () => {
  const f = fixture(), stop = f.start(); stop();
  assert.equal(f.sockets[0].closes.length, 1);
  f.sockets[0].emit('close', { code: 1006 }); stop.reconnect();
  assert.equal(f.timers.size, 0); assert.equal(f.sockets.length, 1);
});

test('connector failures use backoff and pending retry is disposable', () => {
  const f = fixture(), stop = f.start(() => { throw new Error('Offline'); });
  assert.equal(f.delay(), 1000); f.tick(); assert.equal(f.delay(), 2000);
  assert.equal(f.states.at(-1).error, 'Offline'); stop(); assert.equal(f.timers.size, 0);
});

test('jitter varies retry delays but never exceeds 30 seconds', () => {
  for (const random of [0, 1]) {
    const f = fixture(random), stop = f.start();
    for (let i = 0; i < 8; i++) {
      f.sockets.at(-1).emit('close', { code: 1006 });
      const base = Math.min(30000, 1000 * 2 ** Math.min(i, 5));
      assert(f.delay() >= base * .8 && f.delay() <= Math.min(30000, base * 1.2)); f.tick();
    }
    stop();
  }
});


test('large topic payload is decoded once regardless of listener order', () => {
  for (const recoveryFirst of [false, true]) {
    const f = fixture(), stop = f.start();
    const event = { data: JSON.stringify({ type: 'data', data: { image: 'x'.repeat(2_000_000) } }) };
    if (recoveryFirst) f.sockets[0].emit('message', event);
    const parsed = f.parse(event);
    if (!recoveryFirst) f.sockets[0].emit('message', event);
    assert.equal(parsed.data.image.length, 2_000_000);
    assert.equal(f.parseCount(), 1);
    assert.equal(f.parse(event), parsed);
    f.sockets[0].message({ type: 'ready' });
    assert.equal(f.parseCount(), 2);
    assert.equal(f.states.at(-1).status, 'connected');
    stop();
  }
});
