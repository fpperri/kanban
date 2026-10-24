const { test } = require('node:test');
const assert = require('node:assert');
const { openPanelPage, card } = require('./helpers/panel-dom');

// The m key in the real page (helpers/page-vm.js runs every script the page loads in one
// vm; helpers/panel-dom.js draws the pill section onto a stand-in for the DOM): each press
// turns on the next pill alone, as a right-click on it does, through the panel's order,
// the built-ins and then the board's own pills, then turns every pill off; Shift+m runs it
// backwards. The key reads the shared key guard. The browser runner looks at the page
// itself (scenarios/search-panel.js).

const PILLS = [
  { label: 'next', query: 'tags:"next-up"' },
  { label: 'assignee:@human', query: 'assignee:@human' },
  { label: 'tags:*', query: 'tags:*' },
];

// 1 grill, 2 grilling, 3 grill and next-up, 4 blocked with a tag of two words, 5 awaiting
// review, 6 done and awaiting review with next-up.
const makeBoard = (pills = PILLS) => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [], pills,
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing', tags: ['grill'], assignee: '@human' }),
    card(2, { title: 'Move the data layer', tags: ['grilling'], assignee: '@afk' }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', tags: ['grill', 'next-up'], assignee: '@human' }),
    card(4, { title: 'Port the schema', blocked: 'vendor', tags: ['two words'], assignee: '@hitl' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy' }),
    card(6, { title: 'Renew the domain', status: 'done', review: 'PR #9', tags: ['next-up'], assignee: '@afk' }),
  ],
  archived: [],
});

const q = (text) => ({ kind: 'query', text });
const NONE = { anchor: null, additions: [] };

// The queries the panel's order walks through when pressed: the three built-ins, the board's
// two pills, then one pill per tag. The tag next-up holds the query of the `next` pill, so it
// is the same step and the walk goes past it.
const WALK = [
  ['blocked', 'blocked:'],
  ['review', 'review:'],
  ['waiting', 'waiting:'],
  ['next', 'tags:"next-up"'],
  ['assignee:@human', 'assignee:@human'],
  ['grill', 'tags:"grill"'],
  ['grilling', 'tags:"grilling"'],
  ['two words', 'tags:"two words"'],
];

// One press of a key on the document, as the page's listeners see it; answers how many times
// the page stopped the browser's own response to it.
const press = (s, key, init = {}) => {
  let prevented = 0;
  s.page.fireDocument('keydown', { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault() { prevented++; }, ...init });
  return prevented;
};
const m = (s) => press(s, 'm');
const shiftM = (s) => press(s, 'M', { shiftKey: true });
const focusOn = (s, el) => { s.page.ctx.document.activeElement = el; };
const button = () => ({ tagName: 'BUTTON', isContentEditable: false, focus() {} });

// --- the cycle ------------------------------------------------------------------------------

test('each m turns on the next pill alone and the box holds its query alone, then m turns every pill off', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  assert.deepStrictEqual(s.pressed(), []);
  for (const [label, query] of WALK) {
    assert.strictEqual(m(s), 1, `${label}: the page stops the browser's own response to the key`);
    assert.strictEqual(s.box(), query, label);
    assert.deepStrictEqual(s.selection(), { anchor: q(query), additions: [] }, label);
    assert.ok(s.pressed().includes(label), `${label}: its button is on`);
  }
  assert.strictEqual(m(s), 1);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), NONE);
  assert.deepStrictEqual(s.pressed(), []);
  assert.deepStrictEqual(s.shown(), ['1', '2', '3', '4', '5', '6'], 'every card is back on the Board');
  m(s);
  assert.strictEqual(s.box(), 'blocked:', 'the cycle starts over');
});

test('the pill is a solo: it alone is on, its cards are the selection, and what was selected or typed before is gone', async () => {
  const s = await openPanelPage({ typing: true, board: makeBoard() });
  s.click(s.byLabel('review'));
  s.click(s.byLabel('blocked'));
  s.page.input.typed('zephyr | review: | blocked:');
  m(s);
  assert.strictEqual(s.box(), 'blocked:', 'the first pill, since two were on');
  assert.deepStrictEqual(s.pressed(), ['blocked']);
  assert.deepStrictEqual(s.ids(), ['4']);
  assert.deepStrictEqual(s.shown(), ['4']);
});

