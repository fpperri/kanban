const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');
const { fakeDom } = require('./helpers/fake-dom');

// The search panel's slice section in the real page (helpers/page-vm.js runs every
// script the page loads in one vm): the slices it lists with their counts and icons, the
// run it shows as pressed (the slice: term the box holds), what a click, a right-click and
// the context-menu key do to the box, the keys [ ] { }, the chip, the fold and the Graph's
// typed anchor. The elements are not drawn in a vm, so the buttons are built on a small
// stand-in for the DOM and read back; the browser runner looks at the page itself
// (scenarios/slice-section.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Hierarchy goal, strategy, epic: no card is a strategy, so the section does not list it.
// 1 and 2 are goals, 3 an epic under 1, 4 a story under the epic (depth 2), 5 a story with
// no parent (depth 0, blocked), 6 a task under 5 (depth 1, awaiting review).
const makeBoard = (over = {}) => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], notifications: [],
  hierarchy: ['goal', 'strategy', 'epic'],
  types: [{ name: 'goal', icon: 'star' }, { name: 'epic' }, { name: 'story', icon: 'blob' }],
  active: [
    card(1, { type: 'goal', tags: ['ui'] }),
    card(2, { type: 'goal', status: 'doing' }),
    card(3, { type: 'epic', parent: 1, tags: ['ui'] }),
    card(4, { type: 'story', parent: 3 }),
    card(5, { type: 'story', blocked: 'vendor' }),
    card(6, { type: 'task', parent: 5, status: 'doing', review: 'look' }),
  ],
  archived: [],
  ...over,
});

const UNFOLDED = { 'kanban.kanban.prefs': JSON.stringify({ slicesFolded: false }) };
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const spied = (el = control()) => {
  el.attrs = {};
  el.focused = 0;
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.focus = () => { el.focused++; };
  return el;
};
const chipEl = () => {
  const el = spied(hidden());
  let text = '';
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { text = String(v); } });
  return el;
};
const host = () => {
  const el = control();
  el.children = [];
  el.ownerDocument = fakeDom();
  el.insertBefore = (node, ref) => {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = el;
    el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, node);
  };
  return el;
};

