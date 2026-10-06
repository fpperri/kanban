const { test } = require('node:test');
const assert = require('node:assert');
const {
  isBlockedValue, blockedReason, blockedLabel,
  isReviewValue, reviewReason, reviewLabel,
  unresolvedWaits,
} = require('../web/waiting-blocked');

// the ONE shared home of both doing-gate predicates.
// card-store.js (the store) and app.js/dependency-graph.js (the UI) all call
// these — pinned here once so the two sides can never drift.

// --- the blocked-sticker predicate -------------------------------------------

test('isBlockedValue: a reason with >=1 alphanumeric character is blocked', () => {
  assert.strictEqual(isBlockedValue('legal sign-off pending'), true);
  assert.strictEqual(isBlockedValue('x'), true);
  assert.strictEqual(isBlockedValue('  padded reason  '), true, 'trimmed first');
  assert.strictEqual(isBlockedValue('!x!'), true, 'one alphanumeric among punctuation is enough');
  assert.strictEqual(isBlockedValue('42'), true, 'digits count as alphanumeric');
});

test('isBlockedValue: empty / whitespace / punctuation-only values are not blocked', () => {
  assert.strictEqual(isBlockedValue(''), false);
  assert.strictEqual(isBlockedValue('   '), false);
  assert.strictEqual(isBlockedValue('!!!'), false, 'no alphanumeric character');
  assert.strictEqual(isBlockedValue('—'), false);
  assert.strictEqual(isBlockedValue(null), false);
  assert.strictEqual(isBlockedValue(undefined), false);
});

test('isBlockedValue: YAML boolean special-case — false/no clear, true blocks with reason unspecified', () => {
  assert.strictEqual(isBlockedValue('false'), false);
  assert.strictEqual(isBlockedValue('no'), false);
  assert.strictEqual(isBlockedValue('FALSE'), false, 'any-case, tolerant read');
  assert.strictEqual(isBlockedValue('No'), false);
  assert.strictEqual(isBlockedValue(' false '), false, 'trimmed before the special-case');
  assert.strictEqual(isBlockedValue('true'), true);
  assert.strictEqual(isBlockedValue('TRUE'), true);
  assert.strictEqual(isBlockedValue(true), true, 'a real API boolean true blocks');
  assert.strictEqual(isBlockedValue(false), false, 'a real API boolean false clears');
});

test('isBlockedValue: only false/no are the not-blocked special cases — other YAML-ish words read as reasons', () => {
  assert.strictEqual(isBlockedValue('yes'), true, '"yes" is a (odd) reason, not a boolean special-case — the contract names only false/no');
  assert.strictEqual(isBlockedValue('off'), true);
});

// --- the reason / label helpers ----------------------------------------------

test('blockedReason: the trimmed text for a valid sticker; empty for true (unspecified) and for any clear value', () => {
  assert.strictEqual(blockedReason(' vendor outage '), 'vendor outage');
  assert.strictEqual(blockedReason('true'), '', 'blocked, reason unspecified');
  assert.strictEqual(blockedReason(true), '');
  assert.strictEqual(blockedReason('false'), '');
  assert.strictEqual(blockedReason('   '), '');
  assert.strictEqual(blockedReason(null), '');
});

test('blockedLabel: the epic-fixed refusal wording — "blocked: <reason>" or the bare "blocked"', () => {
  assert.strictEqual(blockedLabel('vendor outage'), 'blocked: vendor outage');
  assert.strictEqual(blockedLabel('true'), 'blocked');
  assert.strictEqual(blockedLabel('false'), 'blocked', 'label for a clear value is never shown — callers gate on isBlockedValue first');
});

// --- ADR 0009: review is blocked's sibling sticker, same predicate ----------

test('isReviewValue: exact same predicate as isBlockedValue (ADR 0009 — one presence rule, two stickers)', () => {
  assert.strictEqual(isReviewValue('PR #6'), true);
  assert.strictEqual(isReviewValue('  '), false);
  assert.strictEqual(isReviewValue('false'), false);
  assert.strictEqual(isReviewValue('no'), false);
  assert.strictEqual(isReviewValue('true'), true);
  assert.strictEqual(isReviewValue(true), true);
  assert.strictEqual(isReviewValue(false), false);
  assert.strictEqual(isReviewValue(null), false);
  assert.strictEqual(isReviewValue(undefined), false);
});

test('reviewReason: the trimmed text for a valid sticker; empty for true (unspecified) and for any clear value', () => {
  assert.strictEqual(reviewReason(' PR #6 '), 'PR #6');
  assert.strictEqual(reviewReason('true'), '');
  assert.strictEqual(reviewReason(true), '');
  assert.strictEqual(reviewReason('false'), '');
  assert.strictEqual(reviewReason(null), '');
});

test('reviewLabel: "review: <text>" or the bare "review" — never "blocked"', () => {
  assert.strictEqual(reviewLabel('PR #6'), 'review: PR #6');
  assert.strictEqual(reviewLabel('true'), 'review');
  assert.strictEqual(reviewLabel('false'), 'review', 'label for a clear value is never shown — callers gate on isReviewValue first');
});

// --- the waiting predicate -----------------------------------------------------

function byIdOf(cards) { return new Map(cards.map((c) => [c.id, c])); }

test('unresolvedWaits: lists exactly the not-done deps, in list order', () => {
  const byId = byIdOf([
    { id: 1, status: 'done' },
    { id: 2, status: 'todo' },
    { id: 3, status: 'backlog' },
  ]);
  assert.deepStrictEqual(unresolvedWaits([3, 1, 2], byId).map((c) => c.id), [3, 2], 'done deps drop out; order preserved');
  assert.deepStrictEqual(unresolvedWaits([1], byId), [], 'all deps done — not waiting');
  assert.deepStrictEqual(unresolvedWaits([], byId), []);
  assert.deepStrictEqual(unresolvedWaits(null, byId), [], 'missing list tolerated');
});

test('unresolvedWaits: a dangling id (no matching card) is non-blocking — codified from web\'s behavior', () => {
  const byId = byIdOf([{ id: 1, status: 'done' }]);
  assert.deepStrictEqual(unresolvedWaits([1, 999], byId), [], 'the dangling 999 never makes the card waiting');
});

test('unresolvedWaits: string ids resolve against numeric card ids (frontmatter lists arrive parsed, API bodies may not)', () => {
  const byId = byIdOf([{ id: 7, status: 'todo' }]);
  assert.deepStrictEqual(unresolvedWaits(['7'], byId).map((c) => c.id), [7]);
});
