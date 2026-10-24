const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// The Map's two-finger pinch in the real page (helpers/page-vm.js runs every script the page
// loads in one vm, with elements a test can read back). The pinch scales one wrapper that holds
// every tree while the fingers move, and settles the zoom once when they lift. The browser
// runner drives a real pinch in Chrome (scenarios/phone-steps/map-pinch.js).

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Two trees: 1 with child 2, and 3 with child 4.
const board = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: [],
  assignees: [], tags: [], types: [], notifications: [],
  active: [card(1), card(2, { parent: 1 }), card(3), card(4, { parent: 3 })],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

// Elements with a style object that keeps what a script writes, and a querySelector over
// the tree they hold (the recording elements answer neither).
function recordedStyle(el) {
  Object.defineProperty(el, 'style', { value: {}, writable: true });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  el.querySelector = (sel) => {
    const cls = sel.replace(/^\./, '');
    return el.walk().find((e) => e.classes && e.classes.includes(cls)) || null;
  };
  return el;
}
function styledDocument() {
  const base = recordingDocument();
  return { ...base, createElement: (tag) => recordedStyle(base.createElement(tag)), createElementNS: (ns, tag) => recordedStyle(base.createElementNS(ns, tag)) };
}

// The element an event lands on: closest() answers with the real ancestor that carries the class.
function targetIn(el) {
  return new Proxy({}, {
    get: (t, key) => {
      if (key !== 'closest') return harmless(String(key));
      return (sel) => {
        if (sel === '#map-view') return {};
        const cls = sel.replace(/^\./, '');
        for (let e = el; e; e = e.parent) if (e.classes && e.classes.includes(cls)) return e;
        return null;
      };
    },
  });
}

