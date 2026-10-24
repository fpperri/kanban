const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The search panel in the real page (helpers/page-vm.js runs every script the page
// loads in one vm): the built-in pills, what a click, a Shift+click and a right-click on
// one do to the selection and the box (the status pills' rules: a click turns one pill
// on or off, a right-click solos it), the counts, the chip, and where Esc takes the
// panel in the chain. The elements are not drawn in a vm, so what the page does to them is read
// from the calls it makes; the browser runner looks at the page itself
// (scenarios/search-panel.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// 1 doing, 2 waits for 1, 3 under 1, 4 blocked, 5 awaiting review, 6 done and awaiting
// review (a done card the pill counts), 7 archived and blocked (out until the Archive
// pill is on), 8 todo and waits for the done card 6, so it does not wait.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes' }),
    card(6, { title: 'Renew the domain', status: 'done', review: 'PR #9' }),
    card(8, { title: 'Book the venue', waiting_for: ['6'] }),
  ],
  archived: [
    card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, blocked: 'old vendor' }),
  ],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
// A control that remembers the attributes the page sets on it and how often it was focused.
const spied = (el = control()) => {
  el.attrs = {};
  el.focused = 0;
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.focus = () => { el.focused++; };
  return el;
};
// The chip: hidden to start, with the text and the accessible name the page gives it.
const chipEl = () => {
  const el = spied(hidden());
  let text = '';
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { text = String(v); } });
  return el;
};

// With `list`, the page's comboboxes get elements they can watch, so the search box's
// own suggestion list (its menu) can be seen open and shut.
// `typing` is whether the Board's Typing isolates is on: off unless a test says so, since most of what
// follows is about pills and the selection, and a pill that turns isolate on is its own test.
async function open({ view = 'board', stored = {}, board = makeBoard(), search = '', list = false, typing = false } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  elements['#search-panel-toggle'] = spied();
  elements['#search-pills-fold'] = spied();
  elements['#search-chip'] = chipEl();
  const storage = { 'kanban.kanban.view.mode': view, 'kanban.kanban.typing.isolates': JSON.stringify({ board: typing }), ...stored };
  const menus = [];
  const loaded = loadPage({ board, search, stored: storage, elements, ...(list ? { documentExtras: { createElement: () => control() } } : {}) });
  if (list) loaded.input.parentElement = { style: {}, appendChild: (menu) => menus.push(menu), addEventListener() {}, querySelector: () => null };
  const page = await loaded.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const sortedIds = (set) => [...set].sort((a, b) => a - b);
  // A mouse press on the pill with this key, as the browser sends it to the pills' host; answers how
  // many times the page stopped the browser's own response to it.
  const pillEvent = (type, key, init) => {
    const button = { dataset: { pillKey: key }, closest: (sel) => (sel === '.query-pill' ? button : null) };
    let prevented = 0;
    elements['#search-pills'].fire(type, { target: button, shiftKey: false, preventDefault() { prevented++; }, ...init });
    return prevented;
  };
  const s = {
    page, board, elements, stored: storage,
    ids: () => sortedIds(page.run('selectedIds')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    box: () => page.input.value,
    view: () => page.run('loadViewMode()'),
    pills: () => JSON.parse(JSON.stringify(page.run('searchPanelPills()'))),
    counts: () => Object.fromEntries(s.pills().map((p) => [p.key, p.count])),
    on: () => s.pills().filter((p) => page.run(`pillIsOn(selectionState.selection, searchPanelPills().find((p) => p.key === ${JSON.stringify(p.key)}))`)).map((p) => p.key),
    click: (key, init = {}) => pillEvent('click', key, init),
    shiftClick: (key) => pillEvent('click', key, { shiftKey: true }),
    rightClick: (key, init = {}) => pillEvent('contextmenu', key, init),
    type: (text) => page.input.typed(text),
    esc: (inBox = false) => {
      page.ctx.document.activeElement = inBox ? page.input : null;
      if (inBox) page.input.fire('keydown', { key: 'Escape', stopPropagation() {} });
      return page.fireDocument('keydown', { key: 'Escape' });
    },
    menuOpen: () => menus[0].hidden === false,
    focused: () => page.ctx.document.activeElement,
    focusOn: (el) => { page.ctx.document.activeElement = el; },
    // One Esc as a browser sends it: the box's own listeners first, the document's unless one stops
    // the key, and then the browser's own default, which clears a search field (and says so with an
    // input event) unless a listener prevented it.
    press: () => {
      const target = page.ctx.document.activeElement;
      let stopped = false;
      const e = { key: 'Escape', target, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
      if (target === page.input) page.input.fire('keydown', e);
      if (!stopped) (page.documentListeners.keydown || []).slice().forEach((fn) => fn(e));
      if (target === page.input && !e.defaultPrevented) page.input.typed('');
      return e;
    },
    openPanel: () => { page.run('setSearchPanelOpen(true)'); },
    isOpen: () => page.run('searchPanelIsOpen()'),
    shown: () => sortedIds(page.run('shownCardIds()')),
  };
  return s;
}

const q = (text) => ({ kind: 'query', text });
const typed = (text) => ({ kind: 'query', text, source: 'typing' });

// --- the counts --------------------------------------------------------------------

test('the panel lists blocked, review and waiting, in that order, with each count over the cards the view shows', async () => {
  const s = await open();
  assert.deepStrictEqual(s.pills().map((p) => [p.key, p.label, p.query, p.count]), [
    ['blocked', 'blocked', 'blocked:', 1],
    ['review', 'review', 'review:', 2],
    ['waiting', 'waiting', 'waiting:', 1],
  ]);
});

test('the Board counts leave out the archived cards its collapsed Archive column keeps, and the Map counts them until its Archive pill is off', async () => {
  const board = await open();
  assert.strictEqual(board.counts().blocked, 1, 'card 7 is archived');
  const map = await open({ view: 'map' });
  assert.strictEqual(map.counts().blocked, 2, 'the Map has its Archive pill on to start');
  map.page.run("toggleMapStatusFilter('archive')");
  assert.strictEqual(map.counts().blocked, 1);
});

test('turning one pill on leaves the others\' counts as they were: they are taken before the search box', async () => {
  const s = await open({ typing: true });
  const before = s.counts();
  s.click('review');
  assert.deepStrictEqual(s.shown(), ['5', '6'], 'the box narrows the Board to the review cards');
  assert.deepStrictEqual(s.counts(), before);
  s.click('blocked');
  assert.deepStrictEqual(s.counts(), before);
});

test('a slice: cut in the box leaves the count of every pill as it was: the counts are taken before the box and any cut', async () => {
  const s = await open({ typing: true });
  const before = s.counts();
  s.type('slice:goal');
  assert.deepStrictEqual(s.counts(), before);
  s.type('slice:..epic tags:ui');
  assert.deepStrictEqual(s.counts(), before);
});

test('a status pill that hides the done cards takes them out of the counts', async () => {
  const s = await open({ view: 'map' });
  assert.strictEqual(s.counts().review, 2, 'card 6 is done and counted while its status pill is on');
  s.page.run("toggleMapStatusFilter('done')");
  assert.deepStrictEqual(s.counts(), { blocked: 2, review: 1, waiting: 1 }, 'card 6 is out; archived card 7 is in the Archive column, not Done');
  s.page.run("toggleMapStatusFilter('done')");
  assert.strictEqual(s.counts().review, 2);
});

test('the Archive pill, where a view has one, adds the archived cards to the counts', async () => {
  const board = makeBoard();
  board.active[3].start_date = '2031-06-02';
  board.archived[0].start_date = '2031-06-03';
  const s = await open({ view: 'gantt', board });
  assert.strictEqual(s.counts().blocked, 1, 'the Gantt starts without its archived cards');
  s.page.run("toggleGanttStatusFilter('archive')");
  assert.strictEqual(s.counts().blocked, 2);
});

// The Gantt draws a card by its range or its due date and the Calendar the same; a card with
// neither has no bar, no chip and no marker, and no tray either. A selection only covers
// the cards a view shows, so a card that is not drawn is out of the counts and the selection.
// Cards 1, 4 and 5 are dated (5 by its due date alone); 2, 3, 6, 8 and the archived 7 are not.
const datedBoard = () => {
  const board = makeBoard();
  board.active[0].start_date = '2031-06-02';
  board.active[3].end_date = '2031-06-09';
  board.active[4].due_date = '2031-06-12';
  board.archived[0].blocked = 'old vendor';
  return board;
};

test('the Gantt and the Calendar do not count a card they cannot draw: an undated match is out of the pill and the selection', async () => {
  for (const view of ['gantt', 'calendar']) {
    const s = await open({ view, board: datedBoard() });
    assert.deepStrictEqual(s.shown(), ['1', '4', '5'], `${view}: the cards it draws`);
    assert.deepStrictEqual(s.counts(), { blocked: 1, review: 1, waiting: 0 }, `${view}: card 6 awaits review and card 2 waits, but neither is drawn`);
    s.click('review');
    assert.deepStrictEqual(s.ids(), ['5'], `${view}: the selection reaches only the drawn match`);
    assert.deepStrictEqual(s.shown(), ['5'], `${view}: and so does the box`);
  }
});

test('the Archive pill of the Gantt adds the archived cards that are drawn, and an undated one stays out', async () => {
  const board = datedBoard();
  const s = await open({ view: 'gantt', board });
  s.page.run("toggleGanttStatusFilter('archive')");
  assert.deepStrictEqual(s.shown(), ['1', '4', '5'], 'archived card 7 has no date');
  board.archived[0].start_date = '2031-06-05';
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.shown(), ['1', '4', '5', '7']);
  assert.strictEqual(s.counts().blocked, 2);
});

test('the Board and the Map still count undated cards: they draw them', async () => {
  for (const view of ['board', 'map']) {
    const s = await open({ view, board: datedBoard() });
    assert.strictEqual(s.counts().review, 2, view);
    assert.strictEqual(s.counts().waiting, 1, view);
  }
});

test('a card that waits for a card the view hides still counts as waiting', async () => {
  const s = await open({ view: 'map' });
  s.page.run("toggleMapStatusFilter('doing')");
  assert.strictEqual(s.counts().waiting, 1, 'card 2 waits for card 1, which the Doing pill hid');
});

// --- a click ------------------------------------------------------------------------

test('on the Board a click puts the pill\'s query in the box, shows only its cards and selects them', async () => {
  const s = await open({ typing: true });
  s.click('review');
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.shown(), ['5', '6']);
  assert.deepStrictEqual(s.ids(), ['5', '6'], 'the done review card is selected too');
  assert.deepStrictEqual(s.on(), ['review']);
});

