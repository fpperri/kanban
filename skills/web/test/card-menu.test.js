const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { assertKeepsSelection } = require('./helpers/markers');

// The card menu in the real page (helpers/page-vm.js runs every script the page
// loads in one vm). A right-click on a card outside the selection opens the menu
// for that card alone, leading with Peek and Add to selection, and leaves the
// selection and its range start as they were; inside the selection the menu acts
// on the whole resolved selection. Path and Tree add to the selection and leave
// the search box alone. Bulk entries read their cards from the menu's subject.

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8').replace(/\r\n/g, '\n');

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Card 2 waits for 1, 3 is a child of 1, 6 and archived 7 wait for 1: path:2 is 1, 2
// and 3; tree:2 adds 6 and 7 (7 is archived and the Archive column is collapsed).
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', status: 'todo', waiting_for: [1] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', status: 'todo' }),
    card(5, { title: 'Draft the release notes', status: 'doing' }),
    card(6, { title: 'Renew the domain', status: 'done', waiting_for: [1] }),
  ],
  archived: [card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, waiting_for: [1] })],
});

const MENU_ELEMENTS = ['#context-menu', '#ctx-peek', '#ctx-add', '#ctx-child', '#modal', '#modal-title', '#f-id', '#f-title', '#f-status', '#f-parent', '#ctx-assign', '#ctx-priority', '#ctx-tags', '#ctx-schedule', '#ctx-archive', '#ctx-restore', '#ctx-delete',
  '#bulk-single', '#bulk-single-input', '#bulk-single-apply', '#bulk-single-title', '#bulk-archive', '#bulk-archive-title'];

async function open({ view = 'board' } = {}) {
  const elements = Object.fromEntries(MENU_ELEMENTS.map((sel) => [sel, control()]));
  const graphHost = control();
  elements['#graph-view'] = graphHost;
  const page = await loadPage({ board: makeBoard(), stored: { 'kanban.kanban.view.mode': view }, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const asked = { confirms: [], opened: [], requests: [], deletes: [] };
  page.run('confirm = (m) => { __asked.confirms.push(m); return __asked.answer; }');
  page.run('openDelete = (kind, targets, opts) => { __asked.deletes.push({ kind, targets, opts }); }');
  Object.assign(page.ctx, { __asked: asked });
  asked.answer = false;
  page.ctx.openCard = (id) => { asked.opened.push(Number(id)); };
  const realFetch = page.ctx.fetch;
  page.ctx.fetch = (url, opts = {}) => { asked.requests.push([opts.method || 'GET', String(url)]); return realFetch(url, opts); };
  const ids = () => [...page.run('selectedIds')].map(Number).sort((a, b) => a - b);
  const selection = () => JSON.parse(JSON.stringify(page.run('selectionState.selection')));
  const rangeStart = () => { const v = page.run('selectionState.rangeStart'); return v === null ? null : Number(v); };
  const select = (rangeStartId, ...parts) => page.run(`setSelection(${parts.reduce((s, p) => `addPart(${s}, ${p})`, 'NO_SELECTION')}, ${rangeStartId})`);
  const menuOpen = () => !elements['#context-menu'].classList.contains('hidden');
  const menuControl = (sel) => page.menu[sel.slice('#ctx-'.length)] || elements[sel];
  const shown = (sel) => !menuControl(sel).classList.contains('hidden');
  const rightClick = (id) => page.fireDocument('contextmenu', { target: cardTarget(id), clientX: 30, clientY: 40 });
  const click = (sel, event = {}) => menuControl(sel).fire('click', event);
  const cardRequests = () => asked.requests.filter(([method, url]) => method !== 'GET' && /\/api\/cards\/\d+$/.test(url)).map(([method, url]) => `${method} ${url}`);
  return { page, elements, asked, ids, selection, rangeStart, select, menuOpen, shown, rightClick, click, cardRequests, graphHost };
}

function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : null) : harmless(String(key))) });
}

const a = (id) => ({ kind: 'card', id: String(id) });
const settle = (s) => s.page.settle();

// --- the menu's subject ---------------------------------------------------------------

test('a right-click on a card outside a two-card selection opens the menu and leaves the selection and its range start as they were', async () => {
  const s = await open();
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(3);
  assert.strictEqual(s.menuOpen(), true);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
  assert.deepStrictEqual(s.ids(), [1, 2]);
  assert.strictEqual(s.rangeStart(), 2, 'the range start is not re-planted on the right-clicked card');
});

