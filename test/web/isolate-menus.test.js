const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The Isolate entries of the card menu, in the real page (helpers/page-vm.js runs every script
// the page loads in one vm). A right-click inside the selection opens the menu that acts on the
// selection, and it offers Isolate, which does what the switch does; the menu on a card outside
// the selection and the card details' own menu do not. A right-click on the empty Graph canvas
// or the empty Map canvas opens a small menu with that one entry, in place of the browser's own;
// on a card, a link or a control it opens nothing of the kind. The entry reads like the switch:
// Isolate to turn it on, and Turn isolate off while it is on. The pure parts are pinned in
// selection-isolate.test.js; the browser runner right-clicks the page itself
// (scenarios/isolate-link.js).

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', status: 'todo', waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', status: 'todo' }),
    card(5, { title: 'Draft the release notes', status: 'doing' }),
  ],
  archived: [],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const spied = (el = control()) => {
  el.attrs = {};
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  let text = '';
  Object.defineProperty(el, 'textContent', { configurable: true, get: () => text, set: (v) => { text = String(v); } });
  return el;
};

async function open({ view = 'board' } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  elements['#isolate-switch'] = spied();
  elements['#ctx-isolate'] = spied(hidden());
  elements['#search-chip'] = spied(hidden());
  elements['#search-panel-toggle'] = spied();
  elements['#search-pills-fold'] = spied();
  elements['#toast'] = spied(hidden());
  const page = await loadPage({ board: makeBoard(), stored: { 'kanban.kanban.view.mode': view }, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const menu = elements['#context-menu'];
  const entry = elements['#ctx-isolate'];
  return {
    page, elements, menu, entry,
    box: () => page.input.value,
    isolate: () => JSON.parse(JSON.stringify(page.run('isolateNow()'))),
    ids: () => [...page.run('selectedIds')].sort((a, b) => a - b),
    pick: (...parts) => page.run(`setSelection(${parts.reduce((sel, p) => `addPart(${sel}, ${p})`, 'NO_SELECTION')}, null)`),
    menuOpen: () => !menu.classList.contains('hidden'),
    offered: () => !entry.classList.contains('hidden'),
    label: () => entry.textContent,
    canvasOnly: () => menu.classList.contains('canvas-menu'),
    toast: () => elements['#toast'].textContent,
    choose: () => entry.fire('click'),
    // A right-click on a card's tile; the event records whether the page kept the browser's own menu from opening.
    rightClick: (id) => {
      const el = { dataset: { id: String(id) } };
      const e = { prevented: false, clientX: 30, clientY: 40, preventDefault() { e.prevented = true; }, target: { closest: (sel) => (sel === '.card-el' ? el : null) } };
      page.fireDocument('contextmenu', e);
      return e;
    },
    // A right-click at a point of the page that sits inside the elements named by `within` (its
    // ancestry, as selectors), as the page's document listener sees it.
    rightClickAt: (within) => {
      const e = { prevented: false, clientX: 30, clientY: 40, preventDefault() { e.prevented = true; }, target: ancestry(within) };
      page.fireDocument('contextmenu', e);
      return e;
    },
  };
}

// A target whose closest() answers for a selector list the way a browser does: an element answers
// for a compound selector when it sits inside every part of it.
function ancestry(within) {
  const holds = (part) => part.trim().split(/\s+/).every((token) => within.includes(token));
  return { closest: (sel) => (sel.split(',').some(holds) ? {} : null), dataset: {} };
}

// --- inside the selection ------------------------------------------------------------------------

test('a right-click on a card inside a selection of two offers Isolate, and choosing it turns isolate on as the switch does', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.rightClick(2);
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.offered(), true, 'the menu that acts on the selection offers Isolate');
  assert.strictEqual(s.label(), 'Isolate');
  s.choose();
  assert.strictEqual(s.box(), '#2 | #5', 'the selection is written into the box, as the switch writes it');
  assert.deepStrictEqual(s.isolate(), { previous: '' });
  assert.strictEqual(s.menuOpen(), false, 'the menu closes');
  assert.deepStrictEqual(s.ids(), ['2', '5'], 'and the selection is as it was');
  assert.strictEqual(s.elements['#isolate-switch'].getAttribute('aria-checked'), 'true', 'the switch agrees');
});