test('the selected cards are the bulk targets', async () => {
  const s = await open();
  s.click('review');
  assert.deepStrictEqual(JSON.parse(s.page.run('JSON.stringify(bulkTargets().map((c) => c.id))')), ['5', '6']);
});

test('a click on the same pill again turns it off, empties the selection and clears the box', async () => {
  const s = await open();
  s.click('review');
  s.click('review');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.ids(), []);
  assert.deepStrictEqual(s.on(), []);
});

test('a click on another pill turns it on beside the first: the box grows, both sets are shown and selected, and the first stays the anchor', async () => {
  const s = await open({ typing: true });
  s.click('review');
  s.click('blocked');
  assert.strictEqual(s.box(), 'review: | blocked:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [q('blocked:')] });
  assert.deepStrictEqual(s.shown(), ['4', '5', '6']);
  assert.deepStrictEqual(s.ids(), ['4', '5', '6']);
  assert.deepStrictEqual(s.on(), ['blocked', 'review']);
});

test('a click on an on pill turns off that pill alone: its query leaves the box, and the other pills stay on', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.click('waiting');
  assert.strictEqual(s.box(), 'review: | blocked: | waiting:');
  s.click('blocked');
  assert.strictEqual(s.box(), 'review: | waiting:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [q('waiting:')] });
  assert.deepStrictEqual(s.on(), ['review', 'waiting']);
  assert.deepStrictEqual(s.ids(), ['2', '5', '6']);
});

test('a click on the first pill on turns it off and the next one becomes the anchor', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.click('review');
  assert.strictEqual(s.box(), 'blocked:');
  assert.deepStrictEqual(s.selection(), { anchor: q('blocked:'), additions: [] });
  assert.deepStrictEqual(s.ids(), ['4']);
});

