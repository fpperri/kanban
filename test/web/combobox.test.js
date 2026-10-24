const { test } = require('node:test');
const assert = require('node:assert');
const { comboboxSuggestions, applyChoice, nextHighlightIndex } = require('../web/combobox');

// native <datalist> misrenders inside VSCode's Simple
// Browser (popup at wrong coordinates, filter-by-current-value hides all),
// so the form uses a hand-rolled menu. These are its pure rules.

const OPTS = [
  { value: 'High', label: 'High' },
  { value: 'Normal', label: 'Normal' },
  { value: 'Low', label: 'Low' },
];

test('empty text suggests every option', () => {
  assert.deepStrictEqual(comboboxSuggestions(OPTS, ''), OPTS);
});

test('text exactly equal to an option suggests every option — a prefilled field must not hide the list', () => {
  assert.deepStrictEqual(comboboxSuggestions(OPTS, 'Normal'), OPTS);
  assert.deepStrictEqual(comboboxSuggestions(OPTS, 'normal'), OPTS); // case-insensitive
});

test('partial text filters by substring, case-insensitive, matching value or label', () => {
  assert.deepStrictEqual(comboboxSuggestions(OPTS, 'lo'), [{ value: 'Low', label: 'Low' }]);
  const people = [{ value: '@alex', label: '@alex — Alex (human)' }];
  assert.deepStrictEqual(comboboxSuggestions(people, 'alex'), people); // matches the label
});

test('no match suggests nothing (free text stays legal, menu just hides)', () => {
  assert.deepStrictEqual(comboboxSuggestions(OPTS, 'zzz'), []);
});

test('tag mode filters by the segment after the last comma', () => {
  const tags = [{ value: 'config' }, { value: 'design' }, { value: 'skills' }];
  assert.deepStrictEqual(comboboxSuggestions(tags, 'skills, des', { tagMode: true }), [{ value: 'design' }]);
  assert.deepStrictEqual(comboboxSuggestions(tags, 'skills,', { tagMode: true }), tags); // fresh segment: all
});

test('applyChoice replaces the whole value in plain mode', () => {
  assert.strictEqual(applyChoice('Norm', 'Normal'), 'Normal');
});

test('applyChoice in tag mode replaces only the last segment, preserving prior tags', () => {
  assert.strictEqual(applyChoice('skills, des', 'design', { tagMode: true }), 'skills, design');
  assert.strictEqual(applyChoice('skills,', 'design', { tagMode: true }), 'skills, design');
  assert.strictEqual(applyChoice('', 'design', { tagMode: true }), 'design');
});

// picking from the unfiltered focus menu APPENDS a tag; replacing the last
// segment is only for completing something the user was actually typing
test('applyChoice in tag append mode adds a new segment, keeping the complete last tag', () => {
  assert.strictEqual(applyChoice('app, refactor', 'design', { tagMode: true, append: true }), 'app, refactor, design');
  assert.strictEqual(applyChoice('app,', 'design', { tagMode: true, append: true }), 'app, design');
  assert.strictEqual(applyChoice('', 'design', { tagMode: true, append: true }), 'design');
});

test('applyChoice never duplicates a tag already present', () => {
  assert.strictEqual(applyChoice('app, design', 'design', { tagMode: true, append: true }), 'app, design');
  assert.strictEqual(applyChoice('design, des', 'design', { tagMode: true }), 'design'); // typed completion of an existing tag collapses too
});

// keyboard grammar for the menu — Up/Down move a highlight, wrapping.
test('nextHighlightIndex moves Down from none-highlighted to the first row', () => {
  assert.strictEqual(nextHighlightIndex(3, -1, 1), 0);
});

test('nextHighlightIndex moves Up from none-highlighted to the last row', () => {
  assert.strictEqual(nextHighlightIndex(3, -1, -1), 2);
});

test('nextHighlightIndex advances/retreats normally mid-list', () => {
  assert.strictEqual(nextHighlightIndex(3, 1, 1), 2);
  assert.strictEqual(nextHighlightIndex(3, 1, -1), 0);
});

test('nextHighlightIndex wraps Down past the last row back to the first', () => {
  assert.strictEqual(nextHighlightIndex(3, 2, 1), 0);
});

test('nextHighlightIndex wraps Up past the first row back to the last', () => {
  assert.strictEqual(nextHighlightIndex(3, 0, -1), 2);
});

test('nextHighlightIndex is -1 for a filtered-to-nothing menu (no rows to highlight)', () => {
  assert.strictEqual(nextHighlightIndex(0, 1, 1), -1);
  assert.strictEqual(nextHighlightIndex(0, -1, -1), -1);
});

// Defensive guard, not a live app.js scenario: attachCombobox's own open()
// resets highlightIndex to -1 on every (re)open, including a re-filter
// mid-typing, so an out-of-range `current` never actually reaches this
// function through that caller — this just keeps the pure function safe for
// any caller (or future one) that doesn't share that discipline.
test('nextHighlightIndex treats an out-of-range highlight as none (defensive — the real caller never produces one)', () => {
  // e.g. a highlight on row 4 of what is now only a 2-row menu
  assert.strictEqual(nextHighlightIndex(2, 4, 1), 0);
  assert.strictEqual(nextHighlightIndex(2, 4, -1), 1);
});
