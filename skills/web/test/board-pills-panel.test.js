const { test } = require('node:test');
const assert = require('node:assert');
const { openPanelPage, card } = require('./helpers/panel-dom');

// A board's own pills in the real page (helpers/page-vm.js runs every script the
// page loads in one vm; helpers/panel-dom.js draws the pill section onto a stand-in
// for the DOM): the panel lists blocked, review and waiting, then the pills the
// board's config gave, then one pill per value of each `field:*` entry; a click on
// one anchors its query, as a click on a built-in does; the first eight values of a
// field show and a "+N more" button opens the rest and folds them back; and the
// buttons are updated where they stand, so a focused pill keeps its focus across a
// poll. The browser runner looks at the page itself (scenarios/board-pills.js).

// What the board's answer carries for the plan board's config: a labelled entry, an
// unlabelled one (its label is its query) and a field:* entry.
const PLAN_PILLS = [
  { label: 'next', query: 'tags:"next-up"' },
  { label: 'assignee:@human', query: 'assignee:@human' },
  { label: 'tags:*', query: 'tags:*' },
];

// 1 grill, 2 grilling, 3 grill and next-up, 4 blocked, a tag with a space, 5 awaiting
// review, 6 done and awaiting review with next-up, 7 archived with a tag nobody else has.
const makeBoard = (pills = PLAN_PILLS) => ({
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
  archived: [card(7, { title: 'Spike pooling', status: 'done', archived: true, tags: ['archived-only'] })],
});

const q = (text) => ({ kind: 'query', text });
const BUILT_INS = ['blocked', 'review', 'waiting'];
const TAGS = ['grill', 'grilling', 'next-up', 'two words'];

// --- what the panel lists -----------------------------------------------------------------

test('the panel lists blocked, review and waiting, then the board\'s pills, then one pill per tag, in config order', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, 'next', 'assignee:@human', ...TAGS]);
});

test('a labelled entry shows its label and an unlabelled entry shows its query', async () => {
  const s = await openPanelPage({ board: makeBoard([{ label: 'mine', query: 'assignee:@human' }, { label: 'status:done', query: 'status:done' }]) });
  assert.deepStrictEqual(s.labels().slice(3), ['mine', 'status:done']);
  assert.match(s.byLabel('mine').title, /^assignee:@human /, 'the tooltip carries the query');
});

test('each value pill is keyed by its field and value and each board pill by its query, apart from the built-ins', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  const keys = s.buttons().map((b) => b.dataset.pillKey);
  assert.deepStrictEqual(keys.slice(0, 3), BUILT_INS);
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.ok(keys.includes('value:tags:grill') && keys.includes('value:tags:grilling'));
  assert.ok(keys.includes('pill:tags:"next-up"'));
});

test('a board pill counts the cards its query matches among the cards the view shows, done ones included, archived ones left out', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  const count = (label) => s.byLabel(label).children[1].textContent;
  assert.strictEqual(count('next'), '2', 'cards 3 and 6, the second of them done');
  assert.strictEqual(count('assignee:@human'), '2');
  assert.deepStrictEqual(TAGS.map(count), ['2', '1', '2', '1']);
});

test('the archived card\'s tag has no pill: the values come from the board\'s active cards', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  assert.ok(!s.labels().includes('archived-only'));
});

test('a board with no pills lists only the three built-ins, and so does one whose pills are not a list', async () => {
  for (const pills of [[], null, 'tags:*', { query: 'x' }, 4, 'missing']) {
    const board = makeBoard();
    if (pills === 'missing') delete board.pills; else board.pills = pills;
    const s = await openPanelPage({ board });
    assert.deepStrictEqual(s.labels(), BUILT_INS, JSON.stringify(pills));
    assert.strictEqual(s.more().length, 0);
  }
});

test('entries that are malformed are skipped, the page starts and draws without an error, and the pills around them stay', async () => {
  const bad = [null, 3, true, [], {}, { label: 'x' }, { query: '' }, { query: 7 }, { label: 'tags', query: 'grill' }, { label: 'x', query: '   ' }, { label: 'assignee:@human', query: 'assignee:@human' }];
  const s = await openPanelPage({ board: makeBoard(bad) });
  assert.deepStrictEqual(s.page.failures, []);
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, 'tags', 'assignee:@human']);
  assert.doesNotThrow(() => s.page.run('renderBoard()'));
});

test('the malformed board\'s panel: the built-ins and the two entries its reader keeps', async () => {
  const s = await openPanelPage({ board: makeBoard([{ label: 'tags', query: 'grill' }, { label: 'assignee:@human', query: 'assignee:@human' }]) });
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, 'tags', 'assignee:@human']);
  assert.deepStrictEqual(s.counts().slice(3), ['3', '2'], '"grill" is bare text, which reads title, body and tags, so it catches grilling too');
});

