const { test } = require('node:test');
const assert = require('node:assert');
const { shownMatchIds } = require('../../plugin/skills/web/web/selection');

// Select all shown adds the cards the search matches that the view shows. The pure rule: what the whole
// query matched, narrowed to the ids the view shows before the box and any cut, in the matches' order.

test('shownMatchIds keeps the matches the view shows, in the order they matched', () => {
  const matched = new Set(['9', '3', '7', '1']);
  const shown = new Set(['1', '2', '3', '9']);
  assert.deepStrictEqual(shownMatchIds(matched, shown), ['9', '3', '1']);
});

test('shownMatchIds leaves out a match the view does not show (a hidden status, a cut, a collapsed column)', () => {
  assert.deepStrictEqual(shownMatchIds(new Set(['1', '2']), new Set(['2'])), ['2']);
  assert.deepStrictEqual(shownMatchIds(new Set(['1', '2']), new Set()), []);
});

test('shownMatchIds is empty with no query: null matched is "no query", never "every card"', () => {
  assert.deepStrictEqual(shownMatchIds(null, new Set(['1', '2'])), []);
  assert.deepStrictEqual(shownMatchIds(new Set(), new Set(['1', '2'])), []);
});

test('shownMatchIds with no query and a status off is every card the view shows, in the shown order', () => {
  const shown = new Set(['4', '1', '9']);
  assert.deepStrictEqual(shownMatchIds(null, shown, true), ['4', '1', '9']);
  assert.deepStrictEqual(shownMatchIds(null, shown, false), []);
  assert.deepStrictEqual(shownMatchIds(null, shown), []);
});

test('shownMatchIds with a query ignores the status flag: the matches among the shown, as before', () => {
  assert.deepStrictEqual(shownMatchIds(new Set(['1', '2']), new Set(['2', '3']), true), ['2']);
});

test('shownMatchIds reads the sets without changing them and returns a new list', () => {
  const matched = new Set(['1', '2']);
  const shown = new Set(['1', '2']);
  const ids = shownMatchIds(matched, shown);
  ids.push('3');
  assert.deepStrictEqual([...matched], ['1', '2']);
  assert.deepStrictEqual([...shown], ['1', '2']);
});

test('shownMatchIds keeps an id as it came, string or number, and a group id like G3', () => {
  assert.deepStrictEqual(shownMatchIds(new Set([10, 20]), new Set([20])), [20]);
  assert.deepStrictEqual(shownMatchIds(new Set(['G3', '3']), new Set(['G3', '3'])), ['G3', '3']);
});

// --- the button in the real page (helpers/page-vm.js runs every script the page loads in one vm) ---

const { loadPage, control } = require('./helpers/page-vm');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');

