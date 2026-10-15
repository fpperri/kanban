const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseSearchQuery, filterCards } = require('../web/search');
const { pillList, pillIsOn, pillsOn, panelChip } = require('../web/pills');
const { NO_SELECTION, cardPart, pathPart, queryPart, typedQueryPart, addPart } = require('../web/selection');

// The pills the search panel lists: blocked, review and waiting, in that order,
// each with the number of the cards given that its query matches. The search
// module does the matching, over the whole board (so `waiting:` sees a card it
// waits for that the view hides); the pill list counts the matches among the cards
// the view shows. Whether a pill is on is read off the selection.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], file: `${String(id).padStart(4, '0')}.card.md`,
  assignee: null, type: null, waiting_for: [], blocked: null, review: null, archived: false, ...over,
});

// 1 blocked, 2 review, 3 waits for 1, 4 done and awaiting review (a done card a
// pill still counts), 5 done and blocked, 6 waits for the done card 7 (so it does
// not wait), 7 done, 8 waits for the archived card 9 (not done), 9 archived and
// todo, 10 plain.
const BOARD = [
  card(1, { blocked: 'vendor' }),
  card(2, { review: 'copy' }),
  card(3, { waiting_for: [1] }),
  card(4, { status: 'done', review: 'PR #6' }),
  card(5, { status: 'done', blocked: 'true' }),
  card(6, { waiting_for: [7] }),
  card(7, { status: 'done' }),
  card(8, { waiting_for: [9] }),
  card(9, { archived: true }),
  card(10),
];

const matchOver = (cards) => (query) => new Set(filterCards(cards, parseSearchQuery(query), {}).map((c) => c.id));
const counts = (cards, board = BOARD) => Object.fromEntries(pillList(cards, matchOver(board)).map((p) => [p.label, p.count]));

test('the list is blocked, review and waiting, in that order, each with its query', () => {
  const list = pillList(BOARD, matchOver(BOARD));
  assert.deepStrictEqual(list.map((p) => [p.key, p.label, p.query]), [
    ['blocked', 'blocked', 'blocked:'],
    ['review', 'review', 'review:'],
    ['waiting', 'waiting', 'waiting:'],
  ]);
});

test('each pill counts the given cards its query matches, done cards included', () => {
  assert.deepStrictEqual(counts(BOARD), { blocked: 2, review: 2, waiting: 2 });
  assert.deepStrictEqual(pillList(BOARD, matchOver(BOARD)).map((p) => p.count), [2, 2, 2]);
});

test('a board with none of them counts zero for each pill, and the pills are still listed', () => {
  const plain = [card(1), card(2)];
  const list = pillList(plain, matchOver(plain));
  assert.deepStrictEqual(list.map((p) => p.count), [0, 0, 0]);
  assert.strictEqual(list.length, 3);
  assert.deepStrictEqual(pillList([], matchOver([])).map((p) => p.count), [0, 0, 0]);
});

test('only the cards given are counted: a card the view hides leaves the count', () => {
  const withoutDone = BOARD.filter((c) => c.status !== 'done');
  assert.deepStrictEqual(counts(withoutDone), { blocked: 1, review: 1, waiting: 2 }, 'the done blocked card 5 and the done review card 4 are out');
});

test('a card waits for a card the view hides all the same: waiting is worked out over the whole board', () => {
  const view = BOARD.filter((c) => c.id !== 1);
  assert.strictEqual(counts(view).waiting, 2, 'card 3 still waits for card 1, which is out of view');
  assert.strictEqual(counts(BOARD.filter((c) => c.id !== 3)).waiting, 1, 'and a waiting card that is out of view is not counted');
});

test('a card waiting for an archived card that is not done waits, and one waiting for a done card does not', () => {
  assert.deepStrictEqual(pillList([BOARD[7], BOARD[5]], matchOver(BOARD)).map((p) => p.count), [0, 0, 1]);
});

test('the counts do not depend on what the search box holds: the list is given the cards and a matcher, and nothing else', () => {
  const asked = [];
  const matcher = (query) => { asked.push(query); return matchOver(BOARD)(query); };
  pillList(BOARD, matcher);
  assert.deepStrictEqual(asked, ['blocked:', 'review:', 'waiting:']);
});

test('each call hands out a fresh list: changing one entry never changes the next', () => {
  const first = pillList(BOARD, matchOver(BOARD));
  first[0].label = 'changed';
  first.pop();
  assert.deepStrictEqual(pillList(BOARD, matchOver(BOARD)).map((p) => p.label), ['blocked', 'review', 'waiting']);
});