test('next up is no built-in: with no pill of that name defined, no pill says next', async () => {
  const s = await openPanelPage({ board: makeBoard([]) });
  assert.ok(!s.labels().some((l) => /next/i.test(l)));
});

// --- a click --------------------------------------------------------------------------------

test('a click on the grill pill puts tags:"grill" in the box and shows the grill cards, and not the grilling card', async () => {
  const s = await openPanelPage({ typing: true, board: makeBoard() });
  s.click(s.byLabel('grill'));
  assert.strictEqual(s.box(), 'tags:"grill"');
  assert.deepStrictEqual(s.shown(), ['1', '3']);
  assert.deepStrictEqual(s.ids(), ['1', '3'], 'its matches are the selection, so the bulk targets');
  assert.deepStrictEqual(s.selection(), { anchor: q('tags:"grill"'), additions: [] });
  assert.deepStrictEqual(s.pressed(), ['grill']);
});

test('a click on a board pill makes its query the anchor, and a second click on it takes it out again', async () => {
  const s = await openPanelPage({ typing: true, board: makeBoard() });
  s.click(s.byLabel('assignee:@human'));
  assert.deepStrictEqual(s.selection(), { anchor: q('assignee:@human'), additions: [] });
  assert.strictEqual(s.box(), 'assignee:@human');
  assert.deepStrictEqual(s.shown(), ['1', '3']);
  s.click(s.byLabel('assignee:@human'));
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('Shift+click on a second pill grows the box to "anchor | pill", as a click does', async () => {
  for (const shiftKey of [false, true]) {
    const s = await openPanelPage({ typing: true, board: makeBoard() });
    s.click(s.byLabel('grilling'));
    s.click(s.byLabel('next'), { shiftKey });
    assert.strictEqual(s.box(), 'tags:"grilling" | tags:"next-up"', `shift ${shiftKey}`);
    assert.deepStrictEqual(s.selection(), { anchor: q('tags:"grilling"'), additions: [q('tags:"next-up"')] });
    assert.deepStrictEqual(s.shown(), ['2', '3', '6']);
    assert.deepStrictEqual(s.pressed().sort(), ['next', 'next-up', 'grilling'].sort(), 'the board pill and the value pill with that query are on together');
    s.click(s.byLabel('next'), { shiftKey });
    assert.strictEqual(s.box(), 'tags:"grilling"');
  }
});

test('a right-click on a value pill solos it, and on the soloed pill turns every pill off, as for a built-in', async () => {
  const s = await openPanelPage({ typing: true, board: makeBoard() });
  s.click(s.byLabel('review'));
  s.click(s.byLabel('grill'));
  assert.strictEqual(s.box(), 'review: | tags:"grill"');
  assert.strictEqual(s.rightClick(s.byLabel('two words')), 1, 'the browser\'s own menu is stopped');
  assert.strictEqual(s.box(), 'tags:"two words"');
  assert.deepStrictEqual(s.pressed(), ['two words']);
  assert.deepStrictEqual(s.shown(), ['4']);
  s.rightClick(s.byLabel('two words'));
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.pressed(), []);
});

test('a value with a space is one exact term: its pill finds the card whose tag is those words and nothing that merely holds one of them', async () => {
  const board = makeBoard();
  board.active.push(card(8, { title: 'Another', tags: ['two'] }), card(9, { title: 'More', tags: ['words of wisdom'] }));
  const s = await openPanelPage({ typing: true, board });
  s.click(s.byLabel('two words'));
  assert.strictEqual(s.box(), 'tags:"two words"');
  assert.deepStrictEqual(s.shown(), ['4']);
});

test('turning one board pill on leaves every other pill\'s count as it was', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  const before = s.counts();
  for (const label of ['grill', 'next', 'assignee:@human', 'blocked']) {
    s.click(s.byLabel(label));
    assert.deepStrictEqual(s.counts(), before, `after ${label}`);
  }
});

test('a status pill turned off lowers the counts of the board pills by the cards it hides, and turned on again brings them back', async () => {
  const s = await openPanelPage({ board: makeBoard(), view: 'map' });
  const count = (label) => Number(s.byLabel(label).children[1].textContent);
  assert.deepStrictEqual([count('next'), count('next-up'), count('grill')], [2, 2, 2]);
  s.page.run("toggleMapStatusFilter('done')");
  assert.deepStrictEqual([count('next'), count('next-up')], [1, 1], 'card 6 is done');
  assert.deepStrictEqual([count('grill'), count('assignee:@human')], [2, 2], 'a pill with no done card is not lowered');
  s.page.run("toggleMapStatusFilter('done')");
  assert.deepStrictEqual([count('next'), count('next-up'), count('grill')], [2, 2, 2]);
});

