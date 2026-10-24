const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The Graph lights the selection and a typed search, in the real page (helpers/
// page-vm.js runs every script the page loads in one vm). A search typed in the
// Graph is the anchor of the selection: its matches light, nothing hides, the
// layout is not made again, and the box and the selection follow each other. The
// dots themselves are not drawn in a vm, so what is lit is read from the call
// that lights them; the browser runner looks at the dots (scenarios/graph-lights.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Cards 1 to 6 are drawn in the Graph; 7 and 8 are archived and out until the Archive pill is on.
// Card 1 is the parent of 3, and 2 waits for it, so its one-hop relations are 2 and 3.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing', tags: ['infra'] }),
    card(2, { title: 'Move the data layer', status: 'todo', tags: ['ui'], waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', status: 'todo', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes', tags: ['ui'] }),
    card(6, { title: 'Renew the domain', status: 'done', tags: ['ops'] }),
  ],
  archived: [
    card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, waiting_for: ['1'] }),
    card(8, { title: 'Close out the audit', status: 'done', archived: true, tags: ['ui'] }),
  ],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

async function open({ view = 'graph', stored = {}, board = makeBoard(), search = '' } = {}) {
  const graphHost = control();
  const elements = { '#graph-view': graphHost };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const page = await loadPage({ board, search, stored: { 'kanban.kanban.view.mode': view, ...stored }, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const calls = [];
  const sortedIds = (set) => [...set].map(Number).sort((a, b) => a - b);
  const realLightCards = page.ctx.graphLightCards;
  page.ctx.graphLightCards = (lit) => { calls.push(lit ? { nodes: sortedIds(lit.nodes), links: lit.links.size } : null); };
  const s = {
    page, board, graphHost, calls, realLightCards,
    ids: () => sortedIds(page.run('selectedIds')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    box: () => page.input.value,
    type: (text) => page.input.typed(text),
    lit: () => calls[calls.length - 1],
    drawn: () => [...page.run('graphCur.model.nodes.map((n) => Number(n.id))')].sort((x, y) => x - y),
    view: () => page.run('loadViewMode()'),
    click(id, m) { const e = nodeEvent(id, m); graphHost.fire('click', e); return e; },
    canvasClick(inside = true, m = {}) {
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '#graph-view' && inside ? {} : null) : harmless(String(key))) });
      s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...m });
    },
    canvasDoubleClick(inside = true) {
      s.canvasClick(inside, { detail: 1 });
      s.canvasClick(inside, { detail: 2 });
    },
    esc: (inBox = false) => {
      page.ctx.document.activeElement = inBox ? page.input : null;
      if (inBox) page.input.fire('keydown', { key: 'Escape', stopPropagation() {} });
      return page.fireDocument('keydown', { key: 'Escape' });
    },
    rest: () => { calls.length = 0; page.run('graphRestFocus()'); return s.lit(); },
  };
  return s;
}

function nodeEvent(id, m = {}) {
  const node = { dataset: { id: String(id) } };
  const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-node' ? node : null) : harmless(String(key))) });
  return { target, stopPropagation() {}, preventDefault() {}, key: m.key, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m };
}

const typed = (text) => ({ kind: 'query', text, source: 'typing' });
const a = (id) => ({ kind: 'card', id: String(id) });

// --- typing in the Graph --------------------------------------------------------------

test('a query typed in the Graph is the anchor of the selection, and its matches are the selected cards', async () => {
  const s = await open();
  s.type('zephyr');
  assert.deepStrictEqual(s.selection(), { anchor: typed('zephyr'), additions: [] });
  assert.deepStrictEqual(s.ids(), [1], 'card 7 matches too, but it is archived and the Graph does not draw it');
});

test('a query typed in the Graph hides no card: the Graph draws what it drew before the query', async () => {
  const s = await open();
  const before = s.drawn();
  s.type('zephyr');
  assert.deepStrictEqual(s.drawn(), before);
  s.type('nothing-matches-this');
  assert.deepStrictEqual(s.drawn(), before);
});

test('it lights its matches, a done card included, and nothing else', async () => {
  const s = await open();
  s.type('tags:ui');
  assert.deepStrictEqual(s.lit().nodes, [2, 5]);
  s.type('renew');
  assert.deepStrictEqual(s.lit().nodes, [6], 'card 6 is done');
});

test('a query that matches one card lights that card alone, without its relations', async () => {
  const s = await open();
  s.type('zephyr');
  assert.deepStrictEqual(s.lit(), { nodes: [1], links: 0 }, 'card 1 has relations with 2 and 3, and they stay dim');
});

test('a query that matches nothing lights nothing and dims nothing', async () => {
  const s = await open();
  s.type('nothing-matches-this');
  assert.strictEqual(s.lit(), null);
  assert.deepStrictEqual(s.selection(), { anchor: typed('nothing-matches-this'), additions: [] }, 'it is still the anchor');
});

