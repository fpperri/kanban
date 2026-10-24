const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// The option panel of the Graph and of the Map in the real page (helpers/page-vm.js runs every
// script the page loads in one vm, with elements a test can read back). What is in the panel
// and what stays in the view, whether the panel is built (kept choice, else the screen's width),
// and what a press on the icon button or the sheet's close button does. view-panel.test.js has the
// choice's own rules; the browser runner drives the same panel in Chrome (scenarios/view-panel.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [card(1, { type: 'goal', status: 'doing' }), card(2, { parent: 1 }), card(3, { parent: 1, waiting_for: [2] })],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };
const KEY = 'kanban.kanban.viewpanel';
const GRAPH_OPEN = { [KEY]: '{"map":null,"graph":true}' };
const MAP_OPEN = { [KEY]: '{"map":true,"graph":null}' };

async function open(view, { stored = {}, width = null } = {}) {
  const host = recordingElement('div');
  const elements = { [`#${view}-view`]: host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const all = { 'kanban.kanban.view.mode': view, ...stored };
  const page = await loadPage({ board: makeBoard(), stored: all, elements, documentExtras: recordingDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  if (width !== null) {
    page.run(`innerWidth = ${width}`);
    host.children.length = 0; // the Map clears its host with innerHTML, which a recording element only stores
    page.run(view === 'graph' ? 'renderGraphView()' : 'renderMapView()');
  }
  return {
    page, host, stored: all,
    panel: () => host.children.find((c) => c.classes.includes('view-panel')) || null,
    main: () => host.children.find((c) => c.classes.includes('graph-main') || c.classes.includes('map-main')),
    toggle: () => byClass(host, 'view-panel-toggle')[0] || null,
    // The event a press on `el` makes at the view's host, as the page's listeners see it.
    press(el, type = 'click') {
      const target = new Proxy({}, {
        get: (t, k) => (k === 'closest' ? (sel) => (sel.split(',').some((s) => matchesSelector(el, s.trim())) ? el : null) : harmless(String(k))),
      });
      host.fire(type, { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
  };
}

function matchesSelector(el, sel) {
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...sel.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1], m[2]]);
  return classes.every((c) => el.classes.includes(c)) && attrs.every(([k, v]) => (v === undefined ? el.dataset[k] !== undefined : el.dataset[k] === v));
}

const inside = (root, cls) => byClass(root, cls);

// --- the Graph -------------------------------------------------------------------------------------

test('Graph, opened: the zoom and the Options section are in the panel, the graph choice stands in the toolbar, the rest stays in the view', async () => {
  const s = await open('graph', { stored: GRAPH_OPEN });
  const panel = s.panel();
  assert.ok(panel, 'the panel is built');
  assert.strictEqual(panel.tag, 'aside');
  assert.strictEqual(inside(panel, 'graph-kind-btn').length, 0, 'the graph choice is not in the panel');
  assert.strictEqual(inside(s.main(), 'graph-kind-btn').length, 2);
  assert.strictEqual(inside(panel, 'graph-layout-btn').length, 0, 'the Hierarchy offers no layout to pick');
  assert.strictEqual(inside(panel, 'graph-zoom-btn').length, 3);
  assert.strictEqual(inside(panel, 'graph-options').length, 1);
  const main = s.main();
  for (const cls of ['graph-count', 'graph-key', 'graph-stage', 'view-panel-toggle', 'graph-kinds']) assert.strictEqual(inside(main, cls).length, 1, `${cls} stays in the view`);
  for (const cls of ['graph-zoom-btn', 'graph-options']) assert.strictEqual(inside(main, cls).length, 0, `${cls} is not in the view`);
  for (const cls of ['graph-filter-row', 'graph-filter-toggle', 'status-pill']) assert.strictEqual(inside(main, cls).length, 0, `${cls}: the Graph shows no status pill row`);
  assert.deepStrictEqual(s.host.children.map((c) => c.classes[0]), ['graph-main', 'view-panel'], 'the panel stands after the view, on its right');
});

test('Graph: the graph choice, the (i) and then the option button make the floating top row, left to right; the count and the key follow in a box of their own', async () => {
  const s = await open('graph');
  const row = byClass(s.main(), 'graph-controls')[0];
  assert.deepStrictEqual(row.children.map((c) => c.classes[0]), ['graph-kinds', 'graph-info-toggle', 'view-panel-toggle']);
  assert.deepStrictEqual(byClass(s.main(), 'graph-info')[0].children.map((c) => c.classes[0]), ['graph-count', 'graph-key']);
});

test('Graph: the Hierarchy | Flow buttons and the zoom buttons keep their labels, titles and data', async () => {
  const s = await open('graph', { stored: GRAPH_OPEN });
  const kinds = inside(byClass(s.main(), 'graph-controls')[0], 'graph-kind-btn');
  assert.deepStrictEqual(kinds.map((b) => [b.textContent, b.dataset.graphKind, b.getAttribute('aria-pressed')]), [['Hierarchy', 'hierarchy', 'true'], ['Flow', 'flow', 'false']]);
  assert.ok(kinds.every((b) => b.title.length > 10 && b.dataset.keepsSelection !== undefined && b.dataset.holdsPoll !== undefined));
  const zoom = inside(s.panel(), 'graph-zoom-btn');
  assert.deepStrictEqual(zoom.map((b) => [b.textContent, b.title, b.dataset.graphAction]), [['−', 'Zoom out', 'out'], ['+', 'Zoom in', 'in'], ['Fit', 'Fit every card in the panel', 'fit']]);
});

test('the icon button is a panel glyph: a rectangle with a bar on its right, labelled, saying whether the panel is open', async () => {
  const open1 = await open('graph', { stored: GRAPH_OPEN });
  const toggle = open1.toggle();
  assert.strictEqual(toggle.tag, 'button');
  assert.strictEqual(toggle.getAttribute('aria-label'), 'Options panel');
  assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(toggle.title.length > 10);
  assert.match(toggle.innerHTML, /<svg[^>]*viewBox="0 0 24 24"[\s\S]*<rect [^>]*width="18"[\s\S]*<line x1="15" [^>]*x2="15"/);
  assert.ok(toggle.dataset.keepsSelection !== undefined, 'a press on it keeps the selection');
  const shut = await open('graph', { stored: { [KEY]: '{"map":null,"graph":false}' } });
  assert.strictEqual(shut.toggle().getAttribute('aria-expanded'), 'false');
});

test('Graph, closed by a kept choice: no panel is built, and the view still draws', async () => {
  const s = await open('graph', { stored: { [KEY]: '{"map":null,"graph":false}' } });
  assert.strictEqual(s.panel(), null);
  assert.deepStrictEqual(s.host.children.map((c) => c.classes[0]), ['graph-main']);
  assert.strictEqual(inside(s.host, 'graph-kind-btn').length, 2, 'the graph choice stands in the toolbar, open panel or not');
  assert.strictEqual(inside(s.host, 'graph-stage').length, 1);
});

test('with nothing chosen the panel starts closed at every width, and a kept choice opens it or keeps it shut', async () => {
  for (const width of [400, 760, 1900]) {
    const fresh = await open('graph', { width });
    assert.strictEqual(fresh.panel(), null, `closed at ${width} px with nothing chosen`);
    assert.strictEqual(fresh.toggle().getAttribute('aria-expanded'), 'false');
  }
  const map = await open('map');
  assert.strictEqual(map.panel(), null, 'the Map starts closed too');
  const kept = await open('graph', { stored: GRAPH_OPEN, width: 400 });
  assert.ok(kept.panel(), 'open under 760 px by a kept choice, as a sheet');
  const wide = await open('graph', { stored: GRAPH_OPEN, width: 1900 });
  assert.ok(wide.panel(), 'open on a wide screen by a kept choice');
  const wideShut = await open('graph', { stored: { [KEY]: '{"map":null,"graph":false}' }, width: 1900 });
  assert.strictEqual(wideShut.panel(), null, 'a kept closed choice stays closed on a wide screen');
});

test('a closed panel opens on a press of the icon button, and the Hierarchy | Flow choice is in the toolbar before and after', async () => {
  const s = await open('graph');
  assert.strictEqual(inside(s.host, 'graph-kind-btn').length, 2, 'the choice shows with the panel shut');
  s.press(s.toggle());
  assert.ok(s.panel());
  assert.strictEqual(s.stored[KEY], '{"map":null,"graph":true}');
  assert.strictEqual(inside(s.panel(), 'graph-kind-btn').length, 0);
  assert.strictEqual(inside(s.host, 'graph-kind-btn').length, 2);
});

test('a press on the icon button closes the panel, keeps the choice for this board and the Graph alone, and presses again to open', async () => {
  const s = await open('graph', { stored: GRAPH_OPEN });
  s.press(s.toggle());
  assert.strictEqual(s.panel(), null);
  assert.strictEqual(s.stored[KEY], '{"map":null,"graph":false}');
  s.press(s.toggle());
  assert.ok(s.panel());
  assert.strictEqual(s.stored[KEY], '{"map":null,"graph":true}');
});

test('a sheet carries a close button, which a press on closes the panel as the icon button does', async () => {
  const s = await open('graph', { stored: GRAPH_OPEN });
  const close = byClass(s.panel(), 'view-panel-close')[0];
  assert.ok(close, 'the close button is in the panel');
  assert.strictEqual(close.getAttribute('aria-label'), 'Close the options panel');
  assert.ok(close.dataset.keepsSelection !== undefined);
  s.press(close);
  assert.strictEqual(s.panel(), null);
  assert.strictEqual(s.stored[KEY], '{"map":null,"graph":false}');
});

test('opening or closing the panel frames the cards again in the width it leaves, unless the person moved the view', async () => {
  const s = await open('graph');
  assert.strictEqual(s.page.run('graphRefitNext'), false);
  s.page.run('graphCur.view.x = 12345');
  s.press(s.toggle());
  assert.notStrictEqual(s.page.run('graphCur.view.x'), 12345, 'an untouched view is framed again');
  assert.strictEqual(s.page.run('graphRefitNext'), false, 'once, by the draw it asked for');
  s.page.run('graphCur.view.x = 12345; graphCur.view.touched = true');
  s.press(s.toggle());
  assert.strictEqual(s.page.run('graphCur.view.x'), 12345, 'a view the person moved stays as it is');
  assert.strictEqual(s.page.run('graphCur.view.touched'), true);
});

// --- the Map --------------------------------------------------------------------------------------------

test('Map, opened: the zoom and the Options section are in the panel, the status pills are not', async () => {
  const s = await open('map', { stored: MAP_OPEN });
  const panel = s.panel();
  assert.ok(panel, 'the panel is built');
  assert.strictEqual(inside(panel, 'map-zoom-btn').length, 3);
  assert.strictEqual(inside(panel, 'map-options').length, 1);
  const main = s.main();
  assert.strictEqual(inside(main, 'map-filter-toggle').length, 0, 'no status pill in the Map; they live in the Statuses section of the search panel');
  assert.strictEqual(inside(main, 'view-panel-toggle').length, 1);
  assert.strictEqual(inside(main, 'map-zoom-btn').length, 0);
  assert.strictEqual(inside(main, 'map-options').length, 0);
  assert.deepStrictEqual(s.host.children.map((c) => c.classes[0]), ['map-main', 'view-panel']);
  assert.deepStrictEqual(inside(panel, 'map-zoom-btn').map((b) => [b.textContent, b.title, b.dataset.zoomAction]), [['−', 'Zoom out', 'out'], ['+', 'Zoom in', 'in'], ['Fit', 'Fit the whole graph in the panel', 'fit']]);
});

test('Map: the top row holds only the option button, on the right; a press on it flips the Map\'s choice alone', async () => {
  const s = await open('map', { stored: GRAPH_OPEN });
  const bar = byClass(s.main(), 'view-bar')[0];
  assert.deepStrictEqual(bar.children.map((c) => c.classes[0]), ['view-panel-toggle']);
  assert.strictEqual(s.panel(), null, 'the Graph\'s open choice is not the Map\'s');
  s.press(s.toggle());
  assert.strictEqual(s.stored[KEY], '{"map":true,"graph":true}');
});

test('Map, closed by a kept choice or a narrow screen: no panel is built, and a kept choice beats the width', async () => {
  const kept = await open('map', { stored: { [KEY]: '{"map":false,"graph":null}' } });
  assert.strictEqual(kept.panel(), null);
  assert.strictEqual(inside(kept.host, 'map-zoom-btn').length, 0);
  assert.strictEqual(kept.toggle().getAttribute('aria-expanded'), 'false');
  const narrow = await open('map', { width: 400 });
  assert.strictEqual(narrow.panel(), null);
  const sheet = await open('map', { stored: { [KEY]: '{"map":true,"graph":null}' }, width: 400 });
  assert.ok(sheet.panel());
});

// --- the page ----------------------------------------------------------------------------------------------

test('the panel\'s two buttons keep the selection and leave the poll alone, so a poll\'s redraw gives them focus back', () => {
  const { assertKeepsSelection, assertLetsPollRun } = require('./helpers/markers');
  assertKeepsSelection(['.view-panel-toggle', '.view-panel-close'], 'a panel button');
  assertLetsPollRun(['.view-panel-toggle', '.view-panel-close'], 'a panel button');
});

test('the panel button and the sheet\'s close button are refocused after a redraw, so a poll does not drop focus', async () => {
  const s = await open('graph');
  assert.match(s.page.run('REFOCUS_SELECTOR'), /\.view-panel-toggle, \.view-panel-close/);
  assert.strictEqual(s.page.run('refocusSelector(__t)'.replace('__t', '({ dataset: { panel: "graph" }, classList: ["view-panel-toggle"] })')), '.view-panel-toggle[data-panel="graph"]');
});

test('crossing 760 px draws the view again, which the page asks the browser to tell it of', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /window\.matchMedia\(PHONE_WIDTH_QUERY\)/);
  assert.match(src, /phoneWidthMedia\(\);\s+if \(!list\) return;\s+list\.addEventListener\('change'/);
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /@media \(max-width: 759\.98px\) \{\n  \.view-panel \{ position: absolute;/, 'the sheet starts where the width default stops');
});

test('app.html loads view-panel.js after column-state.js, which it reads, and before app.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');
  const at = (name) => html.indexOf(`<script src="/${name}"></script>`);
  assert.ok(at('column-state.js') > -1 && at('column-state.js') < at('view-panel.js'));
  assert.ok(at('view-panel.js') < at('app.js'));
});

test('the panel\'s rules use tokens and no hex, and the sheet adds no width of its own to the page', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
  const rules = css.split('\n').filter((l) => /^\.view-(panel|bar)|^\.graph-controls \.view-panel/.test(l));
  assert.ok(rules.length >= 8);
  for (const l of rules) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b/, l);
  const sheet = css.match(/@media \(max-width: 759\.98px\) \{\n  \.view-panel \{([^}]*)\}/)[1];
  assert.match(sheet, /position: absolute/);
  assert.match(sheet, /bottom: 0/);
  assert.match(sheet, /left: 0/);
  assert.match(sheet, /right: 0/);
  assert.match(sheet, /width: 100%/);
  assert.match(sheet, /max-height: 50%/);
  assert.match(sheet, /border-top: 1px solid var\(--line\)/);
  assert.match(sheet, /border-left: none/);
  assert.doesNotMatch(sheet, /18rem|top: 0|backdrop/);
});

test('the l key still steps the Graph\'s names with the panel closed, since the choice is not read from the row', async () => {
  const s = await open('graph', { stored: { [KEY]: '{"map":null,"graph":false}' } });
  assert.strictEqual(s.page.run('graphLoadOptions().names'), 'relevant');
  s.page.run('onGraphNamesKey({ key: "l", preventDefault() {} })');
  assert.strictEqual(s.page.run('graphLoadOptions().names'), 'all');
  assert.strictEqual(s.panel(), null, 'and the panel stays closed');
});
