// Copyright 2026 ROBOTIS CO., LTD.
// Licensed under the Apache License, Version 2.0.
// Author: Hyungyu Kim

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(kind, disabled = false) {
  const calls = { start: 0, stop: 0, moves: [], captures: [] };
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, require: name => {
    if (name === 'react') return {
      useRef: current => ({ current }), useState: initial => [initial, () => {}],
    };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/components/ui/controlStyles') return {};
    throw new Error(`Unexpected import: ${name}`);
  } };
  const file = kind === 'button' ? 'JogControls.tsx' : 'JogJoystick.tsx';
  const source = fs.readFileSync(path.join(__dirname, '../components', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, context);
  const component = kind === 'button' ? context.exports.HoldButton : context.exports.default;
  const tree = component({ disabled, label: 'Move', children: '+',
    onStart() { calls.start++; }, onStop() { calls.stop++; },
    onMove(...values) { calls.moves.push(values); },
  });
  const props = kind === 'button' ? tree.props : tree.props.children.props;
  const target = {
    setPointerCapture(id) { calls.captures.push(id); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 224, height: 224 }; },
  };
  return { calls, props,
    motionCount: () => calls.start + calls.moves.length,
    event(overrides = {}) {
      return { button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse',
        clientX: 150, clientY: 112, currentTarget: target, prevented: false,
        preventDefault() { this.prevented = true; }, ...overrides };
    },
  };
}

for (const kind of ['button', 'joystick']) {
  test(`${kind}: right/middle buttons and secondary touches never start motion`, () => {
    const f = fixture(kind);
    for (const input of [{ button: 1, buttons: 4 }, { button: 2, buttons: 2 },
      { pointerType: 'touch', isPrimary: false, pointerId: 2 }]) {
      f.props.onPointerDown(f.event(input));
    }
    assert.equal(f.motionCount(), 0);
    assert.deepEqual(f.calls.captures, []);
    const menu = f.event();
    f.props.onContextMenu(menu);
    assert.equal(menu.prevented, true);
    assert.equal(f.calls.stop, 0);
  });

  test(`${kind}: left mouse and primary touch start and release normally`, () => {
    for (const pointerType of ['mouse', 'touch']) {
      const f = fixture(kind);
      const event = f.event({ pointerType });
      f.props.onPointerDown(event);
      assert.equal(event.prevented, true);
      assert.equal(f.motionCount(), 1);
      assert.deepEqual(f.calls.captures, [1]);
      f.props.onPointerUp(event);
      f.props.onLostPointerCapture(event);
      assert.equal(f.calls.stop, 1);
    }
  });

  test(`${kind}: context menu cancels an active gesture and cannot resume it`, () => {
    const f = fixture(kind);
    f.props.onPointerDown(f.event());
    const menu = f.event({ button: 2, buttons: 3 });
    f.props.onContextMenu(menu);
    f.props.onPointerMove(f.event());
    f.props.onPointerUp(f.event());
    assert.equal(menu.prevented, true);
    assert.equal(f.motionCount(), 1);
    assert.equal(f.calls.stop, 1);
    f.props.onPointerDown(f.event());
    assert.equal(f.motionCount(), 2, 'A new deliberate press still works');
  });

  test(`${kind}: mouse button chords or a lost primary button end motion`, () => {
    // Additional mouse buttons can emit pointermove instead of pointerdown.
    for (const buttons of [0, 2, 3, 4, 5]) {
      const f = fixture(kind);
      f.props.onPointerDown(f.event());
      f.props.onPointerMove(f.event({ buttons }));
      f.props.onPointerMove(f.event());
      assert.equal(f.motionCount(), 1);
      assert.equal(f.calls.stop, 1);
    }
  });

  test(`${kind}: cancelled/capture-lost gestures release exactly once`, () => {
    const f = fixture(kind);
    f.props.onPointerDown(f.event());
    f.props.onPointerCancel(f.event());
    f.props.onLostPointerCapture(f.event());
    assert.equal(f.calls.stop, 1);
  });

  test(`${kind}: disabled controls do not start motion`, () => {
    const f = fixture(kind, true);
    f.props.onPointerDown(f.event());
    if (kind === 'button') f.props.onKeyDown(f.event({ key: 'Enter', repeat: false }));
    assert.equal(f.motionCount(), 0);
    assert.deepEqual(f.calls.captures, []);
  });
}

test('hold button: keyboard hold still works and blur ends it', () => {
  for (const key of ['Enter', ' ']) {
    const f = fixture('button');
    f.props.onKeyDown(f.event({ key, repeat: false }));
    f.props.onKeyDown(f.event({ key, repeat: true }));
    f.props.onPointerMove(f.event({ buttons: 0 }));
    assert.equal(f.calls.start, 1);
    assert.equal(f.calls.stop, 0, 'Mouse hover must not cancel a keyboard hold');
    f.props.onBlur();
    f.props.onKeyUp(f.event({ key }));
    assert.equal(f.calls.stop, 1);
  }
});