async function open({ view = 'board', stored = UNFOLDED, board = makeBoard(), search = '' } = {}) {
  const elements = {};
  for (const sel of ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel']) elements[sel] = hidden();
  elements['#search-slices'] = host();
  elements['#search-slices-section'] = hidden();
  elements['#search-slices-fold'] = spied();
  elements['#search-pills'] = host();
  elements['#search-pills-fold'] = spied();
  elements['#search-panel-toggle'] = spied();
  elements['#search-chip'] = chipEl();
  elements['#graph-view'] = control();
  const storage = { 'kanban.kanban.view.mode': view, ...stored };
  const page = await loadPage({ board, search, stored: storage, elements, documentExtras: { createElement: () => control() } }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const slices = elements['#search-slices'];
  const sorted = (set) => [...set].map(Number).sort((a, b) => a - b);
  let prevented = 0;
  const s = {
    page, board, elements, stored: storage, slices,
    box: () => page.input.value,
    type: (text) => page.input.typed(text),
    openPanel: () => page.run('setSearchPanelOpen(true)'),
    entries: () => slices.children.map((b) => ({
      label: b.children[1].textContent, count: b.children[2].textContent, icon: b.children[0].textContent, on: b.attrs['aria-pressed'], name: b.attrs['aria-label'], key: b.dataset.sliceKey,
    })),
    labels: () => slices.children.map((b) => b.children[1].textContent),
    pressed: () => slices.children.filter((b) => b.attrs['aria-pressed'] === 'true').map((b) => b.children[1].textContent),
    counts: () => slices.children.map((b) => b.children[2].textContent),
    entry: (label) => {
      const el = slices.children.find((b) => b.children[1].textContent === label);
      assert.ok(el, `an entry for ${label}`);
      return el;
    },
    click: (label, init = {}) => slices.fire('click', { target: s.entry(label), shiftKey: false, preventDefault() { prevented++; }, ...init }),
    rightClick: (label) => slices.fire('contextmenu', { target: s.entry(label), preventDefault() { prevented++; } }),
    entryKey: (label, key, init = {}) => {
      let stopped = 0;
      slices.fire('keydown', { key, target: s.entry(label), shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() { stopped++; }, ...init });
      return stopped;
    },
    prevented: () => prevented,
    key: (key, init = {}) => {
      let stopped = 0;
      page.fireDocument('keydown', { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: '{}'.includes(key), repeat: false, preventDefault() { stopped++; }, ...init });
      return stopped;
    },
    focusOn: (el) => { page.ctx.document.activeElement = el; },
    shown: () => sorted(page.run('shownCardIds()')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    chip: () => ({ hidden: elements['#search-chip'].classList.contains('hidden'), text: elements['#search-chip'].textContent, name: elements['#search-chip'].attrs['aria-label'] }),
  };
  return s;
}

const button = () => ({ tagName: 'BUTTON', isContentEditable: false, focus() {} });
const SURFACES = { menu: '#context-menu:not(.hidden)', dialog: '.modal-backdrop:not(.hidden)', notifications: '#notif-modal:not(.hidden)', preferences: '#prefs-sheet:not(.hidden)' };
const withSurface = (s, name) => {
  const orig = s.page.ctx.document.querySelector;
  s.page.ctx.document.querySelector = (sel) => (sel === SURFACES[name] ? control() : orig(sel));
};

// --- the list --------------------------------------------------------------------------------------

test('the section lists the tiers the board uses in hierarchy order, then the depths, each with its count', async () => {
  const s = await open();
  s.openPanel();
  assert.deepStrictEqual(s.labels(), ['goal', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  assert.deepStrictEqual(s.counts(), ['2', '1', '1', '1', '1']);
});

test('a tier that no card on the board has is not listed, and a board with no hierarchy lists the depths only', async () => {
  const s = await open();
  s.openPanel();
  assert.ok(!s.labels().includes('strategy'));
  const flat = await open({ board: makeBoard({ hierarchy: [] }) });
  flat.openPanel();
  assert.deepStrictEqual(flat.labels(), ['depth 0', 'depth 1', 'depth 2']);
});

test('a tier wears its type\'s icon, and a type with no icon, an unknown one or a depth wears none', async () => {
  const s = await open();
  s.openPanel();
  assert.deepStrictEqual(s.entries().map((e) => e.icon), ['★', '', '', '', '']);
});

test('every slice is in the run to start, and each entry\'s name states its label, its count and that it is in the run', async () => {
  const s = await open();
  s.openPanel();
  assert.deepStrictEqual(s.entries().map((e) => e.on), ['true', 'true', 'true', 'true', 'true']);
  assert.deepStrictEqual(s.entries().map((e) => e.name), [
    'goal, 2 cards, in the run', 'epic, 1 card, in the run', 'depth 0, 1 card, in the run', 'depth 1, 1 card, in the run', 'depth 2, 1 card, in the run',
  ]);
  assert.strictEqual(s.box(), '');
});

test('each entry is a button of its own class, never a pill\'s, that keeps a selection and holds no poll', async () => {
  const s = await open();
  s.openPanel();
  for (const b of s.slices.children) {
    assert.strictEqual(b.tag, 'button');
    assert.strictEqual(b.type, 'button');
    assert.strictEqual(b.className.split(' ')[0], 'slice-entry');
    assert.doesNotMatch(b.className, /query-pill|map-filter-toggle/);
    assert.strictEqual('keepsSelection' in b.dataset, true);
    assert.strictEqual('holdsPoll' in b.dataset, false, 'a button left focused by a click would stop the poll for good');
  }
});

test('a closed panel draws no entries, and opening it does', async () => {
  const s = await open();
  assert.strictEqual(s.slices.children.length, 0);
  s.page.run('renderBoard()');
  assert.strictEqual(s.slices.children.length, 0);
  s.openPanel();
  assert.strictEqual(s.slices.children.length, 5);
});

test('a board with no cards has no section to show, and one with cards has', async () => {
  const none = await open({ board: makeBoard({ active: [] }) });
  none.openPanel();
  assert.strictEqual(none.slices.children.length, 0);
  assert.strictEqual(none.elements['#search-slices-section'].classList.contains('hidden'), true);
  const some = await open();
  some.openPanel();
  assert.strictEqual(some.elements['#search-slices-section'].classList.contains('hidden'), false);
});

// --- the run is the slice: term in the box ----------------------------------------------------------

test('the entries in the run are the ones the slice: term in the box names, and editing it by hand updates them', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:epic..1');
  assert.deepStrictEqual(s.pressed(), ['epic', 'depth 0', 'depth 1']);
  assert.deepStrictEqual(s.entries().map((e) => e.on), ['false', 'true', 'true', 'true', 'false']);
  s.type('slice:goal');
  assert.deepStrictEqual(s.pressed(), ['goal']);
  s.type('(tags:ui | #4) slice:..epic');
  assert.deepStrictEqual(s.pressed(), ['goal', 'epic'], 'at the top level of a query that holds a |, as the section writes it');
  s.type('');
  assert.deepStrictEqual(s.pressed(), ['goal', 'epic', 'depth 0', 'depth 1', 'depth 2']);
});

test('an entry out of the run says so in its name, and the name follows the count', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:goal');
  assert.strictEqual(s.entry('epic').attrs['aria-label'], 'epic, 1 card, not in the run');
  assert.strictEqual(s.entry('goal').attrs['aria-label'], 'goal, 2 cards, in the run');
});

test('a single unknown slice name cuts nothing, and the section shows every entry as pressed', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:nosuch');
  assert.deepStrictEqual(s.pressed(), ['goal', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  s.type('slice:..');
  assert.strictEqual(s.pressed().length, 5);
});

test('a slice: term inside a bracket of alternatives, or after a |, is not the run: every entry stays pressed', async () => {
  const s = await open();
  s.openPanel();
  s.type('tags:ui | slice:goal');
  assert.strictEqual(s.pressed().length, 5);
  s.type('(slice:goal | #4) tags:ui');
  assert.strictEqual(s.pressed().length, 5);
});

test('a term that names only the tier no card is in leaves no entry in the run', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:strategy');
  assert.deepStrictEqual(s.pressed(), []);
});

// --- the clicks -------------------------------------------------------------------------------------

test('a click outside the run grows the run to that slice, and writes the term', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:goal');
  s.click('epic');
  assert.strictEqual(s.box(), 'slice:..epic');
  assert.deepStrictEqual(s.pressed(), ['goal', 'epic']);
  s.click('depth 1');
  assert.strictEqual(s.box(), 'slice:..1');
  assert.deepStrictEqual(s.pressed(), ['goal', 'epic', 'depth 0', 'depth 1']);
});

test('a click on an end of the run drops that end', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:goal..1');
  s.click('goal');
  assert.strictEqual(s.box(), 'slice:epic..1');
  s.click('depth 1');
  assert.strictEqual(s.box(), 'slice:epic..0');
  assert.deepStrictEqual(s.pressed(), ['epic', 'depth 0']);
});

test('a click inside the run that is not an end changes nothing: the box is left as it was typed', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:goal..1');
  const writes = s.page.input.writes.length;
  s.click('epic');
  s.click('depth 0');
  assert.strictEqual(s.box(), 'slice:goal..1');
  assert.strictEqual(s.page.input.writes.length, writes, 'nothing was written to the box');
});

