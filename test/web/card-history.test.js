const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cardIdFromSearch, nextCardHistorySearch, nextSearchAddress } = require('../../plugin/skills/web/web/card-history');
const { parseDeepLink } = require('../../plugin/skills/web/web/deep-link');

// Pure decision logic for the card popup's browser-history wiring.
// No DOM — app.js's click handlers and popstate listener
// do the actual history.pushState/openDetailModal/closeDetailModal calls;
// this only decides what URL (if any) a step should carry, and what a
// popstate landing on a URL means.

// --- cardIdFromSearch ---------------------------------------------------

test('cardIdFromSearch: no card key at all — null', () => {
  assert.strictEqual(cardIdFromSearch(''), null);
  assert.strictEqual(cardIdFromSearch('?view=board'), null);
  assert.strictEqual(cardIdFromSearch('?q=status%3Adoing'), null);
});

test('cardIdFromSearch: a card id parses to its whole-id string', () => {
  assert.strictEqual(cardIdFromSearch('?card=194'), '194');
  assert.strictEqual(cardIdFromSearch('?card=7&view=board'), '7');
  assert.strictEqual(cardIdFromSearch('?view=board&card=7'), '7');
});

test('cardIdFromSearch: leading zeros are still the same id, and a prefix belongs to the id', () => {
  assert.strictEqual(cardIdFromSearch('?card=007'), '7');
  assert.strictEqual(cardIdFromSearch('?card=G7'), 'G7');
  assert.strictEqual(cardIdFromSearch('?card=G07'), 'G7');
  assert.notStrictEqual(cardIdFromSearch('?card=G7'), cardIdFromSearch('?card=7'));
});

test('cardIdFromSearch: non-id, empty, lower-case-prefixed, negative, or fractional values all resolve to null (present but unusable)', () => {
  assert.strictEqual(cardIdFromSearch('?card=abc'), null);
  assert.strictEqual(cardIdFromSearch('?card='), null);
  assert.strictEqual(cardIdFromSearch('?card=g7'), null);
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
  const search = nextCardHistorySearch('?card=42&q=type%3Aepic&view=gantt', null);
  const params = new URLSearchParams(search);
  assert.strictEqual(params.has('card'), false);
  assert.strictEqual(params.get('q'), 'type:epic');
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
  assert.strictEqual(cardIdFromSearch(search), '194');
});

test('round trip: pushing a close step, then reading it back, yields null (close)', () => {
  const search = nextCardHistorySearch('?card=194&view=board', null);
  assert.strictEqual(cardIdFromSearch(search), null);
});

// --- nextSearchAddress: the address follows the search box ----------------
//
// Given the address (location.search) and the box's text, the one step that
// puts the box's text in `q` and leaves every other parameter as it found it.
// null when the address already matches, so the caller replaces nothing.

const paramsOf = (search) => [...new URLSearchParams(search).entries()];

test('nextSearchAddress: a box with text sets q on a bare address', () => {
  assert.strictEqual(nextSearchAddress('', 'zephyr'), '?q=zephyr');
  assert.strictEqual(nextSearchAddress('?', 'zephyr'), '?q=zephyr');
});

test('nextSearchAddress: changes only q — card and view ride along, in their place', () => {
  assert.deepStrictEqual(paramsOf(nextSearchAddress('?card=42&view=graph', 'zephyr')),
    [['card', '42'], ['view', 'graph'], ['q', 'zephyr']]);
  assert.deepStrictEqual(paramsOf(nextSearchAddress('?view=map&q=old&card=7', 'new text')),
    [['view', 'map'], ['q', 'new text'], ['card', '7']]);
});

test('nextSearchAddress: an empty box drops q and keeps the rest', () => {
  assert.deepStrictEqual(paramsOf(nextSearchAddress('?q=zephyr&view=graph', '')), [['view', 'graph']]);
  assert.strictEqual(nextSearchAddress('?q=zephyr', ''), '', 'nothing left is the empty string, not "?"');
});

test('nextSearchAddress: a blank box drops q like an empty one', () => {
  assert.deepStrictEqual(paramsOf(nextSearchAddress('?q=zephyr&view=graph', '   ')), [['view', 'graph']]);
  assert.strictEqual(nextSearchAddress('?q=zephyr', ' \t '), '');
});

test('nextSearchAddress: returns nothing when the address already matches', () => {
  assert.strictEqual(nextSearchAddress('?q=zephyr', 'zephyr'), null);
  assert.strictEqual(nextSearchAddress('?view=graph&q=zephyr&card=3', 'zephyr'), null);
  assert.strictEqual(nextSearchAddress('', ''), null, 'no q and an empty box');
  assert.strictEqual(nextSearchAddress('?view=graph', '   '), null, 'no q and a blank box');
  assert.strictEqual(nextSearchAddress('?q=%2312+%7C+%28tags%3A%22next-up%22%29', '#12 | (tags:"next-up")'), null, 'an encoded q is compared decoded');
});

test('nextSearchAddress: a trailing space is part of the box text, so q equals the box', () => {
  assert.strictEqual(new URLSearchParams(nextSearchAddress('?q=a', 'a ')).get('q'), 'a ');
  assert.strictEqual(nextSearchAddress('?q=a+', 'a '), null);
});

