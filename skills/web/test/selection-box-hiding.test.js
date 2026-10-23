const { test } = require('node:test');
const assert = require('node:assert');
const { boxHidingTerms, boxLightsMatches, typingTurnsIsolateOn, ISOLATING_REASONS } = require('../web/selection');
const { parseSearchQuery } = require('../web/search');

// What the box does outside the Graph is isolate's to decide: with isolate off the box hides
// only by the slice: terms that stand on their own and lights the cards its other terms match;
// with isolate on the whole query hides. In the Graph every term goes to the Graph's own
// effect (graphQueryEffect, pinned in graph-isolate.test.js). And a query the person writes
// turns isolate on where the view's Typing isolates is on. The page carries these out
// (isolate.test.js and box-lights.test.js run them in the real page).

const terms = (text) => parseSearchQuery(text, 'kanban');
const fields = (list) => list.map((t) => t.field);

test('with isolate off, outside the Graph, the box hides by its top-level slice: terms alone', () => {
  const query = terms('slice:epic zephyr tags:ui');
  assert.deepStrictEqual(fields(boxHidingTerms(query, { view: 'board', isolated: false })), ['slice']);
  for (const view of ['board', 'map', 'calendar', 'gantt']) {
    assert.strictEqual(boxHidingTerms(terms('zephyr'), { view, isolated: false }).length, 0, `${view}: a query with no cut hides nothing`);
  }
});

test('a slice: under | or in a bracket of alternatives is only a term to match: it hides nothing with isolate off', () => {
  assert.strictEqual(boxHidingTerms(terms('slice:epic | zephyr'), { view: 'board', isolated: false }).length, 0);
  assert.strictEqual(boxHidingTerms(terms('(slice:epic | zephyr) tags:ui'), { view: 'gantt', isolated: false }).length, 0);
});

test('with isolate on every view hides by the whole query, and the Graph always hands it all on', () => {
  const query = terms('zephyr tags:ui slice:epic');
  for (const view of ['board', 'map', 'calendar', 'gantt']) assert.strictEqual(boxHidingTerms(query, { view, isolated: true }), query, view);
  assert.strictEqual(boxHidingTerms(query, { view: 'graph', isolated: false }), query);
  assert.strictEqual(boxHidingTerms(query, { view: 'graph', isolated: true }), query);
});

test('no terms hide nothing, and a value that is not a list is no terms', () => {
  assert.deepStrictEqual(boxHidingTerms([], { view: 'board', isolated: false }), []);
  assert.deepStrictEqual(boxHidingTerms(null, { view: 'board', isolated: false }), []);
  assert.deepStrictEqual(boxHidingTerms(undefined, { view: 'board', isolated: true }), []);
});

test('outside the Graph, with isolate off, the box lights its matches unless the query is a cut alone', () => {
  for (const view of ['board', 'map', 'calendar', 'gantt']) {
    assert.strictEqual(boxLightsMatches(terms('zephyr'), { view, isolated: false }), true, view);
    assert.strictEqual(boxLightsMatches(terms('slice:epic zephyr'), { view, isolated: false }), true, `${view}: the rest of the query lights inside the cut`);
    assert.strictEqual(boxLightsMatches(terms('slice:epic'), { view, isolated: false }), false, `${view}: a cut is no search and lights nothing`);
    assert.strictEqual(boxLightsMatches(terms('zephyr'), { view, isolated: true }), false, `${view}: isolated, the box hides and lights nothing`);
  }
  assert.strictEqual(boxLightsMatches([], { view: 'board', isolated: false }), false);
  assert.strictEqual(boxLightsMatches(terms('zephyr'), { view: 'graph', isolated: false }), false, 'the Graph lights through its own effect');
});

test('typing, a pill, a cue and a link turn isolate on where the view has Typing isolates on', () => {
  assert.deepStrictEqual(ISOLATING_REASONS, ['typing', 'pill', 'cue', 'link']);
  for (const reason of ISOLATING_REASONS) {
    assert.strictEqual(typingTurnsIsolateOn({ reason, text: 'zephyr', isolated: false, setting: true }), true, reason);
    assert.strictEqual(typingTurnsIsolateOn({ reason, text: 'zephyr', isolated: false, setting: false }), false, `${reason}: the view lights what is typed`);
  }
});

test('every other write leaves isolate as it was: the clear button, the prefill, a cut, a selection, a menu and isolate\'s own', () => {
  for (const reason of ['clear', 'prefill', 'slice', 'selection', 'isolate', 'menu', undefined]) {
    assert.strictEqual(typingTurnsIsolateOn({ reason, text: 'zephyr', isolated: false, setting: true }), false, String(reason));
  }
});

test('a write that carries no query, or lands while isolate is on, turns nothing on', () => {
  for (const text of ['', '   ', null, undefined]) assert.strictEqual(typingTurnsIsolateOn({ reason: 'typing', text, isolated: false, setting: true }), false, String(text));
  assert.strictEqual(typingTurnsIsolateOn({ reason: 'typing', text: 'zephyr', isolated: true, setting: true }), false);
  assert.strictEqual(typingTurnsIsolateOn({ reason: 'typing', text: 'zephyr', isolated: false, setting: undefined }), false, 'a setting that is not known is off');
});