test('a click on a run of one brings back every slice, and writes no term', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:epic');
  s.click('epic');
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.pressed().length, 5);
  s.type('tags:ui slice:goal');
  s.click('goal');
  assert.strictEqual(s.box(), 'tags:ui');
});

test('a click with every slice in the run drops that end, and a run that reaches the end of the axis leaves that end open', async () => {
  const s = await open();
  s.openPanel();
  s.click('goal');
  assert.strictEqual(s.box(), 'slice:epic..');
  s.click('goal');
  assert.strictEqual(s.box(), '', 'the run grows back to every slice, so it writes no term');
});

test('a click on the label or the count inside an entry is a click on the entry', async () => {
  const s = await open();
  s.openPanel();
  const target = s.entry('goal').children[1];
  s.slices.fire('click', { target, shiftKey: false, preventDefault() {} });
  assert.strictEqual(s.box(), 'slice:epic..');
});

test('Shift with a click is a plain click', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:goal');
  s.click('epic', { shiftKey: true });
  assert.strictEqual(s.box(), 'slice:..epic');
});

test('the Board hides the cards outside the run, and a click on a run of one shows them again', async () => {
  const s = await open();
  s.openPanel();
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
  s.click('goal');
  assert.deepStrictEqual(s.shown(), [3, 4, 5, 6], 'the two goals are outside the run');
  s.rightClick('goal');
  assert.deepStrictEqual(s.shown(), [1, 2]);
  s.click('goal');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
});