test('a click on a pill beside text typed in the box adds the pill as one more alternative, and off again leaves the text', async () => {
  const s = await open();
  s.type('zephyr');
  s.click('review');
  assert.strictEqual(s.box(), 'zephyr | review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.ids(), ['5', '6'], 'the typed text only filters the view; the pill selects');
  s.click('review');
  assert.strictEqual(s.box(), 'zephyr');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

// --- Shift+click is a click ---------------------------------------------------------------

test('Shift+click on a pill does exactly what a click does: on, on beside another, off beside another, and off alone', async () => {
  const walk = async (press) => {
    const s = await open();
    const seen = [];
    const look = () => seen.push([s.box(), s.selection(), s.ids(), s.on()]);
    for (const key of ['review', 'blocked', 'waiting', 'blocked', 'review', 'waiting']) { press(s, key); look(); }
    return seen;
  };
  const byClick = await walk((s, key) => s.click(key));
  const byShift = await walk((s, key) => s.shiftClick(key));
  assert.deepStrictEqual(byShift, byClick);
  assert.strictEqual(byClick[0][0], 'review:');
  assert.strictEqual(byClick[3][0], 'review: | waiting:', 'the same pill off beside others took only itself out');
  assert.strictEqual(byClick[5][0], '', 'and off alone empties the box');
});

// --- a right-click: solo --------------------------------------------------------------------------

test('a right-click on a pill makes it the only one on: the box holds its query alone, its cards are the selection, and the browser\'s own menu stays shut', async () => {
  const s = await open({ typing: true });
  const prevented = s.rightClick('review');
  assert.strictEqual(prevented, 1);
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.shown(), ['5', '6']);
  assert.deepStrictEqual(s.ids(), ['5', '6']);
  assert.deepStrictEqual(s.on(), ['review']);
});

test('a right-click on a pill while others are on turns the others off', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.click('waiting');
  s.rightClick('blocked');
  assert.strictEqual(s.box(), 'blocked:');
  assert.deepStrictEqual(s.selection(), { anchor: q('blocked:'), additions: [] });
  assert.deepStrictEqual(s.on(), ['blocked']);
  assert.deepStrictEqual(s.ids(), ['4']);
});

test('a right-click on the soloed pill turns every pill off and empties the box: pills default to all off', async () => {
  const s = await open();
  s.rightClick('review');
  const prevented = s.rightClick('review');
  assert.strictEqual(prevented, 1, 'the browser\'s own menu stays shut on this one too');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.ids(), []);
  assert.deepStrictEqual(s.on(), []);
  assert.deepStrictEqual(s.shown(), ['1', '2', '3', '4', '5', '6', '8'], 'every card is back on the Board');
});

test('the Shift key does not change a right-click', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.rightClick('blocked', { shiftKey: true });
  assert.strictEqual(s.box(), 'blocked:');
  assert.deepStrictEqual(s.on(), ['blocked']);
});

test('in the Graph a right-click solos a pill too, and the pill is an anchor, not a typed search', async () => {
  const s = await open({ view: 'graph' });
  s.click('review');
  s.click('blocked');
  s.rightClick('blocked');
  assert.strictEqual(s.box(), 'blocked:');
  assert.deepStrictEqual(s.selection(), { anchor: q('blocked:'), additions: [] });
  s.rightClick('blocked');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('a click on a pill reaches the page through the one list of pills, so a key it does not know does nothing', async () => {
  const s = await open();
  s.click('nonsense');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('in the Graph a click lights the pill\'s cards, a done one included, and the pill\'s query is the anchor, not a typed search', async () => {
  const s = await open({ view: 'graph' });
  const lit = [];
  s.page.ctx.graphLightCards = (set) => { lit.push(set ? [...set.nodes].sort((a, b) => a - b) : null); };
  s.click('review');
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] }, 'no source: it is a pill, so leaving the Graph keeps it');
  assert.deepStrictEqual(s.ids(), ['5', '6']);
  assert.deepStrictEqual(lit[lit.length - 1], ['5', '6']);
  assert.deepStrictEqual(JSON.parse(s.page.run('JSON.stringify(graphCur.model.nodes.map((n) => n.id).sort((a, b) => a - b))')), ['1', '2', '3', '4', '5', '6', '8'], 'nothing is hidden');
});

test('a pill anchor stays the anchor when the Graph is left, where a typed search would go', async () => {
  const s = await open({ view: 'graph' });
  s.click('review');
  s.page.run("toggleView('board')");
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.ids(), ['5', '6']);
  assert.strictEqual(s.box(), 'review:');
});

// --- a second pill, in the Graph and beside a hand-picked card ------------------------------

test('a click on the second pill again takes the box back to "review:"', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.click('blocked');
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.ids(), ['5', '6']);
  assert.deepStrictEqual(s.on(), ['review']);
});

test('in the Graph a click on a second pill grows the box too, so a switch to another view keeps the added pill\'s cards selected, and the Board lights them', async () => {
  const s = await open({ view: 'graph' });
  s.click('review');
  s.click('blocked');
  assert.strictEqual(s.box(), 'review: | blocked:');
  assert.deepStrictEqual(s.ids(), ['4', '5', '6']);
  s.page.run("toggleView('board')");
  assert.strictEqual(s.page.run('isolateNow()'), null, 'a switch writes nothing, so it turns nothing on');
  assert.deepStrictEqual(s.shown(), ['1', '2', '3', '4', '5', '6', '8'], 'the box hides nothing with isolate off');
  assert.deepStrictEqual(s.ids(), ['4', '5', '6']);
});

test('a hand-picked card with an empty box takes a pill as an addition and leaves the box empty', async () => {
  const s = await open();
  s.page.run("setSelection(setAnchor(NO_SELECTION, cardPart(1)))");
  s.click('review');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.ids(), ['1', '5', '6']);
  assert.deepStrictEqual(s.on(), ['review']);
});

// --- Esc ----------------------------------------------------------------------------

test('Esc outside the box takes the added pill back out of the box and the selection, and the next Esc clears the box and the anchor', async () => {
  const s = await open();
  const lit = () => JSON.parse(JSON.stringify(s.page.run('boxLitIds === null ? null : [...boxLitIds].sort()')));
  s.click('review');
  s.click('blocked');
  assert.deepStrictEqual(lit(), ['4', '5', '6', '7'], 'what the whole query matches, the archived card 7 among them');
  s.esc();
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(lit(), ['5', '6']);
  s.esc();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(lit(), null);
});

