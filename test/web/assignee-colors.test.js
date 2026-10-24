const { test } = require('node:test');
const assert = require('node:assert');
const { STATUS_PALETTE, statusHash } = require('../../plugin/skills/web/web/status-colors');
const { assigneeColor, assigneeColorClass, assigneeColorVar, findAssigneeEntry } = require('../../plugin/skills/web/web/assignee-colors');
const { HASH_SLOTS } = require('../../plugin/skills/web/web/status-colors');

// --- assignee colors mirror status-colors.js's contract ------------

test('a reserved config.yaml color wins over the hash', () => {
  const assignees = [{ handle: '@alex', color: '#ff00ff' }];
  assert.strictEqual(assigneeColor('@alex', assignees), '#ff00ff');
});

test('an unreserved handle hashes deterministically into STATUS_PALETTE — the SAME palette custom statuses use, not a forked one', () => {
  const c1 = assigneeColor('@alex', []);
  assert.strictEqual(assigneeColor('@alex', []), c1); // pure: same input, same output
  assert.ok(STATUS_PALETTE.includes(c1));
  assert.strictEqual(c1, STATUS_PALETTE[statusHash('@alex') % STATUS_PALETTE.length]);
});

test('assigneeColor is stable across repeated calls and across an absent/empty registry', () => {
  assert.strictEqual(assigneeColor('@bot', undefined), assigneeColor('@bot', []));
  assert.strictEqual(assigneeColor('@bot', null), assigneeColor('@bot', []));
});

test('an entry with an empty/absent color falls back to the hash — "reserve a color" is opt-in', () => {
  const assignees = [{ handle: '@alex', color: '' }, { handle: '@bob' }];
  assert.strictEqual(assigneeColor('@alex', assignees), assigneeColor('@alex', []));
  assert.strictEqual(assigneeColor('@bob', assignees), assigneeColor('@bob', []));
});

test('registry lookup is exact-match on the handle — same contract column-sort.js\'s assignee sort already uses (unlike statusColor\'s case-folded match)', () => {
  const assignees = [{ handle: '@Alex', color: '#111111' }];
  assert.strictEqual(assigneeColor('@alex', assignees), assigneeColor('@alex', [])); // no case-insensitive match
  assert.strictEqual(assigneeColor('@Alex', assignees), '#111111'); // exact match wins
});

test('assigneeColor tolerates a missing/null/empty handle without throwing', () => {
  assert.strictEqual(assigneeColor(null, []), null);
  assert.strictEqual(assigneeColor(undefined, []), null);
  assert.strictEqual(assigneeColor('', []), null);
  assert.strictEqual(assigneeColor('   ', []), null);
});

test('assigneeColor never throws on hostile handles (proto keys, non-string)', () => {
  for (const h of ['constructor', '__proto__', 'hasOwnProperty', 42]) {
    assert.doesNotThrow(() => assigneeColor(h, []));
  }
});

test('findAssigneeEntry returns the exact-match entry or null', () => {
  const alex = { handle: '@alex', color: '#123456' };
  assert.strictEqual(findAssigneeEntry('@alex', [alex]), alex);
  assert.strictEqual(findAssigneeEntry('@nope', [alex]), null);
  assert.strictEqual(findAssigneeEntry('@alex', null), null);
  assert.strictEqual(findAssigneeEntry('', [alex]), null);
});

// --- the CSS-class twin (CSP compliance) -----------------------

test('assigneeColorClass reuses the exact palette-N slot statusColorClass would give the same string, for the hashed case', () => {
  const cls = assigneeColorClass('@alex', []);
  assert.match(cls, /^palette-\d$/);
  assert.strictEqual(cls, `palette-${statusHash('@alex') % STATUS_PALETTE.length}`);
});

test('assigneeColorClass returns null when a reserved color applies — no fixed class covers an arbitrary hex', () => {
  const assignees = [{ handle: '@alex', color: '#ff00ff' }];
  assert.strictEqual(assigneeColorClass('@alex', assignees), null);
});

test('assigneeColorClass returns null for a missing/empty handle', () => {
  assert.strictEqual(assigneeColorClass('', []), null);
  assert.strictEqual(assigneeColorClass(null, []), null);
});

test('assigneeColorClass is deterministic and pure, same contract as statusColorClass', () => {
  assert.strictEqual(assigneeColorClass('@bot', []), assigneeColorClass('@bot', []));
});


// --- assigneeColorVar: what app.js paints inline ----------------------------
test('assigneeColorVar paints a reserved colour exactly as written', () => {
  assert.strictEqual(assigneeColorVar('@alex', [{ handle: '@alex', color: '#ff00ff' }]), '#ff00ff');
});

test('assigneeColorVar hands an unreserved handle its hashed slot as a theme-following token', () => {
  const slot = statusHash('@alex') % STATUS_PALETTE.length;
  assert.strictEqual(assigneeColorVar('@alex', []), `var(--hash-${HASH_SLOTS[slot]})`);
  assert.strictEqual(assigneeColorVar('@alex', []), assigneeColorVar(' @alex ', []));
});

test('assigneeColorVar returns null for an empty handle', () => {
  assert.strictEqual(assigneeColorVar('', []), null);
  assert.strictEqual(assigneeColorVar(null, []), null);
});