// --- keep only --------------------------------------------------------------------------------------

test('a right-click keeps only that slice, and stops the browser\'s own menu', async () => {
  const s = await open();
  s.openPanel();
  s.rightClick('depth 1');
  assert.strictEqual(s.box(), 'slice:1');
  assert.deepStrictEqual(s.pressed(), ['depth 1']);
  assert.strictEqual(s.prevented(), 1);
  s.rightClick('goal');
  assert.strictEqual(s.box(), 'slice:goal');
  assert.deepStrictEqual(s.shown(), [1, 2]);
});

test('a right-click on the one slice of a run of one writes the same run again, and every slice stays one click away', async () => {
  const s = await open();
  s.openPanel();
  s.rightClick('epic');
  s.rightClick('epic');
  assert.strictEqual(s.box(), 'slice:epic');
  s.click('epic');
  assert.strictEqual(s.box(), '');
});

test('the context-menu key and Shift+F10 on a focused entry each keep only that slice', async () => {
  const s = await open();
  s.openPanel();
  assert.strictEqual(s.entryKey('depth 0', 'ContextMenu'), 1, 'the page stops the browser\'s menu');
  assert.strictEqual(s.box(), 'slice:0');
  assert.strictEqual(s.entryKey('epic', 'F10', { shiftKey: true }), 1);
  assert.strictEqual(s.box(), 'slice:epic');
});

test('F10 without Shift, with a chord, and every other key on an entry leave the box alone', async () => {
  const s = await open();
  s.openPanel();
  assert.strictEqual(s.entryKey('epic', 'F10'), 0);
  assert.strictEqual(s.entryKey('epic', 'F10', { shiftKey: true, ctrlKey: true }), 0);
  assert.strictEqual(s.entryKey('epic', 'a'), 0);
  assert.strictEqual(s.entryKey('epic', 'Enter'), 0, 'Enter is the button\'s own click');
  assert.strictEqual(s.box(), '');
});

// --- a run in a box that holds a query --------------------------------------------------------------

test('a run set on a box that holds | brackets the query, and the Board shows the query\'s matches inside the run', async () => {
  const s = await open();
  s.openPanel();
  s.type('tags:ui | #4');
  s.click('goal');
  assert.strictEqual(s.box(), '(tags:ui | #4) slice:epic..');
  assert.deepStrictEqual(s.shown(), [3, 4]);
  s.click('epic');
  s.click('depth 0');
  s.click('depth 1');
  s.click('depth 2');
  assert.strictEqual(s.box(), 'tags:ui | #4', 'every slice again: the term goes and the bracket with it');
});

// --- the counts -------------------------------------------------------------------------------------

test('setting a run, and turning a pill on, leave every slice\'s count as it was', async () => {
  const s = await open();
  s.openPanel();
  const before = s.counts();
  s.click('goal');
  s.click('depth 2');
  assert.strictEqual(s.box(), 'slice:epic..1');
  assert.deepStrictEqual(s.counts(), before, 'a run does not zero the entries needed to grow it again');
  s.page.run("applyPillGesture('toggle', 'blocked')");
  assert.deepStrictEqual(s.counts(), before, 'nor does a pill');
  s.page.run("applyPillGesture('toggle', 'review')");
  assert.deepStrictEqual(s.counts(), before);
  s.type('title:nothing');
  assert.deepStrictEqual(s.counts(), before, 'nor does the search box');
});

test('the counts are taken after the status pills and Archive: a card the view does not show is not counted', async () => {
  const board = makeBoard({ archived: [card(9, { type: 'epic', archived: true, status: 'done' })] });
  const s = await open({ board });
  s.openPanel();
  assert.deepStrictEqual(s.counts(), ['2', '1', '1', '1', '1'], 'the archived epic is on the board, so its tier is listed, but the Board does not show it');
  assert.ok(s.labels().includes('epic'));
});

