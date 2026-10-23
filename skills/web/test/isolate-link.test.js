const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { attachSessionHistory } = require('./helpers/session-history');

// Isolate in the address and in the browser, in the real page (helpers/page-vm.js runs every
// script the page loads in one vm, over a session history that keeps the address and the
// entries behind Back and Forward). While isolate is on the address carries a second
// parameter beside q, written as the box changes and never as a history entry; a reload or a
// link opened elsewhere opens isolated; the text the box held before isolating is kept per
// board in the browser, so turning isolate off afterwards gives it back, and where it is
// unknown the box ends up empty. The pure parts are pinned in deep-link.test.js,
// card-history.test.js and selection-isolate.test.js; the browser runner looks at the page
// itself (scenarios/isolate-link.js).

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
    card(1, { title: 'Zephyr migration', status: 'doing', tags: ['infra'] }),
    card(2, { title: 'Move the data layer', status: 'todo', tags: ['ui'], waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', status: 'todo', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes', tags: ['ui'] }),
    card(6, { title: 'Renew the domain', status: 'done', tags: ['ops'] }),
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

// The page at `search`, in a browser whose storage is `stored` (one object is one browser: a
// reload is a second page over the same one). `typing` is whether the Board's Typing isolates is on:
// off unless a test says so, since most of what follows is isolate turned on by the switch.
async function openAt(search = '', { stored = {}, board = makeBoard(), view = 'board', typing = false } = {}) {
  if (!('kanban.kanban.view.mode' in stored)) stored['kanban.kanban.view.mode'] = view;
  if (!('kanban.kanban.prefs' in stored)) stored['kanban.kanban.prefs'] = JSON.stringify({ typingIsolates: { board: typing } });
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  elements['#isolate-switch'] = spied();
  elements['#search-chip'] = spied(hidden());
  elements['#search-panel-toggle'] = spied();
  elements['#search-pills-fold'] = spied();
  elements['#toast'] = spied(hidden());
  const page = loadPage({ board, search, stored, elements });
  const session = attachSessionHistory(page);
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const sortedIds = (set) => [...set].sort((a, b) => a - b);
  return {
    page, session, stored, elements,
    box: () => page.input.value,
    type: (text) => page.input.typed(text),
    shown: () => sortedIds(page.run('shownCardIds()')),
    isolate: () => JSON.parse(JSON.stringify(page.run('isolateNow()'))),
    flip: () => elements['#isolate-switch'].fire('click', { preventDefault() {} }),
    ctrlClick: (id) => page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: true, metaKey: false }),
    params: () => Object.fromEntries(new URLSearchParams(session.search)),
    kept: () => Object.keys(stored).filter((k) => /isolate/.test(k)),
  };
}

function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : null) : harmless(String(key))) });
}

const clickTile = (page, id) => page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: false, metaKey: false });

// --- the address ------------------------------------------------------------------------------

test('turning isolate on puts the isolate parameter beside q, and turning it off takes both back out, with no history entry', async () => {
  const s = await openAt();
  s.ctrlClick(2);
  s.ctrlClick(5);
  assert.strictEqual(s.session.search, '', 'nothing in the address before isolating');
  const entries = s.session.entries.length;
  s.flip();
  assert.strictEqual(s.box(), '#2 | #5');
  assert.deepStrictEqual(s.params(), { q: '#2 | #5', isolate: '1' });
  assert.deepStrictEqual(Object.keys(s.params()), ['q', 'isolate'], 'the isolate parameter comes second');
  s.flip();
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.session.search, '', 'both parameters are gone');
  assert.strictEqual(s.session.pushes, 0, 'neither switch was a history entry');
  assert.strictEqual(s.session.entries.length, entries);
});

test('turning isolate on or off adds no browser-history entry, however often it is flipped', async () => {
  const s = await openAt();
  s.ctrlClick(2);
  const entries = s.session.entries.length;
  for (let i = 0; i < 4; i++) s.flip();
  assert.strictEqual(s.session.pushes, 0);
  assert.strictEqual(s.session.entries.length, entries);
  assert.strictEqual(s.session.replaces, 4, 'each flip replaced the entry it is on');
});

test('isolating a selection whose text equals the box still puts the parameter in, and turning it off takes it out', async () => {
  const s = await openAt('?q=%232');
  s.ctrlClick(2);
  s.flip();
  assert.strictEqual(s.box(), '#2');
  assert.deepStrictEqual(s.params(), { q: '#2', isolate: '1' }, 'q did not change, the parameter still arrives');
  s.flip();
  assert.deepStrictEqual(s.params(), { q: '#2' }, 'back to the text it held, and the parameter is gone');
});

// --- a reload, and a link opened in another browser ----------------------------------------------