const card = (id, over = {}) => ({
  id: String(id), title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// 6 and 7 are done, 2 and 5 are tagged ui and sit in two statuses, 8 is a done card in the archive.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [], pills: [],
  active: [
    card(1, { status: 'doing' }),
    card(2, { status: 'todo', tags: ['ui'] }),
    card(3, { status: 'backlog' }),
    card(4, { status: 'todo', blocked: 'vendor' }),
    card(5, { status: 'doing', tags: ['ui'] }),
    card(6, { status: 'done' }),
    card(7, { status: 'done' }),
  ],
  archived: [card(8, { status: 'done', archived: true })],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#bulk-status', '#search-panel', '#search-select-all'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };

async function open({ view = 'board', typing = true, phone = false } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  const stored = { 'kanban.kanban.view.mode': view, 'kanban.kanban.typing.isolates': JSON.stringify({ board: typing, map: typing }) };
  const page = loadPage({ board: makeBoard(), stored, elements });
  page.ctx.matchMedia = (q) => ({ matches: q === PHONE_WIDTH_QUERY && phone, addEventListener() {} });
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  page.run('setSearchPanelOpen(true)');
  const button = elements['#search-select-all'];
  return {
    page, button,
    type: (text) => { page.input.typed(text); },
    shownButton: () => !button.classList.contains('hidden'),
    label: () => button.textContent,
    press: () => button.fire('click', {}),
    picked: () => [...page.run('selectedIds')].map(Number).sort((x, y) => x - y),
    box: () => page.input.value,
    isolated: () => page.run('isolateNow()') !== null,
    flipIsolate: () => page.run('isolateFlip()'),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
  };
}

test('with an empty box and no pill on the panel has no Select all shown; a query brings it, reading how many cards it matches', async () => {
  const s = await open();
  assert.strictEqual(s.shownButton(), false);
  s.type('status:done');
  assert.strictEqual(s.shownButton(), true);
  assert.strictEqual(s.label(), 'Select all shown (2)', 'cards 6 and 7; the archived card 8 is not on the Board');
  s.type('');
  assert.strictEqual(s.shownButton(), false);
});

test('a pill that is on is a query in the box, so the panel offers it then too', async () => {
  const s = await open();
  s.page.run(`applyPillGesture('toggle', 'blocked')`);
  assert.strictEqual(s.box(), 'blocked:');
  assert.strictEqual(s.shownButton(), true);
  assert.strictEqual(s.label(), 'Select all shown (1)', 'card 4');
  s.page.run(`applyPillGesture('toggle', 'blocked')`);
  assert.strictEqual(s.shownButton(), false, 'with the pill off again the box is empty');
});

test('the count is the same with isolate on and off', async () => {
  const s = await open();
  s.type('tags:ui');
  assert.strictEqual(s.isolated(), true, 'typing turned isolate on on the Board');
  assert.strictEqual(s.label(), 'Select all shown (2)');
  s.flipIsolate();
  assert.strictEqual(s.isolated(), false);
  assert.strictEqual(s.label(), 'Select all shown (2)');
});

test('a press selects every card the search matches, as card parts, in the order they matched', async () => {
  const s = await open();
  s.type('status:done');
  s.press();
  assert.deepStrictEqual(s.picked(), [6, 7]);
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'card', id: '6' }, additions: [{ kind: 'card', id: '7' }] });
  assert.strictEqual(s.box(), 'status:done', 'isolate is on: the box keeps the query the cards were found by');
});

test('with isolate off a press shows the picks in the box, as Add to selection does', async () => {
  const s = await open({ typing: false });
  s.type('status:done');
  assert.strictEqual(s.isolated(), false);
  s.press();
  assert.deepStrictEqual(s.picked(), [6, 7]);
  assert.strictEqual(s.box(), '#6 | #7');
  assert.strictEqual(s.label(), 'Select all shown (2)', 'the query is the picks now, and they are the same two');
});

test('a card the selection already holds stays where it was', async () => {
  const s = await open();
  s.type('status:done');
  s.page.run(`setSelection(addPart(NO_SELECTION, cardPart('7')))`);
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'card', id: '7' }, additions: [{ kind: 'card', id: '6' }] });
});

test('on the phone Board it takes the matches of every status, whichever tab is open', async () => {
  const s = await open({ phone: true });
  s.type('tags:ui');
  assert.strictEqual(s.label(), 'Select all shown (2)', 'card 2 is in Todo, card 5 in Doing');
  s.press();
  assert.deepStrictEqual(s.picked(), [2, 5]);
});

test('the phone Board reads the count the desk Board reads: the archive, a location and no status, is left out', async () => {
  const desk = await open();
  desk.type('status:done');
  const s = await open({ phone: true });
  s.type('status:done');
  assert.strictEqual(s.label(), desk.label());
  assert.strictEqual(s.label(), 'Select all shown (2)', 'cards 6 and 7; the archived card 8 is the Archive tab, not a status tab');
  s.press();
  assert.deepStrictEqual(s.picked(), [6, 7], 'what the Archive popup then reads');
});

test('the phone leaves the archive out of the Board only: the Map there keeps its Archive pill', async () => {
  const s = await open({ view: 'map', phone: true });
  s.type('status:done');
  assert.strictEqual(s.label(), 'Select all shown (3)', 'cards 6, 7 and 8; the Map shows the archive to start');
});

test('a status the view has switched off takes its matches out of the count and the press', async () => {
  const s = await open({ view: 'map' });
  s.type('status:done');
  assert.strictEqual(s.label(), 'Select all shown (3)', 'the Map shows the archive to start: cards 6, 7 and 8');
  s.page.run(`toggleMapStatusFilter('done')`);
  assert.strictEqual(s.label(), 'Select all shown (1)', 'Done is off: card 8 is in the Archive, which is still on');
  s.page.run(`toggleMapStatusFilter('archive')`);
  assert.strictEqual(s.label(), 'Select all shown (0)');
  assert.strictEqual(s.button.disabled, true, 'nothing to press');
  s.press();
  assert.deepStrictEqual(s.picked(), []);
});

