const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const {
  ISOLATING_REASONS, SELECTION_OWN_REASONS, PILL_EDITING_REASONS, writeKeepsSelection, writeIsCut, writeEditsPills,
  writeIsIsolateSwitch, writeSkipsJump, linkWriteReason, typingTurnsIsolateOn,
} = require('../web/selection');

// Why the box was written decides what each listener does with the write, and each rule has one named
// predicate in selection.js. The predicates are pinned here, and the page is shown to follow them:
// a listener's behaviour for each reason, run in the real page (helpers/page-vm.js).

const ALL = ['typing', 'clear', 'cue', 'pill', 'unpill', 'slice', 'isolate', 'mirror', 'hover', 'link', 'link-lit', 'prefill', 'selection', 'menu'];

test('the writes that keep the selection are the pill and isolate writes and a click\'s own text, and a write with no reason', () => {
  assert.deepStrictEqual(SELECTION_OWN_REASONS, ['pill', 'unpill', 'isolate', 'mirror']);
  for (const reason of ALL) assert.strictEqual(writeKeepsSelection(reason), SELECTION_OWN_REASONS.includes(reason), reason);
  assert.strictEqual(writeKeepsSelection(null), true);
  assert.strictEqual(writeKeepsSelection(undefined), true);
});

test('only a cut, a hand edit, isolate\'s own write and a click\'s write are named by a rule of their own', () => {
  assert.deepStrictEqual(ALL.filter(writeIsCut), ['slice']);
  assert.deepStrictEqual(PILL_EDITING_REASONS, ['typing', 'clear', 'hover']);
  assert.deepStrictEqual(ALL.filter(writeEditsPills), ['typing', 'clear', 'hover']);
  assert.deepStrictEqual(ALL.filter(writeIsIsolateSwitch), ['isolate']);
  assert.deepStrictEqual(ALL.filter(writeSkipsJump), ['mirror']);
});

test('a link opens lit with isolate=0 and otherwise as a link, and only the second turns isolate on', () => {
  assert.strictEqual(linkWriteReason(true), 'link-lit');
  assert.strictEqual(linkWriteReason(false), 'link');
  assert.strictEqual(linkWriteReason(undefined), 'link');
  assert.strictEqual(typingTurnsIsolateOn({ reason: linkWriteReason(true), text: 'a', isolated: false, setting: true }), false);
  assert.strictEqual(typingTurnsIsolateOn({ reason: linkWriteReason(false), text: 'a', isolated: false, setting: true }), true);
});

test('the reasons a rule names are the reasons the page writes', () => {
  for (const reason of [...ISOLATING_REASONS, ...SELECTION_OWN_REASONS, ...PILL_EDITING_REASONS, 'slice', 'link-lit']) assert.ok(ALL.includes(reason), reason);
});

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const board = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing', tags: ['infra'] }),
    card(2, { title: 'Move the data layer', tags: ['ui'], waiting_for: [1] }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes', tags: ['ui'] }),
  ],
  archived: [],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];

async function open({ view = 'board', typing = false } = {}) {
  const elements = {};
  for (const sel of HIDDEN) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  const stored = { 'kanban.kanban.view.mode': view, 'kanban.kanban.prefs': JSON.stringify({ typingIsolates: { board: typing, graph: typing } }) };
  const page = await loadPage({ board: board(), stored, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const node = (id) => {
    const el = { dataset: { id: String(id) } };
    const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-node' ? el : null) : harmless(String(key))) });
    return { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  };
  return {
    page,
    box: () => page.input.value,
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    isolate: () => JSON.parse(JSON.stringify(page.run('isolateNow()'))),
    write: (text, reason) => page.run(`writeSearch(${JSON.stringify(text)}, ${JSON.stringify(reason)})`),
    nodeClick: (id) => elements['#graph-view'].fire('click', node(id)),
    pillClick: (key) => {
      const button = { dataset: { pillKey: key }, closest: (sel) => (sel === '.query-pill' ? button : null) };
      elements['#search-pills'].fire('click', { target: button, shiftKey: false, preventDefault() {} });
    },
    type: (text) => page.input.typed(text),
    flip: () => page.run('isolateFlip()'),
  };
}

const a = (id) => ({ kind: 'card', id: String(id) });
const typedAnchor = (text) => ({ kind: 'query', text, source: 'typing' });

test('every write moves the Calendar and the Gantt to the nearest match but a click\'s, which moves the box and not the page', async () => {
  const s = await open();
  let jumps = 0;
  s.page.ctx.moveViewToNearestMatch = () => { jumps++; };
  for (const reason of ALL) {
    jumps = 0;
    s.write(`tags:ui ${reason.length}`, reason);
    assert.strictEqual(jumps, reason === 'mirror' ? 0 : 1, reason);
  }
});

test('a card clicked on the Board writes the box with the mirror reason, which makes no jump', async () => {
  const s = await open();
  let jumps = 0;
  s.page.ctx.moveViewToNearestMatch = () => { jumps++; };
  const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? { dataset: { id: '2' } } : null) : harmless(String(key))) });
  s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: true, metaKey: false });
  assert.strictEqual(s.box(), '#2');
  assert.strictEqual(jumps, 0);
  s.type('tags:ui');
  assert.strictEqual(jumps, 1);
});

test('in the Graph isolate\'s own write leaves a picked card the anchor, and the isolate text never becomes a typed anchor', async () => {
  const s = await open({ view: 'graph' });
  s.nodeClick(2);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
  s.flip();
  assert.notStrictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
});

test('in the Graph a cut written by the slice section never makes the box the anchor, and a typed anchor follows it', async () => {
  const s = await open({ view: 'graph' });
  s.nodeClick(2);
  s.write('slice:0..1', 'slice');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, 'a card picked stays the anchor under a cut');
  const t = await open({ view: 'graph' });
  t.type('tags:ui');
  assert.deepStrictEqual(t.selection().anchor, typedAnchor('tags:ui'));
  t.write('tags:ui slice:0..1', 'slice');
  assert.deepStrictEqual(t.selection().anchor, typedAnchor('tags:ui slice:0..1'), 'the typed anchor follows the whole text, the cut included');
});

test('a write by hand or by Space takes a pill off when the box no longer holds its query, and the other writes keep it', async () => {
  for (const reason of ['typing', 'clear', 'hover']) {
    const s = await open();
    s.pillClick('review');
    assert.strictEqual(s.selection().anchor.text, 'review:', reason);
    s.write('tags:ui', reason);
    assert.strictEqual(s.selection().anchor, null, `${reason}: the pill is off`);
  }
  for (const reason of ['cue', 'link', 'prefill', 'selection', 'menu']) {
    const s = await open();
    s.pillClick('review');
    s.write('tags:ui', reason);
    assert.strictEqual(s.selection().anchor.text, 'review:', `${reason}: the pill stays`);
  }
});

test('a write the person makes turns isolate on before the repaint, so every listener sees it on, and one that empties the box ends it before the listeners hear', async () => {
  const s = await open({ typing: true });
  const seen = [];
  s.page.ctx.onSearchWrite((text, reason) => seen.push([text, reason, s.isolate() !== null]));
  s.type('tags:ui');
  s.write('', 'clear');
  assert.deepStrictEqual(seen, [['tags:ui', 'typing', true], ['', 'clear', false]]);
});
