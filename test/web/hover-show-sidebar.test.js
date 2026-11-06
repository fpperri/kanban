const { test } = require('node:test');
const assert = require('node:assert');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// On hover show, in the Graph's own side panel (graph-view.js builds it, hover-show-ui.js keeps it in step with the
// search panel's boxes): six toggle buttons beside the Dependencies and Lanes switches, in the Hierarchy and in the
// Flow, editing the one choice the search panel edits. The page runs in a vm (helpers/page-vm.js) with a document
// that records the elements the Graph builds; the boxes of the search panel are stand-ins. The browser runner presses
// the real buttons (scenarios/hover-show.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Card 1 is the parent of 3, 2 waits for it. Card 4 is on its own.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema' }),
  ],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const KINDS = ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'];
const GRID = ['hlinks', 'dlinks', 'hpath', 'dpath', 'htree', 'dtree'];
const KEY = 'kanban.kanban.hover.show';
const ids = (set) => [...set].map(Number).sort((a, b) => a - b);

function matcher(el) {
  el.matches = (sel) => {
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const attrs = [...sel.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]);
    const own = el.classes || [];
    return classes.every((c) => own.includes(c)) && attrs.every(([k, v]) => (v === undefined ? el.dataset[k] !== undefined : el.dataset[k] === v));
  };
  return el;
}

async function open({ layout = null, stored = {} } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  const boxes = KINDS.map((kind) => ({ dataset: { hoverKind: kind }, checked: false }));
  const sideBtns = ['hierarchy', 'dependencies'].map((toggle) => ({
    dataset: { hoverSide: toggle }, textContent: '', attrs: {}, title: '', setAttribute(k, v) { this.attrs[k] = v; },
  }));
  const box = control();
  box.querySelectorAll = (sel) => (sel === '[data-hover-side]' ? sideBtns : boxes);
  elements['#search-hover'] = box;
  const base = recordingDocument();
  const buttons = () => byClass(host, 'graph-option-btn').filter((b) => b.dataset.key === 'hover');
  const sideButtons = () => byClass(host, 'graph-option-btn').filter((b) => b.dataset.key === 'hover-side');
  const documentExtras = {
    ...base,
    querySelectorAll: (sel) => (sel.includes('data-key="hover"') ? buttons().concat(sideButtons()) : []),
  };
  const all = { 'kanban.kanban.view.mode': 'graph', 'kanban.kanban.viewpanel': '{"map":true,"graph":true}', ...stored };
  if (layout) all['kanban.kanban.graph.layout'] = layout;
  const page = await loadPage({ board: makeBoard(), stored: all, elements, documentExtras }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const calls = [];
  page.ctx.graphLightCards = (lit) => { calls.push(lit ? ids(lit.nodes) : null); };
  const s = {
    page, boxes, sideBtns, calls, stored: all,
    group: () => byClass(host, 'graph-option').find((g) => byClass(g, 'graph-option-label')[0].textContent === 'On hover') || null,
    buttons,
    sideButtons,
    sideLabels: () => sideButtons().map((b) => b.textContent),
    ticked: () => KINDS.filter((k) => buttons().some((b) => b.dataset.val === k && b.getAttribute('aria-pressed') === 'true')),
    boxesTicked: () => boxes.filter((b) => b.checked).map((b) => b.dataset.hoverKind),
    press(kind) {
      const el = matcher(buttons().find((b) => b.dataset.val === kind));
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (el.matches(sel) ? el : null) : harmless(String(key))) });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
    pressSide(toggle) {
      const el = matcher(sideButtons().find((b) => b.dataset.val === toggle));
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (el.matches(sel) ? el : null) : harmless(String(key))) });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
    stepBox(toggle) {
      const btn = sideBtns.find((b) => b.dataset.hoverSide === toggle);
      box.fire('click', { target: { closest: (sel) => (sel === '[data-hover-side]' ? btn : null) } });
    },
    tickBox(kind, on) {
      const found = boxes.find((b) => b.dataset.hoverKind === kind);
      found.checked = on;
      box.fire('change', { target: { closest: (sel) => (sel === '[data-hover-kind]' ? found : null) } });
    },
    syncBoxes: () => page.run('syncHoverShowPanel()'),
    set: (id) => ids(page.run(`hoverSetOf('${id}')`)),
    stage: (kind) => { page.run(`graphSetLayoutKind('${kind}')`); },
  };
  return s;
}