test('outside the selection the menu offers Peek and Add to selection; inside it offers neither', async () => {
  const s = await open();
  s.select(null, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(3);
  assert.strictEqual(s.shown('#ctx-peek'), true);
  assert.strictEqual(s.shown('#ctx-add'), true);
  s.rightClick(2);
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.shown('#ctx-peek'), false);
  assert.strictEqual(s.shown('#ctx-add'), false);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] }, 'a right-click inside the selection leaves it as it is');
});

test('the menu leads with Peek, Add note… and Add child… in the markup, ahead of the groups', () => {
  const menu = html.match(/<div id="context-menu"[\s\S]*?\n<\/div>/)[0];
  const ids = [...menu.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids.slice(0, 4), ['ctx-peek', 'ctx-note', 'ctx-child', 'ctx-edit']);
});

test('the card details\' own menu has no Peek, and a right-click there leaves the selection alone', async () => {
  const s = await open();
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.page.run("currentDetailId = '3'");
  s.page.run('onDetailContextMenu({ clientX: 5, clientY: 6, defaultPrevented: false, preventDefault() {}, target: { closest: () => null } })');
  assert.strictEqual(s.menuOpen(), true);
  assert.strictEqual(s.shown('#ctx-peek'), false);
  assert.strictEqual(s.shown('#ctx-add'), true);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
  assert.strictEqual(s.rangeStart(), 2);
});

// --- Peek and Add to selection -------------------------------------------------------

test('the card details popup keeps the selection when a click lands in it, so closing a peek costs the selection nothing', () => {
  assertKeepsSelection(['#detail-modal'], 'the card details popup');
});

test('Peek opens the card\'s details through the plain open path and leaves the selection and its range start as they were', async () => {
  const s = await open();
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(3);
  s.click('#ctx-peek');
  assert.deepStrictEqual(s.asked.opened, [3]);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
  assert.strictEqual(s.rangeStart(), 2);
  assert.strictEqual(s.menuOpen(), false, 'the menu closes');
});

test('Add to selection adds the card as an addition, keeps the range start, and closes the menu', async () => {
  const s = await open();
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(3);
  s.click('#ctx-add');
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2), a(3)] });
  assert.deepStrictEqual(s.ids(), [1, 2, 3]);
  assert.strictEqual(s.rangeStart(), 2);
  assert.strictEqual(s.menuOpen(), false);
});

test('with nothing selected Add to selection makes the card the anchor', async () => {
  const s = await open();
  s.rightClick(3);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'the right-click itself picked nothing');
  s.click('#ctx-add');
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [] });
  assert.deepStrictEqual(s.ids(), [3]);
});

test('Add to selection from the card details\' menu adds the card shown', async () => {
  const s = await open();
  s.select(null, 'cardPart(1)');
  s.page.run("currentDetailId = '4'");
  s.page.run('onDetailContextMenu({ clientX: 5, clientY: 6, defaultPrevented: false, preventDefault() {}, target: { closest: () => null } })');
  s.click('#ctx-add');
  assert.deepStrictEqual(s.ids(), [1, 4]);
});

// --- the bulk entries act on the menu's subject ---------------------------------------

async function setPriority(s) {
  s.click('#ctx-priority');
  s.elements['#bulk-single-input'].value = 'High';
  s.click('#bulk-single-apply');
  await settle(s);
}

test('after a right-click outside a two-card selection, Set priority changes only the right-clicked card', async () => {
  const s = await open();
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(3);
  await setPriority(s);
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/3']);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] }, 'and the selection is still the two cards');
});

test('after a right-click inside a two-card selection, Set priority changes both cards', async () => {
  const s = await open();
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(2);
  await setPriority(s);
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/1', 'PATCH /api/cards/2']);
});

test('a popup opened from a menu outside the selection keeps the right-clicked card even when the selection changes while it is open', async () => {
  const s = await open();
  s.select(1, 'cardPart(1)');
  s.rightClick(3);
  s.click('#ctx-priority');
  s.select(5, 'cardPart(5)', 'cardPart(6)');
  s.elements['#bulk-single-input'].value = 'High';
  s.click('#bulk-single-apply');
  await settle(s);
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/3']);
});

test('the bulk entries include cards added by a path: a selection holding a path part has the path\'s cards as targets', async () => {
  const s = await open();
  s.select(null, 'cardPart(5)', 'pathPart(2)');
  s.rightClick(5);
  await setPriority(s);
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/5', 'PATCH /api/cards/1', 'PATCH /api/cards/2', 'PATCH /api/cards/3']);
});

