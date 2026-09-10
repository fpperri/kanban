const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseDeepLink, DEEP_LINK_VIEWS } = require('../web/deep-link');

// ?card=<id>&q=<search>&view=<board|map|gantt|calendar> deep links. Pure
// querystring parse only — app.js's DOMContentLoaded handler does the DOM part
// (search box, view switch, openDetailModal, scrollIntoView), consumed exactly
// once right after the first loadBoard() resolves.
//
// `card` points at ONE card, `q` points at a SET, `view` points at neither, so
// each key stands on its own — a link may carry any combination of the three.

test('the recognized view set is exactly board/map/gantt/calendar', () => {
  assert.deepStrictEqual([...DEEP_LINK_VIEWS].sort(), ['board', 'calendar', 'gantt', 'map']);
});

test('?card=<id>&view=<view> parses both fields', () => {
  assert.deepStrictEqual(parseDeepLink('?card=194&view=board'), { hasCard: true, id: 194, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=map'), { hasCard: true, id: 7, q: null, view: 'map' });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=gantt'), { hasCard: true, id: 7, q: null, view: 'gantt' });
  assert.deepStrictEqual(parseDeepLink('?card=7&view=calendar'), { hasCard: true, id: 7, q: null, view: 'calendar' });
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
  assert.deepStrictEqual(parseDeepLink('?view=board'), { hasCard: false, id: null, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?view=calendar'), { hasCard: false, id: null, q: null, view: 'calendar' });
});

test('a link with only "q" resolves', () => {
  assert.deepStrictEqual(parseDeepLink('?q=status%3Adoing'), { hasCard: false, id: null, q: 'status:doing', view: null });
});

test('q and view compose without a card', () => {
  assert.deepStrictEqual(parseDeepLink('?q=status%3Atodo&view=board'), {
    hasCard: false, id: null, q: 'status:todo', view: 'board',
  });
});

test('all three keys compose', () => {
  assert.deepStrictEqual(parseDeepLink('?card=42&q=epic%3A&view=map'), {
    hasCard: true, id: 42, q: 'epic:', view: 'map',
  });
});

test('missing/unrecognized "view" resolves to view: null — id still parses', () => {
  assert.deepStrictEqual(parseDeepLink('?card=194'), { hasCard: true, id: 194, q: null, view: null });
  assert.deepStrictEqual(parseDeepLink('?card=194&view=kanban'), { hasCard: true, id: 194, q: null, view: null });
  assert.deepStrictEqual(parseDeepLink('?card=194&view='), { hasCard: true, id: 194, q: null, view: null });
});

test('a non-numeric or non-positive-integer "card" value resolves to id: null, not a dropped link', () => {
  assert.deepStrictEqual(parseDeepLink('?card=abc&view=board'), { hasCard: true, id: null, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=&view=board'), { hasCard: true, id: null, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=0&view=board'), { hasCard: true, id: null, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=-3&view=board'), { hasCard: true, id: null, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?card=3.5&view=board'), { hasCard: true, id: null, q: null, view: 'board' });
});

// One unusable key must not discard the keys that parsed fine — otherwise a
// malformed card id would silently swallow the query the link came for.
test('an unusable "card" value still delivers q and view', () => {
  assert.deepStrictEqual(parseDeepLink('?card=abc&q=status%3Adone&view=gantt'), {
    hasCard: true, id: null, q: 'status:done', view: 'gantt',
  });
});

// hasCard is what separates "never asked for a card" from "asked with a bad
// value" — both leave id null, but only the second owes the user a toast.
test('hasCard distinguishes an absent card key from an unusable one', () => {
  assert.strictEqual(parseDeepLink('?q=epic%3A').hasCard, false);
  assert.strictEqual(parseDeepLink('?card=abc&q=epic%3A').hasCard, true);
});

test('an empty or whitespace-only "q" reads as absent, not as a match-everything filter', () => {
  assert.deepStrictEqual(parseDeepLink('?q=&view=board'), { hasCard: false, id: null, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?q=%20%20&view=board'), { hasCard: false, id: null, q: null, view: 'board' });
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
    hasCard: false, id: null, q: 'status:doing', view: 'board',
  });
  assert.deepStrictEqual(parseDeepLink('?q=assignee%3A%40human'), {
    hasCard: false, id: null, q: 'assignee:@human', view: null,
  });
  assert.deepStrictEqual(parseDeepLink('?q=blocked%3A'), {
    hasCard: false, id: null, q: 'blocked:', view: null,
  });
  assert.deepStrictEqual(parseDeepLink('?q=review%3A'), {
    hasCard: false, id: null, q: 'review:', view: null,
  });
});

test('leading zeros / extra params / order do not matter', () => {
  assert.deepStrictEqual(parseDeepLink('?card=007&view=board'), { hasCard: true, id: 7, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?view=board&card=194&extra=1'), { hasCard: true, id: 194, q: null, view: 'board' });
  assert.deepStrictEqual(parseDeepLink('?extra=1&q=epic%3A&card=5'), { hasCard: true, id: 5, q: 'epic:', view: null });
});

test('non-string input never throws — resolves to null', () => {
  assert.strictEqual(parseDeepLink(null), null);
  assert.strictEqual(parseDeepLink(undefined), null);
  assert.strictEqual(parseDeepLink(42), null);
});

// The DOM half has no test of its own — this suite has no jsdom — so these pin
// the wiring in app.js's source text, the same way the other cross-module
// wiring tests here do. They are a smoke alarm, not a proof of behaviour.
const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const CONSUME = (() => {
  const from = APP.slice(APP.indexOf('function consumeDeepLink()'));
  return from.slice(0, from.indexOf('\nfunction ', 1));
})();

test('consumeDeepLink writes q into the search box and re-renders', () => {
  assert.match(CONSUME, /link\.q/, 'consumeDeepLink never reads link.q');
  assert.match(CONSUME, /\$\('#search-input'\)/, 'the query never reaches #search-input');
  assert.match(CONSUME, /input\.value = link\.q/, 'the query is not written into the box');
  assert.match(CONSUME, /if \(link\.q \|\| link\.view\) renderBoard\(\);/, 'a q-only link never re-renders');
});

test('consumeDeepLink resolves the card only when the link asked for one', () => {
  assert.match(CONSUME, /if \(!link\.hasCard\) return;/, 'a card-less link still runs the card lookup');
  assert.ok(
    CONSUME.indexOf('link.q') < CONSUME.indexOf('link.hasCard'),
    'q must be applied before the card is resolved, so a bad card id still delivers the query',
  );
});
