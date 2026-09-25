const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cardIdFromSearch, nextCardHistorySearch } = require('../web/card-history');

// Pure decision logic for the card popup's browser-history wiring
// (kanban.proj#277). No DOM — app.js's click handlers and popstate listener
// do the actual history.pushState/openDetailModal/closeDetailModal calls;
// this only decides what URL (if any) a step should carry, and what a
// popstate landing on a URL means.

// --- cardIdFromSearch ---------------------------------------------------

test('cardIdFromSearch: no card key at all — null', () => {
  assert.strictEqual(cardIdFromSearch(''), null);
  assert.strictEqual(cardIdFromSearch('?view=board'), null);
  assert.strictEqual(cardIdFromSearch('?q=status%3Adoing'), null);
});

test('cardIdFromSearch: a valid positive integer card id parses', () => {
  assert.strictEqual(cardIdFromSearch('?card=194'), 194);
  assert.strictEqual(cardIdFromSearch('?card=7&view=board'), 7);
  assert.strictEqual(cardIdFromSearch('?view=board&card=7'), 7);
});

test('cardIdFromSearch: leading zeros are still the same integer', () => {
  assert.strictEqual(cardIdFromSearch('?card=007'), 7);
});

test('cardIdFromSearch: non-numeric, empty, zero, negative, or fractional values all resolve to null (present but unusable)', () => {
  assert.strictEqual(cardIdFromSearch('?card=abc'), null);
  assert.strictEqual(cardIdFromSearch('?card='), null);
  assert.strictEqual(cardIdFromSearch('?card=0'), null);
  assert.strictEqual(cardIdFromSearch('?card=-3'), null);
  assert.strictEqual(cardIdFromSearch('?card=3.5'), null);
});

test('cardIdFromSearch: non-string input never throws — resolves to null', () => {
  assert.strictEqual(cardIdFromSearch(null), null);
  assert.strictEqual(cardIdFromSearch(undefined), null);
});

// --- nextCardHistorySearch: opening --------------------------------------

test('opening a card from a bare board URL pushes ?card=<id>', () => {
  assert.strictEqual(nextCardHistorySearch('', 42), '?card=42');
  assert.strictEqual(nextCardHistorySearch('?', 42), '?card=42');
});

test('opening a card preserves the other params already on the URL (q, view)', () => {
  const search = nextCardHistorySearch('?q=status%3Adoing&view=board', 42);
  const params = new URLSearchParams(search);
  assert.strictEqual(params.get('card'), '42');
  assert.strictEqual(params.get('q'), 'status:doing');
  assert.strictEqual(params.get('view'), 'board');
});

test('opening card B while card A is showing pushes B, replacing only the card param', () => {
  const search = nextCardHistorySearch('?card=1&view=map', 2);
  const params = new URLSearchParams(search);
  assert.strictEqual(params.get('card'), '2');
  assert.strictEqual(params.get('view'), 'map');
});

test('opening the card already named by the current URL is a no-op — no duplicate step', () => {
  assert.strictEqual(nextCardHistorySearch('?card=42', 42), null);
  assert.strictEqual(nextCardHistorySearch('?card=042&view=board', 42), null); // leading zero, same id
});

// --- nextCardHistorySearch: closing --------------------------------------

test('closing removes the card param and keeps the rest', () => {
  const search = nextCardHistorySearch('?card=42&q=epic%3A&view=gantt', null);
  const params = new URLSearchParams(search);
  assert.strictEqual(params.has('card'), false);
  assert.strictEqual(params.get('q'), 'epic:');
  assert.strictEqual(params.get('view'), 'gantt');
});

test('closing down to no params left returns the empty string, not "?"', () => {
  assert.strictEqual(nextCardHistorySearch('?card=42', null), '');
});

test('closing when no card is currently in play is a no-op — nothing to remove', () => {
  assert.strictEqual(nextCardHistorySearch('', null), null);
  assert.strictEqual(nextCardHistorySearch('?view=board', null), null);
});

