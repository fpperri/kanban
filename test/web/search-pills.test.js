const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseSearchQuery, filterCards, searchTermText } = require('../../plugin/skills/web/web/search');
const { pillList, pillEntries, pillIsOn, pillsOn, pillStep, panelChip } = require('../../plugin/skills/web/web/pills');
const { NO_SELECTION, cardPart, pathPart, queryPart, typedQueryPart, addPart } = require('../../plugin/skills/web/web/selection');

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

// --- stepping through the pills ------------------------------------------------------

// The m key's step is a solo, like a right-click: pillStep answers the pill whose solo is the
// next step. The cycle runs off, then every pill in list order, then off again; a solo of the
// pill that is on alone turns every pill off, so the step after the last pill answers that pill.
const CYCLE = pillEntries({ pills: [{ label: 'next', query: 'tags:"next-up"' }, 'assignee:"@human"'] });
const keysOf = (list) => list.map((p) => p.key);
const aloneOn = (pill) => selectionOf(queryPart(pill.query));

test('with every pill off, m steps to the first pill and Shift+m to the last', () => {
  assert.strictEqual(pillStep(CYCLE, NO_SELECTION, 1).key, 'blocked');
  assert.strictEqual(pillStep(CYCLE, NO_SELECTION, -1).key, CYCLE[CYCLE.length - 1].key);
});

test('with one pill on alone, m steps to the next pill in list order, then the pills a board defines', () => {
  assert.deepStrictEqual(keysOf(CYCLE), ['blocked', 'review', 'waiting', 'pill:tags:"next-up"', 'pill:assignee:"@human"']);
  const walked = [];
  for (let at = 0; at < CYCLE.length - 1; at++) walked.push(pillStep(CYCLE, aloneOn(CYCLE[at]), 1).key);
  assert.deepStrictEqual(walked, keysOf(CYCLE).slice(1));
});

test('with one pill on alone, Shift+m steps to the pill before it', () => {
  const walked = [];
  for (let at = CYCLE.length - 1; at > 0; at--) walked.push(pillStep(CYCLE, aloneOn(CYCLE[at]), -1).key);
  assert.deepStrictEqual(walked, keysOf(CYCLE).slice(0, -1).reverse());
});

test('after the last pill m steps to off, and before the first Shift+m does: the step is the solo of the pill that is on alone', () => {
  const last = CYCLE[CYCLE.length - 1];
  assert.strictEqual(pillStep(CYCLE, aloneOn(last), 1), last);
  assert.strictEqual(pillStep(CYCLE, aloneOn(CYCLE[0]), -1), CYCLE[0]);
});

test('with several pills on, the step starts the cycle over: the first pill for m and the last for Shift+m', () => {
  const several = selectionOf(queryPart('review:'), queryPart('waiting:'));
  assert.strictEqual(pillStep(CYCLE, several, 1).key, 'blocked');
  assert.strictEqual(pillStep(CYCLE, several, -1).key, CYCLE[CYCLE.length - 1].key);
});

test('a card, a path or a typed search is not a pill on: the step starts the cycle', () => {
  assert.strictEqual(pillStep(CYCLE, selectionOf(cardPart(1), pathPart(2)), 1).key, 'blocked');
  assert.strictEqual(pillStep(CYCLE, selectionOf(typedQueryPart('review:')), 1).key, 'blocked');
});

test('a pill on beside a card is on alone: the step goes on from it', () => {
  assert.strictEqual(pillStep(CYCLE, selectionOf(cardPart(1), queryPart('review:')), 1).key, 'waiting');
});

test('a pill that is on but no longer listed counts as nothing on, and a list with no pill answers null', () => {
  assert.strictEqual(pillStep(CYCLE, selectionOf(queryPart('tags:gone')), 1).key, 'blocked');
  assert.strictEqual(pillStep([], NO_SELECTION, 1), null);
});

// A board pill and a value pill can hold one query (a `next` pill for tags:"next-up" and the
// tag next-up of a `tags:*` entry). Both show as on together, and one filter is one step.
test('pills that share a query are one step: soloing the first never leaves the cycle stuck on it', () => {
  const same = pillEntries({
    pills: [{ label: 'next', query: 'tags:"next-up"' }, 'assignee:@human', 'tags:*'],
    cards: [{ tags: ['grill', 'next-up'] }],
    term: searchTermText,
  });
  assert.deepStrictEqual(keysOf(same), ['blocked', 'review', 'waiting', 'pill:tags:"next-up"', 'pill:assignee:@human', 'value:tags:grill', 'value:tags:next-up']);
  const next = same[3];
  const bothOn = selectionOf(queryPart(next.query));
  assert.deepStrictEqual(keysOf(pillsOn(bothOn, same)), ['pill:tags:"next-up"', 'value:tags:next-up']);
  assert.strictEqual(pillStep(same, bothOn, 1).key, 'pill:assignee:@human');
  assert.strictEqual(pillStep(same, bothOn, -1).key, 'waiting');
  const lastOnly = selectionOf(queryPart('tags:"grill"'));
  assert.strictEqual(pillStep(same, lastOnly, 1).key, 'value:tags:grill', 'the last step is the soloed pill again, which turns it off');
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
const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
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
  for (const name of ['pillList', 'pillIsOn', 'pillsOn', 'pillStep', 'panelChip']) assert.strictEqual(typeof window[name], 'function', name);
  const list = window.pillList([card(1, { blocked: 'x' })], (q) => (q === 'blocked:' ? [1] : []));
  assert.deepStrictEqual(Array.from(list, (p) => p.count), [1, 0, 0]);
});