test('a tier whose only cards are archived is still listed, with a count of none', async () => {
  const board = makeBoard({ active: [card(5, { type: 'story' })], archived: [card(9, { type: 'goal', archived: true, status: 'done' })] });
  const s = await open({ board });
  s.openPanel();
  assert.deepStrictEqual(s.labels(), ['goal', 'depth 0']);
  assert.deepStrictEqual(s.counts(), ['0', '1']);
});

// --- the pills and the run share the box ------------------------------------------------------------

test('a pill turned on beside a run joins the query inside the bracket, and the run stays', async () => {
  const s = await open();
  s.openPanel();
  s.click('goal');
  s.page.run("applyPillGesture('toggle', 'blocked')");
  assert.strictEqual(s.box(), 'blocked: slice:epic..');
  s.page.run("applyPillGesture('toggle', 'review')");
  assert.strictEqual(s.box(), '(blocked: | review:) slice:epic..');
  s.page.run("applyPillGesture('toggle', 'blocked')");
  assert.strictEqual(s.box(), 'review: slice:epic..');
  s.page.run("applyPillGesture('toggle', 'review')");
  assert.strictEqual(s.box(), 'slice:epic..', 'the pill leaves and the run stays');
});

test('a right-click on a pill solos it and leaves the run in the box', async () => {
  const s = await open();
  s.openPanel();
  s.click('goal');
  s.page.run("applyPillGesture('toggle', 'blocked')");
  s.page.run("applyPillGesture('solo', 'review')");
  assert.strictEqual(s.box(), 'review: slice:epic..');
  s.page.run("applyPillGesture('solo', 'review')");
  assert.strictEqual(s.box(), 'slice:epic..');
});

test('a run set while a pill is on leaves the pill on, and typing after it still does', async () => {
  const s = await open();
  s.openPanel();
  s.page.run("applyPillGesture('toggle', 'blocked')");
  s.click('goal');
  assert.strictEqual(s.box(), 'blocked: slice:epic..');
  assert.strictEqual(s.page.run("pillIsOn(selectionState.selection, BUILT_IN_PILLS[0])"), true);
  s.type('blocked: slice:epic.. ');
  assert.strictEqual(s.page.run("pillIsOn(selectionState.selection, BUILT_IN_PILLS[0])"), true, 'the box still holds the pill\'s query as an alternative');
});

test('a card selection is kept by a click on an entry, and a run changes none of it', async () => {
  const s = await open();
  s.openPanel();
  s.page.run('setSelection({ anchor: cardPart(3), additions: [] }, 3)');
  const before = s.selection();
  assert.strictEqual(before.anchor.id, '3');
  s.click('goal');
  s.click('depth 2');
  assert.strictEqual(s.box(), 'slice:epic..1');
  assert.deepStrictEqual(s.selection(), before);
});

// --- the Graph --------------------------------------------------------------------------------------

test('in the Graph, a run set on a typed search keeps that search the anchor, with its text following the box', async () => {
  const s = await open({ view: 'graph' });
  s.openPanel();
  s.type('tags:ui | #4');
  assert.strictEqual(s.selection().anchor.text, 'tags:ui | #4');
  s.click('goal');
  assert.strictEqual(s.box(), '(tags:ui | #4) slice:epic..');
  const anchor = s.selection().anchor;
  assert.strictEqual(anchor.source, 'typing');
  assert.strictEqual(anchor.text, '(tags:ui | #4) slice:epic..');
});

test('in the Graph, a run set with no typed search does not make the box the anchor: it is a cut, not a selection', async () => {
  const s = await open({ view: 'graph' });
  s.openPanel();
  s.click('goal');
  assert.strictEqual(s.box(), 'slice:epic..');
  assert.strictEqual(s.selection().anchor, null);
  s.page.run('setSelection({ anchor: cardPart(3), additions: [] }, 3)');
  s.click('depth 2');
  assert.deepStrictEqual(s.selection().anchor, { kind: 'card', id: '3' });
});

test('in the Graph, taking the last term out of a typed search with a run takes the anchor with it, as clearing the box does', async () => {
  const s = await open({ view: 'graph' });
  s.openPanel();
  s.type('slice:goal');
  assert.strictEqual(s.selection().anchor.text, 'slice:goal');
  s.click('goal');
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.selection().anchor, null);
});

// --- the keys ----------------------------------------------------------------------------------------