test('m steps on from the pill a click or a right-click turned on alone', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  s.click(s.byLabel('waiting'));
  m(s);
  assert.strictEqual(s.box(), 'tags:"next-up"');
  s.rightClick(s.byLabel('review'));
  m(s);
  assert.strictEqual(s.box(), 'waiting:');
});

test('m in the Graph solos the pill as an anchor, not a typed search, and the cycle ends with every pill off', async () => {
  const s = await openPanelPage({ board: makeBoard(), view: 'graph' });
  m(s);
  assert.strictEqual(s.box(), 'blocked:');
  assert.deepStrictEqual(s.selection(), { anchor: q('blocked:'), additions: [] });
  for (let i = 0; i < WALK.length; i++) m(s);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), NONE);
});

test('m works in every view the pills filter', async () => {
  for (const view of ['board', 'map', 'gantt', 'calendar', 'graph']) {
    const s = await openPanelPage({ board: makeBoard(), view });
    m(s);
    assert.strictEqual(s.box(), 'blocked:', view);
    assert.deepStrictEqual(s.pressed(), ['blocked'], view);
    m(s);
    assert.strictEqual(s.box(), 'review:', view);
  }
});

// --- backwards ------------------------------------------------------------------------------

test('Shift+m steps backwards: from off to the last pill, down to the first, then off', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  for (const [label, query] of [...WALK].reverse()) {
    assert.strictEqual(shiftM(s), 1, label);
    assert.strictEqual(s.box(), query, label);
    assert.deepStrictEqual(s.selection(), { anchor: q(query), additions: [] }, label);
    assert.ok(s.pressed().includes(label), label);
  }
  assert.strictEqual(shiftM(s), 1);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), NONE);
  assert.deepStrictEqual(s.pressed(), []);
});

test('Shift+m and m undo each other, and a capital M with Shift held, or with Caps Lock on, steps the way the Shift key says', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  m(s);
  m(s);
  shiftM(s);
  assert.strictEqual(s.box(), 'blocked:');
  press(s, 'M');
  assert.strictEqual(s.box(), 'review:', 'Caps Lock gives a capital M with no Shift: forward');
  press(s, 'm', { shiftKey: true });
  assert.strictEqual(s.box(), 'blocked:', 'Shift with Caps Lock on gives a small m: backward');
});

// --- where it does nothing ---------------------------------------------------------------------

const SURFACES = { menu: '#context-menu:not(.hidden)', dialog: '.modal-backdrop:not(.hidden)', notifications: '#notif-modal:not(.hidden)', preferences: '#prefs-sheet:not(.hidden)' };
const withSurface = (s, name) => {
  const orig = s.page.ctx.document.querySelector;
  s.page.ctx.document.querySelector = (sel) => (sel === SURFACES[name] ? {} : orig(sel));
};
const unchanged = (s, label) => {
  assert.strictEqual(s.box(), '', label);
  assert.deepStrictEqual(s.selection(), NONE, label);
  assert.deepStrictEqual(s.pressed(), [], label);
};

test('m does nothing while typing in a field: an input, a text area, a select, an editable element or the search box', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  for (const el of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, s.page.input]) {
    focusOn(s, el);
    assert.strictEqual(m(s), 0, el.tagName);
    assert.strictEqual(shiftM(s), 0, el.tagName);
    unchanged(s, el.tagName);
  }
});

test('m does nothing while a card menu, a dialog, the notifications panel or the preferences sheet is up', async () => {
  for (const name of Object.keys(SURFACES)) {
    const s = await openPanelPage({ board: makeBoard() });
    withSurface(s, name);
    focusOn(s, button());
    assert.strictEqual(m(s), 0, name);
    assert.strictEqual(shiftM(s), 0, name);
    unchanged(s, name);
  }
});

test('m with Ctrl, Cmd or Alt held, or held down, does nothing, and neither does another key', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  focusOn(s, button());
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { ctrlKey: true, shiftKey: true }]) {
    assert.strictEqual(press(s, 'm', init), 0, JSON.stringify(init));
    unchanged(s, JSON.stringify(init));
  }
  for (const key of ['q', 'o', 'M ', 'mm']) {
    assert.strictEqual(press(s, key), 0, key);
    unchanged(s, key);
  }
  assert.strictEqual(press(s, undefined), 0, 'a key event with no key');
});

