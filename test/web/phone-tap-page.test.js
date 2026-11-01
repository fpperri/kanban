const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');

// A tap and a double tap on a card at the phone layout, run through every listener the real
// page puts on the document, the way the browser runs them: a tap toggles the card in or out of
// the selection, and the second tap of a double tap (a click with detail 2) opens the card and
// puts the selection and its range start back as they were before the first tap. The pure
// rules are selection-tap.test.js's; the desk's clicks are card-click-page.test.js's.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Dated, so the Gantt and the Calendar show every card the other views show.
const dated = { start_date: '2026-10-05', end_date: '2026-10-09' };

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [card(1, { status: 'doing', ...dated }), card(2, dated), card(3, { status: 'backlog', ...dated }), card(4, { tags: ['grill'], assignee: '@afk', ...dated })],
  archived: [],
});

function mediaStandIn(phone) {
  const state = { phone };
  return {
    matchMedia: (q) => ({ get matches() { return q === PHONE_WIDTH_QUERY && state.phone; }, addEventListener() {} }),
    cross(to) { state.phone = to; },
  };
}

async function open({ view = 'board', prefs = null, phone = true } = {}) {
  const stored = { 'kanban.kanban.view.mode': view };
  if (prefs) stored['kanban.kanban.prefs'] = JSON.stringify(prefs);
  const media = mediaStandIn(phone);
  const page = loadPage({ board: makeBoard(), stored, elements: { '#graph-view': control() } });
  page.ctx.matchMedia = media.matchMedia;
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const opened = [];
  page.ctx.openCard = (id) => { opened.push(Number(id)); };
  const state = () => JSON.parse(JSON.stringify(page.run('({ selection: selectionState.selection, rangeStart: selectionState.rangeStart })')));
  return { page, media, opened, state, selection: () => state().selection };
}

const CUES = '.card-assignee, .tag, .blocked-pill, .review-pill';

function cardTarget(id, cue = null) {
  const el = { dataset: { id: String(id) } };
  const inCard = (sel) => sel.split(',').some((part) => part.trim() === '.card-el');
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (inCard(sel) ? el : (sel === CUES ? cue : null)) : harmless(String(key))) });
}
const tap = (s, target, extra = {}) => s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });
const doubleTap = (s, id) => { tap(s, cardTarget(id), { detail: 1 }); tap(s, cardTarget(id), { detail: 2 }); };

const a = (id) => ({ kind: 'card', id: String(id) });
const VIEWS = ['board', 'map', 'gantt', 'calendar'];

test('a tap adds a card to the selection and a tap on a selected card takes it out, in every view, with the preferences left as they are', async () => {
  for (const view of VIEWS) {
    const s = await open({ view });
    tap(s, cardTarget(2));
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, `${view}: the first card is the anchor`);
    tap(s, cardTarget(3));
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3)] }, `${view}: the next card is added, not swapped in`);
    tap(s, cardTarget(1));
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3), a(1)] }, view);
    tap(s, cardTarget(3));
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(1)] }, `${view}: a tap on a selected card takes it out`);
    assert.deepStrictEqual(s.opened, [], `${view}: a tap opens nothing`);
  }
});

test('a double tap opens the card and leaves the selection and its range start as they were before the first tap', async () => {
  const s = await open();
  tap(s, cardTarget(2));
  tap(s, cardTarget(3));
  const before = s.state();
  doubleTap(s, 1);
  assert.deepStrictEqual(s.opened, [1]);
  assert.deepStrictEqual(s.state(), before, 'the card the first tap added is out again, and the range start is where it was');
});

test('a double tap on a selected card opens it and leaves it selected, and one on a card with nothing selected leaves nothing selected', async () => {
  const s = await open();
  tap(s, cardTarget(2));
  tap(s, cardTarget(3));
  doubleTap(s, 3);
  assert.deepStrictEqual(s.opened, [3]);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3)] });
  const none = await open();
  doubleTap(none, 2);
  assert.deepStrictEqual(none.opened, [2]);
  assert.deepStrictEqual(none.state(), { selection: { anchor: null, additions: [] }, rangeStart: null });
});

test('the search box follows the restore: it names the selection from before the first tap', async () => {
  const s = await open();
  tap(s, cardTarget(2));
  tap(s, cardTarget(3));
  assert.strictEqual(s.page.input.value, '#2 | #3');
  doubleTap(s, 1);
  assert.strictEqual(s.page.input.value, '#2 | #3');
  const fresh = await open();
  doubleTap(fresh, 2);
  assert.strictEqual(fresh.page.input.value, '', 'the box the first tap filled is empty again');
});

