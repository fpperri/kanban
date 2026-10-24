const { test } = require('node:test');
const assert = require('node:assert');
const { isDirty, isMinimalCreate } = require('../web/form-guard');

test('identical snapshots are not dirty', () => {
  assert.strictEqual(isDirty({ title: 'a', body: 'b' }, { title: 'a', body: 'b' }), false);
});

test('a changed value is dirty', () => {
  assert.strictEqual(isDirty({ title: 'a', body: 'b' }, { title: 'a', body: 'c' }), true);
});

test('an added or missing key is dirty (field set drifted)', () => {
  assert.strictEqual(isDirty({ title: 'a' }, { title: 'a', tags: '' }), true);
  assert.strictEqual(isDirty({ title: 'a', tags: '' }, { title: 'a' }), true);
});

test('empty objects are clean; null/undefined snapshot is never dirty (no baseline to lose)', () => {
  assert.strictEqual(isDirty({}, {}), false);
  assert.strictEqual(isDirty(null, { title: 'x' }), false);
  assert.strictEqual(isDirty(undefined, { title: 'x' }), false);
});

test('values compare strictly — "1" vs 1 is dirty, whitespace matters', () => {
  assert.strictEqual(isDirty({ id: '1' }, { id: 1 }), true);
  assert.strictEqual(isDirty({ title: 'a ' }, { title: 'a' }), true);
});

// minimal-first create form — the one presentation decision that's
// pure (DOM wiring is covered by manual checks, not fabricated tests).

test('create mode opens minimal until expanded', () => {
  assert.strictEqual(isMinimalCreate(false, false), true);
});

test('"Show more fields" (expanded) lifts minimal for the rest of the open', () => {
  assert.strictEqual(isMinimalCreate(false, true), false);
});

test('edit mode is never minimal, expanded or not', () => {
  assert.strictEqual(isMinimalCreate(true, false), false);
  assert.strictEqual(isMinimalCreate(true, true), false);
});

test('a fresh open (expanded omitted/undefined) is minimal again — one-way per open, nothing persisted', () => {
  assert.strictEqual(isMinimalCreate(false, undefined), true);
});