test('typing does not make the layout again: the Graph draws the same cards, so the layout is the one it has', async () => {
  const s = await open();
  let made = 0;
  const real = s.page.ctx.graphLayoutHierarchy;
  s.page.ctx.graphLayoutHierarchy = (...args) => { made++; return real(...args); };
  for (const text of ['z', 'ze', 'zep', 'zephyr', 'tags:ui', 'renew', '']) s.type(text);
  assert.strictEqual(made, 0);
});

test('a status pill still hides the cards it hides, so a done match is not lit with the Done pill off', async () => {
  const s = await open();
  s.type('renew');
  assert.deepStrictEqual(s.ids(), [6]);
  s.page.run("graphToggleFilter('done')");
  assert.deepStrictEqual(s.ids(), []);
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5]);
  assert.strictEqual(s.lit(), null);
});

test('typing the first character, a second and the last backspace all reach the selection', async () => {
  const s = await open();
  s.type('z');
  assert.deepStrictEqual(s.selection().anchor, typed('z'));
  s.type('zephyr');
  assert.deepStrictEqual(s.selection().anchor, typed('zephyr'), 'the text follows the box');
  s.type('');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.lit(), null);
});

test('typing while a card is selected makes the text a new anchor and drops the card', async () => {
  const s = await open();
  s.click(2);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
  s.type('zephyr');
  assert.deepStrictEqual(s.selection(), { anchor: typed('zephyr'), additions: [] });
});

test('a ?q= link opened in the Graph is a typed query, and lights', async () => {
  const s = await open({ view: 'board', search: '?view=graph&q=tags%3Aui' });
  assert.strictEqual(s.view(), 'graph');
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [] });
  assert.deepStrictEqual(s.rest().nodes, [2, 5]);
});

test('a poll keeps the query as the anchor and lights a card that comes to match', async () => {
  const s = await open();
  s.type('zephyr');
  s.board.active.push(card(9, { title: 'More zephyr work' }));
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.ids(), [1, 9]);
  assert.deepStrictEqual(s.rest().nodes, [1, 9]);
  assert.deepStrictEqual(s.selection().anchor, typed('zephyr'));
});

// --- a slice: term typed in the Graph -------------------------------------------------
// The one thing a query typed in the Graph hides: the cards outside the cut of a
// slice: term that stands on its own. Card 1 is the goal and card 3, its child,
// the strategy; every other card has no tier. So slice:goal..strategy is cards 1
// and 3, the board's own hierarchy being what the page hands the search.

const tiered = () => {
  const board = makeBoard();
  board.hierarchy = ['goal', 'strategy'];
  board.active[0].type = 'goal';
  board.active[2].type = 'strategy';
  return board;
};

test('a slice: term typed in the Graph hides the cards outside its cut, and lights nothing when it is the whole query', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy');
  assert.deepStrictEqual(s.drawn(), [1, 3]);
  assert.strictEqual(s.lit(), null, 'nothing is left in the query to light');
  assert.deepStrictEqual(s.ids(), [], 'the cut is not a selection');
  s.type('');
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5, 6], 'clearing the box brings every card back');
});

test('the rest of the query lights inside the cut, and the selection reaches only those cards', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy zephyr');
  assert.deepStrictEqual(s.drawn(), [1, 3]);
  assert.deepStrictEqual(s.lit().nodes, [1]);
  assert.deepStrictEqual(s.ids(), [1]);
  s.type('slice:goal..strategy tags:ui');
  assert.deepStrictEqual(s.drawn(), [1, 3], 'cards 2 and 5 match tags:ui and sit outside the cut');
  assert.deepStrictEqual(s.ids(), []);
  assert.strictEqual(s.lit(), null, 'nothing inside the cut matches, so nothing lights and nothing dims');
});

test('a slice: term under | hides nothing in the Graph: it lights its cards with the rest of the query', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy | tags:ui');
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(s.lit().nodes, [1, 2, 3, 5]);
  assert.deepStrictEqual(s.ids(), [1, 2, 3, 5]);
});

test('the cut keeps cutting with the Archive pill on, and a card outside it is not selectable', async () => {
  const s = await open({ board: tiered(), stored: { 'kanban.kanban.graph.statusFilter': JSON.stringify({ archive: true }) } });
  s.type('slice:goal..strategy');
  assert.deepStrictEqual(s.drawn(), [1, 3]);
  s.type('slice:0 tags:ui');
  assert.deepStrictEqual(s.drawn(), [2, 4, 5, 6, 7, 8], 'the untiered cards, the archived ones too');
  assert.deepStrictEqual(s.ids(), [2, 5, 8]);
});