test('in the Graph a click on a board pill lights its cards and the counts stay', async () => {
  const s = await openPanelPage({ board: makeBoard(), view: 'graph' });
  const before = s.counts();
  s.click(s.byLabel('grill'));
  assert.strictEqual(s.box(), 'tags:"grill"');
  assert.deepStrictEqual(s.counts(), before);
  assert.deepStrictEqual(s.pressed(), ['grill']);
});

// --- the chip ----------------------------------------------------------------------------------

test('the chip counts the board pills that are on and names them', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  s.click(s.byLabel('grill'));
  s.click(s.byLabel('assignee:@human'));
  s.click(s.byLabel('review'));
  assert.strictEqual(s.chip.textContent, '3');
  assert.strictEqual(s.chip.attrs['aria-label'], '3 on: review, assignee:@human, grill');
});

test('a pill that is on keeps counting in the chip while the panel is closed', async () => {
  const s = await openPanelPage({ board: makeBoard() });
  s.click(s.byLabel('grill'));
  s.page.run('setSearchPanelOpen(false)');
  assert.strictEqual(s.chip.textContent, '1');
  assert.strictEqual(s.chip.attrs['aria-label'], '1 on: grill');
});

// --- eight, then "+N more" ---------------------------------------------------------------------

const TEN = Array.from({ length: 10 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
const tenBoard = () => {
  const board = makeBoard([{ label: 'tags:*', query: 'tags:*' }]);
  board.active = TEN.map((tag, i) => card(i + 1, { title: `Card ${i + 1}`, tags: [tag] }));
  board.archived = [];
  return board;
};

test('ten values show eight pills and a "+2 more" button', async () => {
  const s = await openPanelPage({ board: tenBoard() });
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, ...TEN.slice(0, 8), '+2 more']);
  const more = s.more()[0];
  assert.strictEqual(more.tag, 'button');
  assert.strictEqual(more.type, 'button');
  assert.strictEqual(more.attrs['aria-expanded'], 'false');
  assert.strictEqual('keepsSelection' in more.dataset, true, 'a click on it never clears a selection');
  assert.strictEqual('holdsPoll' in more.dataset, false);
  assert.ok(!more.classList.contains('query-pill'), 'it is not a pill: no count, no click that anchors');
});

test('the more button opens the rest, says it can fold them back, and folds them again, and it is the one button throughout', async () => {
  const s = await openPanelPage({ board: tenBoard() });
  const more = s.more()[0];
  s.click(more);
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, ...TEN, 'fewer']);
  assert.strictEqual(s.more()[0], more);
  assert.strictEqual(more.attrs['aria-expanded'], 'true');
  assert.strictEqual(s.host.children[s.host.children.length - 1], more, 'it stays after the last value');
  s.click(more);
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, ...TEN.slice(0, 8), '+2 more']);
  assert.strictEqual(s.more()[0], more);
  assert.strictEqual(more.attrs['aria-expanded'], 'false');
});

test('the more button moves nothing but itself: the box, the selection and the pills\' own elements stay', async () => {
  const s = await openPanelPage({ board: tenBoard() });
  s.click(s.byLabel('t01'));
  const first = s.byLabel('t01');
  const before = s.box();
  s.click(s.more()[0]);
  assert.strictEqual(s.box(), before);
  assert.deepStrictEqual(s.selection(), { anchor: q('tags:"t01"'), additions: [] });
  assert.strictEqual(s.byLabel('t01'), first, 'a pill that stayed is the element it was');
  assert.strictEqual(s.rightClick(s.more()[0]), 0, 'a right-click on it is the browser\'s own');
  assert.strictEqual(s.box(), before);
});

test('folding takes the rest out before the button is placed, so the button is never moved and a focused one keeps its focus', async () => {
  const s = await openPanelPage({ board: tenBoard() });
  const more = s.more()[0];
  s.click(more);
  const moves = [];
  const insert = s.host.insertBefore;
  s.host.insertBefore = (node, ref) => { moves.push(node.dataset.pillKey); insert(node, ref); };
  s.click(more);
  assert.deepStrictEqual(moves, [], 'folding moves no element');
  s.click(more);
  assert.ok(!moves.includes('more:tags'), 'opening only adds the pills before it');
});