test('with Typing isolates on, a pill turns isolate on, and the first Esc turns it off before it takes the added pill out', async () => {
  const s = await open({ typing: true });
  s.click('review');
  s.click('blocked');
  assert.notStrictEqual(s.page.run('isolateNow()'), null);
  assert.deepStrictEqual(s.shown(), ['4', '5', '6']);
  s.esc();
  assert.strictEqual(s.page.run('isolateNow()'), null, 'isolate goes first');
  assert.strictEqual(s.box(), 'review: | blocked:', 'and the pills stay in the box, lit');
  assert.deepStrictEqual(s.shown(), ['1', '2', '3', '4', '5', '6', '8']);
  s.esc();
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  s.esc();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('the first pill on is the anchor and the later ones are additions: Esc drops the later pills together, then the anchor', async () => {
  const s = await open();
  s.click('waiting');
  s.click('review');
  s.click('blocked');
  assert.deepStrictEqual(s.selection(), { anchor: q('waiting:'), additions: [q('review:'), q('blocked:')] });
  s.esc();
  assert.strictEqual(s.box(), 'waiting:');
  assert.deepStrictEqual(s.selection(), { anchor: q('waiting:'), additions: [] });
  assert.deepStrictEqual(s.on(), ['waiting']);
  s.esc();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('turning the anchor pill off makes the next pill on the anchor, and Esc then drops that one', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.click('review');
  assert.deepStrictEqual(s.selection(), { anchor: q('blocked:'), additions: [] });
  s.esc();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.on(), []);
});

test('Esc outside the box leaves a box that is not a pill\'s as it was', async () => {
  const s = await open();
  s.type('zephyr');
  s.page.run("setSelection(setAnchor(NO_SELECTION, cardPart(1)))");
  s.esc();
  assert.strictEqual(s.box(), 'zephyr');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('Esc in the box clears the box and with it the pills it held', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.esc(true);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.on(), []);
});

test('an open panel takes the first Esc and closes, leaving the box and the selection alone; the next Esc steps the selection back', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.openPanel();
  assert.strictEqual(s.isOpen(), true);
  s.esc();
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(s.box(), 'review: | blocked:');
  assert.deepStrictEqual(s.selection().additions, [q('blocked:')]);
  s.esc();
  assert.strictEqual(s.box(), 'review:');
});

// Chrome clears a search field on Esc by its own default, on top of what the page does with
// the key. The suggestion list and the panel each take an Esc, so each must stop that default,
// or one Esc empties the box and the next two have nothing to close or clear.
test('with the panel open and the suggestion list showing, Esc closes the list, then the panel, then clears the box, the text staying until the last', async () => {
  const s = await open({ list: true });
  const toggle = s.elements['#search-panel-toggle'];
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  s.openPanel();
  s.type('zephyr');
  s.focusOn(s.page.input);
  assert.strictEqual(s.menuOpen(), true, 'typing in the box opens the suggestion list');
  const first = s.press();
  assert.strictEqual(s.menuOpen(), false, '1st Esc: the list closes');
  assert.strictEqual(s.box(), 'zephyr', '1st Esc: the box keeps its text');
  assert.strictEqual(s.isOpen(), true, '1st Esc: the panel is still open');
  assert.strictEqual(first.defaultPrevented, true, '1st Esc: the browser\'s own clear is stopped');
  const second = s.press();
  assert.strictEqual(s.isOpen(), false, '2nd Esc: the panel closes');
  assert.strictEqual(s.box(), 'zephyr', '2nd Esc: the box keeps its text');
  assert.strictEqual(s.focused(), s.page.input, '2nd Esc: focus stays in the box');
  assert.strictEqual(toggle.focused, 0, '2nd Esc: focus does not go to the toggle');
  assert.strictEqual(second.defaultPrevented, true, '2nd Esc: the browser\'s own clear is stopped');
  s.press();
  assert.strictEqual(s.box(), '', '3rd Esc: the box clears');
});

test('with the panel closed, the first Esc in the box closes the suggestion list and the box keeps its text; the next clears it', async () => {
  const s = await open({ list: true });
  s.type('zephyr');
  s.focusOn(s.page.input);
  assert.strictEqual(s.menuOpen(), true);
  const first = s.press();
  assert.strictEqual(s.menuOpen(), false);
  assert.strictEqual(s.box(), 'zephyr');
  assert.strictEqual(first.defaultPrevented, true, 'the browser\'s own clear is stopped');
  s.press();
  assert.strictEqual(s.box(), '');
});

test('an Esc that finds no suggestion list in the box leaves the browser\'s default to the box: the key goes on down the chain', async () => {
  const s = await open({ list: true });
  s.type('zephyr');
  s.focusOn(s.page.input);
  s.press();
  assert.strictEqual(s.menuOpen(), false);
  s.page.input.fire('keydown', { key: 'Escape', preventDefault() { throw new Error('the box stopped a default with no list to close'); }, stopPropagation() { throw new Error('the box held back the key with no list to close'); } });
});

test('Esc with focus on a pill closes the panel, stops the default, and puts focus back on the toggle', async () => {
  const s = await open();
  const toggle = s.elements['#search-panel-toggle'];
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  s.openPanel();
  const pill = control();
  s.focusOn(pill);
  const e = s.press();
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(toggle.focused, 1, 'focus went back to the toggle');
  assert.strictEqual(s.focused(), toggle);
  assert.strictEqual(e.defaultPrevented, true);
});

test('the panel closes with focus back on its toggle', async () => {
  const s = await open();
  const toggle = s.elements['#search-panel-toggle'];
  s.openPanel();
  assert.strictEqual(s.page.run('closeSearchPanel()'), true);
  assert.strictEqual(toggle.focused, 1);
  assert.strictEqual(s.page.run('closeSearchPanel()'), false, 'a closed panel has nothing to close, so Esc goes on down the chain');
  assert.strictEqual(toggle.focused, 1);
});

test('a held Esc closes the panel once and runs no stage of the selection step', async () => {
  const s = await open();
  s.click('review');
  s.openPanel();
  s.esc();
  s.page.fireDocument('keydown', { key: 'Escape', repeat: true });
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection().anchor, q('review:'));
});

// --- typing -------------------------------------------------------------------------

test('typing in the box drops the pill: it turns off and, outside the Graph, its matches leave the selection', async () => {
  const s = await open();
  s.click('review');
  s.type('review:x');
  assert.deepStrictEqual(s.on(), []);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.ids(), []);
});

test('typing after one of two pills keeps the other, as the anchor', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  s.type('review: | blockedx');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.on(), ['review']);
});