// --- the decision is what lights ------------------------------------------------------

test('the typed anchor lights what the Graph\'s query decision says the query lights', async () => {
  const s = await open();
  s.page.ctx.graphQueryEffect = () => ({ visibleIds: null, litIds: new Set(['2', '4']) });
  s.type('zephyr');
  assert.deepStrictEqual(s.ids(), [2, 4]);
  assert.deepStrictEqual(s.lit().nodes, [2, 4]);
});

test('the Graph draws the cards the decision leaves visible', async () => {
  const s = await open();
  s.page.ctx.graphQueryEffect = () => ({ visibleIds: new Set(['1', '2']), litIds: new Set(['1']) });
  s.type('zephyr');
  assert.deepStrictEqual(s.drawn(), [1, 2]);
  assert.deepStrictEqual(s.ids(), [1]);
  s.page.ctx.graphQueryEffect = () => ({ visibleIds: new Set(['2']), litIds: new Set(['1']) });
  s.type('zephyr!');
  assert.deepStrictEqual(s.ids(), [], 'a card the Graph does not draw is not selected');
});

test('outside the Graph the decision is not asked, and a query part resolves through the search module', async () => {
  const s = await open({ view: 'board' });
  s.page.ctx.graphQueryEffect = () => { throw new Error('the Graph\'s decision is for the Graph'); };
  s.type('tags:ui');
  s.page.run("setSelection(setAnchor(NO_SELECTION, queryPart('tags:ui')), null)");
  assert.deepStrictEqual(s.ids(), [2, 5]);
});

// --- a click --------------------------------------------------------------------------

test('a click on a lone card lights it with its one-hop relations, selects only it, and does not select the relations', async () => {
  const s = await open();
  s.click(1);
  assert.deepStrictEqual(s.ids(), [1], 'only the card is selected');
  assert.deepStrictEqual(s.lit().nodes, [1, 2, 3], 'its relations light');
});

test('a click on a card after a typed query shows the card in the box and lights only that card and its relations', async () => {
  const s = await open();
  s.type('tags:ui');
  s.click(1);
  assert.strictEqual(s.box(), '#1');
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] });
  assert.deepStrictEqual(s.ids(), [1]);
  assert.deepStrictEqual(s.rest().nodes, [1, 2, 3]);
});

test('Shift+click on an unlit card adds it: the box shows the query and the card, the query stays the typed anchor, and the matches and the card light', async () => {
  const s = await open();
  s.type('tags:ui');
  s.click(4, { shiftKey: true });
  assert.strictEqual(s.box(), 'tags:ui | #4');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [a(4)] });
  assert.deepStrictEqual(s.ids(), [2, 4, 5]);
  assert.deepStrictEqual(s.lit().nodes, [2, 4, 5]);
});

test('Ctrl+click works as Shift+click does', async () => {
  const s = await open();
  s.type('tags:ui');
  s.click(4, { ctrlKey: true });
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [a(4)] });
  assert.strictEqual(s.box(), 'tags:ui | #4');
});

test('Shift+click on a card the query lit takes it out and turns the query into its other cards; the box then names them', async () => {
  const s = await open();
  s.type('tags:ui');
  s.click(5, { shiftKey: true });
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(8)] }, 'the query matched 2, 5 and the archived 8');
  assert.strictEqual(s.box(), '#2 | #8');
  assert.deepStrictEqual(s.ids(), [2]);
  assert.deepStrictEqual(s.rest().nodes, [2]);
});

test('Shift+click on the one card a query matched leaves nothing selected and clears the box', async () => {
  const s = await open();
  s.type('renew');
  s.click(6, { shiftKey: true });
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.rest(), null);
});

test('a click with the box empty paints in place, without a rebuild of the Graph', async () => {
  const s = await open();
  let rebuilt = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...args) => { rebuilt++; return real(...args); };
  s.click(1);
  s.click(2, { shiftKey: true });
  assert.strictEqual(rebuilt, 0);
});

test('a click that rewrites the box paints in place too, so the card under the pointer is not replaced and a double click still reaches it', async () => {
  const s = await open();
  let rebuilt = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...args) => { rebuilt++; return real(...args); };
  s.type('tags:ui');
  rebuilt = 0;
  s.click(1);
  assert.strictEqual(s.box(), '#1');
  assert.strictEqual(rebuilt, 0, 'a plain click on a card');
  s.type('tags:ui');
  rebuilt = 0;
  s.click(5, { shiftKey: true });
  assert.strictEqual(s.box(), '#2 | #8', 'the query was turned into its cards');
  assert.strictEqual(rebuilt, 0, 'Shift+click on a card the query lit');
});