test('a reload with isolate on keeps the switch on, the box text, the address and the isolated chip, and the Board shows only the isolated cards', async () => {
  const first = await openAt();
  first.ctrlClick(2);
  first.ctrlClick(5);
  first.flip();
  const address = first.session.search;
  assert.strictEqual(first.params().isolate, '1');
  const second = await openAt(address, { stored: first.stored });
  assert.deepStrictEqual(second.isolate(), { previous: '' }, 'isolate is on again');
  assert.strictEqual(second.elements['#isolate-switch'].getAttribute('aria-checked'), 'true', 'the switch says on');
  assert.strictEqual(second.box(), '#2 | #5');
  assert.strictEqual(second.session.search, address, 'the address is as the link had it');
  assert.strictEqual(second.session.replaces, 0, 'and was not rewritten on load');
  assert.strictEqual(second.elements['#search-chip'].textContent, 'isolated', 'the closed box says isolated');
  assert.deepStrictEqual(second.shown(), ['2', '5'], 'the Board shows only the isolated cards');
});

test('after a reload, turning isolate off gives the box the text it held before isolating, and takes the isolate parameter out of the address', async () => {
  const first = await openAt();
  first.type('tags:ui');
  first.ctrlClick(2);
  first.ctrlClick(5);
  first.flip();
  assert.strictEqual(first.box(), '#2 | #5');
  const second = await openAt(first.session.search, { stored: first.stored });
  assert.strictEqual(second.box(), '#2 | #5');
  second.flip();
  assert.strictEqual(second.box(), 'tags:ui', 'the text from before isolating, kept in the browser, is back');
  assert.strictEqual(second.isolate(), null);
  assert.deepStrictEqual(second.params(), { q: 'tags:ui' });
  assert.deepStrictEqual(second.shown(), ['1', '2', '3', '4', '5', '6'], 'and the Board shows every card again, the box lighting its matches');
});

test('the text kept for a reload follows the box while isolated: a hand edit of the isolate text is still isolated after a reload, and still gives the earlier text back', async () => {
  const first = await openAt();
  first.type('zephyr');
  first.ctrlClick(2);
  first.flip();
  first.type('#2 | #5');
  assert.notStrictEqual(first.isolate(), null, 'isolate stays on while the box holds a query');
  assert.deepStrictEqual(first.params(), { q: '#2 | #5', isolate: '1' }, 'the address follows the edit and keeps isolate');
  const second = await openAt(first.session.search, { stored: first.stored });
  second.flip();
  assert.strictEqual(second.box(), 'zephyr');
});

test('turning isolate off, or ending it by emptying the box, forgets the kept text', async () => {
  const first = await openAt();
  first.type('zephyr');
  first.ctrlClick(2);
  first.flip();
  assert.strictEqual(first.kept().length, 1, 'the browser keeps it while isolate is on');
  first.flip();
  assert.deepStrictEqual(first.kept(), [], 'turned off, nothing is kept');
  first.ctrlClick(2);
  first.flip();
  first.page.clear.fire('click');
  assert.strictEqual(first.isolate(), null, 'an emptied box ends isolate');
  assert.deepStrictEqual(first.kept(), [], 'and nothing is kept');
  assert.strictEqual(first.session.search, '', 'the address has neither parameter');
});

test('the link opened in a browser with nothing stored shows only the isolated cards, and turning isolate off leaves the box empty', async () => {
  const s = await openAt('?q=%232+%7C+%235&isolate=1');
  assert.deepStrictEqual(s.isolate(), { previous: '' });
  assert.strictEqual(s.box(), '#2 | #5');
  assert.deepStrictEqual(s.shown(), ['2', '5']);
  assert.strictEqual(s.elements['#isolate-switch'].getAttribute('aria-checked'), 'true');
  assert.strictEqual(s.elements['#search-chip'].textContent, 'isolated');
  s.flip();
  assert.strictEqual(s.box(), '', 'the text before isolating is unknown here');
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.session.search, '', 'both parameters are gone');
  assert.deepStrictEqual(s.shown(), ['1', '2', '3', '4', '5', '6']);
});

test('the link opens isolated in the Graph too, with only the isolated cards drawn and none dimmed', async () => {
  const s = await openAt('?q=%232+%7C+%235&isolate=1&view=graph');
  const drawn = JSON.parse(s.page.run('JSON.stringify(graphCur.model.nodes.map((n) => n.id))'));
  assert.deepStrictEqual(drawn.sort((a, b) => a - b), ['2', '5']);
  const effect = JSON.parse(s.page.run('JSON.stringify((() => { const e = currentGraphQueryEffect(); return { visible: [...e.visibleIds], lit: [...e.litIds] }; })())'));
  assert.deepStrictEqual(effect.visible.sort(), effect.lit.sort(), 'everything shown is lit');
  assert.strictEqual(s.page.run('selectionState.selection.anchor'), null, 'the box is not taken for a typed search');
});