test('in the Graph the typed text becomes the anchor, and the pill is off', async () => {
  const s = await open({ view: 'graph' });
  s.click('review');
  s.type('review:x');
  assert.deepStrictEqual(s.selection(), { anchor: typed('review:x'), additions: [] });
  assert.deepStrictEqual(s.on(), []);
});

test("a query typed by hand that is exactly a pill's query leaves the pill off, in the Board and in the Graph", async () => {
  for (const view of ['board', 'graph']) {
    const s = await open({ view });
    s.type('review:');
    assert.strictEqual(s.box(), 'review:', view);
    assert.deepStrictEqual(s.on(), [], view);
    assert.deepStrictEqual(s.pills().map((p) => p.key), ['blocked', 'review', 'waiting'], view);
  }
});

test("a link whose q is a pill's query opens with the query in the box as typed text: the pill is off and, outside the Graph, nothing is selected", async () => {
  const board = await open({ typing: true, search: '?q=review%3A' });
  assert.strictEqual(board.box(), 'review:');
  assert.deepStrictEqual(board.shown(), ['5', '6'], 'the filter travels');
  assert.deepStrictEqual(board.on(), []);
  assert.deepStrictEqual(board.ids(), []);
  const graph = await open({ view: 'graph', search: '?q=review%3A' });
  assert.strictEqual(graph.box(), 'review:');
  assert.deepStrictEqual(graph.on(), []);
  assert.deepStrictEqual(graph.selection(), { anchor: typed('review:'), additions: [] });
});

test('the clear button turns the pill off too', async () => {
  const s = await open();
  s.click('review');
  s.page.clear.fire('click', {});
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.on(), []);
  assert.deepStrictEqual(s.ids(), []);
});

test('a hand-picked selection is not touched by typing outside the Graph', async () => {
  const s = await open();
  s.page.run("setSelection(setAnchor(NO_SELECTION, cardPart(1)))");
  s.type('zephyr');
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'card', id: '1' }, additions: [] });
});

// --- the address, the box and a poll ------------------------------------------------------

test('a pill write is one more write of the box: the address follows it', async () => {
  const s = await open();
  const replaced = [];
  s.page.ctx.history = { replaceState: (a, b, url) => replaced.push(url) };
  s.click('review');
  assert.ok(replaced.some((u) => /q=review%3A/.test(u)), replaced.join(' '));
});

test('a poll updates the counts without writing the box, and keeps the pills on', async () => {
  const s = await open();
  s.click('review');
  const writes = s.page.input.writes.length;
  s.board.active.push(card(9, { title: 'Another review', review: 'look' }));
  await s.page.run('autoRefreshTick()');
  assert.strictEqual(s.page.input.writes.length, writes);
  assert.strictEqual(s.counts().review, 3);
  assert.deepStrictEqual(s.ids(), ['5', '6', '9'], 'the pill\'s query reaches the card that came to match');
  assert.deepStrictEqual(s.on(), ['review']);
});

// --- the panel's own state -----------------------------------------------------------------

test('the panel starts closed, and the arrow starts pressed: the switch is on', async () => {
  const s = await open();
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(s.elements['#search-panel-toggle'].attrs['aria-pressed'], 'true');
  assert.strictEqual(s.page.run('searchPanelSwitchOn()'), true);
});

// --- the arrow's switch: the panel opens on focus -----------------------------------------

const toggleOf = (s) => s.elements['#search-panel-toggle'];
const arrow = (s) => toggleOf(s).fire('click', {});
const focusBox = (s) => { s.focusOn(s.page.input); s.page.input.fire('focus', {}); };
const pressed = (s) => toggleOf(s).attrs['aria-pressed'];
const expanded = (s) => toggleOf(s).attrs['aria-expanded'];
// A button, the way the key guard sees one: nobody typing in it.
const button = () => ({ tagName: 'BUTTON', isContentEditable: false, focus() {} });
// One press of a key on the document, as the page's listeners see it; answers how many times the page
// stopped the browser's own response to it.
const press = (s, key, init = {}) => {
  let prevented = 0;
  s.page.fireDocument('keydown', { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault() { prevented++; }, ...init });
  return prevented;
};
const SURFACES = { menu: '#context-menu:not(.hidden)', dialog: '.modal-backdrop:not(.hidden)', notifications: '#notif-modal:not(.hidden)', preferences: '#prefs-sheet:not(.hidden)' };
const withSurface = (s, name) => {
  const orig = s.page.ctx.document.querySelector;
  s.page.ctx.document.querySelector = (sel) => (sel === SURFACES[name] ? control() : orig(sel));
};

test('with the switch on, the default, focusing the search box opens the panel, and the arrow says it is expanded', async () => {
  const s = await open();
  assert.strictEqual(s.isOpen(), false);
  focusBox(s);
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(expanded(s), 'true');
  assert.strictEqual(s.elements['#search-panel'].classList.contains('hidden'), false);
  focusBox(s);
  assert.strictEqual(s.isOpen(), true, 'a second focus leaves it open');
});

test('a click on the arrow switches it off: the panel closes now, the arrow says so, and focusing the box opens nothing', async () => {
  const s = await open();
  focusBox(s);
  assert.strictEqual(s.isOpen(), true);
  arrow(s);
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(pressed(s), 'false');
  assert.strictEqual(expanded(s), 'false');
  assert.strictEqual(s.elements['#search-panel'].classList.contains('hidden'), true);
  focusBox(s);
  assert.strictEqual(s.isOpen(), false, 'focus no longer opens it');
  assert.strictEqual(s.page.run('searchPanelSwitchOn()'), false);
});

test('a second click switches it on and opens the panel now, and focusing the box opens it again', async () => {
  const s = await open();
  arrow(s);
  assert.strictEqual(s.isOpen(), false, 'the first click switched it off, with nothing to close');
  assert.strictEqual(pressed(s), 'false');
  arrow(s);
  assert.strictEqual(pressed(s), 'true');
  assert.strictEqual(s.isOpen(), true, 'on opens the panel now, without a focus');
  assert.strictEqual(expanded(s), 'true');
  s.page.run('setSearchPanelOpen(false)');
  focusBox(s);
  assert.strictEqual(s.isOpen(), true, 'and it opens on focus again');
});