test('the click that writes the box is a write to it like any other: the address follows, and the writer is told why', async () => {
  const s = await open();
  const told = [];
  s.page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  s.type('tags:ui');
  told.length = 0;
  s.click(1);
  assert.deepStrictEqual(told, [['#1', 'mirror']]);
  assert.strictEqual(s.page.run('isolateNow()'), null, 'and the write turns isolate on for no one');
});

test('Ctrl+Space on a focused card acts as a plain click, and so shows the card in the box too', async () => {
  const s = await open();
  s.type('tags:ui');
  s.graphHost.fire('keydown', nodeEvent(1, { key: ' ', ctrlKey: true }));
  assert.strictEqual(s.box(), '#1');
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] });
});

// --- dropping the anchor --------------------------------------------------------------

test('clearing the box with its button drops the anchor and the dimming', async () => {
  const s = await open();
  s.type('zephyr');
  s.page.clear.fire('click', {});
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.lit(), null);
});

test('clearing the box drops the additions with the query', async () => {
  const s = await open();
  s.type('zephyr');
  s.click(4, { shiftKey: true });
  s.page.clear.fire('click', {});
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.ids(), []);
});

test('Esc with a typed query as the only part clears the box and the dimming, with focus in the box or outside it', async () => {
  for (const focus of [true, false]) {
    const s = await open();
    s.type('tags:ui');
    s.esc(focus);
    assert.strictEqual(s.box(), '', `focus in the box: ${focus}`);
    assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
    assert.strictEqual(s.lit(), null);
  }
});

test('Esc outside the box steps back one stage at a time: the additions first, then the typed anchor and the box with it', async () => {
  const s = await open();
  s.type('tags:ui');
  s.click(4, { shiftKey: true });
  s.esc();
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [] });
  s.esc();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.lit(), null);
});

test('a click on the empty canvas leaves a query lit, with its box and its selection', async () => {
  const s = await open();
  s.type('tags:ui');
  s.canvasClick();
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [] });
  assert.deepStrictEqual(s.lit().nodes, [2, 5]);
});

test('a double click on the empty canvas with a query lit clears the box, the selection and the dimming', async () => {
  const s = await open();
  s.type('tags:ui');
  s.canvasDoubleClick();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.lit(), null);
});

test('a double click on the empty canvas clears a query that matches nothing too', async () => {
  const s = await open();
  s.type('nothing-matches-this');
  s.canvasDoubleClick();
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('a double click outside the Graph leaves the typed query where it is, so a double click in the box or on the header does not wipe it', async () => {
  const s = await open();
  s.type('tags:ui');
  s.canvasDoubleClick(false);
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [] });
});

test('a click on a control that keeps the selection leaves the typed query where it is', async () => {
  const s = await open();
  s.type('tags:ui');
  const marked = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '[data-keeps-selection]' ? {} : null) : harmless(String(key))) });
  s.page.fireDocument('click', { target: marked, detail: 2, shiftKey: false, ctrlKey: false, metaKey: false });
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection().anchor, typed('tags:ui'));
});

test('a double click on the empty canvas with a selection carried in clears the selection, and the box that said it goes with it', async () => {
  const s = await open({ view: 'board' });
  s.type('tags:ui');
  s.page.run("setSelection(addPart(NO_SELECTION, cardPart(5)), 5)");
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.box(), '#5', 'the switch put the picked card in the box, though the box was not its text');
  s.canvasDoubleClick();
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '');
});

// --- the hover ------------------------------------------------------------------------

test('hovering a dot lights its relations for a moment, and moving off brings back the lit query', async () => {
  const s = await open();
  s.type('tags:ui');
  assert.deepStrictEqual(s.lit().nodes, [2, 5]);
  s.graphHost.fire('mouseover', nodeEvent(1));
  assert.deepStrictEqual(s.lit().nodes, [1, 2, 3], 'card 1 and its relations');
  s.graphHost.fire('mouseout', Object.assign(nodeEvent(1), { relatedTarget: null }));
  assert.deepStrictEqual(s.lit().nodes, [2, 5], 'the query lights again');
});

test('hovering a dot while a lone card is selected shows that dot\'s relations, and moving off shows the card\'s again', async () => {
  const s = await open();
  s.click(5);
  assert.deepStrictEqual(s.lit().nodes, [5]);
  s.graphHost.fire('mouseover', nodeEvent(1));
  assert.deepStrictEqual(s.lit().nodes, [1, 2, 3]);
  s.graphHost.fire('mouseout', Object.assign(nodeEvent(1), { relatedTarget: null }));
  assert.deepStrictEqual(s.lit().nodes, [5]);
});

// --- the hover on a line ----------------------------------------------------------------
// The pointer on a line's hit stroke lights the line and the cards at its ends, a card under the
// pointer wins, and leaving the line brings back what was lit before it (graph-line-hover.test.js
// has the strokes and the drawing; the browser runner hovers the real lines).