test('a link with the isolate parameter and no query opens with isolate off, and no error', async () => {
  for (const search of ['?isolate=1', '?isolate=1&view=board', '?q=&isolate=1', '?q=%20%20&isolate=1']) {
    const s = await openAt(search);
    assert.strictEqual(s.isolate(), null, `${search}: isolate is off`);
    assert.strictEqual(s.box(), '');
    assert.deepStrictEqual(s.shown(), ['1', '2', '3', '4', '5', '6']);
    assert.strictEqual(s.elements['#isolate-switch'].getAttribute('aria-checked'), 'false');
  }
});

test('a link whose isolate parameter is anything but 1 opens with the query alone', async () => {
  for (const value of ['0', 'true', '']) {
    const s = await openAt(`?q=%232&isolate=${value}`);
    assert.strictEqual(s.isolate(), null, `isolate=${value}`);
    assert.strictEqual(s.box(), '#2');
  }
});

test('text kept for another isolate is not given back: a link whose query is not the kept one leaves the box empty when turned off', async () => {
  const first = await openAt();
  first.type('zephyr');
  first.ctrlClick(2);
  first.flip();
  const other = await openAt('?q=%235&isolate=1', { stored: first.stored });
  assert.strictEqual(other.box(), '#5');
  other.flip();
  assert.strictEqual(other.box(), '', 'the kept text belongs to #2, not to this link');
});

test('without browser storage the page isolates, reloads isolated and turns off to an empty box, with no error', async () => {
  const board = makeBoard();
  const blocked = (page) => {
    const refuse = () => { throw new Error('SecurityError: storage is blocked'); };
    page.ctx.localStorage = { getItem: refuse, setItem: refuse, removeItem: refuse };
  };
  const first = await openAt('', { board });
  blocked(first.page);
  first.type('tags:ui');
  first.ctrlClick(2);
  first.flip();
  assert.strictEqual(first.box(), '#2');
  assert.deepStrictEqual(first.page.failures, []);
  const second = await openAt(first.session.search, { board });
  blocked(second.page);
  assert.strictEqual(second.box(), '#2');
  second.flip();
  assert.strictEqual(second.box(), '');
  assert.deepStrictEqual(second.page.failures, []);
});

// --- card history keeps the parameter --------------------------------------------------------------

test('opening a card while isolated is one history step that carries q and isolate, and Back and Forward keep both', async () => {
  const s = await openAt();
  s.ctrlClick(2);
  s.ctrlClick(5);
  s.flip();
  const entries = s.session.entries.length;
  clickTile(s.page, 2);
  await s.page.settle();
  assert.deepStrictEqual(s.params(), { q: '#2 | #5', isolate: '1', card: '2' });
  assert.strictEqual(s.session.entries.length, entries + 1);
  s.session.back();
  await s.page.settle();
  assert.deepStrictEqual(s.params(), { q: '#2 | #5', isolate: '1' }, 'Back closes the card and keeps isolate');
  s.session.forward();
  await s.page.settle();
  assert.deepStrictEqual(s.params(), { q: '#2 | #5', isolate: '1', card: '2' });
  assert.strictEqual(s.session.pushes, 1, 'stepping between the entries pushed nothing');
});

test('Back onto an entry from before isolating brings that entry in line with the box, isolate included', async () => {
  const s = await openAt();
  clickTile(s.page, 1);
  await s.page.settle();
  s.session.close.fire('click');
  s.ctrlClick(2);
  s.flip();
  assert.deepStrictEqual(s.params(), { q: '#2', isolate: '1' });
  s.session.back();
  await s.page.settle();
  assert.deepStrictEqual(s.params(), { q: '#2', isolate: '1', card: '1' }, 'the entry Back landed on says what the box says');
  assert.strictEqual(s.box(), '#2');
  assert.notStrictEqual(s.isolate(), null, 'and Back never turns isolate off');
});

test('a query typed on the Board with Typing isolates on is isolated in the address, and a reload opens isolated and gives the typed query back when isolate goes off', async () => {
  const first = await openAt('', { typing: true });
  first.type('tags:ui');
  assert.deepStrictEqual(first.params(), { q: 'tags:ui', isolate: '1' });
  assert.deepStrictEqual(first.shown(), ['2', '5']);
  const second = await openAt(first.session.search, { stored: first.stored });
  assert.deepStrictEqual(second.isolate(), { previous: 'tags:ui', following: true }, 'isolate is on again, and still follows the box');
  assert.deepStrictEqual(second.shown(), ['2', '5']);
  second.flip();
  assert.strictEqual(second.box(), 'tags:ui', 'the typed query stays, lit');
  assert.deepStrictEqual(second.params(), { q: 'tags:ui' });
  assert.deepStrictEqual(second.shown(), ['1', '2', '3', '4', '5', '6']);
});