test('the menu on a card outside the selection does not offer Isolate', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.rightClick(2);
  assert.strictEqual(s.offered(), true);
  s.rightClick(3);
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.offered(), false, 'a card the selection does not hold is no part of what Isolate shows');
  s.pick();
  s.rightClick(3);
  assert.strictEqual(s.offered(), false, 'and with nothing selected every card is outside it');
});

test('the card details\' own menu does not offer Isolate, even for a card inside the selection', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.page.run('currentDetailId = 2');
  s.page.run('onDetailContextMenu({ clientX: 5, clientY: 6, defaultPrevented: false, preventDefault() {}, target: { closest: () => null } })');
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.offered(), false);
});

test('while isolate is on, the entry in the selection\'s menu reads Turn isolate off, and choosing it turns it off', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.elements['#isolate-switch'].fire('click', { preventDefault() {} });
  assert.strictEqual(s.box(), '#2 | #5');
  s.rightClick(2);
  assert.strictEqual(s.offered(), true);
  assert.strictEqual(s.label(), 'Turn isolate off');
  s.choose();
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.isolate(), null);
  s.rightClick(5);
  assert.strictEqual(s.label(), 'Isolate', 'the entry follows the switch back');
});

test('Isolate reads the selection as it is when it is chosen: a card added while the menu is up joins it', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.rightClick(2);
  s.pick('cardPart(2)', 'cardPart(5)', 'cardPart(4)');
  s.choose();
  assert.strictEqual(s.box(), '#2 | #5 | #4');
});

// --- the empty canvas of the Graph and the Map ---------------------------------------------------------

test('a right-click on the empty Graph canvas opens a menu with Isolate alone, and the browser\'s own menu does not open', async () => {
  const s = await open({ view: 'graph' });
  s.pick('cardPart(2)', 'cardPart(5)');
  const e = s.rightClickAt(['#graph-view', '.graph-canvas']);
  assert.strictEqual(e.prevented, true, 'the browser\'s own menu is kept from opening');
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.offered(), true);
  assert.strictEqual(s.canvasOnly(), true, 'every other entry is out of the menu');
  assert.strictEqual(s.label(), 'Isolate');
  s.choose();
  assert.strictEqual(s.box(), '#2 | #5');
  assert.notStrictEqual(s.isolate(), null);
  assert.strictEqual(s.menuOpen(), false);
});

test('a right-click on the empty Map canvas opens that menu too', async () => {
  const s = await open({ view: 'map' });
  s.pick('cardPart(1)', 'cardPart(3)');
  const e = s.rightClickAt(['#map-view', '.map-canvas']);
  assert.strictEqual(e.prevented, true);
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.offered(), true);
  assert.strictEqual(s.canvasOnly(), true);
  s.choose();
  assert.strictEqual(s.box(), '#1 | #3');
});

test('with nothing selected the canvas menu still offers Isolate, and choosing it says nothing is selected and leaves isolate off, as the switch does', async () => {
  const s = await open({ view: 'graph' });
  s.rightClickAt(['#graph-view', '.graph-canvas']);
  assert.strictEqual(s.offered(), true);
  s.choose();
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), '');
  assert.match(s.toast(), /Nothing is selected to isolate/);
});

test('while isolate is on, the canvas menu reads Turn isolate off, and choosing it turns it off', async () => {
  const s = await open({ view: 'graph' });
  s.pick('cardPart(2)', 'cardPart(5)');
  s.elements['#isolate-switch'].fire('click', { preventDefault() {} });
  s.rightClickAt(['#graph-view', '.graph-canvas']);
  assert.strictEqual(s.label(), 'Turn isolate off');
  s.choose();
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), '');
});