test('the arrow names what it switches and says what a click does, in each state', async () => {
  const s = await open();
  const on = toggleOf(s).title;
  assert.match(on, /opens when the (search )?box is focused/i);
  assert.match(on, /switch it off/i);
  assert.match(on, /\bp\b/);
  arrow(s);
  const off = toggleOf(s).title;
  assert.match(off, /off/i);
  assert.match(off, /switch it on/i);
  assert.match(off, /\bp\b/);
  assert.notStrictEqual(on, off);
});

test('the switch is kept per board in the preferences, and the next visit starts as it was left', async () => {
  const s = await open();
  arrow(s);
  assert.strictEqual(JSON.parse(s.stored['kanban.kanban.prefs']).panelOnFocus, false);
  const again = await open({ stored: s.stored });
  assert.strictEqual(pressed(again), 'false', 'the arrow comes back off');
  focusBox(again);
  assert.strictEqual(again.isOpen(), false);
  arrow(again);
  assert.strictEqual(JSON.parse(again.stored['kanban.kanban.prefs']).panelOnFocus, true);
  const third = await open({ stored: again.stored });
  assert.strictEqual(pressed(third), 'true');
  focusBox(third);
  assert.strictEqual(third.isOpen(), true);
});

test('another board keeps its own switch', async () => {
  const s = await open();
  arrow(s);
  const other = await open({ board: { ...makeBoard(), projectName: 'shop' }, stored: s.stored });
  assert.strictEqual(pressed(other), 'true', 'the switch of the kanban board does not reach the shop board');
  focusBox(other);
  assert.strictEqual(other.isOpen(), true);
});

test('a repaint and a poll leave the arrow as it was, and a switch that is off keeps the panel shut through them', async () => {
  const s = await open();
  arrow(s);
  s.page.run('renderBoard()');
  await s.page.run('autoRefreshTick()');
  assert.strictEqual(pressed(s), 'false');
  assert.strictEqual(s.isOpen(), false);
});

// --- the p key ---------------------------------------------------------------------------

test('p does what the arrow does: it switches the panel off and closes it, then on and opens it', async () => {
  const s = await open();
  focusBox(s);
  s.focusOn(button());
  assert.strictEqual(press(s, 'p'), 1, 'the page stops the browser\'s own response to the key');
  assert.strictEqual(pressed(s), 'false');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(JSON.parse(s.stored['kanban.kanban.prefs']).panelOnFocus, false, 'the choice is kept, as the arrow keeps it');
  focusBox(s);
  assert.strictEqual(s.isOpen(), false, 'focus opens nothing while it is off');
  s.focusOn(button());
  press(s, 'p');
  assert.strictEqual(pressed(s), 'true');
  assert.strictEqual(s.isOpen(), true, 'on opens the panel now');
});

test('p works with nothing focused, and a capital P (Caps Lock) counts too', async () => {
  const s = await open();
  s.focusOn(null);
  assert.strictEqual(press(s, 'p'), 1);
  assert.strictEqual(pressed(s), 'false');
  assert.strictEqual(press(s, 'P'), 1);
  assert.strictEqual(pressed(s), 'true');
});

test('p does nothing while typing in a field', async () => {
  const s = await open();
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    s.focusOn({ tagName, isContentEditable: false });
    assert.strictEqual(press(s, 'p'), 0, tagName);
    assert.strictEqual(pressed(s), 'true', tagName);
  }
  s.focusOn({ tagName: 'DIV', isContentEditable: true });
  assert.strictEqual(press(s, 'p'), 0, 'an editable element');
  focusBox(s);
  assert.strictEqual(press(s, 'p'), 0, 'the search box');
  assert.strictEqual(pressed(s), 'true');
  assert.strictEqual(s.isOpen(), true);
});

test('p does nothing while a card menu, a dialog, the notifications panel or the preferences sheet is up', async () => {
  for (const name of Object.keys(SURFACES)) {
    const s = await open();
    withSurface(s, name);
    s.focusOn(button());
    assert.strictEqual(press(s, 'p'), 0, name);
    assert.strictEqual(pressed(s), 'true', name);
    assert.strictEqual(s.page.run('searchPanelSwitchOn()'), true, name);
  }
});

test('p with Ctrl, Cmd or Alt held, with Shift on a lower-case key, or held down, leaves the switch alone', async () => {
  const s = await open();
  s.focusOn(button());
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
    assert.strictEqual(press(s, 'p', init), 0, JSON.stringify(init));
    assert.strictEqual(pressed(s), 'true', JSON.stringify(init));
  }
  assert.strictEqual(press(s, 'o'), 0, 'another key');
  assert.strictEqual(pressed(s), 'true');
});

test('p with the panel open is not stopped by it: the panel is no popup for the key guard', async () => {
  const s = await open();
  s.openPanel();
  s.focusOn(button());
  press(s, 'p');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(pressed(s), 'false');
});

test('p on a pill closes the panel and hands focus to the arrow, since the pill went with it', async () => {
  const s = await open();
  const toggle = toggleOf(s);
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  s.openPanel();
  s.focusOn(button());
  press(s, 'p');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(toggle.focused, 1);
  assert.strictEqual(s.focused(), toggle);
});

// --- Esc and the switch ------------------------------------------------------------------------

test('Esc closes the panel that focus opened and the box keeps its text; the switch stays on and focusing the box opens it again', async () => {
  const s = await open();
  focusBox(s);
  s.type('zephyr');
  s.focusOn(s.page.input);
  assert.strictEqual(s.isOpen(), true);
  const e = s.press();
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(s.box(), 'zephyr');
  assert.strictEqual(e.defaultPrevented, true, 'the browser\'s own Esc, which clears a search field, is stopped');
  assert.strictEqual(pressed(s), 'true', 'Esc leaves the switch on');
  assert.strictEqual(s.focused(), s.page.input, 'focus stays in the box');
  focusBox(s);
  assert.strictEqual(s.isOpen(), true);
  s.press();
  assert.strictEqual(s.isOpen(), false);
  s.press();
  assert.strictEqual(s.box(), '', 'the Esc after the panel clears the box');
});

// --- the preferences sheet's copy of the switch -----------------------------------------------------