test('m works with nothing focused and with focus on a button, and with the panel open, which is no popup for the key', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  assert.strictEqual(s.page.run('searchPanelIsOpen()'), true);
  for (const el of [null, button(), s.byLabel('review')]) {
    focusOn(s, el);
    assert.strictEqual(m(s), 1);
  }
  assert.strictEqual(s.box(), 'waiting:');
});

// --- what shows which pill is on ---------------------------------------------------------------

test('with the panel closed the chip counts the one pill that is on and its name and hover text say which, and the buttons agree once it opens', async () => {
  const s = await openPanelPage({ board: makeBoard(), open: false });
  assert.strictEqual(s.chip.classList.contains('hidden'), true);
  m(s);
  assert.strictEqual(s.chip.classList.contains('hidden'), false);
  assert.strictEqual(s.chip.textContent, '1');
  assert.strictEqual(s.chip.attrs['aria-label'], '1 on: blocked');
  assert.strictEqual(s.chip.title, '1 on: blocked');
  m(s);
  assert.strictEqual(s.chip.textContent, '1', 'a step leaves one pill on, not two');
  assert.strictEqual(s.chip.title, '1 on: review');
  s.page.run('setSearchPanelOpen(true)');
  assert.deepStrictEqual(s.pressed(), ['review']);
  assert.strictEqual(s.chip.classList.contains('hidden'), true, 'the panel shows what is on');
  s.page.run('setSearchPanelOpen(false)');
  assert.strictEqual(s.chip.title, '1 on: review');
});

test('the step after the last pill takes the chip away, and its hover text with it', async () => {
  const s = await openPanelPage({ board: makeBoard(), open: false });
  for (let i = 0; i < WALK.length; i++) shiftM(s);
  assert.strictEqual(s.box(), 'blocked:');
  assert.strictEqual(s.chip.textContent, '1');
  assert.strictEqual(s.chip.title, '1 on: blocked');
  shiftM(s);
  assert.strictEqual(s.chip.classList.contains('hidden'), true);
  assert.strictEqual(s.chip.title, '');
});

test('the buttons show which pill is on as the key steps: one on, the one before off', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  for (const [label] of WALK) {
    m(s);
    assert.deepStrictEqual(s.pressed().filter((l) => l !== 'next-up'), [label]);
    assert.ok(s.byLabel(label).classList.contains('on'), label);
  }
});

// --- a pill behind the "+N more" button -------------------------------------------------------

const TAGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const manyTags = () => {
  const board = makeBoard([{ label: 'tags:*', query: 'tags:*' }]);
  board.active = TAGS.map((tag, at) => card(at + 1, { title: `Card ${tag}`, tags: [tag] }));
  return board;
};

test('a step that lands on a value pill behind the "+N more" button opens the field, so the pill that is on is drawn', async () => {
  const s = await openPanelPage({ board: manyTags() });
  assert.deepStrictEqual(s.labels().slice(3), [...TAGS.slice(0, 8), '+2 more']);
  for (let i = 0; i < 3 + 9; i++) m(s);
  assert.strictEqual(s.box(), 'tags:"i"');
  assert.deepStrictEqual(s.labels().slice(3), [...TAGS, 'fewer']);
  assert.deepStrictEqual(s.pressed(), ['i']);
  m(s);
  assert.strictEqual(s.box(), 'tags:"j"');
  assert.deepStrictEqual(s.pressed(), ['j']);
});

test('Shift+m from off lands on the last value pill, which is behind the button, and opens the field', async () => {
  const s = await openPanelPage({ board: manyTags() });
  shiftM(s);
  assert.strictEqual(s.box(), 'tags:"j"');
  assert.deepStrictEqual(s.pressed(), ['j']);
  assert.strictEqual(s.labels().at(-1), 'fewer');
});

test('the step goes through the pills behind the button even though the panel is closed, and the chip counts the one on', async () => {
  const s = await openPanelPage({ board: manyTags(), open: false });
  for (let i = 0; i < 3 + 10; i++) m(s);
  assert.strictEqual(s.box(), 'tags:"j"');
  assert.strictEqual(s.chip.textContent, '1');
  assert.strictEqual(s.chip.title, '1 on: j');
});
