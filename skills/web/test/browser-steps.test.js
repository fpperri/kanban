const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runSteps, tap, swipe, pinch } = require('./browser/steps');
const scenarios = require('./browser/scenarios');
const phone = require('./browser/scenarios/phone');
const phoneFlip = require('./browser/scenarios/phone-flip');

// The step runner of the phone and phone-flip scenarios, and the touch helpers a step uses, driven
// through a stand-in page that records what it is sent. No browser, no socket.

function standIn({ boards = ['plan', 'feature'], refuseReset = 0 } = {}) {
  const calls = [];
  let refused = 0;
  return {
    calls,
    bases: Object.fromEntries(boards.map((k, i) => [k, `http://127.0.0.1:${7000 + i}`])),
    async send(method, params) {
      calls.push([method, params]);
      if (method === 'Page.resetNavigationHistory' && refused < refuseReset) { refused += 1; throw new Error('Page.resetNavigationHistory: Not attached to an active page'); }
      return {};
    },
  };
}

function stepsFolder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-steps-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

const PHONE_START = { width: 390, height: 844, touch: true };

test('every .js file in the folder runs, in sorted name order, and a file that is not a .js file does not', async () => {
  globalThis.__ran = [];
  const dir = stepsFolder({
    '10-b.js': "globalThis.__ran.push('10-b'); module.exports = { async run() {} };",
    '00-a.js': "globalThis.__ran.push('00-a'); module.exports = { async run() {} };",
    '05-mid.js': "globalThis.__ran.push('05-mid'); module.exports = { async run() {} };",
    'notes.md': 'not a step',
  });
  await runSteps(standIn(), dir, PHONE_START);
  assert.deepStrictEqual(globalThis.__ran, ['00-a', '05-mid', '10-b']);
  delete globalThis.__ran;
});

test('an empty folder runs nothing', async () => {
  const page = standIn();
  await runSteps(page, stepsFolder({}), PHONE_START);
  assert.deepStrictEqual(page.calls, []);
});