test('the sheet\'s setting is the same switch: off closes the panel now and focus opens nothing; on opens nothing by itself, and focus opens it', async () => {
  const s = await open();
  focusBox(s);
  s.page.run('setPanelOnFocus(false)');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(pressed(s), 'false');
  assert.strictEqual(JSON.parse(s.stored['kanban.kanban.prefs']).panelOnFocus, false);
  focusBox(s);
  assert.strictEqual(s.isOpen(), false);
  s.page.run('setPanelOnFocus(true)');
  assert.strictEqual(pressed(s), 'true');
  assert.strictEqual(s.isOpen(), false, 'the sheet is up over the board: the panel waits for the box');
  assert.strictEqual(JSON.parse(s.stored['kanban.kanban.prefs']).panelOnFocus, true);
  focusBox(s);
  assert.strictEqual(s.isOpen(), true);
});

test('the arrow and the sheet read one choice: what the sheet sets, the arrow flips from', async () => {
  const s = await open();
  s.page.run('setPanelOnFocus(false)');
  arrow(s);
  assert.strictEqual(pressed(s), 'true');
  assert.strictEqual(s.page.run('loadPrefsState().panelOnFocus'), true);
});

test('the panel stays open through a poll, and the poll is never paused for it', async () => {
  const s = await open();
  s.openPanel();
  const before = s.page.fetchLog.length;
  await s.page.run('autoRefreshTick()');
  assert.ok(s.page.fetchLog.length > before, 'the poll fetched with the panel open');
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(s.page.run('autoRefreshSkipState().modalOpen'), false);
});

// --- the chip -------------------------------------------------------------------------------

const chipOf = (s) => {
  const chip = s.elements['#search-chip'];
  return { hidden: () => chip.classList.contains('hidden'), text: () => chip.textContent, name: () => chip.attrs['aria-label'] };
};

test('closed, the chip counts the pills that are on and names them; with none on it is hidden', async () => {
  const s = await open();
  const chip = chipOf(s);
  s.page.run('renderSearchPanel()');
  assert.strictEqual(chip.hidden(), true);
  s.click('review');
  assert.strictEqual(chip.hidden(), false);
  assert.strictEqual(chip.text(), '1');
  assert.strictEqual(chip.name(), '1 on: review');
  s.click('blocked');
  assert.strictEqual(chip.text(), '2');
  assert.strictEqual(chip.name(), '2 on: blocked, review');
  s.rightClick('blocked');
  assert.strictEqual(chip.text(), '1');
  assert.strictEqual(chip.name(), '1 on: blocked');
  s.click('blocked');
  assert.strictEqual(chip.hidden(), true);
  s.click('review');
  s.click('waiting');
  s.click('review');
  s.click('waiting');
  assert.strictEqual(chip.hidden(), true, 'every pill off, no chip');
});

test('with the panel open the chip is hidden: the pills show what is on', async () => {
  const s = await open();
  const chip = chipOf(s);
  s.click('review');
  s.openPanel();
  assert.strictEqual(chip.hidden(), true);
  s.page.run('setSearchPanelOpen(false)');
  assert.strictEqual(chip.hidden(), false);
});

// --- the chip is a tab stop ------------------------------------------------------------------

// The chip is a button, so Enter and Space on it reach the page as a click that has no pointer
// behind it (detail 0), which is also how assistive technology activates a button; a mouse click
// has a count of 1 or more. The page treats the two alike.
const keyOnChip = (s) => s.elements['#search-chip'].fire('click', { detail: 0 });
const mouseOnChip = (s) => s.elements['#search-chip'].fire('click', { detail: 1 });

test('Enter or Space on the shown chip opens the panel, and the chip, which leaves with it, hands focus to the arrow', async () => {
  const s = await open();
  const chip = chipOf(s);
  let boxFocus = 0;
  s.page.input.focus = () => { boxFocus++; };
  s.click('review');
  assert.strictEqual(chip.hidden(), false);
  assert.strictEqual(s.isOpen(), false);
  keyOnChip(s);
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(chip.hidden(), true, 'the pills show what is on now');
  assert.strictEqual(s.elements['#search-panel-toggle'].focused, 1, 'focus goes where Esc would have put it');
  assert.strictEqual(boxFocus, 0, 'and not into the box, whose focus would open a suggestion list over the panel');
});

test('the chip opens the panel with the arrow switched off too, and leaves the switch off', async () => {
  const s = await open();
  s.page.run('setPanelOnFocus(false)');
  s.click('review');
  keyOnChip(s);
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(s.page.run('searchPanelSwitchOn()'), false);
});

test('a mouse click on the chip opens the panel exactly as Enter or Space does: the chip leaves with it, focus goes to the arrow and not the box, and the box, the selection and the switch are as they were', async () => {
  const outcome = async (press) => {
    const s = await open();
    let boxFocus = 0;
    s.page.input.focus = () => { boxFocus++; };
    s.click('review');
    assert.strictEqual(s.isOpen(), false);
    press(s);
    return {
      open: s.isOpen(), chipHidden: chipOf(s).hidden(), arrowFocus: s.elements['#search-panel-toggle'].focused, boxFocus,
      box: s.box(), ids: s.ids(), switchOn: s.page.run('searchPanelSwitchOn()'),
    };
  };
  const byKey = await outcome(keyOnChip);
  const byMouse = await outcome(mouseOnChip);
  assert.deepStrictEqual(byMouse, byKey);
  assert.deepStrictEqual(byMouse, { open: true, chipHidden: true, arrowFocus: 1, boxFocus: 0, box: 'review:', ids: ['5', '6'], switchOn: true });
});

test('a mouse click on the chip opens the panel with the arrow switched off too, and leaves the switch off', async () => {
  const s = await open();
  s.page.run('setPanelOnFocus(false)');
  s.click('review');
  mouseOnChip(s);
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(s.page.run('searchPanelSwitchOn()'), false);
});

test('a click on the chip that carries no count at all, the way a script or assistive technology sends one, opens the panel too', async () => {
  const s = await open();
  s.click('review');
  s.elements['#search-chip'].fire('click', {});
  assert.strictEqual(s.isOpen(), true);
});

test('the chip keeps a name that says how many are on, and the same words as its hover text', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  assert.strictEqual(s.elements['#search-chip'].attrs['aria-label'], '2 on: blocked, review');
  assert.strictEqual(s.elements['#search-chip'].title, '2 on: blocked, review');
});

// --- a held Enter ---------------------------------------------------------------------------------

