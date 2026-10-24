const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseDeepLink, DEEP_LINK_VIEWS } = require('../../plugin/skills/web/web/deep-link');

// ?card=<id>&q=<search>&view=<board|map|gantt|calendar|graph> deep links. Pure
// querystring parse only — app.js's DOMContentLoaded handler does the DOM part
// (search box, view switch, openDetailModal, scrollIntoView), consumed exactly
// once right after the first loadBoard() resolves.
//
// `card` points at ONE card, `q` points at a SET, `view` points at neither, so
// each key stands on its own — a link may carry any combination of the three.

test('the recognized view set is exactly board/map/gantt/calendar/graph', () => {
  assert.deepStrictEqual([...DEEP_LINK_VIEWS].sort(), ['board', 'calendar', 'gantt', 'graph', 'map']);
});

test('?card=<id>&view=<view> parses both fields', () => {
  assert.deepStrictEqual(parseDeepLink('?card=194&view=board'), { hasCard: true, id: '194', q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=map'), { hasCard: true, id: '7', q: null, view: 'map', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=gantt'), { hasCard: true, id: '7', q: null, view: 'gantt', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=calendar'), { hasCard: true, id: '7', q: null, view: 'calendar', isolate: false });
});

test('none of the three keys present — not a deep link', () => {
  assert.strictEqual(parseDeepLink(''), null);
  assert.strictEqual(parseDeepLink('?foo=bar'), null);
  assert.strictEqual(parseDeepLink('?extra=1&other=2'), null);
});

// kanban.proj#262 — this used to return null: the parser bailed on a missing
// `card` key before it ever read `view`, so a card-less link applied NEITHER
// its query nor its view. Both keys are fixed by the same moved early return.
test('a link with only "view" now resolves — it used to be dropped whole', () => {
  assert.deepStrictEqual(parseDeepLink('?view=board'), { hasCard: false, id: null, q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?view=calendar'), { hasCard: false, id: null, q: null, view: 'calendar', isolate: false });
});

test('a link with only "q" resolves', () => {
  assert.deepStrictEqual(parseDeepLink('?q=status%3Adoing'), { hasCard: false, id: null, q: 'status:doing', view: null, isolate: false });
});

test('q and view compose without a card', () => {
  assert.deepStrictEqual(parseDeepLink('?q=status%3Atodo&view=board'), {
    hasCard: false, id: null, q: 'status:todo', view: 'board', isolate: false,
  });
});

test('all three keys compose', () => {
  assert.deepStrictEqual(parseDeepLink('?card=42&q=type%3Aepic&view=map'), {
    hasCard: true, id: '42', q: 'type:epic', view: 'map', isolate: false,
  });
});

test('missing/unrecognized "view" resolves to view: null — id still parses', () => {
  assert.deepStrictEqual(parseDeepLink('?card=194'), { hasCard: true, id: '194', q: null, view: null, isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=194&view=kanban'), { hasCard: true, id: '194', q: null, view: null, isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=194&view='), { hasCard: true, id: '194', q: null, view: null, isolate: false });
});

test('a "card" value that is no id resolves to id: null, not a dropped link', () => {
  assert.deepStrictEqual(parseDeepLink('?card=abc&view=board'), { hasCard: true, id: null, q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=&view=board'), { hasCard: true, id: null, q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=g7&view=board'), { hasCard: true, id: null, q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=-3&view=board'), { hasCard: true, id: null, q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=3.5&view=board'), { hasCard: true, id: null, q: null, view: 'board', isolate: false });
});

// One unusable key must not discard the keys that parsed fine — otherwise a
// malformed card id would silently swallow the query the link came for.
test('an unusable "card" value still delivers q and view', () => {
  assert.deepStrictEqual(parseDeepLink('?card=abc&q=status%3Adone&view=gantt'), {
    hasCard: true, id: null, q: 'status:done', view: 'gantt', isolate: false,
  });
});

// hasCard is what separates "never asked for a card" from "asked with a bad
// value" — both leave id null, but only the second owes the user a toast.
test('hasCard distinguishes an absent card key from an unusable one', () => {
  assert.strictEqual(parseDeepLink('?q=type%3Aepic').hasCard, false);
  assert.strictEqual(parseDeepLink('?card=abc&q=type%3Aepic').hasCard, true);
});

test('an empty or whitespace-only "q" reads as absent, not as a match-everything filter', () => {
  assert.deepStrictEqual(parseDeepLink('?q=&view=board'), { hasCard: false, id: null, q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?q=%20%20&view=board'), { hasCard: false, id: null, q: null, view: 'board', isolate: false });
  assert.strictEqual(parseDeepLink('?q='), null);
  assert.strictEqual(parseDeepLink('?q=%20%20'), null);
});

test('"q" is trimmed', () => {
  assert.strictEqual(parseDeepLink('?q=%20status%3Adoing%20').q, 'status:doing');
});

// The value is the board's own search grammar, handed over verbatim — there is
// no second query language, so whatever search.js parses is what a link carries.
test('"q" is passed through verbatim once decoded, whatever the grammar', () => {
  assert.strictEqual(parseDeepLink('?q=status%3Adoing%20assignee%3A%40human').q, 'status:doing assignee:@human');
  assert.strictEqual(parseDeepLink('?q=%2342').q, '#42');
  assert.strictEqual(parseDeepLink('?q=tree%3A74').q, 'tree:74');
  assert.strictEqual(parseDeepLink('?q=blocked%3A').q, 'blocked:');
  assert.strictEqual(parseDeepLink('?q=title%3Adeep%20link').q, 'title:deep link');
});

// The shop status page (fpp#60) emits exactly these, one per column count.
test('the shop status page URL shapes parse', () => {
  assert.deepStrictEqual(parseDeepLink('?q=status%3Adoing&view=board'), {
    hasCard: false, id: null, q: 'status:doing', view: 'board', isolate: false,
  });
  assert.deepStrictEqual(parseDeepLink('?q=assignee%3A%40human'), {
    hasCard: false, id: null, q: 'assignee:@human', view: null, isolate: false,
  });
  assert.deepStrictEqual(parseDeepLink('?q=blocked%3A'), {
    hasCard: false, id: null, q: 'blocked:', view: null, isolate: false,
  });
  assert.deepStrictEqual(parseDeepLink('?q=review%3A'), {
    hasCard: false, id: null, q: 'review:', view: null, isolate: false,
  });
});

test('leading zeros / extra params / order do not matter', () => {
  assert.deepStrictEqual(parseDeepLink('?card=007&view=board'), { hasCard: true, id: '7', q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?card=G7&view=board'), { hasCard: true, id: 'G7', q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?view=board&card=194&extra=1'), { hasCard: true, id: '194', q: null, view: 'board', isolate: false });
  assert.deepStrictEqual(parseDeepLink('?extra=1&q=type%3Aepic&card=5'), { hasCard: true, id: '5', q: 'type:epic', view: null, isolate: false });
});

test('non-string input never throws — resolves to null', () => {
  assert.strictEqual(parseDeepLink(null), null);
  assert.strictEqual(parseDeepLink(undefined), null);
  assert.strictEqual(parseDeepLink(42), null);
});

// The DOM half has no test of its own — this suite has no jsdom — so these pin
// the wiring in app.js's source text, the same way the other cross-module
// wiring tests here do. They are a smoke alarm, not a proof of behaviour.
const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8');
const CONSUME = (() => {
  const from = APP.slice(APP.indexOf('function consumeDeepLink()'));
  return from.slice(0, from.indexOf('\nfunction ', 1));
})();

test('consumeDeepLink writes q into the search box through its writer, which re-renders', () => {
  assert.match(CONSUME, /link\.q/, 'consumeDeepLink never reads link.q');
  assert.match(CONSUME, /writeSearch\(link\.q, linkWriteReason\(link\.isolateOff\)\)/, 'the query is not written into the box through the writer, with the reason the selection module names');
  assert.match(CONSUME, /else if \(link\.view\) renderBoard\(\);/, 'a view-only link never re-renders');
});

test('consumeDeepLink resolves the card only when the link asked for one', () => {
  assert.match(CONSUME, /if \(!link\.hasCard\) return;/, 'a card-less link still runs the card lookup');
  assert.ok(
    CONSUME.indexOf('link.q') < CONSUME.indexOf('link.hasCard'),
    'q must be applied before the card is resolved, so a bad card id still delivers the query',
  );
});

// --- isolate in the link ----------------------------------------------------------------
//
// While isolate is on the address carries `isolate=1` beside q (nextSearchAddress, card-history.js).
// The parse tells whether the link asks for it, in the field `isolate`: beside a usable query only.

test('isolate: isolate=1 beside a query asks for isolate, in either order', () => {
  assert.strictEqual(parseDeepLink('?q=%232+%7C+%235&isolate=1').isolate, true);
  assert.strictEqual(parseDeepLink('?isolate=1&q=status%3Adoing&view=graph').isolate, true);
  assert.strictEqual(parseDeepLink('?card=4&q=%234&isolate=1').isolate, true);
});

test('isolate: no query, a blank one, or a value other than 1 asks for nothing', () => {
  for (const search of ['?isolate=1&view=board', '?q=&isolate=1&view=board', '?q=%20%20&isolate=1&view=board', '?q=%232', '?q=%232&isolate=0', '?q=%232&isolate=true', '?q=%232&isolate=', '?q=%232&isolate']) {
    assert.strictEqual(parseDeepLink(search).isolate, false, search);
  }
});

test('a link with only the isolate parameter, or a blank query beside it, is not a deep link', () => {
  for (const search of ['', '?isolate=1', '?q=&isolate=1', '?q=%20%20&isolate=1']) assert.strictEqual(parseDeepLink(search), null, search);
});

test('the isolate parameter adds nothing but the one field to what the parse returns', () => {
  assert.deepStrictEqual(parseDeepLink('?q=%232&isolate=1'), { hasCard: false, id: null, q: '#2', view: null, isolate: true });
});

test('consumeDeepLink isolates from the parse, not from a second read of the address', () => {
  assert.match(CONSUME, /if \(link\.isolate\) isolateFromLink\(link\.q\);/);
  assert.doesNotMatch(APP, /deepLinkIsolates/);
});

// --- isolate=0: how the page says a query is shown lit ---------------------------------------
// Outside the Graph the page writes isolate=0 beside q while isolate is off (nextSearchAddress, card-history.js), so a
// reload reopens the same picture. The parse tells it apart from a link with no parameter, which is an old or
// hand-made link and which the page opens isolated where the view isolates what is typed.

test('isolateOff: isolate=0 beside a usable query says the query is shown lit, in either order', () => {
  assert.strictEqual(parseDeepLink('?q=%232&isolate=0').isolateOff, true);
  assert.strictEqual(parseDeepLink('?isolate=0&q=status%3Adoing&view=board').isolateOff, true);
  assert.strictEqual(parseDeepLink('?q=%232&isolate=0').isolate, false);
});

test('isolateOff: a link with a query and no isolate parameter, isolate=1, or another value says nothing of the kind', () => {
  for (const search of ['?q=%232', '?q=%232&isolate=1', '?q=%232&isolate=true', '?q=%232&isolate=', '?q=%232&isolate']) {
    assert.ok(!('isolateOff' in parseDeepLink(search)), search);
  }
  assert.strictEqual(parseDeepLink('?q=%232&isolate=1').isolate, true);
});

test('isolateOff: no query, or a blank one, says nothing, and the parameter alone is no deep link', () => {
  assert.strictEqual(parseDeepLink('?q=&isolate=0&view=board').isolateOff, undefined);
  assert.strictEqual(parseDeepLink('?isolate=0'), null);
});
