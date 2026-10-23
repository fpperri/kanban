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
  const box = control();
  box.querySelectorAll = () => boxes;
  elements['#search-hover'] = box;
  elements['#search-hover-for'] = { textContent: '' };
  const base = recordingDocument();
  const buttons = () => byClass(host, 'graph-option-btn').filter((b) => b.dataset.key === 'hover');
  const documentExtras = {
    ...base,
    querySelectorAll: (sel) => (sel.includes('data-key="hover"') ? buttons() : []),
  };
  const all = { 'kanban.kanban.view.mode': 'graph', 'kanban.kanban.viewpanel': '{"map":true,"graph":true}', ...stored };
  if (layout) all['kanban.kanban.graph.layout'] = layout;
  const page = await loadPage({ board: makeBoard(), stored: all, elements, documentExtras }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const calls = [];
  page.ctx.graphLightCards = (lit) => { calls.push(lit ? ids(lit.nodes) : null); };
  const s = {
    page, boxes, calls, stored: all,
    group: () => byClass(host, 'graph-option').find((g) => byClass(g, 'graph-option-label')[0].textContent === 'On hover') || null,
    buttons,
    ticked: () => KINDS.filter((k) => buttons().some((b) => b.dataset.val === k && b.getAttribute('aria-pressed') === 'true')),
    boxesTicked: () => boxes.filter((b) => b.checked).map((b) => b.dataset.hoverKind),
    press(kind) {
      const el = matcher(buttons().find((b) => b.dataset.val === kind));
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (el.matches(sel) ? el : null) : harmless(String(key))) });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
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

test('in the Flow the section is there too, and shows the Flow\'s own choice: dlinks and hlinks at first, as in the Hierarchy', async () => {
  const s = await open({ layout: 'flow' });
  assert.ok(s.group());
  assert.deepStrictEqual(s.buttons().map((b) => b.dataset.val), GRID);
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
});

test('the section shows a kept choice, and reads a corrupt one as the defaults', async () => {
  const kept = await open({ stored: { [KEY]: JSON.stringify({ hierarchy: ['hpath'], flow: ['dtree'] }) } });
  assert.deepStrictEqual(kept.ticked(), ['hpath']);
  const flow = await open({ layout: 'flow', stored: { [KEY]: JSON.stringify({ hierarchy: ['hpath'], flow: ['dtree'] }) } });
  assert.deepStrictEqual(flow.ticked(), ['dtree']);
  const bad = await open({ stored: { [KEY]: 'not json' } });
  assert.deepStrictEqual(bad.ticked(), ['dlinks', 'hlinks']);
});

test('pressing a toggle ticks it for the board and the kind of Graph that is on, keeps the choice, and leaves the other kind alone', async () => {
  const s = await open();
  s.press('hpath');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { hierarchy: ['hpath', 'dlinks', 'hlinks'], flow: ['dlinks', 'hlinks'] });
  assert.deepStrictEqual(s.ticked(), ['hpath', 'dlinks', 'hlinks'], 'the toggle shows it at once');
  s.press('dlinks');
  s.press('hlinks');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { hierarchy: ['hpath'], flow: ['dlinks', 'hlinks'] });
  assert.deepStrictEqual(s.ticked(), ['hpath']);
  s.press('hpath');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { hierarchy: [], flow: ['dlinks', 'hlinks'] }, 'any mix, none included');
  assert.deepStrictEqual(s.ticked(), []);
  const flow = await open({ layout: 'flow' });
  flow.press('hlinks');
  assert.deepStrictEqual(JSON.parse(flow.stored[KEY]), { hierarchy: ['dlinks', 'hlinks'], flow: ['dlinks'] });
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

test('the Hierarchy and the Flow keep their own choices in the side panel as the Graph swaps between them', async () => {
  const s = await open();
  s.press('dtree');
  assert.deepStrictEqual(s.ticked(), ['dtree', 'dlinks', 'hlinks']);
  s.stage('flow');
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks'], 'the Flow\'s own');
  s.press('hpath');
  assert.deepStrictEqual(s.ticked(), ['hpath', 'dlinks', 'hlinks']);
  s.stage('hierarchy');
  assert.deepStrictEqual(s.ticked(), ['dtree', 'dlinks', 'hlinks'], 'the Hierarchy\'s is as it was left');
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { hierarchy: ['dtree', 'dlinks', 'hlinks'], flow: ['hpath', 'dlinks', 'hlinks'] });
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
  s.page.run("setHoveredId('3')");
  let prevented = 0;
  s.page.fireDocument('keydown', { key: ' ', target: { closest: () => null }, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { prevented++; } });
  assert.strictEqual(prevented, 1);
  assert.strictEqual(s.page.input.value, 'dtree:3 | hpath:3');
});