test('Delete opens one popup for the cards it acts on: the right-clicked card alone outside the selection, the resolved selection inside it; Archive names the count in its confirmation', async () => {
  const s = await open();
  s.select(null, 'cardPart(1)', 'pathPart(2)', 'cardPart(5)');
  assert.deepStrictEqual(s.ids(), [1, 2, 3, 5]);
  s.rightClick(4);
  s.click('#ctx-archive');
  s.click('#ctx-delete');
  assert.deepStrictEqual(s.asked.deletes.map((d) => [d.kind, [...d.targets].map(String)]), [['card', ['4']]]);
  s.rightClick(5);
  s.click('#ctx-archive');
  s.click('#ctx-delete');
  assert.deepStrictEqual(s.asked.deletes.map((d) => [d.kind, [...d.targets].map(String)]), [['card', ['4']], ['card', ['1', '2', '3', '5']]]);
  assert.deepStrictEqual(s.asked.confirms, ['Archive 1 card(s)? (moves their files to archived/)', 'Archive 4 card(s)? (moves their files to archived/)'], 'Delete asks in its popup, not through confirm()');
});

test('deleting the card a menu outside the selection was opened on leaves the hand-built selection as it was; deleting a selection clears it', async () => {
  const s = await open();
  const confirmDelete = async () => {
    const d = s.asked.deletes[s.asked.deletes.length - 1];
    assert.strictEqual(await s.page.ctx.performDelete(d.kind, d.targets, {}, d.opts), '');
    await settle(s);
  };
  s.select(2, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(4);
  s.click('#ctx-delete');
  await confirmDelete();
  assert.deepStrictEqual(s.cardRequests(), ['DELETE /api/cards/4']);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
  s.rightClick(2);
  s.click('#ctx-delete');
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] }, 'the selection stays while the popup is open');
  await confirmDelete();
  assert.deepStrictEqual(s.cardRequests().slice(1), ['DELETE /api/cards/1', 'DELETE /api/cards/2']);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

// --- Explore: Path and Tree, each by Hierarchy or Dependency ---------------------------------

const box = (s) => s.page.input.value;

test('each of the four writes its term for the right-clicked card into the box, as typed, and shuts the menu', async () => {
  const s = await open();
  for (const [sel, term] of [['#ctx-hpath', 'hpath:3'], ['#ctx-htree', 'htree:3'], ['#ctx-dpath', 'dpath:3'], ['#ctx-dtree', 'dtree:3']]) {
    s.rightClick(3);
    s.click(sel);
    assert.strictEqual(box(s), term, sel);
    assert.strictEqual(s.menuOpen(), false, sel);
  }
  assert.deepStrictEqual(s.page.input.writes.slice(-4), ['hpath:3', 'htree:3', 'dpath:3', 'dtree:3']);
});

test('it replaces what the box held but for its slice: run, which stays after the term', async () => {
  const s = await open();
  s.page.input.typed('zephyr tags:ui slice:goal..epic');
  s.rightClick(2);
  s.click('#ctx-dpath');
  assert.strictEqual(box(s), 'dpath:2 slice:goal..epic');
  s.page.input.typed('(a | b) slice:2');
  s.rightClick(2);
  s.click('#ctx-hpath');
  assert.strictEqual(box(s), 'hpath:2 slice:2');
});

test('the write is the one typing makes: the address follows and the Board shows only the set', async () => {
  const s = await open();
  const told = [];
  s.page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  s.rightClick(2);
  s.click('#ctx-dpath');
  assert.deepStrictEqual(told, [['dpath:2', 'typing']]);
  assert.strictEqual(s.page.run('[...shownCardIds()].map(Number).sort((a, b) => a - b).join()'), '1,2', 'card 2 waits for card 1; card 6 waits for card 1 too but is not on the path of 2');
});

test('in the Graph the box is the typed anchor of the selection, so the set is lit and Isolate works on it', async () => {
  const s = await open({ view: 'graph' });
  s.rightClick(2);
  s.click('#ctx-dpath');
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'query', text: 'dpath:2', source: 'typing' }, additions: [] });
  assert.deepStrictEqual(s.ids(), [1, 2]);
  assert.strictEqual(s.page.run('isolateFlip()'), true);
  assert.strictEqual(box(s), 'dpath:2', 'the isolate text of a typed search is the search');
  assert.notStrictEqual(s.page.run('isolateNow()'), null);
});

test('the four act on the right-clicked card alone, even when it is inside the selection or the subject is several cards', async () => {
  const s = await open();
  s.select(null, 'cardPart(1)', 'cardPart(2)', 'cardPart(4)');
  s.rightClick(4);
  assert.strictEqual(s.page.run('menuSubject.ids.length'), 3, 'the menu is for the selection');
  s.click('#ctx-hpath');
  assert.strictEqual(box(s), 'hpath:4');
  s.rightClick(1);
  s.click('#ctx-dtree');
  assert.strictEqual(box(s), 'dtree:1');
});