const lineEvent = (i, type, related = null) => {
  const hit = { dataset: { link: String(i) } };
  const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-link-hit' ? hit : null) : harmless(String(key))) });
  return { type, target, relatedTarget: related, stopPropagation() {}, preventDefault() {} };
};
const relatedLine = (i) => lineEvent(i, 'mouseover').target;
const relatedNode = (id) => nodeEvent(id).target;

// Card 1 holds 3, 9 and 10, which stand on one ring: a bracket. Card 2 waits for card 1.
const withBracket = () => {
  const board = makeBoard();
  board.active.push(card(9, { parent: 1 }), card(10, { parent: 1 }));
  return board;
};
const lineAt = (s, test) => s.page.run('graphCur.plan.links').findIndex(test);

test('hovering a dependency line lights it and its two cards, and moving off brings back the lit query', async () => {
  const s = await open({ board: withBracket() });
  s.type('tags:ui');
  assert.deepStrictEqual(s.lit().nodes, [2, 5]);
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover', relatedNode(5)));
  assert.deepStrictEqual(s.lit(), { nodes: [1, 2], links: 1 });
  s.graphHost.fire('mouseout', lineEvent(wait, 'mouseout', null));
  assert.deepStrictEqual(s.lit().nodes, [2, 5], 'the query lights again');
});

test('hovering a bracket lights its parent and every child it holds, and a parent line its parent and child', async () => {
  const s = await open({ board: withBracket() });
  const bracket = lineAt(s, (l) => l.count !== undefined);
  assert.ok(bracket >= 0);
  s.graphHost.fire('mouseover', lineEvent(bracket, 'mouseover'));
  assert.deepStrictEqual(s.lit(), { nodes: [1, 3, 9, 10], links: 1 });
});

test('a line on its own parent and child: a plain parent line lights those two cards', async () => {
  const s = await open();
  const parent = lineAt(s, (l) => l.kind === 'parent');
  assert.ok(parent >= 0);
  s.graphHost.fire('mouseover', lineEvent(parent, 'mouseover'));
  assert.deepStrictEqual(s.lit(), { nodes: [1, 3], links: 1 });
});

test('moving from a line onto a card leaves the card\'s hover to light, and from a card onto a line lights the line', async () => {
  const s = await open();
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  const calls = s.calls.length;
  s.graphHost.fire('mouseout', lineEvent(wait, 'mouseout', relatedNode(1)));
  assert.strictEqual(s.calls.length, calls, 'leaving a line for a card lights nothing by itself');
  s.graphHost.fire('mouseover', Object.assign(nodeEvent(1), { type: 'mouseover' }));
  assert.deepStrictEqual(s.lit().nodes, [1, 2, 3], 'the card\'s own hover');
  s.graphHost.fire('mouseout', Object.assign(nodeEvent(1), { relatedTarget: null }));
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  assert.deepStrictEqual(s.lit().nodes, [1, 2], 'the line');
});

test('moving from one line onto another lights the second, and a click on a line does nothing', async () => {
  const s = await open({ board: withBracket() });
  const wait = lineAt(s, (l) => l.kind === 'wait');
  const bracket = lineAt(s, (l) => l.count !== undefined);
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  s.graphHost.fire('mouseout', lineEvent(wait, 'mouseout', relatedLine(bracket)));
  s.graphHost.fire('mouseover', lineEvent(bracket, 'mouseover', relatedLine(wait)));
  assert.deepStrictEqual(s.lit().nodes, [1, 3, 9, 10]);
  const e = lineEvent(bracket, 'click');
  s.graphHost.fire('click', e);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'nothing is selected');
});

test('leaving a line while a lone card is selected brings back the card\'s lighting', async () => {
  const s = await open();
  s.click(4);
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  assert.deepStrictEqual(s.lit().nodes, [1, 2]);
  s.graphHost.fire('mouseout', lineEvent(wait, 'mouseout', null));
  assert.deepStrictEqual(s.lit().nodes, [4]);
});

test('a keyboard focus on a line is not a thing: the focus events never light one', async () => {
  const s = await open();
  const wait = lineAt(s, (l) => l.kind === 'wait');
  const before = s.calls.length;
  s.graphHost.fire('focusin', lineEvent(wait, 'focusin'));
  assert.strictEqual(s.calls.length, before);
});

// Space on a hovered line writes the cards the line lights into the box as card terms (the 'hover' write of
// hover-show-ui.js), and Shift+Space adds them.
const spaceKey = (s, over = {}) => {
  let prevented = 0;
  s.page.fireDocument('keydown', {
    key: ' ', target: { closest: () => null }, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { prevented++; }, ...over,
  });
  return prevented;
};

