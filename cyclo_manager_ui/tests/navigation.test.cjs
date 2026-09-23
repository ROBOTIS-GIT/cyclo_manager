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
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function fixture(load) {
  let cursor = 0, value, pathname = '/dashboard', mounted = true;
  const slots = [], routes = [], effects = [];
  const react = {
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [slots[i].value, next => {
        assert.ok(mounted, 'Unmounted navigation must not update state');
        slots[i].value = next;
      }];
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || !deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) {
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const config = { exports: {} };
  vm.runInNewContext(compile('config/navigation.ts'), config);
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, require: name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'next/link') return { default: 'Link' };
    if (name === 'next/navigation') return { useRouter: () => ({ push: url => routes.push(url) }) };
    if (name === '@/config/navigation') return config.exports;
    if (name === '@/lib/robotContainers') return {
      getRunningRobotContainers: load, robotPageUrl: (container, page) => `/${container}/${page}`,
    };
    throw new Error(`Unexpected import ${name}`);
  } };
  vm.runInNewContext(compile('hooks/useNavigation.ts'), context);
  const sidebar = { ...context, exports: {} };
  vm.runInNewContext(compile('components/layout/SidebarNavigation.tsx'), sidebar);
  const render = (nextPath = pathname) => {
    pathname = nextPath;
    cursor = 0;
    value = context.exports.useNavigation(() => {}, pathname);
    while (effects.length) effects.shift()();
  };
  render();
  return {
    get nav() { return value; }, render, routes,
    clickLink(href) {
      const tree = sidebar.exports.default({ pathname, onNavigate: value.handleNavigate,
        onSystem: value.handleSystemClick, onJog: value.handleJogClick });
      const link = tree.props.children.find(item => item.type === 'Link' && item.props.href === href);
      assert.ok(link, `Missing sidebar link: ${href}`);
      link.props.onClick();
      routes.push(href);
      // Let a pending response arrive before Next.js commits the new route.
    },
    unmount() {
      mounted = false;
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

test('System and Jog both open the only running robot container', async () => {
  const f = fixture(async () => ['ai_worker']);
  await f.nav.handleJogClick();
  await f.nav.handleSystemClick();
  assert.deepEqual(f.routes, ['/ai_worker/jog', '/ai_worker/system']);
});

test('no running robot prevents navigation and shows an explanation', async () => {
  const f = fixture(async () => []);
  await f.nav.handleJogClick(); f.render();
  assert.match(f.nav.navError, /No robot container/);
  assert.equal(f.routes.length, 0);
});

test('multiple containers offer a page-specific choice without choosing automatically', async () => {
  const f = fixture(async () => ['ai_worker', 'open_manipulator']);
  await f.nav.handleJogClick(); f.render();
  assert.equal(f.nav.selection.page, 'jog');
  assert.equal(f.nav.selection.containers.length, 2);
  assert.equal(f.routes.length, 0);
  f.nav.openRobotPage('unknown');
  assert.equal(f.routes.length, 0);
  f.nav.openRobotPage('open_manipulator'); f.render();
  assert.deepEqual(f.routes, ['/open_manipulator/jog']);
  assert.equal(f.nav.selection, null);
});

test('late System request cannot replace a newer Jog selection', async () => {
  const pending = [];
  const f = fixture(() => new Promise(resolve => pending.push(resolve)));
  const system = f.nav.handleSystemClick();
  const jog = f.nav.handleJogClick();
  pending[1](['open_manipulator']); await jog;
  pending[0](['ai_worker']); await system;
  assert.deepEqual(f.routes, ['/open_manipulator/jog']);
});

test('ordinary sidebar links immediately discard late robot results and errors', async () => {
  for (const action of ['handleJogClick', 'handleSystemClick']) {
    for (const href of ['/files', '/dashboard']) {
      for (const result of [['ai_worker'], ['ai_worker', 'open_manipulator'], [], new Error('offline')]) {
        let resolve, reject;
        const f = fixture(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
        const pending = f.nav[action]();
        f.clickLink(href);
        if (result instanceof Error) reject(result); else resolve(result);
        await pending; f.render();
        assert.deepEqual(f.routes, [href]);
        assert.equal(f.nav.selection, null);
        assert.equal(f.nav.navError, null);
      }
    }
  }
});

test('back or forward route changes discard pending navigation and allow new requests', async () => {
  const pending = [];
  const f = fixture(() => new Promise(resolve => pending.push(resolve)));
  const oldRequest = f.nav.handleJogClick();
  f.render('/topics'); // Route change without a sidebar click.
  pending[0](['ai_worker']); await oldRequest; f.render();
  assert.deepEqual(f.routes, []);
  assert.equal(f.nav.selection, null);
  const newRequest = f.nav.handleSystemClick();
  pending[1](['open_manipulator']); await newRequest;
  assert.deepEqual(f.routes, ['/open_manipulator/system']);
});

test('unmount discards pending navigation, choices and errors without updating state', async () => {
  for (const result of [['ai_worker'], ['ai_worker', 'open_manipulator'], [], new Error('offline')]) {
    let resolve, reject;
    const f = fixture(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
    const pending = f.nav.handleJogClick();
    f.unmount();
    if (result instanceof Error) reject(result); else resolve(result);
    await pending;
    assert.deepEqual(f.routes, []);
  }
});

test('request failure and cancelling a choice never open Jog', async () => {
  const f = fixture(async () => { throw new Error('offline'); });
  await f.nav.handleJogClick(); f.render();
  assert.match(f.nav.navError, /Failed to connect/);
  assert.equal(f.routes.length, 0);
  const multiple = fixture(async () => ['a', 'b']);
  await multiple.nav.handleJogClick(); multiple.render();
  multiple.nav.cancelSelection(); multiple.render();
  assert.equal(multiple.nav.selection, null);
  assert.equal(multiple.routes.length, 0);
});

test('System and Jog reuse the filtered containers API without listing Docker images', async () => {
  const context = { exports: {}, require: name => {
    assert.equal(name, '@/lib/api');
    return {
      getSupportedRobotContainers: async running => {
        assert.equal(running, true);
        return { supported_robot_containers: ['ai_worker'] };
      },
    };
  } };
  vm.runInNewContext(compile('lib/robotContainers.ts'), context);
  assert.deepEqual(Array.from(await context.exports.getRunningRobotContainers()), ['ai_worker']);
  assert.equal(context.exports.robotPageUrl('custom robot', 'jog'), '/custom%20robot/jog');
});