test('[ moves the bottom of the run up and ] moves it down, { moves its top up and } moves it down', async () => {
  const s = await open();
  s.focusOn(button());
  s.key('[');
  assert.strictEqual(s.box(), 'slice:..1');
  s.key('{');
  assert.strictEqual(s.box(), 'slice:..1', 'the top is at the first slice');
  s.key('}');
  assert.strictEqual(s.box(), 'slice:epic..1');
  s.key('}');
  assert.strictEqual(s.box(), 'slice:0..1');
  s.key('{');
  assert.strictEqual(s.box(), 'slice:epic..1');
  s.key(']');
  assert.strictEqual(s.box(), 'slice:epic..', 'the bottom is at the last slice, so the end is left open');
  s.key(']');
  assert.strictEqual(s.box(), 'slice:epic..', 'and it stops there');
});

test('each key stops at the ends of the axis, and the top never passes the bottom', async () => {
  const s = await open();
  s.focusOn(button());
  assert.strictEqual(s.key(']'), 1);
  assert.strictEqual(s.box(), '', 'every slice in the run: the bottom has nowhere to go');
  assert.strictEqual(s.key('{'), 1);
  assert.strictEqual(s.box(), '');
  s.type('slice:epic');
  s.key('[');
  s.key('}');
  assert.strictEqual(s.box(), 'slice:epic', 'a run of one stays one under [ and }');
  s.key(']');
  assert.strictEqual(s.box(), 'slice:epic..0');
});

test('the keys work with the search panel closed and with it open', async () => {
  for (const openIt of [false, true]) {
    const s = await open();
    if (openIt) s.openPanel();
    s.focusOn(button());
    s.key('[');
    s.key('[');
    assert.strictEqual(s.box(), 'slice:..0', `panel ${openIt ? 'open' : 'closed'}`);
    if (openIt) assert.deepStrictEqual(s.pressed(), ['goal', 'epic', 'depth 0']);
  }
});

test('the keys work from the page when nothing has focus, and with focus on an entry', async () => {
  const s = await open();
  s.openPanel();
  s.focusOn(null);
  s.key(']');
  s.focusOn(s.entry('epic'));
  s.key('[');
  assert.strictEqual(s.box(), 'slice:..1');
});

test('the keys do nothing with focus in a text field, the search box included', async () => {
  const s = await open();
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    s.focusOn({ tagName, isContentEditable: false });
    assert.strictEqual(s.key('['), 0, tagName);
  }
  s.focusOn({ tagName: 'DIV', isContentEditable: true });
  assert.strictEqual(s.key('['), 0, 'an editable element');
  s.focusOn(s.page.input);
  assert.strictEqual(s.key('['), 0, 'the search box');
  assert.strictEqual(s.box(), '');
});

test('the keys do nothing while a card menu, a dialog, the notifications panel or the preferences sheet is up', async () => {
  for (const name of Object.keys(SURFACES)) {
    const s = await open();
    withSurface(s, name);
    s.focusOn(button());
    for (const key of ['[', ']', '{', '}']) assert.strictEqual(s.key(key), 0, `${name} ${key}`);
    assert.strictEqual(s.box(), '', name);
  }
});

test('a chord with Ctrl, Cmd or Alt, and any other key, leave the run alone', async () => {
  const s = await open();
  s.focusOn(button());
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.strictEqual(s.key('[', init), 0, JSON.stringify(init));
  assert.strictEqual(s.key('('), 0);
  assert.strictEqual(s.key('a'), 0);
  assert.strictEqual(s.box(), '');
});

test('AltGr, which types the brackets on layouts that have none of their own, is not a chord: the keys work with it, and a plain Ctrl+Alt still does not', async () => {
  const s = await open();
  s.focusOn(button());
  const altGr = { ctrlKey: true, altKey: true, getModifierState: (name) => name === 'AltGraph' };
  assert.strictEqual(s.key('[', altGr), 1);
  assert.strictEqual(s.box(), 'slice:..1');
  assert.strictEqual(s.key('[', { ctrlKey: true, altKey: true, getModifierState: () => false }), 0, 'Ctrl+Alt held as a chord');
  assert.strictEqual(s.key('[', { ctrlKey: true, getModifierState: (name) => name === 'AltGraph' }), 1, 'a layout that reports AltGr without the Ctrl and Alt keys');
  assert.strictEqual(s.key('[', { metaKey: true, getModifierState: (name) => name === 'AltGraph' }), 0, 'Cmd is a chord whatever else is held');
});