async function open() {
  const host = recordedStyle(recordingElement('div'));
  const elements = { '#map-view': host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const stored = { 'kanban.kanban.view.mode': 'map' };
  const page = await loadPage({ board: board(), stored, elements, documentExtras: styledDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  page.run(`globalThis.zoomCalls = [];
    const zoomMapAtReal = zoomMapAt;
    zoomMapAt = (...a) => { zoomCalls.push(a); return zoomMapAtReal(...a); };
    globalThis.phantomCalls = 0;
    const suppressReal = suppressMapPanPhantomClick;
    suppressMapPanPhantomClick = () => { phantomCalls++; return suppressReal(); };`);
  const canvas = byClass(host, 'map-canvas')[0];
  assert.ok(canvas, 'the Map draws');
  const fire = (type, pointerId, x, y) => host.fire(type, {
    button: 0, pointerId, pointerType: 'touch', clientX: x, clientY: y, target: targetIn(canvas), preventDefault() {}, stopPropagation() {},
  });
  return {
    page, host, canvas,
    zoomCalls: () => page.run('zoomCalls'),
    phantomCalls: () => page.run('phantomCalls'),
    dragging: () => page.run('isDragging'),
    wrapper: () => byClass(host, 'map-trees')[0],
    down: (id, x, y) => fire('pointerdown', id, x, y),
    move: (id, x, y) => fire('pointermove', id, x, y),
    up: (id, x, y) => fire('pointerup', id, x, y),
    cancel: (id, x, y) => fire('pointercancel', id, x, y),
    lost: (id, x, y) => fire('lostpointercapture', id, x, y),
    // Two fingers 100 px apart, centred on x 150.
    twoFingers() { fire('pointerdown', 1, 100, 100); fire('pointerdown', 2, 200, 100); },
    spread(gap) { fire('pointermove', 1, 150 - gap / 2, 100); fire('pointermove', 2, 150 + gap / 2, 100); },
  };
}

test('every tree sits inside the one wrapper a pinch scales', async () => {
  const s = await open();
  const canvases = byClass(s.host, 'map-canvas');
  assert.strictEqual(canvases.length, 2, 'two trees are drawn');
  const wrappers = byClass(s.host, 'map-trees');
  assert.strictEqual(wrappers.length, 1, 'one wrapper');
  assert.strictEqual(byClass(wrappers[0], 'map-canvas').length, 2, 'both trees are in it');
});

test('while the fingers move the wrapper scales around the start midpoint, and on release it clears and the Map zooms once', async () => {
  const s = await open();
  s.twoFingers();
  s.spread(150);
  assert.strictEqual(s.wrapper().style.transform, 'scale(1.5)');
  assert.strictEqual(s.wrapper().style.transformOrigin, '150px 100px');
  assert.strictEqual(s.zoomCalls().length, 0, 'nothing is redrawn while the fingers move');
  s.spread(200);
  assert.strictEqual(s.wrapper().style.transform, 'scale(2)');
  s.up(1, 100, 100);
  assert.strictEqual(JSON.stringify(s.zoomCalls()), '[[2,150,100]]', 'one zoom, with the total, around the start midpoint');
  s.up(2, 200, 100);
  assert.strictEqual(s.zoomCalls().length, 1, 'the second finger lifting zooms nothing more');
});

test('the scale is clamped with the Map zoom limits', async () => {
  const s = await open();
  s.twoFingers();
  s.spread(900);
  assert.strictEqual(s.wrapper().style.transform, 'scale(2)', 'no more than the zoom ceiling');
  s.spread(1);
  assert.strictEqual(s.wrapper().style.transform, 'scale(0.1)', 'no less than the zoom floor');
  s.up(1, 0, 0);
  assert.strictEqual(s.zoomCalls()[0][0], 0.1);
});

test('a factor within 1% of 1 changes nothing', async () => {
  const s = await open();
  s.twoFingers();
  s.spread(100.5);
  s.up(1, 100, 100);
  assert.strictEqual(s.zoomCalls().length, 0);
  assert.ok(!s.wrapper().style.transform, 'the transform is cleared');
});

test('a second pointer cancels a one-finger pan', async () => {
  const s = await open();
  s.down(1, 100, 100);
  s.move(1, 130, 100);
  const scrolled = s.page.run('mapMain.scrollLeft');
  assert.strictEqual(scrolled, -30, 'one finger pans');
  s.down(2, 200, 100);
  s.move(1, 160, 100);
  assert.strictEqual(s.page.run('mapMain.scrollLeft'), scrolled, 'the first finger no longer pans');
});

test('one finger still pans, zooms nothing and scales nothing', async () => {
  const s = await open();
  s.down(1, 100, 100);
  s.move(1, 130, 100);
  assert.strictEqual(s.page.run('mapMain.scrollLeft'), -30);
  s.up(1, 130, 100);
  assert.strictEqual(s.zoomCalls().length, 0, 'a pan zooms nothing');
  assert.strictEqual(s.wrapper().style.transform, undefined, 'and scales nothing');
});

for (const [how, end] of [['lifts', (s) => s.up(1, 100, 100)], ['is cancelled', (s) => s.cancel(1, 100, 100)], ['loses capture', (s) => s.lost(1, 100, 100)]]) {
  test(`isDragging is held for the whole pinch and cleared when a finger ${how}`, async () => {
    const s = await open();
    assert.strictEqual(s.dragging(), false);
    s.twoFingers();
    assert.strictEqual(s.dragging(), true, 'held once both fingers are down');
    s.spread(150);
    assert.strictEqual(s.dragging(), true, 'and while they move');
    end(s);
    assert.strictEqual(s.dragging(), false, 'cleared');
    assert.ok(!s.wrapper().style.transform, 'and the transform with it');
  });
}

test('the pinch ends with the click it would make suppressed, so no card opens', async () => {
  const s = await open();
  s.twoFingers();
  s.spread(150);
  assert.strictEqual(s.phantomCalls(), 0, 'not before the fingers lift');
  s.up(1, 100, 100);
  assert.strictEqual(s.phantomCalls(), 1);
  let stopped = false;
  const click = { target: { closest: (sel) => (sel === '#map-view' ? {} : null) }, preventDefault() {}, stopPropagation() { stopped = true; } };
  s.page.fireDocument('click', click);
  assert.ok(stopped, 'the next click inside the Map is swallowed');
});

test('a pinch that changes nothing still ends in a suppressed click', async () => {
  const s = await open();
  s.twoFingers();
  s.up(2, 200, 100);
  assert.strictEqual(s.phantomCalls(), 1);
});

test('a third finger starts nothing while two are pinching', async () => {
  const s = await open();
  s.twoFingers();
  s.down(3, 50, 50);
  s.spread(150);
  s.up(3, 50, 50);
  assert.strictEqual(s.dragging(), true, 'the pinch is still going');
  s.up(1, 100, 100);
  assert.strictEqual(s.zoomCalls().length, 1);
});

// --- source pins -----------------------------------------------------------------------------

test('the Map canvas hands every touch to the script, so a pinch is never cancelled by a native scroll, in the stylesheet and not in a style attribute', () => {
  const rule = read('app.css').match(/\.map-canvas \{[^}]*\}/);
  assert.ok(rule, '.map-canvas rule found');
  assert.match(rule[0], /touch-action: none/);
  const wire = read('app.js').match(/function wireMapPanZoom\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(wire, /style=|setAttribute\('style'|\.onclick/);
  assert.doesNotMatch(read('app.html'), /map-canvas/);
});

test('the pinch uses the module math and the existing click helper, and the option bar line is untouched', () => {
  const src = read('app.js');
  const wire = src.match(/function wireMapPanZoom\([\s\S]*?\n\}/)[0];
  for (const name of ['pinchDistance', 'pinchMidpoint', 'pinchFactor', 'pinchZoom', 'pinchFactorIsChange', 'suppressMapPanPhantomClick']) assert.match(wire, new RegExp(`${name}\\(`), name);
  assert.match(src, /main\.appendChild\(buildMapBar\(panelOpen\)\);/);
});