test('a third tap is a first tap again, and a second tap on another card than the first is a first tap too', async () => {
  const s = await open();
  tap(s, cardTarget(2), { detail: 1 });
  tap(s, cardTarget(2), { detail: 2 });
  tap(s, cardTarget(2), { detail: 3 });
  assert.deepStrictEqual(s.opened, [2], 'only the second tap opened it');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, 'the third tap selects it again');
  const other = await open();
  tap(other, cardTarget(2), { detail: 1 });
  tap(other, cardTarget(3), { detail: 2 });
  assert.deepStrictEqual(other.opened, []);
  assert.deepStrictEqual(other.selection(), { anchor: a(2), additions: [a(3)] });
});

// --- the first tap is remembered only while the selection is the one it made -------------------

const emptyUntil = (s) => { for (let i = 0; i < 4 && s.selection().anchor; i++) s.page.run('stepSelectionBack()'); };
const targetOver = (closest) => new Proxy({}, { get: (t, key) => (key === 'closest' ? closest : harmless(String(key))) });
const buttonTarget = (id) => {
  const el = { dataset: { id: String(id) }, closest: () => null };
  return targetOver((sel) => (sel.split(',').some((part) => ['.card-el', 'button'].includes(part.trim())) ? el : null));
};
const emptySpace = () => targetOver(() => null);
const tagCue = { classList: { contains: (c) => c === 'tag' }, textContent: 'grill' };

test('a first tap whose selection the person has since cleared is forgotten: a lone second tap on that card is a first tap, and opens nothing', async () => {
  const s = await open();
  tap(s, cardTarget(3));
  tap(s, cardTarget(2));
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [a(2)] });
  emptyUntil(s);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'Esc stepped the selection down to nothing');
  tap(s, cardTarget(2), { detail: 2 });
  assert.deepStrictEqual(s.opened, [], 'no first tap on this card is left to undo');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, 'the tap selects the card, and the cleared selection stays cleared');
  assert.strictEqual(s.page.input.value, '#2');
});

test('the same holds in the Graph: a dot tapped, the selection cleared, then a lone second tap on it selects it and opens nothing', async () => {
  const s = await open({ view: 'graph' });
  graphTap(s, 3);
  graphTap(s, 2);
  emptyUntil(s);
  graphTap(s, 2, 2);
  assert.deepStrictEqual(s.opened, []);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
});

test('a first tap on a card is forgotten by a tap on one of its cues, so the card\'s next tap is a first tap', async () => {
  const s = await open();
  tap(s, cardTarget(4));
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [] });
  tap(s, cardTarget(4, tagCue));
  const kept = s.selection();
  assert.deepStrictEqual(kept, { anchor: a(4), additions: [] }, 'the cue tap left the selection as it was');
  tap(s, cardTarget(4), { detail: 2 });
  assert.deepStrictEqual(s.opened, [], 'the tap that came after a cue has no first tap to undo');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'it toggled the card out, as a first tap does');
});

test('a first tap is forgotten by a tap on empty space or on a button, though that tap leaves the selection as it was', async () => {
  for (const [name, away] of [['empty space', emptySpace], ['a button', () => buttonTarget(3)]]) {
    const s = await open();
    tap(s, cardTarget(2));
    tap(s, cardTarget(3));
    const kept = s.selection();
    tap(s, away(), { detail: 1 });
    assert.deepStrictEqual(s.selection(), kept, `${name}: the tap changed nothing`);
    tap(s, cardTarget(3), { detail: 2 });
    assert.deepStrictEqual(s.opened, [], `${name}: the second tap has no first tap on the card to undo`);
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, `${name}: it toggled the card out as a first tap does`);
  }
});

test('a peek at the desk forgets the first tap, so crossing the width line does not bring its restore back', async () => {
  const s = await open({ prefs: { click: { board: 'selects' } }, phone: true });
  tap(s, cardTarget(3));
  s.media.cross(false);
  tap(s, cardTarget(2), { detail: 2 });
  assert.deepStrictEqual(s.opened, [2], 'the desk\'s second click is a peek');
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [] }, 'and leaves the selection as it was');
  s.media.cross(true);
  tap(s, cardTarget(3), { detail: 2 });
  assert.deepStrictEqual(s.opened, [2], 'back on the phone, the lone second tap has no first tap to undo');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'it toggled the card out, as a first tap does');
});

test('where the phone choice for a view is opens, a tap opens the card and drops the selection as a click that opens does', async () => {
  const s = await open({ view: 'map', prefs: { tap: { map: 'opens' } } });
  tap(s, cardTarget(1), { ctrlKey: true });
  tap(s, cardTarget(2));
  assert.deepStrictEqual(s.opened, [2]);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  const board = await open({ view: 'board', prefs: { tap: { map: 'opens' } } });
  tap(board, cardTarget(2));
  assert.deepStrictEqual(board.opened, [], 'a view left at selects still selects');
});