test('a key on a board with no cards does nothing', async () => {
  const s = await open({ board: makeBoard({ active: [] }) });
  s.focusOn(button());
  assert.strictEqual(s.key('['), 0);
  assert.strictEqual(s.box(), '');
});

test('a key with a run that no slice is in does nothing, and a click starts a run again', async () => {
  const s = await open();
  s.openPanel();
  s.type('slice:strategy');
  s.focusOn(button());
  s.key(']');
  assert.strictEqual(s.box(), 'slice:strategy');
  s.click('goal');
  assert.strictEqual(s.box(), 'slice:goal');
});

test('the keys write the box with a reason of their own, and the box\'s address follows', async () => {
  const s = await open();
  s.focusOn(button());
  s.key('[');
  assert.ok(s.page.input.writes.includes('slice:..1'));
});

// --- the chip ---------------------------------------------------------------------------------------

test('with the panel closed, the chip counts a run, and its name says it', async () => {
  const s = await open();
  assert.strictEqual(s.chip().hidden, true);
  s.type('slice:goal..epic');
  assert.deepStrictEqual(s.chip(), { hidden: false, text: '1', name: '1 on: slice goal..epic' });
  s.type('');
  assert.strictEqual(s.chip().hidden, true);
});

test('the chip counts a run and a pill, each once', async () => {
  const s = await open();
  s.page.run("applyPillGesture('toggle', 'blocked')");
  assert.deepStrictEqual(s.chip(), { hidden: false, text: '1', name: '1 on: blocked' });
  s.type('blocked: slice:..epic');
  s.page.run('renderBoard()');
  assert.strictEqual(s.chip().text, '2');
  assert.strictEqual(s.chip().name, '2 on: blocked, slice ..epic');
});

test('a term that cuts nothing is not counted: a single unknown name, and every slice', async () => {
  const s = await open();
  s.type('slice:nosuch');
  assert.strictEqual(s.chip().hidden, true);
  s.type('slice:..');
  assert.strictEqual(s.chip().hidden, true);
  s.type('tags:ui | slice:goal');
  assert.strictEqual(s.chip().hidden, true, 'a slice: term that is one alternative among others is not the run');
});

test('a run that leaves no slice is counted: it hides every card', async () => {
  const s = await open();
  s.type('slice:strategy');
  assert.strictEqual(s.chip().text, '1');
});

test('with the panel open the chip is hidden, as for the pills', async () => {
  const s = await open();
  s.type('slice:goal');
  s.openPanel();
  assert.strictEqual(s.chip().hidden, true);
  s.page.run('setSearchPanelOpen(false)');
  assert.strictEqual(s.chip().hidden, false);
});

// --- the fold ---------------------------------------------------------------------------------------

test('the section starts folded, and "slice section starts folded" in the preferences is on', async () => {
  const s = await open({ stored: {} });
  s.openPanel();
  assert.strictEqual(s.page.run('currentSlicesFolded()'), true);
  assert.strictEqual(s.page.run('loadPrefsState().slicesFolded'), true);
  assert.strictEqual(s.slices.classList.contains('hidden'), true);
  assert.strictEqual(s.elements['#search-slices-fold'].attrs['aria-expanded'], 'false');
});

test('the fold control unfolds and folds the section for the visit, and says so, without changing the preference', async () => {
  const s = await open({ stored: {} });
  s.openPanel();
  s.page.run('toggleSearchSlicesFold()');
  assert.strictEqual(s.page.run('currentSlicesFolded()'), false);
  assert.strictEqual(s.slices.classList.contains('hidden'), false);
  assert.strictEqual(s.elements['#search-slices-fold'].attrs['aria-expanded'], 'true');
  assert.strictEqual(s.page.run('loadPrefsState().slicesFolded'), true);
  s.page.run('toggleSearchSlicesFold()');
  assert.strictEqual(s.slices.classList.contains('hidden'), true);
});