test('an opened field stays open across a poll and a repaint, and a field with no more than eight has no button', async () => {
  const board = tenBoard();
  const s = await openPanelPage({ board });
  s.click(s.more()[0]);
  await s.poll();
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, ...TEN, 'fewer']);
  board.active.splice(8);
  await s.poll();
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, ...TEN.slice(0, 8)], 'with eight values left the button goes');
  board.active.push(card(9, { tags: ['t09'] }));
  await s.poll();
  assert.deepStrictEqual(s.labels(), [...BUILT_INS, ...TEN.slice(0, 9), 'fewer'], 'and with a ninth it is back, and the field is still open');
});

test('a pill on that is behind the more button still counts in the chip', async () => {
  const s = await openPanelPage({ board: tenBoard() });
  s.click(s.more()[0]);
  s.click(s.byLabel('t10'));
  s.click(s.more()[0]);
  assert.ok(!s.labels().includes('t10'));
  assert.strictEqual(s.chip.textContent, '1');
  assert.strictEqual(s.chip.attrs['aria-label'], '1 on: t10');
  assert.strictEqual(s.box(), 'tags:"t10"');
});

test('each field:* entry has its own button, and opening one leaves the other', async () => {
  const board = makeBoard([{ query: 'tags:*' }, { query: 'assignee:*' }]);
  board.active = TEN.map((tag, i) => card(i + 1, { tags: [tag], assignee: `@a${String(i + 1).padStart(2, '0')}` }));
  const s = await openPanelPage({ board });
  assert.strictEqual(s.more().length, 2);
  assert.deepStrictEqual(s.more().map((b) => b.dataset.pillKey), ['more:tags', 'more:assignee']);
  s.click(s.more()[0]);
  assert.deepStrictEqual(s.more().map((b) => b.textContent), ['fewer', '+2 more']);
});

// --- a poll -----------------------------------------------------------------------------------

test('a focused value pill keeps its focus across a poll: the same element, with its count changed under it', async () => {
  const board = makeBoard();
  const s = await openPanelPage({ board });
  const before = [...s.buttons()];
  const grill = s.byLabel('grill');
  s.page.ctx.document.activeElement = grill;
  board.active.push(card(9, { title: 'Another grill', tags: ['grill'] }));
  await s.poll();
  assert.strictEqual(s.byLabel('grill').children[1].textContent, '3', 'the count changed');
  assert.ok(s.buttons().every((b, i) => b === before[i]), 'no button was rebuilt');
  assert.strictEqual(s.page.ctx.document.activeElement, grill);
});

test('a pill that is on stays on across a poll, a value pill included', async () => {
  const board = makeBoard();
  const s = await openPanelPage({ board });
  s.click(s.byLabel('grill'));
  s.click(s.byLabel('next'));
  await s.poll();
  assert.deepStrictEqual(s.pressed().sort(), ['grill', 'next', 'next-up']);
  assert.strictEqual(s.byLabel('grill').attrs['aria-pressed'], 'true');
});

test('a tag that joins the board gets a pill in its sorted place and the others stay as they were; one that leaves loses its pill', async () => {
  const board = makeBoard();
  const s = await openPanelPage({ board });
  const before = [...s.buttons()];
  board.active.push(card(9, { tags: ['grim'] }));
  await s.poll();
  assert.deepStrictEqual(s.labels().slice(5), ['grill', 'grilling', 'grim', 'next-up', 'two words']);
  assert.ok(before.every((b) => s.buttons().includes(b)), 'every button that was there still is');
  board.active.pop();
  await s.poll();
  assert.deepStrictEqual(s.labels().slice(5), TAGS);
  assert.ok(s.buttons().every((b, i) => b === before[i]));
});

test('a repaint with nothing changed writes nothing to the buttons, the board\'s own included', async () => {
  const s = await openPanelPage({ board: tenBoard() });
  const writes = [];
  for (const b of s.buttons()) {
    const set = b.setAttribute;
    b.setAttribute = (k, v) => { writes.push(k); set(k, v); };
    for (const part of b.children) {
      const key = Object.getOwnPropertyDescriptor(part, 'textContent');
      Object.defineProperty(part, 'textContent', { configurable: true, get: key.get, set: (v) => { writes.push('text'); key.set(v); } });
    }
    const own = Object.getOwnPropertyDescriptor(b, 'textContent');
    Object.defineProperty(b, 'textContent', { configurable: true, get: own.get, set: (v) => { writes.push('own'); own.set(v); } });
  }
  s.page.run('renderBoard()');
  s.page.run('renderBoard()');
  assert.deepStrictEqual(writes, []);
});