// Enter on a focused button, the way a browser handles it: the keydown reaches the page's listeners and,
// unless one of them stops it, the button gets a click with no pointer behind it (detail 0), for the first
// keydown and for every auto-repeated one while the key is held. The vm does not do that by itself.
const enterOn = (el, { repeat = false } = {}) => {
  let prevented = false;
  el.fire('keydown', { key: 'Enter', repeat, preventDefault() { prevented = true; } });
  if (!prevented) el.fire('click', { detail: 0 });
  return prevented;
};

test('holding Enter on the chip opens the panel once: the key repeats land on the arrow, which ignores them, so the switch stays on and the panel stays open', async () => {
  const s = await open();
  s.click('review');
  const arrowEl = toggleOf(s);
  enterOn(s.elements['#search-chip']);
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(arrowEl.focused, 1, 'the key is still down, and focus is on the arrow, where its repeats now land');
  for (let i = 1; i <= 4; i++) {
    enterOn(arrowEl, { repeat: true });
    assert.strictEqual(s.isOpen(), true, `repeat ${i}: the panel is still open`);
    assert.strictEqual(s.page.run('searchPanelSwitchOn()'), true, `repeat ${i}: and the switch is still on`);
  }
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.ids(), ['5', '6']);
});

test('Enter on the arrow switches once per press: the repeats of a held key are ignored, and the next press switches again', async () => {
  const s = await open();
  const arrowEl = toggleOf(s);
  enterOn(arrowEl);
  assert.strictEqual(s.page.run('searchPanelSwitchOn()'), false, 'a press switches it off');
  for (let i = 1; i <= 3; i++) {
    enterOn(arrowEl, { repeat: true });
    assert.strictEqual(s.page.run('searchPanelSwitchOn()'), false, `repeat ${i}: the held key does not switch it back`);
  }
  enterOn(arrowEl);
  assert.strictEqual(s.page.run('searchPanelSwitchOn()'), true, 'a second press switches it on');
  assert.strictEqual(s.isOpen(), true, 'and opens the panel now');
});

test('the arrow stops the browser only for a repeating Enter: a held Tab, Space, Escape or arrow key goes through', async () => {
  const s = await open();
  const arrowEl = toggleOf(s);
  for (const key of ['Tab', ' ', 'Escape', 'ArrowRight', 'p']) {
    let prevented = 0;
    arrowEl.fire('keydown', { key, repeat: true, preventDefault() { prevented++; } });
    assert.strictEqual(prevented, 0, `a repeating ${JSON.stringify(key)} is left to the browser`);
  }
  let first = 0;
  arrowEl.fire('keydown', { key: 'Enter', repeat: false, preventDefault() { first++; } });
  assert.strictEqual(first, 0, 'and so is the first Enter, which is a press');
});

// --- the fold and the preference ------------------------------------------------------------------

test('the pill section starts unfolded, and "pill section starts folded" in the preferences sheet is off', async () => {
  const s = await open();
  assert.strictEqual(s.page.run('currentPillsFolded()'), false);
  assert.strictEqual(s.page.run('loadPrefsState().pillsFolded'), false);
});

test('setting it folds the section now, is kept per board, and the next visit starts folded', async () => {
  const s = await open();
  s.page.run('setPillsFolded(true)');
  assert.strictEqual(s.page.run('currentPillsFolded()'), true);
  assert.deepStrictEqual(JSON.parse(s.stored['kanban.kanban.prefs']).pillsFolded, true);
  const again = await open({ stored: s.stored });
  assert.strictEqual(again.page.run('currentPillsFolded()'), true);
});

test('the fold control folds and unfolds for the visit, without changing the preference', async () => {
  const s = await open();
  s.page.run('toggleSearchPillsFold()');
  assert.strictEqual(s.page.run('currentPillsFolded()'), true);
  assert.strictEqual(s.page.run('loadPrefsState().pillsFolded'), false);
  s.page.run('toggleSearchPillsFold()');
  assert.strictEqual(s.page.run('currentPillsFolded()'), false);
});

// --- turning the switch off moves focus only when the panel took it with it ----------------

// A stand-in for the panel that knows which elements are inside it, which the harmless element
// the page is given for it does not.
const withPanelHolding = (s, ...inside) => {
  s.elements['#search-panel'].contains = (el) => inside.includes(el);
};

test('switching off with focus on the panel\'s own pill hands focus to the arrow, since the pill went with the panel', async () => {
  const s = await open();
  const toggle = toggleOf(s);
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  const pillEl = button();
  withPanelHolding(s, pillEl);
  s.openPanel();
  s.focusOn(pillEl);
  s.page.run('setPanelOnFocus(false)');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(toggle.focused, 1);
  assert.strictEqual(s.focused(), toggle);
});

test('switching off from the preferences sheet leaves focus in the sheet, and p and the arrow leave it where it is', async () => {
  const s = await open();
  const toggle = toggleOf(s);
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  withPanelHolding(s);
  const checkbox = { tagName: 'INPUT', isContentEditable: false, focus() {} };
  s.openPanel();
  s.focusOn(checkbox);
  s.page.run('setPanelOnFocus(false)');
  assert.strictEqual(s.isOpen(), false, 'the panel closed');
  assert.strictEqual(toggle.focused, 0, 'and the arrow behind the sheet did not take focus');
  assert.strictEqual(s.focused(), checkbox);
  s.page.run('setPanelOnFocus(true, true)');
  const card = button();
  s.focusOn(card);
  press(s, 'p');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(toggle.focused, 0, 'p with focus on a card leaves it there');
  assert.strictEqual(s.focused(), card);
});

test('switching off with focus in the box or on the arrow keeps it there', async () => {
  const s = await open();
  const toggle = toggleOf(s);
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  withPanelHolding(s);
  s.openPanel();
  s.focusOn(s.page.input);
  s.page.run('setPanelOnFocus(false)');
  assert.strictEqual(s.focused(), s.page.input);
  s.page.run('setPanelOnFocus(true, true)');
  s.focusOn(toggle);
  s.page.run('setPanelOnFocus(false)');
  assert.strictEqual(toggle.focused, 0, 'the arrow had it already');
  assert.strictEqual(s.focused(), toggle);
});

test('Esc still hands focus to the arrow when it closes the panel from anywhere but the box', async () => {
  const s = await open();
  const toggle = toggleOf(s);
  toggle.focus = () => { toggle.focused++; s.focusOn(toggle); };
  withPanelHolding(s);
  s.openPanel();
  s.focusOn(button());
  s.press();
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(toggle.focused, 1, 'the Esc rule: the arrow, unless the box has it');
});
