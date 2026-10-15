const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The search panel in the real page (helpers/page-vm.js runs every script the page
// loads in one vm): the built-in pills, what a click and Shift+click on one do to the
// selection and the box, the counts, the chip, and where Esc takes the panel in the
// chain. The elements are not drawn in a vm, so what the page does to them is read
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
    card(2, { title: 'Move the data layer', waiting_for: [1] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes' }),
    card(6, { title: 'Renew the domain', status: 'done', review: 'PR #9' }),
    card(8, { title: 'Book the venue', waiting_for: [6] }),
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
async function open({ view = 'board', stored = {}, board = makeBoard(), search = '', list = false } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  elements['#search-panel-toggle'] = spied();
  elements['#search-pills-fold'] = spied();
  elements['#search-chip'] = chipEl();
  const storage = { 'kanban.kanban.view.mode': view, ...stored };
  const menus = [];
  const loaded = loadPage({ board, search, stored: storage, elements, ...(list ? { documentExtras: { createElement: () => control() } } : {}) });
  if (list) loaded.input.parentElement = { style: {}, appendChild: (menu) => menus.push(menu) };
  const page = await loaded.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const sortedIds = (set) => [...set].sort((a, b) => a - b);
  const s = {
    page, board, elements, stored: storage,
    ids: () => sortedIds(page.run('selectedIds')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    box: () => page.input.value,
    view: () => page.run('loadViewMode()'),
    pills: () => JSON.parse(JSON.stringify(page.run('searchPanelPills()'))),
    counts: () => Object.fromEntries(s.pills().map((p) => [p.key, p.count])),
    on: () => s.pills().filter((p) => page.run(`pillIsOn(selectionState.selection, searchPanelPills().find((p) => p.key === ${JSON.stringify(p.key)}))`)).map((p) => p.key),
    click: (key) => { page.run(`applyPillGesture('click', ${JSON.stringify(key)})`); },
    shift: (key) => { page.run(`applyPillGesture('add', ${JSON.stringify(key)})`); },
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
  const s = await open();
  const before = s.counts();
  s.click('review');
  assert.deepStrictEqual(s.shown(), [5, 6], 'the box narrows the Board to the review cards');
  assert.deepStrictEqual(s.counts(), before);
  s.shift('blocked');
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
  const s = await open({ view: 'gantt' });
  assert.strictEqual(s.counts().blocked, 1, 'the Gantt starts without its archived cards');
  s.page.run("toggleGanttStatusFilter('archive')");
  assert.strictEqual(s.counts().blocked, 2);
});

test('a card that waits for a card the view hides still counts as waiting', async () => {
  const s = await open({ view: 'map' });
  s.page.run("toggleMapStatusFilter('doing')");
  assert.strictEqual(s.counts().waiting, 1, 'card 2 waits for card 1, which the Doing pill hid');
});

// --- a click ------------------------------------------------------------------------

test('on the Board a click puts the pill\'s query in the box, shows only its cards and selects them', async () => {
  const s = await open();
  s.click('review');
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.shown(), [5, 6]);
  assert.deepStrictEqual(s.ids(), [5, 6], 'the done review card is selected too');
  assert.deepStrictEqual(s.on(), ['review']);
});

test('the selected cards are the bulk targets', async () => {
  const s = await open();
  s.click('review');
  assert.deepStrictEqual(JSON.parse(s.page.run('JSON.stringify(bulkTargets().map((c) => c.id))')), [5, 6]);
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

test('a click on another pill replaces the first', async () => {
  const s = await open();
  s.click('review');
  s.click('blocked');
  assert.strictEqual(s.box(), 'blocked:');
  assert.deepStrictEqual(s.ids(), [4]);
  assert.deepStrictEqual(s.on(), ['blocked']);
});

test('either mouse button: a right-click on a pill does what a click does', async () => {
  const s = await open();
  const host = s.elements['#search-pills'];
  const button = { dataset: { pillKey: 'review' }, closest: (sel) => (sel === '.query-pill' ? button : null) };
  let prevented = 0;
  host.fire('contextmenu', { target: button, shiftKey: false, preventDefault() { prevented++; } });
  assert.strictEqual(s.box(), 'review:');
  assert.strictEqual(prevented, 1, 'the browser\'s own menu does not open');
  host.fire('click', { target: button, shiftKey: false, preventDefault() {} });
  assert.strictEqual(s.box(), '', 'and the same pill clicked again turns it off');
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
  assert.deepStrictEqual(s.ids(), [5, 6]);
  assert.deepStrictEqual(lit[lit.length - 1], [5, 6]);
  assert.deepStrictEqual(JSON.parse(s.page.run('JSON.stringify(graphCur.model.nodes.map((n) => n.id).sort((a, b) => a - b))')), [1, 2, 3, 4, 5, 6, 8], 'nothing is hidden');
});

test('a pill anchor stays the anchor when the Graph is left, where a typed search would go', async () => {
  const s = await open({ view: 'graph' });
  s.click('review');
  s.page.run("toggleView('board')");
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.ids(), [5, 6]);
  assert.strictEqual(s.box(), 'review:');
});

// --- shift --------------------------------------------------------------------------

test('shift on a second pill grows the box to "review: | blocked:" and selects both sets', async () => {
  const s = await open();
  s.click('review');
  s.shift('blocked');
  assert.strictEqual(s.box(), 'review: | blocked:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [q('blocked:')] });
  assert.deepStrictEqual(s.shown(), [4, 5, 6]);
  assert.deepStrictEqual(s.ids(), [4, 5, 6]);
  assert.deepStrictEqual(s.on(), ['blocked', 'review']);
});

test('shift on it again takes the box back to "review:"', async () => {
  const s = await open();
  s.click('review');
  s.shift('blocked');
  s.shift('blocked');
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.ids(), [5, 6]);
  assert.deepStrictEqual(s.on(), ['review']);
});

test('in the Graph shift grows the box too, so a switch to another view keeps the added pill\'s cards shown and selected', async () => {
  const s = await open({ view: 'graph' });
  s.click('review');
  s.shift('blocked');
  assert.strictEqual(s.box(), 'review: | blocked:');
  assert.deepStrictEqual(s.ids(), [4, 5, 6]);
  s.page.run("toggleView('board')");
  assert.deepStrictEqual(s.shown(), [4, 5, 6]);
  assert.deepStrictEqual(s.ids(), [4, 5, 6]);
});

test('a hand-picked card with an empty box takes a pill as an addition and leaves the box empty', async () => {
  const s = await open();
  s.page.run("setSelection(setAnchor(NO_SELECTION, cardPart(1)))");
  s.shift('review');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.ids(), [1, 5, 6]);
  assert.deepStrictEqual(s.on(), ['review']);
});

// --- Esc ----------------------------------------------------------------------------

test('Esc outside the box takes the added pill back out of the box and the selection, and the next Esc clears the box and the anchor', async () => {
  const s = await open();
  s.click('review');
  s.shift('blocked');
  s.esc();
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.shown(), [5, 6]);
  s.esc();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6, 8]);
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
  s.shift('blocked');
  s.esc(true);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.on(), []);
});