test('the card details\' own menu writes the term of the open card', async () => {
  const s = await open();
  s.select(null, 'cardPart(1)', 'cardPart(2)');
  const openDetailMenu = (id) => {
    s.page.run(`currentDetailId = '${id}'`);
    s.page.run('onDetailContextMenu({ clientX: 5, clientY: 6, defaultPrevented: false, preventDefault() {}, target: { closest: () => null } })');
  };
  openDetailMenu(2);
  s.click('#ctx-dpath');
  assert.strictEqual(box(s), 'dpath:2');
  openDetailMenu(4);
  s.click('#ctx-htree');
  assert.strictEqual(box(s), 'htree:4');
});

test('with isolate on, the term replaces the isolate text in the box as typing would, and isolate stays on holding it', async () => {
  const s = await open();
  s.select(null, 'cardPart(1)', 'cardPart(2)');
  assert.strictEqual(s.page.run('isolateFlip()'), true);
  assert.strictEqual(box(s), '#1 | #2');
  s.rightClick(1);
  s.click('#ctx-dpath');
  assert.strictEqual(box(s), 'dpath:1');
  assert.notStrictEqual(s.page.run('isolateNow()'), null);
});

test('a Shift pick adds the term to what the box holds as one more alternative, as if typed, and leaves isolate alone', async () => {
  const s = await open();
  const shift = { shiftKey: true };
  s.page.input.typed('htree:1');
  s.rightClick(2);
  s.click('#ctx-dpath', shift);
  assert.strictEqual(box(s), 'htree:1 | dpath:2');
  s.rightClick(3);
  s.click('#ctx-hpath', shift);
  assert.strictEqual(box(s), 'htree:1 | dpath:2 | hpath:3');
  s.rightClick(3);
  s.click('#ctx-hpath', shift);
  assert.strictEqual(box(s), 'htree:1 | dpath:2 | hpath:3', 'an alternative the box holds is not added twice');
  s.page.input.typed('tags:ui status:doing slice:goal..epic');
  s.rightClick(2);
  s.click('#ctx-dtree', shift);
  assert.strictEqual(box(s), '((tags:ui status:doing) | dtree:2) slice:goal..epic', 'bracketed where it needs it, the slice run after');
  assert.deepStrictEqual(s.page.run('isolateNow()'), null);
});

test('a Shift pick on an empty box is a plain pick, and a plain pick after it replaces the alternatives', async () => {
  const s = await open();
  s.rightClick(2);
  s.click('#ctx-dpath', { shiftKey: true });
  assert.strictEqual(box(s), 'dpath:2');
  s.rightClick(3);
  s.click('#ctx-hpath', { shiftKey: true });
  assert.strictEqual(box(s), 'dpath:2 | hpath:3');
  s.rightClick(3);
  s.click('#ctx-htree');
  assert.strictEqual(box(s), 'htree:3');
});

test('a Shift pick is a write of the reason typing, and in the Graph the box is still the typed anchor', async () => {
  const s = await open({ view: 'graph' });
  const told = [];
  s.page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  s.rightClick(2);
  s.click('#ctx-dpath');
  s.rightClick(3);
  s.click('#ctx-hpath', { shiftKey: true });
  assert.deepStrictEqual(told, [['dpath:2', 'typing'], ['dpath:2 | hpath:3', 'typing']]);
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'query', text: 'dpath:2 | hpath:3', source: 'typing' }, additions: [] });
});

test('each item\'s tooltip ends by saying Shift adds to the search', () => {
  for (const id of ['ctx-hpath', 'ctx-htree', 'ctx-dpath', 'ctx-dtree']) {
    const title = new RegExp(`id="${id}"[^>]*title="([^"]*)"`).exec(html)[1];
    assert.match(title, /Shift: add to the search$/, id);
  }
});

test('the empty canvas menu has no card, so the four write nothing', async () => {
  const s = await open();
  s.page.input.typed('zephyr');
  const writes = s.page.input.writes.length;
  s.page.run('menuSubject = canvasMenuFor()');
  for (const sel of ['#ctx-hpath', '#ctx-htree', '#ctx-dpath', '#ctx-dtree']) s.click(sel);
  assert.strictEqual(box(s), 'zephyr');
  assert.strictEqual(s.page.input.writes.length, writes);
});

