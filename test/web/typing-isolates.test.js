const { test } = require('node:test');
const assert = require('node:assert');
const { typingIsolatesDefaults, mergeTypingIsolates, typingIsolatesWith } = require('../../plugin/skills/web/web/typing-isolates');
const { VIEW_MODES } = require('../../plugin/skills/web/web/calendar-model');

// Typing isolates is one flag per view, kept per board in the browser under its own key
// (isolate.js carries the storage out; helpers/page-vm.js runs it in the real page in isolate.test.js).
// This is the pure half, on the dual-environment pattern of hover-show.js.

const DEFAULTS = { board: true, map: true, calendar: true, gantt: true, graph: false };

test('typing turns isolate on in every view but the Graph until a choice says otherwise, for the views the page has', () => {
  assert.deepStrictEqual(typingIsolatesDefaults(), DEFAULTS);
  assert.deepStrictEqual(Object.keys(typingIsolatesDefaults()), VIEW_MODES);
  assert.deepStrictEqual(mergeTypingIsolates(null), DEFAULTS);
  assert.deepStrictEqual(mergeTypingIsolates(undefined), DEFAULTS);
  assert.deepStrictEqual(mergeTypingIsolates('{}'), DEFAULTS, 'a board that never chose has the defaults');
});

test('a saved choice comes back as saved, per view, from the text or the parsed value, and the Graph can be turned on', () => {
  const want = { ...DEFAULTS, board: false, graph: true };
  assert.deepStrictEqual(mergeTypingIsolates(JSON.stringify({ board: false, graph: true })), want);
  assert.deepStrictEqual(mergeTypingIsolates({ board: false, graph: true }), want);
});

test('a value that is not a boolean, a view that is not listed and a prototype key are dropped', () => {
  const merged = mergeTypingIsolates(JSON.stringify({ board: 'no', map: 0, gantt: null, calendar: false, list: false, __proto__: { graph: true } }));
  assert.deepStrictEqual(merged, { ...DEFAULTS, calendar: false });
  assert.deepStrictEqual(Object.keys(merged), VIEW_MODES);
  for (const raw of ['"off"', '[false]', 'null', '5', 'not json', '', '{"board":']) assert.deepStrictEqual(mergeTypingIsolates(raw), DEFAULTS, raw);
});

test('one view changes alone, a bad change is dropped, and the choice passed in is not touched', () => {
  const choice = typingIsolatesDefaults();
  const next = typingIsolatesWith(choice, 'board', false);
  assert.deepStrictEqual(next, { ...DEFAULTS, board: false });
  assert.deepStrictEqual(choice, DEFAULTS, 'the choice passed in is left as it was');
  assert.deepStrictEqual(typingIsolatesWith(next, 'graph', true), { ...DEFAULTS, board: false, graph: true });
  assert.deepStrictEqual(typingIsolatesWith(next, 'map', 'yes'), next);
  assert.deepStrictEqual(typingIsolatesWith(next, 'list', false), next);
  assert.deepStrictEqual(typingIsolatesWith(null, 'gantt', false), { ...DEFAULTS, gantt: false });
});