test('with an empty box a status switched off on the Map brings the button, counting the cards the Map shows', async () => {
  const s = await open({ view: 'map' });
  assert.strictEqual(s.shownButton(), false, 'every status on and an empty box: nothing to select');
  s.page.run(`toggleMapStatusFilter('todo')`);
  s.page.run(`toggleMapStatusFilter('backlog')`);
  assert.strictEqual(s.shownButton(), true);
  assert.strictEqual(s.label(), 'Select all shown (5)', 'cards 1 and 5 in Doing, 6 and 7 in Done, and 8 in the Archive the Map shows to start');
});

test('the Map with a status off and an empty box: a press selects the cards it shows', async () => {
  const s = await open({ view: 'map' });
  s.page.run(`toggleMapStatusFilter('todo')`);
  s.page.run(`toggleMapStatusFilter('backlog')`);
  s.press();
  assert.deepStrictEqual(s.picked(), [1, 5, 6, 7, 8]);
});

test('switching the status back on takes the button away again', async () => {
  const s = await open({ view: 'map' });
  s.page.run(`toggleMapStatusFilter('todo')`);
  assert.strictEqual(s.shownButton(), true);
  s.page.run(`toggleMapStatusFilter('todo')`);
  assert.strictEqual(s.shownButton(), false);
});

test('a query with a status off counts as before: the matches among the shown', async () => {
  const s = await open({ view: 'map' });
  s.page.run(`toggleMapStatusFilter('todo')`);
  s.type('tags:ui');
  assert.strictEqual(s.label(), 'Select all shown (1)', 'card 5; card 2 is in the hidden Todo');
});

test('the Archive off alone on the Map, an empty box: the button shows and leaves the archive out', async () => {
  const s = await open({ view: 'map' });
  s.page.run(`toggleMapStatusFilter('archive')`);
  assert.strictEqual(s.shownButton(), true);
  assert.strictEqual(s.label(), 'Select all shown (7)');
});

test('the Board has no Statuses section, so an empty box stays without the button', async () => {
  const s = await open();
  assert.strictEqual(s.shownButton(), false);
});

test('a query that matches nothing offers nothing to press', async () => {
  const s = await open();
  s.type('zzzz-no-such-card');
  assert.strictEqual(s.shownButton(), true);
  assert.strictEqual(s.label(), 'Select all shown (0)');
  assert.strictEqual(s.button.disabled, true);
});

test('the button is static markup between the pill section and the divider: hidden to start, a type=button that keeps a selection', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');
  const panel = html.slice(html.indexOf('<div id="search-panel"'));
  const [tag] = panel.match(/<button[^>]*id="search-select-all"[^>]*>/);
  assert.match(tag, /\stype="button"/);
  assert.match(tag, /\sclass="[^"]*\bhidden\b/, 'with an empty box there is nothing to select');
  assert.match(tag, /\sdata-keeps-selection(\s|>)/, 'a click on it never clears the selection it adds to');
  const at = (needle) => panel.indexOf(needle);
  assert.ok(at('id="search-pills"') < at('id="search-select-all"') && at('id="search-select-all"') < at('class="search-divider"'));
});

test('in the Graph, where the typed query is already the anchor and lights its matches, a press adds them as cards and the count is the same', async () => {
  const s = await open({ view: 'graph', typing: false });
  s.type('status:done');
  assert.strictEqual(s.label(), 'Select all shown (2)', 'cards 6 and 7');
  assert.deepStrictEqual(s.picked(), [6, 7], 'the typed anchor already selects them');
  s.press();
  assert.deepStrictEqual(s.picked(), [6, 7]);
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'query', text: 'status:done', source: 'typing' }, additions: [{ kind: 'card', id: '6' }, { kind: 'card', id: '7' }] });
  assert.strictEqual(s.label(), 'Select all shown (2)');
});

test('the right-click menu on a card Select all shown picked is the menu of them all', async () => {
  const s = await open();
  s.type('status:done');
  s.press();
  s.page.rightClickCard(7);
  const subject = JSON.parse(JSON.stringify(s.page.run('menuSubject')));
  assert.deepStrictEqual(subject.ids.slice().sort(), ['6', '7']);
  assert.strictEqual(subject.inSelection, true);
});