test('Space on a hovered bracket, parent line and dependency line writes the cards it lights, parent first', async () => {
  const s = await open({ board: withBracket() });
  const told = [];
  s.page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  const bracket = lineAt(s, (l) => l.count !== undefined);
  s.graphHost.fire('mouseover', lineEvent(bracket, 'mouseover'));
  assert.strictEqual(spaceKey(s), 1, 'the key is taken');
  const kids = s.page.run('graphCur.plan.links').find((l) => l.count !== undefined).kids;
  assert.strictEqual(s.box(), ['#1', ...kids.map((id) => `#${id}`)].join(' | '));
  assert.strictEqual(kids.length, 3);
  assert.deepStrictEqual(told[told.length - 1][1], 'hover');
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseout', lineEvent(bracket, 'mouseout', relatedLine(wait)));
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover', relatedLine(bracket)));
  spaceKey(s);
  assert.strictEqual(s.box(), '#1 | #2', 'the card waited for, then the card that waits');
});

test('a parent line writes its parent and its child', async () => {
  const s = await open();
  const parent = lineAt(s, (l) => l.kind === 'parent');
  s.graphHost.fire('mouseover', lineEvent(parent, 'mouseover'));
  spaceKey(s);
  assert.strictEqual(s.box(), '#1 | #3');
});

test('Shift+Space on a hovered line adds its cards to what the box holds as more alternatives', async () => {
  const s = await open();
  s.type('tags:ui');
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  assert.strictEqual(spaceKey(s, { shiftKey: true }), 1);
  assert.strictEqual(s.box(), 'tags:ui | #1 | #2');
});

test('a line writes its cards whatever sets On hover show ticks, even none', async () => {
  const s = await open({ stored: { 'kanban.kanban.hover.show': JSON.stringify({ hierarchy: [], flow: [] }) } });
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  assert.strictEqual(spaceKey(s), 1);
  assert.strictEqual(s.box(), '#1 | #2');
});

test('with no line under the pointer, or after it left, Space does nothing new and is not taken', async () => {
  const s = await open();
  assert.strictEqual(spaceKey(s), 0);
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  s.graphHost.fire('mouseout', lineEvent(wait, 'mouseout', null));
  assert.strictEqual(spaceKey(s), 0);
  assert.strictEqual(s.box(), '');
});

test('a poll that draws the Graph again drops the line hover, so Space then does nothing', async () => {
  const s = await open();
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  await s.page.run('autoRefreshTick()');
  assert.strictEqual(spaceKey(s), 0);
  assert.strictEqual(s.box(), '');
});

test('a card with the focus wins over a hovered line, and the key guard still holds', async () => {
  const s = await open();
  const wait = lineAt(s, (l) => l.kind === 'wait');
  s.graphHost.fire('mouseover', lineEvent(wait, 'mouseover'));
  s.page.ctx.document.activeElement = { tagName: 'DIV', closest: (sel) => (sel === '.card-el' ? { dataset: { id: '3' } } : null) };
  assert.strictEqual(spaceKey(s), 1);
  assert.strictEqual(s.box(), 'dlinks:3 | hlinks:3', 'the focused card\'s sets, not the line\'s cards');
  s.page.ctx.document.activeElement = null;
  assert.strictEqual(spaceKey(s, { target: { closest: (sel) => (sel.includes('button') ? {} : null) } }), 0, 'on a button Space presses it');
  assert.strictEqual(spaceKey(s, { ctrlKey: true }), 0);
});

// --- leaving the Graph ----------------------------------------------------------

const BOARD_LIGHTS = { 'kanban.kanban.typing.isolates': JSON.stringify({ board: false }) };

test('a query typed in the Graph stops being the anchor on the Board: where typing lights, the Board lights its matches and hides nothing, nothing is selected and there are no bulk targets', async () => {
  const s = await open({ stored: BOARD_LIGHTS });
  s.type('tags:ui');
  assert.deepStrictEqual(s.ids(), [2, 5]);
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.view(), 'board');
  assert.strictEqual(s.box(), 'tags:ui', 'the box keeps its text');
  assert.strictEqual(s.page.run('isolateNow()'), null, 'and going to the Board turns nothing on');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.ids(), []);
  assert.deepStrictEqual([...s.page.run('bulkTargets().map((c) => c.id)')], []);
  assert.strictEqual(s.page.run('currentSearchMatch().ids'), null, 'with isolate off the box hides no card on the Board');
  assert.deepStrictEqual([...s.page.run('currentSearchMatch().matched')].map(Number).sort((x, y) => x - y), [2, 5, 8]);
  assert.deepStrictEqual([...s.page.run('boxLitIds')].map(Number).sort((x, y) => x - y), [2, 5, 8], 'it lights its matches');
});

