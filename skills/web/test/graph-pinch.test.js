const { test } = require('node:test');
const assert = require('node:assert');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement } = require('./helpers/recording-dom');

// The Graph's two-finger pinch, driven as recorded pointer sequences at the Graph's host in the
// real page (helpers/page-vm.js): a second finger ends the one-finger pan and starts a pinch, the
// pinch zooms around the midpoint, isDragging holds the 5-second refresh for the whole gesture,
// and the click that ends it is swallowed. Ctrl+wheel and the panel's zoom buttons are untouched.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});
const board = {
  projectName: 'kanban', statuses: ['backlog', 'todo', 'doing', 'done'], priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'], assignees: [], tags: [], types: [], notifications: [],
  active: [card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 })], archived: [],
};
const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];

async function open() {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  const page = await loadPage({
    board, stored: { 'kanban.kanban.view.mode': 'graph' }, elements, documentExtras: recordingDocument(),
  }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
  page.run('Object.assign(graphCur.view, { x: 10, y: 20, k: 1 })');
  const canvas = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.graph-canvas' ? {} : null) : harmless(String(k))) });
  const at = (pointerId, x, y) => ({ button: 0, pointerId, clientX: x, clientY: y, target: canvas, preventDefault() {}, stopPropagation() {} });
  return {
    page, host, at, run: (c) => page.run(c),
    fire: (type, pointerId, x, y) => host.fire(type, at(pointerId, x, y)),
    k: () => page.run('graphCur.view.k'),
    view: () => page.run('({ x: graphCur.view.x, y: graphCur.view.y, k: graphCur.view.k })'),
    dragging: () => page.run('isDragging'),
  };
}

// Finger 1 down, finger 2 down 100 px to its right, then both spread to 200 px apart.
function spread(s) {
  s.fire('pointerdown', 1, 100, 100);
  s.fire('pointerdown', 2, 200, 100);
  s.fire('pointermove', 1, 50, 100);
  s.fire('pointermove', 2, 250, 100);
}

test('a second finger ends the one-finger pan and the pinch grows k around the midpoint', async () => {
  const s = await open();
  const before = s.view();
  s.fire('pointerdown', 1, 100, 100);
  assert.notStrictEqual(s.run('graphPan'), null);
  s.fire('pointerdown', 2, 200, 100);
  assert.strictEqual(s.run('graphPan'), null, 'the pan ended');
  s.fire('pointermove', 2, 300, 100);
  const after = s.view();
  assert.ok(Math.abs(after.k / before.k - 2) < 1e-6, `k doubled: ${before.k} to ${after.k}`);
  const mid = 200;
  assert.ok(Math.abs((mid - before.x) / before.k - (mid - after.x) / after.k) < 1e-6, 'the point under the midpoint stays under it');
});

test('isDragging holds for the whole pinch and clears when a finger lifts', async () => {
  const s = await open();
  spread(s);
  assert.strictEqual(s.dragging(), true);
  s.fire('pointerup', 2, 250, 100);
  assert.strictEqual(s.dragging(), false);
  s.fire('pointerup', 1, 50, 100);
  assert.strictEqual(s.dragging(), false);
});

test('pointercancel mid-pinch clears isDragging and the pinch', async () => {
  const s = await open();
  spread(s);
  assert.strictEqual(s.dragging(), true);
  s.fire('pointercancel', 1, 50, 100);
  assert.strictEqual(s.dragging(), false);
  assert.strictEqual(s.run('graphPinch'), null);
});

test('lostpointercapture mid-pinch clears isDragging', async () => {
  const s = await open();
  spread(s);
  s.fire('lostpointercapture', 2, 250, 100);
  assert.strictEqual(s.dragging(), false);
});

test('the click after the pinch is swallowed, and a later click is not', async () => {
  const s = await open();
  spread(s);
  s.fire('pointerup', 2, 250, 100);
  assert.notStrictEqual(s.run('graphClickSwallow'), null, 'a swallow waits for the click');
  s.fire('pointerup', 1, 50, 100);
  s.run('graphClickSwallow({ preventDefault() {}, stopPropagation() {} })');
  assert.strictEqual(s.run('graphClickSwallow'), null);
});

test('the lone finger left after one lifts does not pan', async () => {
  const s = await open();
  spread(s);
  s.fire('pointerup', 2, 250, 100);
  const v = s.view();
  s.fire('pointermove', 1, 10, 10);
  assert.deepStrictEqual(s.view(), v);
  assert.strictEqual(s.run('graphPan'), null);
});

test('a one-finger pan still pans and a third finger changes nothing', async () => {
  const s = await open();
  const v = s.view();
  s.fire('pointerdown', 1, 100, 100);
  s.fire('pointermove', 1, 130, 100);
  assert.strictEqual(s.view().x, v.x + 30);
  assert.strictEqual(s.dragging(), true);
  s.fire('pointerup', 1, 130, 100);
  assert.strictEqual(s.dragging(), false);
  spread(s);
  const k = s.k();
  s.fire('pointerdown', 3, 300, 300);
  s.fire('pointermove', 3, 400, 400);
  assert.strictEqual(s.k(), k);
});

test('a pinch starts although the first finger landed on a card', async () => {
  const s = await open();
  const onCard = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.graph-node' ? { dataset: { id: '2' } } : sel === '.graph-canvas' ? {} : null) : harmless(String(k))) });
  const down = (pointerId, x, y, isPrimary, target) => s.host.fire('pointerdown', { button: 0, pointerId, isPrimary, clientX: x, clientY: y, target, preventDefault() {}, stopPropagation() {} });
  const before = s.view();
  down(1, 100, 100, true, onCard);
  down(2, 200, 100, false, onCard);
  assert.notStrictEqual(s.run('graphPinch'), null, 'the second finger started a pinch');
  s.fire('pointermove', 1, 50, 100);
  s.fire('pointermove', 2, 250, 100);
  assert.ok(Math.abs(s.view().k / before.k - 2) < 1e-6, 'the pinch doubled k');
  s.fire('pointerup', 2, 250, 100);
  s.fire('pointerup', 1, 50, 100);
  assert.strictEqual(s.dragging(), false);
  assert.strictEqual(s.run('graphTouch'), null);
});