test('the four leave the selection\'s cards alone outside the Graph: nothing is added to it', async () => {
  const s = await open();
  s.select(null, 'cardPart(5)');
  s.rightClick(3);
  s.click('#ctx-hpath');
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
});

// --- Add child… -----------------------------------------------------------------------------

test('Add child… is in the menu of one live card, wherever the menu opens, and not in a batch menu or an archived card', async () => {
  const s = await open();
  s.rightClick(3);
  assert.strictEqual(s.shown('#ctx-child'), true, 'a card outside the selection');
  s.select(null, 'cardPart(4)');
  s.rightClick(4);
  assert.strictEqual(s.shown('#ctx-child'), true, 'a selection of one');
  s.select(null, 'cardPart(1)', 'cardPart(2)');
  s.rightClick(2);
  assert.strictEqual(s.shown('#ctx-child'), false, 'a selection of two');
  s.rightClick(7);
  assert.strictEqual(s.shown('#ctx-child'), false, 'an archived card');
});

test('Add child… is in the card detail menu for a live card and not for an archived one', async () => {
  const s = await open();
  const rightClickDetail = (id) => {
    s.page.run(`currentDetailId = '${id}'`);
    s.page.run('onDetailContextMenu({ clientX: 5, clientY: 6, defaultPrevented: false, preventDefault() {}, target: { closest: () => null } })');
  };
  rightClickDetail(3);
  assert.strictEqual(s.shown('#ctx-child'), true);
  rightClickDetail(7);
  assert.strictEqual(s.shown('#ctx-child'), false);
});

test('Add child… opens the New card form as + New card does, with the parent preset and the heading saying so, and writes nothing', async () => {
  const s = await open();
  s.rightClick(3);
  s.click('#ctx-child');
  assert.strictEqual(s.menuOpen(), false, 'the menu closes');
  assert.strictEqual(s.elements['#modal'].classList.contains('hidden'), false, 'the form is up');
  assert.strictEqual(s.elements['#modal-title'].textContent, 'New card under #3');
  assert.strictEqual(String(s.elements['#f-parent'].value), '3');
  assert.strictEqual(s.elements['#f-id'].value, '', 'a new card: it has no id yet');
  assert.strictEqual(s.elements['#f-status'].value, 'backlog', 'the default status, as + New card gives');
  assert.deepStrictEqual(s.cardRequests(), [], 'neither the parent nor any other card is written');
  assert.deepStrictEqual(s.asked.requests.filter(([method]) => method !== 'GET'), [], 'nothing is written until the form is saved');
});

test('the form + New card opens has no parent and the plain heading, after one opened under a card', async () => {
  const s = await open();
  s.rightClick(3);
  s.click('#ctx-child');
  s.page.run('openModal(null)');
  assert.strictEqual(s.elements['#modal-title'].textContent, 'New card');
  assert.strictEqual(String(s.elements['#f-parent'].value), '');
});

test('Add child… from the card detail menu presets the card shown', async () => {
  const s = await open();
  s.page.run("currentDetailId = '4'");
  s.page.run('onDetailContextMenu({ clientX: 5, clientY: 6, defaultPrevented: false, preventDefault() {}, target: { closest: () => null } })');
  s.click('#ctx-child');
  assert.strictEqual(s.elements['#modal-title'].textContent, 'New card under #4');
  assert.strictEqual(String(s.elements['#f-parent'].value), '4');
});

test('the canvas menu of the Graph and the Map has no Add child…', async () => {
  const s = await open();
  s.page.run('menuSubject = canvasMenuFor(); showContextMenu(5, 6)');
  assert.strictEqual(s.shown('#ctx-child'), false);
});

test('Add child… is a menu item in the markup', () => {
  const menu = html.match(/<div id="context-menu"[\s\S]*?\n<\/div>/)[0];
  assert.match(menu, /<button type="button" id="ctx-child" role="menuitem" class="hidden">Add child…<\/button>/);
});

test('on a phone in the Board, Add child… opens in the status tab being read, as New card does', async () => {
  const s = await open();
  s.page.run("onPhoneLayout = () => true; activePhoneColumn = () => 'doing'");
  s.rightClick(3);
  s.click('#ctx-child');
  assert.strictEqual(s.elements['#f-status'].value, 'doing');
  assert.strictEqual(s.elements['#modal-title'].textContent, 'New card under #3');
});

test('on a phone the archive tab is no status: Add child… opens in the first status', async () => {
  const s = await open();
  s.page.run("onPhoneLayout = () => true; activePhoneColumn = () => 'archive'");
  s.rightClick(3);
  s.click('#ctx-child');
  assert.strictEqual(s.elements['#f-status'].value, 'backlog');
});