test('a browser that saved opens for every desk click gets selects on the phone, and a desk click choice of selects does not make a tap replace', async () => {
  const saved = { click: { board: 'opens', map: 'opens', gantt: 'opens', calendar: 'opens', graph: 'selects' }, archivedDone: true };
  const s = await open({ prefs: saved });
  tap(s, cardTarget(2));
  tap(s, cardTarget(3));
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3)] });
  assert.deepStrictEqual(s.opened, []);
  const desk = await open({ prefs: { click: { board: 'selects' } } });
  tap(desk, cardTarget(2));
  tap(desk, cardTarget(3));
  assert.deepStrictEqual(desk.selection(), { anchor: a(2), additions: [a(3)] });
});

test('a tap on a tag, an assignee, a blocked or a review pill still searches for it, and builds no selection', async () => {
  const cues = [['tag', 'grill', 'tags:grill'], ['card-assignee', '', 'assignee:@afk'], ['blocked-pill', '', 'blocked:'], ['review-pill', '', 'review:']];
  for (const [cls, text, term] of cues) {
    const s = await open();
    const cue = { classList: { contains: (c) => c === cls }, textContent: text };
    tap(s, cardTarget(4, cue));
    assert.strictEqual(s.page.input.value, term, cls);
    assert.deepStrictEqual(s.opened, [], cls);
    assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, cls);
  }
});

test('Enter on a focused card opens it where a tap selects, and adds nothing where a tap opens', async () => {
  const enter = (s, id) => {
    const focused = { dataset: { id: String(id) }, closest: (sel) => (sel === '.card-el' ? focused : null) };
    s.page.fireDocument('keydown', { key: 'Enter', repeat: false, target: focused, shiftKey: false, ctrlKey: false, metaKey: false });
  };
  const selects = await open();
  enter(selects, 2);
  assert.deepStrictEqual(selects.opened, [2]);
  const opens = await open({ prefs: { tap: { board: 'opens' } } });
  enter(opens, 2);
  assert.deepStrictEqual(opens.opened, []);
});

test('the layout on screen decides, in both directions: a tap toggles under the width line and a click replaces above it, and each reads only its own choices', async () => {
  const s = await open({ prefs: { click: { board: 'selects' }, tap: { board: 'selects' } }, phone: true });
  tap(s, cardTarget(2));
  tap(s, cardTarget(3));
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3)] }, 'phone: toggled');
  s.media.cross(false);
  tap(s, cardTarget(1));
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] }, 'desk with click selects: the click replaces, as it does');
  assert.deepStrictEqual(s.opened, []);
  s.media.cross(true);
  tap(s, cardTarget(4));
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(4)] }, 'back on the phone: toggled again');
});

test('at the desk width a click opens by default, the phone\'s tap choices are not read, and with click set to selects a double click is still a peek', async () => {
  const s = await open({ phone: false, prefs: { tap: { board: 'selects' } } });
  tap(s, cardTarget(1), { ctrlKey: true });
  tap(s, cardTarget(2));
  assert.deepStrictEqual(s.opened, [2], 'a click opens');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  const dbl = await open({ phone: false, prefs: { click: { board: 'selects' } } });
  tap(dbl, cardTarget(2), { detail: 1 });
  tap(dbl, cardTarget(2), { detail: 2 });
  assert.deepStrictEqual(dbl.opened, [2], 'a double click is a peek');
  assert.deepStrictEqual(dbl.selection(), { anchor: a(2), additions: [] }, 'and it leaves the selection the first click made');
});

// --- the Graph, which catches its own dot clicks ---------------------------------------------

const graphTap = (s, id, detail = 1) => s.page.run(`graphClickNode('${id}', { detail: ${detail}, shiftKey: false, ctrlKey: false, metaKey: false })`);

test('in the Graph a tap on a dot toggles the card, and a double tap opens it and puts the selection back, the dot painted in place', async () => {
  const s = await open({ view: 'graph' });
  graphTap(s, 2);
  graphTap(s, 3);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3)] });
  graphTap(s, 3);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, 'a tap on a selected dot takes it out');
  const before = s.state();
  graphTap(s, 1, 1);
  graphTap(s, 1, 2);
  assert.deepStrictEqual(s.opened, [1]);
  assert.deepStrictEqual(s.state(), before);
});

test('at the desk width a click on a Graph dot replaces the selection as it always did, and the double click is the dblclick event\'s', async () => {
  const s = await open({ view: 'graph', phone: false });
  graphTap(s, 2);
  graphTap(s, 3);
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [] });
  graphTap(s, 3, 2);
  assert.deepStrictEqual(s.opened, [], 'the click path opens nothing at the desk');
});