test('a matcher that answers with an array, or with ids that are not cards given, still counts only the cards given', () => {
  const list = pillList([card(1), card(2)], () => [1, 99, 100]);
  assert.deepStrictEqual(list.map((p) => p.count), [1, 1, 1]);
});

// --- which pills are on -----------------------------------------------------------

const selectionOf = (...parts) => parts.reduce((s, p) => addPart(s, p), NO_SELECTION);
const PILLS = pillList(BOARD, matchOver(BOARD));
const reviewPill = PILLS[1];
const blockedPill = PILLS[0];

test('a pill is on while its query is the anchor', () => {
  assert.strictEqual(pillIsOn(selectionOf(queryPart('review:')), reviewPill), true);
  assert.strictEqual(pillIsOn(selectionOf(queryPart('review:')), blockedPill), false);
});

test('a pill is on while its query is an addition', () => {
  const s = selectionOf(queryPart('review:'), queryPart('blocked:'));
  assert.strictEqual(pillIsOn(s, reviewPill), true);
  assert.strictEqual(pillIsOn(s, blockedPill), true);
  assert.strictEqual(pillIsOn(selectionOf(cardPart(1), queryPart('blocked:')), blockedPill), true);
});

test('nothing selected, or only cards, paths and trees, turns no pill on', () => {
  assert.strictEqual(pillIsOn(NO_SELECTION, reviewPill), false);
  assert.strictEqual(pillIsOn(selectionOf(cardPart(2), pathPart(3)), reviewPill), false);
});

test('a typed search is not a pill, even when it reads as the pill\'s query', () => {
  assert.strictEqual(pillIsOn(selectionOf(typedQueryPart('review:')), reviewPill), false);
  assert.strictEqual(pillIsOn(selectionOf(cardPart(1), typedQueryPart('review:')), reviewPill), false);
});

test('spacing does not matter when the query is compared', () => {
  const spaced = { key: 'x', label: 'x', query: 'tags:ui   status:doing' };
  assert.strictEqual(pillIsOn(selectionOf(queryPart('tags:ui status:doing')), spaced), true);
  assert.strictEqual(pillIsOn(selectionOf(queryPart(' tags:ui status:doing ')), spaced), true);
});

test('the pills that are on come back in list order, whatever order they were picked in', () => {
  const s = selectionOf(queryPart('waiting:'), queryPart('blocked:'));
  assert.deepStrictEqual(pillsOn(s, PILLS).map((p) => p.key), ['blocked', 'waiting']);
  assert.deepStrictEqual(pillsOn(NO_SELECTION, PILLS), []);
});

// --- the chip ---------------------------------------------------------------------

test('the chip counts what is on and its name says what', () => {
  assert.deepStrictEqual(panelChip(['review']), { count: 1, name: '1 on: review' });
  assert.deepStrictEqual(panelChip(['blocked', 'waiting']), { count: 2, name: '2 on: blocked, waiting' });
});

test('with nothing on there is no chip', () => {
  assert.deepStrictEqual(panelChip([]), { count: 0, name: '' });
  assert.deepStrictEqual(panelChip(), { count: 0, name: '' });
});

// --- loading ----------------------------------------------------------------------

// The snapshot embeds this file as it is, into a page where no other module is
// loaded and a build step rewrites __NAME__ tokens.
const WEB = path.join(__dirname, '..', 'web');
const source = fs.readFileSync(path.join(WEB, 'pills.js'), 'utf8').split('\r\n').join('\n');

test('the pill-list module needs no other module, cannot close the script element it is embedded in, and holds no build placeholder', () => {
  assert.doesNotMatch(source, /\brequire\(/);
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /<\/script/i);
  assert.doesNotMatch(source, /__[A-Z_]+__/);
});

test('loaded alone as a plain script, the pill-list module lists the pills from window', () => {
  const window = {};
  const page = vm.createContext({ window });
  vm.runInContext(source, page);
  for (const name of ['pillList', 'pillIsOn', 'pillsOn', 'panelChip']) assert.strictEqual(typeof window[name], 'function', name);
  const list = window.pillList([card(1, { blocked: 'x' })], (q) => (q === 'blocked:' ? [1] : []));
  assert.deepStrictEqual(Array.from(list, (p) => p.count), [1, 0, 0]);
});