test('the Graph\'s side panel has an On hover section of six toggles, laid out as a grid of two columns and three rows', async () => {
  const s = await open();
  const group = s.group();
  assert.ok(group, 'the section is there');
  assert.deepStrictEqual(byClass(group, 'graph-option-btn').map((b) => b.textContent), GRID, 'h sets left, d sets right, links, path, tree');
  assert.deepStrictEqual(byClass(group, 'graph-option-btn').map((b) => `${b.dataset.key}=${b.dataset.val}`), GRID.map((k) => `hover=${k}`));
  assert.ok(group.title.length > 20, 'it explains itself in a tooltip');
  for (const b of s.buttons()) {
    assert.strictEqual(b.dataset.keepsSelection, '', `${b.dataset.val} keeps the selection`);
    assert.strictEqual(b.type, 'button');
  }
});

test('the toggles show the Hierarchy\'s choice there: dlinks and hlinks at first', async () => {
  const s = await open();
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
  for (const b of s.buttons()) assert.strictEqual(b.classes.includes('active'), b.getAttribute('aria-pressed') === 'true', 'the active class follows aria-pressed');
});

test('in the Flow the section is there too, with the same choice', async () => {
  const s = await open({ layout: 'flow' });
  assert.ok(s.group());
  assert.deepStrictEqual(s.buttons().map((b) => b.dataset.val), GRID);
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
});

test('the section shows a kept choice, the old record as its Hierarchy list, and a corrupt one as the defaults, in both layouts', async () => {
  const kept = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['hpath'], hierarchy: 'below', dependencies: 'after' }) } });
  assert.deepStrictEqual(kept.ticked(), ['hpath']);
  assert.deepStrictEqual(kept.sideLabels(), ['below', 'after']);
  const old = { [KEY]: JSON.stringify({ hierarchy: ['hpath'], flow: ['dtree'] }) };
  assert.deepStrictEqual((await open({ stored: old })).ticked(), ['hpath']);
  const flow = await open({ layout: 'flow', stored: old });
  assert.deepStrictEqual(flow.ticked(), ['hpath'], 'the Flow\'s old list is let go');
  assert.deepStrictEqual(flow.sideLabels(), ['above&below', 'before&after']);
  const bad = await open({ stored: { [KEY]: 'not json' } });
  assert.deepStrictEqual(bad.ticked(), ['dlinks', 'hlinks']);
});

test('under the six stand the Hierarchy and Dependencies toggles, labelled with their state, keyboard buttons that keep the selection', async () => {
  const s = await open();
  assert.deepStrictEqual(s.sideButtons().map((b) => `${b.dataset.key}=${b.dataset.val}`), ['hover-side=hierarchy', 'hover-side=dependencies']);
  assert.deepStrictEqual(s.sideLabels(), ['above&below', 'before&after']);
  assert.deepStrictEqual(s.sideButtons().map((b) => b.getAttribute('aria-label')), ['Hierarchy: above&below', 'Dependencies: before&after']);
  for (const b of s.sideButtons()) {
    assert.strictEqual(b.type, 'button');
    assert.strictEqual(b.dataset.keepsSelection, '');
    assert.strictEqual(b.getAttribute('aria-pressed'), null, 'a stepper, not a pressed switch');
  }
});

test('a toggle pressed in the side panel steps, shows in the search panel\'s toggles at once, and the other way round', async () => {
  const s = await open();
  s.syncBoxes();
  s.pressSide('hierarchy');
  assert.deepStrictEqual(s.sideLabels(), ['above', 'before&after']);
  assert.deepStrictEqual(s.sideBtns.map((b) => b.textContent), ['above', 'before&after'], 'no repaint of the search panel is needed');
  s.stepBox('dependencies');
  assert.deepStrictEqual(s.sideLabels(), ['above', 'before'], 'and the search panel\'s click shows in the Graph\'s panel');
  s.pressSide('hierarchy');
  s.pressSide('hierarchy');
  s.pressSide('dependencies');
  s.pressSide('dependencies');
  assert.deepStrictEqual(s.sideLabels(), ['above&below', 'before&after'], 'three presses round to the & state');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { kinds: ['dlinks', 'hlinks'], hierarchy: 'above&below', dependencies: 'before&after' });
});

test('the hover lights the cut set once a toggle is pressed', async () => {
  const s = await open();
  assert.deepStrictEqual(s.set(1), [1, 2, 3]);
  s.pressSide('hierarchy');
  s.pressSide('hierarchy');
  assert.deepStrictEqual(s.set(3), [3], 'below card 3: no child');
  assert.deepStrictEqual(s.set(1), [1, 2, 3]);
  s.pressSide('hierarchy');
  s.pressSide('dependencies');
  assert.deepStrictEqual(s.set(2), [1, 2], 'before: what card 2 waits for, and nothing else');
});