test('the fold control is wired to the section', async () => {
  const s = await open({ stored: {} });
  s.elements['#search-slices-fold'].fire('click', {});
  assert.strictEqual(s.page.run('currentSlicesFolded()'), false);
});

test('setting "starts unfolded" unfolds the section now, is kept per board, and the next visit starts unfolded', async () => {
  const s = await open({ stored: {} });
  s.openPanel();
  s.page.run('setSlicesFolded(false)');
  assert.strictEqual(s.page.run('currentSlicesFolded()'), false);
  assert.strictEqual(s.slices.classList.contains('hidden'), false);
  assert.strictEqual(JSON.parse(s.stored['kanban.kanban.prefs']).slicesFolded, false);
  const again = await open({ stored: s.stored });
  assert.strictEqual(again.page.run('currentSlicesFolded()'), false);
});

// --- the poll ---------------------------------------------------------------------------------------

test('a poll updates the entries where they stand: the same elements, the new count, and the one with focus is still the one with focus', async () => {
  const s = await open();
  s.openPanel();
  const before = [...s.slices.children];
  s.click('goal');
  s.focusOn(before[1]);
  s.board.active.push(card(9, { type: 'epic' }));
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.counts(), ['2', '2', '1', '1', '1']);
  assert.ok(s.slices.children.every((b, i) => b === before[i]), 'no entry was rebuilt');
  assert.strictEqual(s.page.ctx.document.activeElement, before[1]);
  assert.strictEqual(s.entry('goal').attrs['aria-pressed'], 'false');
});

test('a repaint with nothing changed writes nothing to the entries', async () => {
  const s = await open();
  s.openPanel();
  const writes = [];
  for (const b of s.slices.children) {
    const set = b.setAttribute;
    b.setAttribute = (k, v) => { writes.push(k); set(k, v); };
    for (const at of [0, 1, 2]) {
      const child = b.children[at];
      Object.defineProperty(child, 'textContent', { configurable: true, get: () => child.text, set: (v) => { writes.push(`text${at}`); child.text = String(v); } });
    }
  }
  s.page.run('renderBoard()');
  s.page.run('renderBoard()');
  assert.deepStrictEqual(writes, []);
});

test('a tier that appears joins the list in its place, a tier that is gone is taken out, and the others stay as they are', async () => {
  const s = await open();
  s.openPanel();
  const [goal, epic] = s.slices.children;
  s.board.active.push(card(8, { type: 'strategy' }));
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.labels(), ['goal', 'strategy', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  assert.strictEqual(s.slices.children[0], goal);
  assert.strictEqual(s.slices.children[2], epic);
  s.board.active = s.board.active.filter((c) => c.id !== 8);
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.labels(), ['goal', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  assert.strictEqual(s.slices.children[1], epic);
});

test('an entry whose slice has gone since it was drawn does nothing when it is clicked', async () => {
  const s = await open();
  s.openPanel();
  const gone = { dataset: { sliceKey: 't:nosuch' }, closest: (sel) => (sel === '.slice-entry' ? gone : null) };
  assert.doesNotThrow(() => s.slices.fire('click', { target: gone, shiftKey: false, preventDefault() {} }));
  assert.doesNotThrow(() => s.slices.fire('contextmenu', { target: gone, preventDefault() {} }));
  assert.strictEqual(s.box(), '');
});

// Moving an element that is already in the page blurs it, so an entry that stays must never
// be moved by the others leaving: the stand-in below models that, which the other fakes do not.
test('an entry that stays keeps focus when an earlier entry leaves the list, and no entry that stays is moved', async () => {
  const s = await open();
  s.openPanel();
  s.board.active.push(card(8, { type: 'strategy' }));
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.labels(), ['goal', 'strategy', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  const doc = s.page.ctx.document;
  const moved = [];
  const real = s.slices.insertBefore;
  s.slices.insertBefore = (node, ref) => {
    if (node.parent === s.slices) {
      moved.push(node);
      if (doc.activeElement === node) doc.activeElement = null;
    }
    real(node, ref);
  };
  const epic = s.entry('epic');
  s.focusOn(epic);
  s.board.active = s.board.active.filter((c) => c.id !== 8);
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.labels(), ['goal', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  assert.deepStrictEqual(moved, [], 'an entry that stays was moved');
  assert.strictEqual(doc.activeElement, epic, 'and focus is still on it');
});