test('a query typed in the Graph filters a Board whose Typing isolates is on, and ends again in the Graph', async () => {
  const s = await open();
  s.type('tags:ui');
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.view(), 'board');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'it is still no selection');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.page.run('isolateNow()'))), { previous: 'tags:ui', following: true });
  assert.deepStrictEqual([...s.page.run('currentSearchMatch().ids')].map(Number).sort((x, y) => x - y), [2, 5, 8], 'the Board hides what the box does not match');
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.page.run('isolateNow()'), null);
  assert.deepStrictEqual(s.selection().anchor, typed('tags:ui'));
});

test('the same on every view the Graph can be left for', async () => {
  for (const to of ['map', 'calendar', 'gantt']) {
    const s = await open();
    s.type('tags:ui');
    s.page.run(`toggleView('${to}')`);
    assert.strictEqual(s.view(), to);
    assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, to);
    assert.deepStrictEqual(s.ids(), [], to);
    assert.strictEqual(s.box(), 'tags:ui', to);
  }
});

test('back in the Graph with the box unchanged and nothing selected, the matches light again', async () => {
  const s = await open();
  s.type('tags:ui');
  s.page.run("toggleView('graph')");
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.view(), 'graph');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [] });
  assert.deepStrictEqual(s.ids(), [2, 5]);
  assert.deepStrictEqual(s.rest().nodes, [2, 5]);
});

test('a selection carried into the Graph stays, and the box has no effect there until it is edited', async () => {
  const s = await open({ view: 'board' });
  s.type('tags:ui');
  s.page.run("setSelection(addPart(NO_SELECTION, cardPart(5)), 5)");
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.view(), 'graph');
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
  assert.deepStrictEqual(s.ids(), [5]);
  assert.deepStrictEqual(s.rest().nodes, [5], 'the box lights nothing');
  s.type('tags:uix');
  s.type('tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: typed('tags:ui'), additions: [] }, 'edited, the box is the anchor');
  assert.deepStrictEqual(s.ids(), [2, 5]);
});

test('cards added to a typed query by hand stay selected when the Graph is left, and the first of them is the anchor', async () => {
  const s = await open();
  s.type('tags:ui');
  s.click(4, { shiftKey: true });
  s.page.run("toggleView('graph')");
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [] });
  assert.deepStrictEqual(s.ids(), [4], 'the Board hides nothing with isolate off, so card 4 is in the id set');
  s.type('');
  assert.deepStrictEqual(s.ids(), [4]);
});

test('typing outside the Graph never selects anything', async () => {
  for (const view of ['board', 'map', 'calendar', 'gantt']) {
    const s = await open({ view });
    s.type('tags:ui');
    assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, view);
    assert.deepStrictEqual(s.ids(), [], view);
    s.type('');
    assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, view);
  }
});

test('a selection built outside the Graph is not touched by typing there', async () => {
  const s = await open({ view: 'board' });
  s.page.run("setSelection(addPart(addPart(NO_SELECTION, cardPart(2)), cardPart(5)), 5)");
  s.type('ui');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
});

// --- the lighting is one mechanism ----------------------------------------------------

function fakeGraph(page) {
  const el = () => {
    const names = new Set();
    return { names, classList: { add: (c) => names.add(c), remove: (c) => names.delete(c), contains: (c) => names.has(c), toggle: (c, force) => { if (force) names.add(c); else names.delete(c); } } };
  };
  const nodes = new Map(['1', '2', '3', '4', '5', '6'].map((id) => [id, el()]));
  const model = page.run('graphBuild(state.active, { ctx: nestingCtx() })');
  const links = model.links.map(() => el());
  const svg = el();
  const heads = new Map([['1', [el()]]]);
  svg.querySelectorAll = () => [...nodes.values(), ...[...heads.values()].flat(), ...links].filter((e) => e.names.has('graph-near'));
  page.ctx.__fake = { svg, nodeEls: nodes, headEls: heads, linkEls: links, model };
  page.run('graphCur = __fake');
  return { svg, nodes, links, model, heads };
}