// A card param present but unusable (e.g. a stale/malformed value) still
// reads as "nothing to remove" for closing purposes the same way it reads as
// "no card" for opening dedup — cardIdFromSearch is the single source of
// truth both branches share.
test('closing when the current card param is unusable is also a no-op', () => {
  assert.strictEqual(nextCardHistorySearch('?card=abc', null), null);
});

// --- round trip: the decision this module makes matches what a popstate on
// the resulting URL would read back --------------------------------------

test('round trip: pushing an open step, then reading the id back off it, yields the same id', () => {
  const search = nextCardHistorySearch('?view=board', 194);
  assert.strictEqual(cardIdFromSearch(search), 194);
});

test('round trip: pushing a close step, then reading it back, yields null (close)', () => {
  const search = nextCardHistorySearch('?card=194&view=board', null);
  assert.strictEqual(cardIdFromSearch(search), null);
});

// --- wiring smoke tests: pins app.js's use of this module, the same way
// deep-link.test.js pins consumeDeepLink's wiring (no jsdom in this suite) --

const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

test('app.js registers a popstate listener that reads cardIdFromSearch off location.search', () => {
  assert.match(APP, /addEventListener\('popstate'/, 'no popstate listener wired');
  const from = APP.slice(APP.indexOf("addEventListener('popstate'"));
  const body = from.slice(0, from.indexOf('\n});') + 4);
  assert.match(body, /cardIdFromSearch\(location\.search\)/, 'popstate handler does not read cardIdFromSearch(location.search)');
});

test('the popstate handler closes/opens directly, never through the pushing wrapper — no push loop', () => {
  const from = APP.slice(APP.indexOf("addEventListener('popstate'"));
  const body = from.slice(0, from.indexOf('\n});') + 4);
  assert.doesNotMatch(body, /pushCardHistoryStep|nextCardHistorySearch|pushState/, 'popstate handler must not itself push a history step');
});

// openDetailModal is called directly from exactly 4 places: its own
// definition line, inside openCard's body, consumeDeepLink (initial load —
// the URL already carries the id, so pushing would be a no-op anyway, but
// it's deliberately raw rather than routed through the wrapper), and the
// popstate handler (which must never push a step for a step the user just
// took). Every OTHER surface that opens a card from a live user gesture —
// tile, mention-in-body, tray, map ghost — must call the wrapper so
// Back/Forward see it. A future call site added as a raw openDetailModal()
// call would silently drop out of history tracking with no other test
// catching it.
test('every user-gesture call site opens through the openCard wrapper, not openDetailModal directly', () => {
  assert.ok(APP.match(/function openCard\(/), 'no openCard wrapper defined');
  const rawCalls = [...APP.matchAll(/[^.\w]openDetailModal\(/g)].length;
  assert.strictEqual(rawCalls, 4,
    `expected exactly 4 raw openDetailModal( call sites (definition, openCard's own call, consumeDeepLink, popstate handler) — found ${rawCalls}; ` +
    'a new one should probably go through openCard() instead so Alt+Left/Alt+Right can see it');
  const wrapperCalls = [...APP.matchAll(/[^.\w]openCard\(/g)].length;
  assert.strictEqual(wrapperCalls, 5,
    `expected the openCard definition plus 4 call sites (mention, tray, map ghost, tile) — found ${wrapperCalls}`);
});

test('every user-gesture close goes through the closeCard wrapper, not closeDetailModal directly', () => {
  assert.ok(APP.match(/function closeCard\(/), 'no closeCard wrapper defined');
  // closeDetailModal is still called raw from: its own definition, inside
  // closeCard's body, the popstate handler, and editFromDetail (switching to
  // the EDIT modal, not a plain close — out of scope for #277's history
  // steps; see the doc comment above pushCardHistoryStep).
  const rawCalls = [...APP.matchAll(/[^.\w]closeDetailModal\(/g)].length;
  assert.strictEqual(rawCalls, 5,
    `expected exactly 5 raw closeDetailModal( call sites — found ${rawCalls}`);
});