test('before each step: a blank page, history reset, storage cleared for every board, then the start size and touch', async () => {
  const dir = stepsFolder({
    '00-a.js': 'module.exports = { async run(page) { await page.send("step", {}); } };',
    '01-b.js': 'module.exports = { async run(page) { await page.send("step", {}); } };',
  });
  const page = standIn();
  await runSteps(page, dir, PHONE_START);
  const methods = page.calls.map((c) => c[0]);
  const first = methods.indexOf('step');
  assert.strictEqual(methods.filter((m) => m === 'step').length, 2);
  const before = page.calls.slice(0, first);
  assert.deepStrictEqual(before[0], ['Page.navigate', { url: 'about:blank' }]);
  assert.strictEqual(before[1][0], 'Page.resetNavigationHistory');
  assert.deepStrictEqual(before.filter((c) => c[0] === 'Storage.clearDataForOrigin').map((c) => c[1]), [
    { origin: 'http://127.0.0.1:7000', storageTypes: 'all' },
    { origin: 'http://127.0.0.1:7001', storageTypes: 'all' },
  ]);
  assert.deepStrictEqual(before.find((c) => c[0] === 'Emulation.setDeviceMetricsOverride')[1], { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.deepStrictEqual(before.find((c) => c[0] === 'Emulation.setTouchEmulationEnabled')[1], { enabled: true, maxTouchPoints: 5 });
  const second = methods.indexOf('step', first + 1);
  assert.ok(methods.slice(first + 1, second).includes('Page.navigate'), 'the second step has its own clean start');
  assert.ok(methods.slice(first + 1, second).includes('Storage.clearDataForOrigin'));
});

test('with touch off the start size is set and touch emulation is turned off', async () => {
  const dir = stepsFolder({ '00-a.js': 'module.exports = { async run() {} };' });
  const page = standIn();
  await runSteps(page, dir, { width: 390, height: 844, touch: false });
  assert.deepStrictEqual(page.calls.find((c) => c[0] === 'Emulation.setDeviceMetricsOverride')[1], { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.deepStrictEqual(page.calls.find((c) => c[0] === 'Emulation.setTouchEmulationEnabled')[1], { enabled: false });
});

test('a history reset Chrome refuses while it swaps the page in is tried again', async () => {
  const dir = stepsFolder({ '00-a.js': 'module.exports = { async run() {} };' });
  const page = standIn({ refuseReset: 2 });
  await runSteps(page, dir, PHONE_START);
  assert.strictEqual(page.calls.filter((c) => c[0] === 'Page.resetNavigationHistory').length, 3);
});

test('a step that throws stops the run with its error', async () => {
  const dir = stepsFolder({ '00-a.js': "module.exports = { async run() { throw new Error('step broke'); } };" });
  await assert.rejects(runSteps(standIn(), dir, PHONE_START), /step broke/);
});

const touches = (page) => page.calls.filter((c) => c[0] === 'Input.dispatchTouchEvent').map((c) => c[1]);

test('tap is a touchStart and a touchEnd at the same point', async () => {
  const page = standIn();
  await tap(page, 100, 200);
  assert.deepStrictEqual(touches(page), [
    { type: 'touchStart', touchPoints: [{ x: 100, y: 200, id: 0 }] },
    { type: 'touchEnd', touchPoints: [] },
  ]);
});

test('swipe is a touchStart, evenly spaced touchMoves to the end point, and a touchEnd', async () => {
  const page = standIn();
  await swipe(page, { x: 300, y: 400 }, { x: 100, y: 400 }, { steps: 4 });
  assert.deepStrictEqual(touches(page), [
    { type: 'touchStart', touchPoints: [{ x: 300, y: 400, id: 0 }] },
    { type: 'touchMove', touchPoints: [{ x: 250, y: 400, id: 0 }] },
    { type: 'touchMove', touchPoints: [{ x: 200, y: 400, id: 0 }] },
    { type: 'touchMove', touchPoints: [{ x: 150, y: 400, id: 0 }] },
    { type: 'touchMove', touchPoints: [{ x: 100, y: 400, id: 0 }] },
    { type: 'touchEnd', touchPoints: [] },
  ]);
});

test('pinch is two fingers either side of the centre, moving apart in even steps, then both lifting', async () => {
  const page = standIn();
  await pinch(page, { x: 200, y: 300 }, { from: 40, to: 80, steps: 2 });
  const two = (d) => [{ x: 200 - d, y: 300, id: 0 }, { x: 200 + d, y: 300, id: 1 }];
  assert.deepStrictEqual(touches(page), [
    { type: 'touchStart', touchPoints: two(20) },
    { type: 'touchMove', touchPoints: two(30) },
    { type: 'touchMove', touchPoints: two(40) },
    { type: 'touchEnd', touchPoints: [] },
  ]);
});

test('pinch moves the fingers together when the end distance is the smaller', async () => {
  const page = standIn();
  await pinch(page, { x: 200, y: 300 }, { from: 80, to: 40, steps: 2 });
  assert.deepStrictEqual(touches(page).map((t) => t.touchPoints[0] && t.touchPoints[0].x), [160, 170, 180, undefined]);
});

test('phone is 390 by 844 with touch on, on the plan board with the feature board alongside, 120 s', () => {
  assert.strictEqual(phone.name, 'phone');
  assert.strictEqual(phone.board, 'plan');
  assert.deepStrictEqual(phone.alsoBoards, ['feature']);
  assert.strictEqual(phone.timeoutMs, 120000);
  assert.deepStrictEqual(phone.start, { width: 390, height: 844, touch: true });
});

test('phone-flip is 390 by 844 with touch off, on the plan board, 120 s', () => {
  assert.strictEqual(phoneFlip.name, 'phone-flip');
  assert.strictEqual(phoneFlip.board, 'plan');
  assert.strictEqual(phoneFlip.timeoutMs, 120000);
  assert.deepStrictEqual(phoneFlip.start, { width: 390, height: 844, touch: false });
});

test('both are registered once', () => {
  for (const sc of [phone, phoneFlip]) assert.strictEqual(scenarios.filter((s) => s === sc).length, 1, sc.name);
});

test('touch is off after phone ends, also when a step threw', async () => {
  const dir = stepsFolder({ '00-a.js': "module.exports = { async run() { throw new Error('boom'); } };" });
  const page = standIn();
  await assert.rejects(phone.run(page, { stepsDir: dir }), /boom/);
  const touch = page.calls.filter((c) => c[0] === 'Emulation.setTouchEmulationEnabled');
  assert.deepStrictEqual(touch[touch.length - 1][1], { enabled: false });
});

test('touch is off after phone ends when every step passes', async () => {
  const page = standIn();
  await phone.run(page, { stepsDir: stepsFolder({}) });
  const touch = page.calls.filter((c) => c[0] === 'Emulation.setTouchEmulationEnabled');
  assert.deepStrictEqual(touch[touch.length - 1][1], { enabled: false });
});

test('each scenario folder holds a boot step', () => {
  const dir = path.join(__dirname, 'browser', 'scenarios');
  for (const f of ['phone-steps', 'phone-flip-steps']) {
    assert.strictEqual(typeof require(path.join(dir, f, '00-boot.js')).run, 'function', f);
  }
});

test('the whole-layout checks are steps: layout on the phone, flip and desktop on the flip scenario', () => {
  const dir = path.join(__dirname, 'browser', 'scenarios');
  for (const f of ['phone-steps/layout.js', 'phone-flip-steps/flip.js', 'phone-flip-steps/desktop.js']) {
    assert.strictEqual(typeof require(path.join(dir, f)).run, 'function', f);
  }
});