test('a lighting dims the canvas and marks exactly its cards and the lines between them, and the next lighting replaces it', async () => {
  const s = await open();
  s.page.ctx.graphLightCards = s.realLightCards;
  const f = fakeGraph(s.page);
  const lit = () => [...f.nodes].filter(([, e]) => e.names.has('graph-near')).map(([id]) => Number(id));
  s.page.ctx.__lit = s.page.run("graphLit(__fake.model, new Set(['1', '2']))");
  s.page.run('graphLightCards(__lit)');
  assert.strictEqual(f.svg.names.has('graph-dim'), true);
  assert.deepStrictEqual(lit(), [1, 2]);
  assert.strictEqual(f.links.filter((e) => e.names.has('graph-near')).length, 1, 'the one line between 1 and 2');
  assert.strictEqual(f.heads.get('1')[0].names.has('graph-near'), true, 'the header of a lit card is lit with its dot');
  s.page.ctx.__lit = s.page.run("graphLit(__fake.model, new Set(['5']))");
  s.page.run('graphLightCards(__lit)');
  assert.deepStrictEqual(lit(), [5], 'the first set is gone');
  assert.strictEqual(f.heads.get('1')[0].names.has('graph-near'), false, 'and so is the header of a card no longer lit');
  assert.strictEqual(f.links.filter((e) => e.names.has('graph-near')).length, 0);
  s.page.run('graphLightCards(null)');
  assert.strictEqual(f.svg.names.has('graph-dim'), false, 'nothing to light dims nothing');
  assert.deepStrictEqual(lit(), []);
});

test('there is one dimming mechanism: the hover, the lone card and the selection all go through the same lighting', async () => {
  const s = await open();
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'graph-view.js'), 'utf8');
  const body = (name) => (src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
  for (const name of ['graphSetFocus', 'graphRestFocus']) assert.match(body(name), /graphLightCards\(/, name);
  assert.strictEqual((src.match(/classList\.add\('graph-dim'\)/g) || []).length, 1, 'graph-dim is set in one place');
  assert.strictEqual((src.match(/classList\.add\('graph-near'\)/g) || []).length, 2, 'graph-near is set for a node and for a line, both in the one function');
  assert.ok(!/graph-lit|graph-query|graph-match/.test(src), 'no second class for a second mechanism');
  assert.ok(s.page.run('typeof graphLightCards') === 'function');
});

// --- a cut is no search: a gesture that clears the box leaves it ----------------------
// A run of slices in the box (typed, or written by the slice section and the [ ] { } keys)
// is a cut of the view, not the anchor of a selection. A click that selects writes the selection over
// the typed query and leaves the cut, so the Graph keeps drawing what the box says.

test('a plain click on a card replaces the typed query with the card and leaves the cut: the box, the chip and the drawing agree', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy zephyr');
  assert.deepStrictEqual(s.drawn(), [1, 3]);
  s.click(3);
  assert.strictEqual(s.box(), '#3 slice:goal..strategy');
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [] });
  assert.deepStrictEqual(s.drawn(), [1, 3], 'the cut still hides the cards outside it');
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.drawn(), [1, 3], 'and a repaint draws the same cards the click left');
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.drawn(), [1, 3], 'and so does the poll');
});

test('a plain click with a cut alone in the box writes the card beside it', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy');
  const told = [];
  s.page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  s.click(1);
  assert.strictEqual(s.box(), '#1 slice:goal..strategy');
  assert.deepStrictEqual(told, [['#1 slice:goal..strategy', 'mirror']]);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] });
  assert.deepStrictEqual(s.drawn(), [1, 3]);
});

test('a click paints in place with a cut in the box too, so a double click still reaches the card', async () => {
  const s = await open({ board: tiered() });
  let rebuilt = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...args) => { rebuilt++; return real(...args); };
  s.type('slice:goal..strategy zephyr');
  rebuilt = 0;
  s.click(3);
  assert.strictEqual(rebuilt, 0);
});

test('Shift+click that takes out the card the typed query lit clears the query and leaves the cut', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy zephyr');
  assert.deepStrictEqual(s.ids(), [1]);
  s.click(1, { shiftKey: true });
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), 'slice:goal..strategy');
  assert.deepStrictEqual(s.drawn(), [1, 3]);
});

test('Shift+click that only adds a card writes it beside the query, the cut kept after both', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy zephyr');
  s.click(3, { shiftKey: true });
  assert.strictEqual(s.box(), '(zephyr | #3) slice:goal..strategy');
});

test('a cut inside a bracket with | is part of the query and goes with it', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy | tags:ui');
  s.click(1);
  assert.strictEqual(s.box(), '#1', 'no top-level cut: the term is one alternative of the query, so none is kept');
});

test('Esc, a double click on the empty canvas and the typed anchor going away leave the cut in the box', async () => {
  for (const drop of ['esc', 'canvas']) {
    const s = await open({ board: tiered() });
    s.type('slice:goal..strategy zephyr');
    if (drop === 'esc') s.esc(); else s.canvasDoubleClick();
    assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, drop);
    assert.strictEqual(s.box(), 'slice:goal..strategy', drop);
    assert.deepStrictEqual(s.drawn(), [1, 3], drop);
  }
});

test('the box\'s own clear button and Esc inside the box still take everything, the cut too', async () => {
  const s = await open({ board: tiered() });
  s.type('slice:goal..strategy zephyr');
  s.page.clear.fire('click', {});
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5, 6]);
});