test('an open panel takes the first Esc and closes, leaving the box and the selection alone; the next Esc steps the selection back', async () => {
  const s = await open();
  s.click('review');
  s.shift('blocked');
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
  s.shift('blocked');
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
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'card', id: 1 }, additions: [] });
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
  assert.deepStrictEqual(s.ids(), [5, 6, 9], 'the pill\'s query reaches the card that came to match');
  assert.deepStrictEqual(s.on(), ['review']);
});

// --- the panel's own state -----------------------------------------------------------------

test('the panel starts closed, and focusing the search box does not open it', async () => {
  const s = await open();
  assert.strictEqual(s.isOpen(), false);
  s.page.input.fire('focus', {});
  assert.strictEqual(s.isOpen(), false);
});

test('the toggle opens and closes it, and says which', async () => {
  const s = await open();
  const toggle = s.elements['#search-panel-toggle'];
  const panel = s.elements['#search-panel'];
  s.page.run('toggleSearchPanel()');
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(toggle.attrs['aria-expanded'], 'true');
  assert.strictEqual(panel.classList.contains('hidden'), false);
  s.page.run('toggleSearchPanel()');
  assert.strictEqual(s.isOpen(), false);
  assert.strictEqual(toggle.attrs['aria-expanded'], 'false');
  assert.strictEqual(panel.classList.contains('hidden'), true);
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
  s.shift('blocked');
  assert.strictEqual(chip.text(), '2');
  assert.strictEqual(chip.name(), '2 on: blocked, review');
  s.click('blocked');
  s.click('blocked');
  assert.strictEqual(chip.hidden(), true);
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