test('nextSearchAddress: # | quotes and spaces are encoded, never a fragment, and the deep-link reader gets the text back', () => {
  const text = '#12 | (tags:"next-up" status:doing)';
  const search = nextSearchAddress('?view=graph', text);
  assert.ok(search.startsWith('?'), search);
  assert.doesNotMatch(search, /[# |"]/, 'no raw #, space, | or quote in the address');
  assert.strictEqual(parseDeepLink(search).q, text);
  assert.strictEqual(parseDeepLink(search).view, 'graph');
});

test('nextSearchAddress: non-string input never throws', () => {
  assert.strictEqual(nextSearchAddress(null, 'zephyr'), '?q=zephyr');
  assert.strictEqual(nextSearchAddress(undefined, undefined), null);
  assert.strictEqual(nextSearchAddress('?q=zephyr', null), '');
});

// --- wiring smoke tests: pins app.js's use of this module, the same way
// deep-link.test.js pins consumeDeepLink's wiring (no jsdom in this suite) --

const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8');

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

// openDetailModal is called directly from exactly 5 places: its own
// definition line, inside openCard's body, consumeDeepLink (initial load —
// the URL already carries the id, so pushing would be a no-op anyway, but
// it's deliberately raw rather than routed through the wrapper), the
// popstate handler (which must never push a step for a step the user just
// took) and refreshOpenDetail (a board reload re-reading the card the popup
// already shows, so there is no step to push). Every OTHER surface that opens a card from a live user gesture —
// tile, mention-in-body, tray, map ghost — must call the wrapper so
// Back/Forward see it. A future call site added as a raw openDetailModal()
// call would silently drop out of history tracking with no other test
// catching it.
test('every user-gesture call site opens through the openCard wrapper, not openDetailModal directly', () => {
  assert.ok(APP.match(/function openCard\(/), 'no openCard wrapper defined');
  const rawCalls = [...APP.matchAll(/[^.\w]openDetailModal\(/g)].length;
  assert.strictEqual(rawCalls, 6,
    `expected exactly 6 raw openDetailModal( call sites (definition, openCard's own call, consumeDeepLink, popstate handler, refreshOpenDetail, the phone Save returning to its card, whose address still holds card=) — found ${rawCalls}; ` +
    'a new one should probably go through openCard() instead so Alt+Left/Alt+Right can see it');
  const wrapperCalls = [...APP.matchAll(/[^.\w]openCard\(/g)].length;
  assert.strictEqual(wrapperCalls, 8,
    `expected the openCard definition plus 7 call sites (mention, tray, map ghost, tile, the peek of a double click, the Enter handler, the card menu's Peek) — found ${wrapperCalls}`);
});

test('popstate bails out while any popup other than the detail popup itself is open', () => {
  const from = APP.slice(APP.indexOf("addEventListener('popstate'"));
  const body = from.slice(0, from.indexOf('\n});') + 4);
  // An edit/new-card form (or any other popup) may hold unsaved typing —
  // letting Back/Forward swap the detail popup in underneath it means a
  // later Edit click silently overwrites that typed work with a different
  // card's fields. The check must run before the handler decides open vs.
  // close, and must not treat the detail popup's own open state as a reason
  // to bail (that's the normal card-to-card case).
  assert.match(body, /modal-backdrop:not\(#detail-modal\):not\(\.hidden\)/,
    'popstate handler must skip opening/closing while a non-detail popup (e.g. the edit form) is open');
});

test('popstate opens quietly — a stale/deleted card must not toast', () => {
  const from = APP.slice(APP.indexOf("addEventListener('popstate'"));
  const body = from.slice(0, from.indexOf('\n});') + 4);
  assert.match(body, /openDetailModal\(id,\s*\{\s*quiet:\s*true\s*\}\)/,
    'popstate must pass quiet:true so a card that no longer resolves closes the popup instead of toasting on every traversal');
});

test('openDetailModal reports success/failure so callers can tell a real open from a failed one', () => {
  const fn = APP.slice(APP.indexOf('async function openDetailModal('));
  // An unindented closing brace on its own line ends the function. The line
  // ending after it is CRLF in a Windows checkout and LF everywhere else.
  const end = fn.search(/\n\}\r?\n/);
  assert.ok(end > 0, 'could not find the end of openDetailModal');
  const body = fn.slice(0, end + 2);
  assert.match(body, /return true;/, 'openDetailModal must return true once the card is actually showing');
  assert.match(body, /return false;/, 'openDetailModal must return false on a failed fetch (superseded or not)');
});

test('openCard pushes the history step only after the card actually loads, not before the fetch', () => {
  const fn = APP.slice(APP.indexOf('async function openCard('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /if \(await openDetailModal\(id\)\) pushCardHistoryStep\(id\);/,
    'openCard must await openDetailModal and only push on success — pushing first leaves a phantom history step behind a chip for a deleted/nonexistent card');
});

test('every user-gesture close goes through the closeCard wrapper, not closeDetailModal directly', () => {
  assert.ok(APP.match(/function closeCard\(/), 'no closeCard wrapper defined');
  // closeDetailModal is still called raw from: its own definition, inside
  // closeCard's body, the popstate handler's close branch, editFromDetail
  // (switching to the EDIT modal, not a plain close — out of scope for the
  // history steps above; see the doc comment above pushCardHistoryStep), and
  // openDetailModal's own quiet-failure branch (a popstate landing on a card
  // id that no longer resolves closes the popup instead of toasting), and the
  // edit form's return, whose failed card read closes the popup and replaces
  // its address step (a dead card's step is not stacked on).
  const rawCalls = [...APP.matchAll(/[^.\w]closeDetailModal\(/g)].length;
  assert.strictEqual(rawCalls, 7,
    `expected exactly 7 raw closeDetailModal( call sites — found ${rawCalls}`);
});

// --- nextSearchAddress with isolate: the second parameter beside q ------------
//
// While isolate is on, `isolate=1` stands beside q; it is gone when isolate is off or the box
// holds no query.

test('nextSearchAddress: isolate on puts isolate=1 after q, and off takes it out', () => {
  assert.strictEqual(nextSearchAddress('', '#2 | #5', true), '?q=%232+%7C+%235&isolate=1');
  assert.deepStrictEqual(paramsOf(nextSearchAddress('?view=graph&q=a&isolate=1', 'a', false)), [['view', 'graph'], ['q', 'a']]);
  assert.strictEqual(nextSearchAddress('?q=a&isolate=1', 'a', false), '?q=a');
});

test('nextSearchAddress: a change of the flag alone is a new address, and the same flag with the same q is nothing', () => {
  assert.strictEqual(nextSearchAddress('?q=a', 'a', true), '?q=a&isolate=1');
  assert.strictEqual(nextSearchAddress('?q=a&isolate=1', 'a', true), null);
  assert.strictEqual(nextSearchAddress('?q=a', 'a', false), null);
});

test('nextSearchAddress: isolate with no query is no isolate, so an empty or blank box drops both', () => {
  assert.strictEqual(nextSearchAddress('?q=a&isolate=1', '', true), '');
  assert.strictEqual(nextSearchAddress('?q=a&isolate=1', '   ', true), '');
  assert.strictEqual(nextSearchAddress('?isolate=1&view=map', '', true), '?view=map');
  assert.strictEqual(nextSearchAddress('', '', true), null);
});

test('nextSearchAddress: a caller that does not say reads as isolate off, and drops the parameter', () => {
  assert.strictEqual(nextSearchAddress('?q=a&isolate=1', 'a'), '?q=a');
  assert.deepStrictEqual(paramsOf(nextSearchAddress('?q=a&isolate=1', 'b')), [['q', 'b']]);
});

test('nextCardHistorySearch: opening and closing a card keep the isolate parameter, whatever order the address holds it in', () => {
  assert.deepStrictEqual(paramsOf(nextCardHistorySearch('?q=%232&isolate=1', 2)), [['q', '#2'], ['isolate', '1'], ['card', '2']]);
  assert.deepStrictEqual(paramsOf(nextCardHistorySearch('?q=%232&isolate=1&card=2', null)), [['q', '#2'], ['isolate', '1']]);
});

// --- nextSearchAddress: isolate=0 outside the Graph ------------------------------------------------

test('nextSearchAddress: outside the Graph a box with a query and isolate off writes isolate=0 beside q', () => {
  assert.strictEqual(nextSearchAddress('', 'zephyr', false, true), '?q=zephyr&isolate=0');
  assert.strictEqual(nextSearchAddress('?q=zephyr&isolate=1', 'zephyr', false, true), '?q=zephyr&isolate=0', 'isolate going off changes 1 to 0');
  assert.strictEqual(nextSearchAddress('?q=zephyr&isolate=0', 'zephyr', true, true), '?q=zephyr&isolate=1', 'and going on changes 0 to 1');
});

test('nextSearchAddress: isolate=0 is already in line when the address says so, and an old link without it is brought in line', () => {
  assert.strictEqual(nextSearchAddress('?q=zephyr&isolate=0', 'zephyr', false, true), null);
  assert.strictEqual(nextSearchAddress('?q=zephyr', 'zephyr', false, true), '?q=zephyr&isolate=0');
});

test('nextSearchAddress: an empty box drops isolate=0 with q, so the parameter never stands alone', () => {
  assert.strictEqual(nextSearchAddress('?q=zephyr&isolate=0', '', false, true), '');
  assert.strictEqual(nextSearchAddress('?view=map&q=zephyr&isolate=0', '  ', false, true), '?view=map');
});

test('nextSearchAddress: in the Graph (no off declared) nothing is written for isolate off, and a stale isolate=0 goes', () => {
  assert.strictEqual(nextSearchAddress('', 'zephyr', false, false), '?q=zephyr');
  assert.strictEqual(nextSearchAddress('?q=zephyr&isolate=0', 'zephyr', false, false), '?q=zephyr');
  assert.strictEqual(nextSearchAddress('?q=zephyr', 'zephyr', false), null, 'the fourth argument is off by default');
});