test('pressing a toggle ticks it for the board, keeps the choice, and shows it at once', async () => {
  const s = await open();
  s.press('hpath');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { kinds: ['hpath', 'dlinks', 'hlinks'], hierarchy: 'above&below', dependencies: 'before&after' });
  assert.deepStrictEqual(s.ticked(), ['hpath', 'dlinks', 'hlinks'], 'the toggle shows it at once');
  s.press('dlinks');
  s.press('hlinks');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]).kinds, ['hpath']);
  assert.deepStrictEqual(s.ticked(), ['hpath']);
  s.press('hpath');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]).kinds, [], 'any mix, none included');
  assert.deepStrictEqual(s.ticked(), []);
});

test('a toggle pressed in the side panel shows in the search panel\'s boxes at once, and the hover lights the union', async () => {
  const s = await open();
  s.syncBoxes();
  assert.deepStrictEqual(s.boxesTicked(), ['dlinks', 'hlinks']);
  assert.deepStrictEqual(s.set(1), [1, 2, 3]);
  s.press('hlinks');
  assert.deepStrictEqual(s.boxesTicked(), ['dlinks'], 'no repaint of the search panel is needed');
  assert.deepStrictEqual(s.set(1), [1, 2], 'only what waits for it');
  s.press('hpath');
  assert.deepStrictEqual(s.boxesTicked(), ['hpath', 'dlinks']);
  s.press('htree');
  assert.deepStrictEqual(s.boxesTicked(), ['htree', 'hpath', 'dlinks']);
  assert.deepStrictEqual(s.set(1), [1, 2, 3], 'the tree below it joins the wait');
  s.press('htree');
  s.press('hpath');
  s.press('dlinks');
  assert.deepStrictEqual(s.boxesTicked(), []);
  assert.deepStrictEqual(s.set(1), [], 'nothing ticked holds nothing');
});

test('a box ticked in the search panel shows in the side panel\'s toggles at once', async () => {
  const s = await open();
  s.tickBox('hpath', true);
  assert.deepStrictEqual(s.ticked(), ['hpath', 'dlinks', 'hlinks']);
  s.tickBox('dlinks', false);
  assert.deepStrictEqual(s.ticked(), ['hpath', 'hlinks']);
});

test('the Hierarchy and the Flow share the one choice as the Graph swaps between them', async () => {
  const s = await open();
  s.press('dtree');
  s.pressSide('hierarchy');
  assert.deepStrictEqual(s.ticked(), ['dtree', 'dlinks', 'hlinks']);
  s.stage('flow');
  assert.deepStrictEqual(s.ticked(), ['dtree', 'dlinks', 'hlinks'], 'the same in the Flow');
  assert.deepStrictEqual(s.sideLabels(), ['above', 'before&after']);
  s.press('hpath');
  s.stage('hierarchy');
  assert.deepStrictEqual(s.ticked(), ['dtree', 'hpath', 'dlinks', 'hlinks'], 'and a change made in the Flow is there when it is left');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { kinds: ['dtree', 'hpath', 'dlinks', 'hlinks'], hierarchy: 'above', dependencies: 'before&after' });
});

test('a card hovered at the moment of the change lights again with the new union, and with none ticked lights nothing but the selection', async () => {
  const s = await open();
  s.page.run("setHoveredId('1')");
  s.page.run('refreshHover()');
  assert.deepStrictEqual(s.calls[s.calls.length - 1], [1, 2, 3], 'the wait and the child');
  s.press('hlinks');
  assert.deepStrictEqual(s.calls[s.calls.length - 1], [1, 2], 'at once, with no new hover');
  s.press('dlinks');
  assert.strictEqual(s.calls[s.calls.length - 1], null, 'nothing ticked and nothing selected');
});

test('Space writes the terms of the toggles ticked in the side panel, in the panel\'s order', async () => {
  const s = await open();
  s.press('dlinks');
  s.press('hlinks');
  s.press('hpath');
  s.press('dtree');
  s.pressSide('hierarchy');
  s.page.run("setHoveredId('3')");
  let prevented = 0;
  s.page.fireDocument('keydown', { key: ' ', target: { closest: () => null }, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { prevented++; } });
  assert.strictEqual(prevented, 1);
  assert.strictEqual(s.page.input.value, 'dtree:3 | hpath:3:above', 'the h set says its side, the d set is on & and says none');
});
