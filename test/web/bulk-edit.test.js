const { test } = require('node:test');
const assert = require('node:assert');
const { tagUnion, addTagChanges, removeTagsChanges, scheduleChanges, scheduleSummary } = require('../web/bulk-edit');

// pure rules behind the bulk Edit-tags popup.

const CARDS = [
  { id: 1, tags: ['app', 'design'] },
  { id: 2, tags: ['design'] },
  { id: 3, tags: [] },
];

test('tagUnion lists every tag across the selection with its card count, most-carried first, ties alphabetical', () => {
  assert.deepStrictEqual(tagUnion(CARDS), [
    { tag: 'design', count: 2 },
    { tag: 'app', count: 1 },
  ]);
});

test('addTagChanges returns new tag arrays only for cards missing the tag', () => {
  assert.deepStrictEqual(addTagChanges(CARDS, 'design'), [
    { id: 3, tags: ['design'] },
  ]);
  assert.deepStrictEqual(addTagChanges(CARDS, 'new'), [
    { id: 1, tags: ['app', 'design', 'new'] },
    { id: 2, tags: ['design', 'new'] },
    { id: 3, tags: ['new'] },
  ]);
});

test('addTagChanges dedupes case-insensitively', () => {
  assert.deepStrictEqual(addTagChanges([{ id: 1, tags: ['Design'] }], 'design'), []);
});

test('removeTagsChanges strips the chosen tags, touching only cards that carry one', () => {
  assert.deepStrictEqual(removeTagsChanges(CARDS, ['design']), [
    { id: 1, tags: ['app'] },
    { id: 2, tags: [] },
  ]);
  assert.deepStrictEqual(removeTagsChanges(CARDS, ['nope']), []);
});

// pure rules behind the Schedule… popup. Per field: a non-empty
// value sets it (trimmed, never validated), a checked clear box wins with '',
// empty + unchecked leaves the card's value alone (key absent), and a fully
// untouched popup returns null (Apply is a no-op).

const untouched = { value: '', clear: false };

test('scheduleChanges maps set fields onto the date triad keys', () => {
  assert.deepStrictEqual(
    scheduleChanges({ start: { value: '2026-07-01', clear: false }, end: { value: '2026-07-15', clear: false }, due: { value: '2026-07-10', clear: false } }),
    { start_date: '2026-07-01', end_date: '2026-07-15', due_date: '2026-07-10' });
});

test('scheduleChanges trims the typed value but never validates it', () => {
  assert.deepStrictEqual(
    scheduleChanges({ start: { value: '  2026-07-01T09:30  ', clear: false }, end: untouched, due: { value: 'next tuesday', clear: false } }),
    { start_date: '2026-07-01T09:30', due_date: 'next tuesday' });
});

test('scheduleChanges: checked clear sends the empty string (the PATCH clear contract)', () => {
  assert.deepStrictEqual(
    scheduleChanges({ start: untouched, end: { value: '', clear: true }, due: untouched }),
    { end_date: '' });
});

test('scheduleChanges: clear wins over a typed value in the same field', () => {
  assert.deepStrictEqual(
    scheduleChanges({ start: { value: '2026-07-01', clear: true }, end: untouched, due: untouched }),
    { start_date: '' });
});

test('scheduleChanges: empty + unchecked leaves the field out of the PATCH entirely', () => {
  const changes = scheduleChanges({ start: { value: '2026-07-01', clear: false }, end: untouched, due: untouched });
  assert.deepStrictEqual(changes, { start_date: '2026-07-01' });
  assert.strictEqual('end_date' in changes, false);
  assert.strictEqual('due_date' in changes, false);
});

test('scheduleChanges: whitespace-only value counts as untouched, not as a set', () => {
  assert.strictEqual(scheduleChanges({ start: { value: '   ', clear: false }, end: untouched, due: untouched }), null);
});

test('scheduleChanges returns null when all three fields are untouched', () => {
  assert.strictEqual(scheduleChanges({ start: untouched, end: untouched, due: untouched }), null);
});

test('scheduleChanges tolerates missing field entries (treated as untouched)', () => {
  assert.strictEqual(scheduleChanges({}), null);
  assert.deepStrictEqual(scheduleChanges({ due: { value: '2026-08-01', clear: false } }), { due_date: '2026-08-01' });
});

test('scheduleChanges: clearing all three is a real PATCH, not a no-op', () => {
  assert.deepStrictEqual(
    scheduleChanges({ start: { value: '', clear: true }, end: { value: '', clear: true }, due: { value: '', clear: true } }),
    { start_date: '', end_date: '', due_date: '' });
});

test('scheduleChanges: mixed set / clear / leave-alone in one call', () => {
  assert.deepStrictEqual(
    scheduleChanges({ start: { value: '2026-07-01', clear: false }, end: untouched, due: { value: 'ignored', clear: true } }),
    { start_date: '2026-07-01', due_date: '' });
});

test('scheduleSummary names each set and cleared field in triad order', () => {
  assert.strictEqual(scheduleSummary({ start_date: '2026-07-01', end_date: '', due_date: '2026-07-10' }),
    'start → 2026-07-01, end cleared, due → 2026-07-10');
  assert.strictEqual(scheduleSummary({ due_date: '' }), 'due cleared');
  assert.strictEqual(scheduleSummary({ end_date: '2026-07-15' }), 'end → 2026-07-15');
});