test('the canvas menu opens only on empty canvas: not on a card, a Graph dot, a caption of the fan, a Map node, a link or a control', async () => {
  for (const [view, canvas] of [['graph', ['#graph-view', '.graph-canvas']], ['map', ['#map-view', '.map-canvas']]]) {
    for (const on of [['.graph-node'], ['[data-tip]'], ['.map-node'], ['a'], ['button'], ['input'], ['select'], ['textarea'], ['.graph-link'], ['.graph-link-hit'], ['.graph-link-count'], ['.map-edge']]) {
      const s = await open({ view });
      const e = s.rightClickAt([...canvas, ...on]);
      assert.strictEqual(e.prevented, false, `${view} on ${on}: the browser's own menu is left alone`);
      assert.strictEqual(s.menuOpen(), false, `${view} on ${on}: no menu`);
    }
  }
});

test('a right-click on a card in the Graph or the Map still opens the card\'s own menu, not the canvas one', async () => {
  for (const [view, canvas] of [['graph', ['#graph-view', '.graph-canvas']], ['map', ['#map-view', '.map-canvas']]]) {
    const s = await open({ view });
    s.pick('cardPart(2)', 'cardPart(5)');
    const el = { dataset: { id: '3' } };
    const e = { prevented: false, clientX: 1, clientY: 2, preventDefault() { e.prevented = true; }, target: { closest: (sel) => (sel === '.card-el' ? el : ancestry(canvas).closest(sel)) } };
    s.page.fireDocument('contextmenu', e);
    assert.strictEqual(s.menuOpen(), true, view);
    assert.strictEqual(s.canvasOnly(), false, `${view}: the card's menu has every entry`);
    assert.strictEqual(s.offered(), false, `${view}: card 3 is outside the selection`);
  }
});

test('outside the Graph and the Map, empty space keeps the browser\'s own menu', async () => {
  const board = await open({ view: 'board' });
  assert.strictEqual(board.rightClickAt(['#board']).prevented, false);
  assert.strictEqual(board.menuOpen(), false);
  const stale = await open({ view: 'board' });
  assert.strictEqual(stale.rightClickAt(['#graph-view', '.graph-canvas']).prevented, false, 'a Graph canvas that is not the view on show is not a canvas');
  assert.strictEqual(stale.menuOpen(), false);
  const graph = await open({ view: 'graph' });
  assert.strictEqual(graph.rightClickAt(['#graph-view', '.graph-toolbar']).prevented, false, 'the Graph\'s toolbar is not canvas');
  assert.strictEqual(graph.rightClickAt(['#map-view', '.map-canvas']).prevented, false, 'nor is the Map\'s canvas while the Graph is shown');
});

test('a card menu opened after a canvas menu has every entry back', async () => {
  const s = await open({ view: 'graph' });
  s.rightClickAt(['#graph-view', '.graph-canvas']);
  assert.strictEqual(s.canvasOnly(), true);
  s.rightClick(3);
  assert.strictEqual(s.canvasOnly(), false);
  assert.strictEqual(s.offered(), false);
});

// --- the markup and the page's own rules ----------------------------------------------------------------

test('the menu holds one Isolate entry, hidden to start, after Schedule and before Dependency tree', () => {
  const menu = html.match(/<div id="context-menu"[\s\S]*?\n<\/div>/)[0];
  const ids = [...menu.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(ids.filter((id) => id === 'ctx-isolate').length, 1);
  assert.ok(ids.indexOf('ctx-isolate') > ids.indexOf('ctx-schedule'), ids.join(' '));
  assert.ok(ids.indexOf('ctx-isolate') < ids.indexOf('ctx-tree'), ids.join(' '));
  assert.match(menu, /<button[^>]*id="ctx-isolate"[^>]*role="menuitem"[^>]*>Isolate<\/button>/);
  assert.match(menu, /<button[^>]*id="ctx-isolate"[^>]*class="hidden"/, 'hidden until a menu for the selection opens');
});

test('the canvas menu is the one menu with every entry but Isolate out of it, in the stylesheet and not in an inline style', () => {
  assert.match(css, /\.context-menu\.canvas-menu button:not\(#ctx-isolate\)\s*\{\s*display:\s*none;?\s*\}/);
});
