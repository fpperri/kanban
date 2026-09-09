const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  SORT_FIELDS, SORT_FIELD_LABELS, DEFAULT_SORT_DIRECTION, DEFAULT_SORT,
  mergeSortState, compareCards, sortCards, scheduleKey, scheduleLabel, scheduleRows,
} = require('../web/column-sort');

// --- constants --------------------------------------------------------

test('SORT_FIELDS lists exactly id / priority / due / modified / assignee', () => {
  assert.deepStrictEqual(SORT_FIELDS, ['id', 'priority', 'due', 'modified', 'assignee']);
});

test('SORT_FIELD_LABELS names the split fields "Due date" and "Last modified" and "Assignee"', () => {
  assert.strictEqual(SORT_FIELD_LABELS.due, 'Due date');
  assert.strictEqual(SORT_FIELD_LABELS.modified, 'Last modified');
  assert.strictEqual(SORT_FIELD_LABELS.assignee, 'Assignee');
});

test('DEFAULT_SORT_DIRECTION: priority and modified start desc (High-first / newest-first), id/due/assignee asc', () => {
  assert.deepStrictEqual(DEFAULT_SORT_DIRECTION, { id: 'asc', priority: 'desc', due: 'asc', modified: 'desc', assignee: 'asc' });
});

test('DEFAULT_SORT: live columns priority-desc, Archive id-asc', () => {
  assert.deepStrictEqual(DEFAULT_SORT, {
    backlog: { field: 'priority', direction: 'desc' },
    todo: { field: 'priority', direction: 'desc' },
    doing: { field: 'priority', direction: 'desc' },
    done: { field: 'priority', direction: 'desc' },
    archive: { field: 'id', direction: 'asc' },
  });
});

// --- mergeSortState -----------------------------------------------------

test('mergeSortState returns the defaults for undefined/null saved value', () => {
  assert.deepStrictEqual(mergeSortState(undefined), DEFAULT_SORT);
  assert.deepStrictEqual(mergeSortState(null), DEFAULT_SORT);
});

test('mergeSortState overrides only columns with a structurally valid {field, direction} entry', () => {
  const result = mergeSortState({ todo: { field: 'due', direction: 'asc' }, done: { field: 'id', direction: 'desc' } });
  assert.deepStrictEqual(result, {
    backlog: { field: 'priority', direction: 'desc' },
    todo: { field: 'due', direction: 'asc' },
    doing: { field: 'priority', direction: 'desc' },
    done: { field: 'id', direction: 'desc' },
    archive: { field: 'id', direction: 'asc' },
  });
});

test('mergeSortState migrates a legacy saved field "date" to "due", direction preserved', () => {
  const result = mergeSortState({ todo: { field: 'date', direction: 'desc' }, done: { field: 'date', direction: 'asc' } });
  assert.deepStrictEqual(result.todo, { field: 'due', direction: 'desc' });
  assert.deepStrictEqual(result.done, { field: 'due', direction: 'asc' });
});

test('mergeSortState: a legacy "date" entry with an invalid or missing direction still falls back to the default', () => {
  assert.deepStrictEqual(mergeSortState({ todo: { field: 'date', direction: 'sideways' } }).todo, DEFAULT_SORT.todo);
  assert.deepStrictEqual(mergeSortState({ todo: { field: 'date' } }).todo, DEFAULT_SORT.todo);
});

test('mergeSortState falls back to defaults for a non-object saved value (string/array/number)', () => {
  assert.deepStrictEqual(mergeSortState('corrupt'), DEFAULT_SORT);
  assert.deepStrictEqual(mergeSortState(['todo', true]), DEFAULT_SORT);
  assert.deepStrictEqual(mergeSortState(42), DEFAULT_SORT);
});

test('mergeSortState ignores an entry with an unknown field, keeping the default for that column', () => {
  const result = mergeSortState({ todo: { field: 'title', direction: 'asc' } });
  assert.deepStrictEqual(result.todo, DEFAULT_SORT.todo);
});

test('mergeSortState ignores an entry with an invalid direction, keeping the default for that column', () => {
  const result = mergeSortState({ todo: { field: 'id', direction: 'sideways' } });
  assert.deepStrictEqual(result.todo, DEFAULT_SORT.todo);
});

test('mergeSortState ignores a malformed (non-object / missing field) entry for a column', () => {
  assert.deepStrictEqual(mergeSortState({ todo: 'id' }).todo, DEFAULT_SORT.todo);
  assert.deepStrictEqual(mergeSortState({ todo: null }).todo, DEFAULT_SORT.todo);
  assert.deepStrictEqual(mergeSortState({ todo: { field: 'id' } }).todo, DEFAULT_SORT.todo);
});

test('mergeSortState drops unknown/stale column keys from a prior column set', () => {
  const result = mergeSortState({ review: { field: 'id', direction: 'asc' } });
  assert.deepStrictEqual(result, DEFAULT_SORT);
  assert.strictEqual('review' in result, false);
});

// --- dynamic column keys ---------------------------------------------

test('mergeSortState with a custom column set derives defaults per column: priority-desc live, id-asc archive', () => {
  const ids = ['triage', 'review', 'archive'];
  assert.deepStrictEqual(mergeSortState(null, ids), {
    triage: { field: 'priority', direction: 'desc' },
    review: { field: 'priority', direction: 'desc' },
    archive: { field: 'id', direction: 'asc' },
  });
});

test('mergeSortState honors a saved entry for a custom column and drops keys from a prior column set', () => {
  const ids = ['triage', 'review', 'archive'];
  const merged = mergeSortState({ review: { field: 'due', direction: 'desc' }, todo: { field: 'id', direction: 'asc' } }, ids);
  assert.deepStrictEqual(merged.review, { field: 'due', direction: 'desc' });
  assert.deepStrictEqual(merged.triage, { field: 'priority', direction: 'desc' });
  assert.strictEqual('todo' in merged, false);
});

test('mergeSortState applies the legacy "date"→"due" migration to custom columns too', () => {
  const ids = ['triage', 'review', 'archive'];
  const merged = mergeSortState({ review: { field: 'date', direction: 'desc' } }, ids);
  assert.deepStrictEqual(merged.review, { field: 'due', direction: 'desc' });
});

test('mergeSortState tolerates arbitrary column names (dots/spaces) as keys', () => {
  const ids = ['a.b', 'c d', 'archive'];
  const merged = mergeSortState({ 'c d': { field: 'id', direction: 'desc' } }, ids);
  assert.deepStrictEqual(merged['c d'], { field: 'id', direction: 'desc' });
  assert.deepStrictEqual(merged['a.b'], { field: 'priority', direction: 'desc' });
});

// --- compareCards: id ----------------------------------------------------

function card(overrides) {
  return Object.assign({ id: 1, priority: 'Normal', due_date: null }, overrides);
}

test('compareCards id ascending sorts lowest id first', () => {
  const cards = [card({ id: 3 }), card({ id: 1 }), card({ id: 2 })];
  const sorted = sortCards(cards, { field: 'id', direction: 'asc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [1, 2, 3]);
});

test('compareCards id descending sorts highest id first', () => {
  const cards = [card({ id: 3 }), card({ id: 1 }), card({ id: 2 })];
  const sorted = sortCards(cards, { field: 'id', direction: 'desc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [3, 2, 1]);
});

// --- compareCards: priority -----------------------------------------------

test('compareCards priority desc (default) puts High before Normal, ties id-stable', () => {
  const cards = [
    card({ id: 3, priority: 'Normal' }),
    card({ id: 1, priority: 'High' }),
    card({ id: 2, priority: 'High' }),
    card({ id: 4, priority: 'Normal' }),
  ];
  const sorted = sortCards(cards, { field: 'priority', direction: 'desc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [1, 2, 3, 4]); // High(1,2) then Normal(3,4), each ascending by id
});

test('compareCards priority asc puts Normal before High, ties still id-stable', () => {
  const cards = [
    card({ id: 3, priority: 'Normal' }),
    card({ id: 1, priority: 'High' }),
    card({ id: 2, priority: 'High' }),
    card({ id: 4, priority: 'Normal' }),
  ];
  const sorted = sortCards(cards, { field: 'priority', direction: 'asc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [3, 4, 1, 2]); // Normal(3,4) then High(1,2), each ascending by id
});

// --- compareCards: due (formerly the 'date' field) -------------------------

test('compareCards due asc sorts earliest due_date first', () => {
  const cards = [
    card({ id: 1, due_date: '2026-08-01' }),
    card({ id: 2, due_date: '2026-07-01' }),
    card({ id: 3, due_date: '2026-07-15' }),
  ];
  const sorted = sortCards(cards, { field: 'due', direction: 'asc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [2, 3, 1]);
});

test('compareCards due desc sorts latest due_date first', () => {
  const cards = [
    card({ id: 1, due_date: '2026-08-01' }),
    card({ id: 2, due_date: '2026-07-01' }),
    card({ id: 3, due_date: '2026-07-15' }),
  ];
  const sorted = sortCards(cards, { field: 'due', direction: 'desc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [1, 3, 2]);
});

test('compareCards due: cards without due_date sort LAST in both directions', () => {
  const cards = [
    card({ id: 1, due_date: null }),
    card({ id: 2, due_date: '2026-07-01' }),
    card({ id: 3, due_date: undefined }),
    card({ id: 4, due_date: '2026-08-01' }),
  ];
  const asc = sortCards(cards, { field: 'due', direction: 'asc' });
  assert.deepStrictEqual(asc.map((c) => c.id), [2, 4, 1, 3]); // dated ones first (earliest first), undated last (id-stable)

  const desc = sortCards(cards, { field: 'due', direction: 'desc' });
  assert.deepStrictEqual(desc.map((c) => c.id), [4, 2, 1, 3]); // dated ones first (latest first), undated STILL last
});

test('compareCards due: an empty-string due_date is treated as missing, sorts last', () => {
  const cards = [card({ id: 1, due_date: '' }), card({ id: 2, due_date: '2026-07-01' })];
  const sorted = sortCards(cards, { field: 'due', direction: 'asc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [2, 1]);
});

test('compareCards due: same due_date ties break by id ascending', () => {
  const cards = [
    card({ id: 3, due_date: '2026-07-01' }),
    card({ id: 1, due_date: '2026-07-01' }),
    card({ id: 2, due_date: '2026-07-01' }),
  ];
  const sorted = sortCards(cards, { field: 'due', direction: 'desc' });
  assert.deepStrictEqual(sorted.map((c) => c.id), [1, 2, 3]);
});

test('compareCards due: a datetime due_date sorts correctly against plain dates — lexicographic ISO', () => {
  // '2026-07-01' < '2026-07-01T09:00' < '2026-07-02' < '2026-07-02T08:30'
  // (a bare date sorts before any datetime on the same day; that's the
  // documented consequence of comparing ISO strings lexicographically, no
  // Date parsing needed)
  const cards = [
    card({ id: 1, due_date: '2026-07-01T09:00' }),
    card({ id: 2, due_date: '2026-07-02' }),
    card({ id: 3, due_date: '2026-07-01' }),
    card({ id: 4, due_date: '2026-07-02T08:30' }),
  ];
  const asc = sortCards(cards, { field: 'due', direction: 'asc' });
  assert.deepStrictEqual(asc.map((c) => c.id), [3, 1, 2, 4]);
  const desc = sortCards(cards, { field: 'due', direction: 'desc' });
  assert.deepStrictEqual(desc.map((c) => c.id), [4, 2, 1, 3]);
});

// --- sortCards purity ------------------------------------------------------

test('sortCards does not mutate the input array', () => {
  const cards = [card({ id: 3 }), card({ id: 1 }), card({ id: 2 })];
  const original = cards.slice();
  sortCards(cards, { field: 'id', direction: 'asc' });
  assert.deepStrictEqual(cards, original);
});

// --- priority rank comes from the configured list, not a hardcoded 'High' check ---

const PRIO = { field: 'priority', direction: 'desc' };

test('default priorities list ranks High > Normal > Low', () => {
  const cards = [
    { id: 1, priority: 'Low' },
    { id: 2, priority: 'Normal' },
    { id: 3, priority: 'High' },
  ];
  assert.deepStrictEqual(sortCards(cards, PRIO).map((c) => c.id), [3, 2, 1]);
});

test('unknown priority sorts after all known ones, in both directions', () => {
  const cards = [
    { id: 1, priority: 'Weird' },
    { id: 2, priority: 'Low' },
    { id: 3, priority: 'High' },
  ];
  assert.deepStrictEqual(sortCards(cards, PRIO).map((c) => c.id), [3, 2, 1]);
  assert.deepStrictEqual(sortCards(cards, { field: 'priority', direction: 'asc' }).map((c) => c.id), [2, 3, 1]);
});

test('a configured priorities list overrides the default ranking', () => {
  const cards = [
    { id: 1, priority: 'P1' },
    { id: 2, priority: 'High' }, // not in this board's list — unknown, sorts last
    { id: 3, priority: 'P0' },
  ];
  assert.deepStrictEqual(sortCards(cards, PRIO, ['P0', 'P1']).map((c) => c.id), [3, 1, 2]);
});

test('priority ties still break by id ascending under a configured list', () => {
  const cards = [
    { id: 9, priority: 'P0' },
    { id: 4, priority: 'P0' },
  ];
  assert.deepStrictEqual(sortCards(cards, PRIO, ['P0', 'P1']).map((c) => c.id), [4, 9]);
});

// --- the Due date sort is triad-aware — due wins, else the range
// end, else its start; only truly dateless cards sort last.

const DUE_ASC = { field: 'due', direction: 'asc' };

test('due sort keys on due, else end, else start — range-only cards join the order', () => {
  const cards = [
    { id: 1, due_date: '2026-07-01T14:00' },
    { id: 2, start_date: '2026-06-20', end_date: '2026-06-25' },
    { id: 3, start_date: '2026-06-28' },
    { id: 4 },
  ];
  assert.deepStrictEqual(sortCards(cards, DUE_ASC).map((c) => c.id), [2, 3, 1, 4]);
  assert.deepStrictEqual(sortCards(cards, { field: 'due', direction: 'desc' }).map((c) => c.id), [1, 3, 2, 4]);
});

test('due sort orders by time within a day, date-only first (start-of-day read)', () => {
  const cards = [
    { id: 1, due_date: '2026-07-01T14:00' },
    { id: 2, due_date: '2026-07-01T09:00' },
    { id: 3, due_date: '2026-07-01' },
  ];
  assert.deepStrictEqual(sortCards(cards, DUE_ASC).map((c) => c.id), [3, 2, 1]);
});

// --- the Last modified sort keys on the machine-maintained
// `updated` stamp — newest-first by default, missing-last always.

test('modified desc sorts most recently updated first', () => {
  const cards = [
    { id: 1, updated: '2026-07-01T10:00:00' },
    { id: 2, updated: '2026-07-09T23:30:00' },
    { id: 3, updated: '2026-07-05T08:15:00' },
  ];
  assert.deepStrictEqual(sortCards(cards, { field: 'modified', direction: 'desc' }).map((c) => c.id), [2, 3, 1]);
});

test('modified asc sorts least recently updated first', () => {
  const cards = [
    { id: 1, updated: '2026-07-01T10:00:00' },
    { id: 2, updated: '2026-07-09T23:30:00' },
    { id: 3, updated: '2026-07-05T08:15:00' },
  ];
  assert.deepStrictEqual(sortCards(cards, { field: 'modified', direction: 'asc' }).map((c) => c.id), [1, 3, 2]);
});

test('modified: cards without an updated stamp sort LAST in both directions, id-stable', () => {
  const cards = [
    { id: 1 },
    { id: 2, updated: '2026-07-09T23:30:00' },
    { id: 3, updated: null },
    { id: 4, updated: '2026-07-01T10:00:00' },
  ];
  const desc = sortCards(cards, { field: 'modified', direction: 'desc' });
  assert.deepStrictEqual(desc.map((c) => c.id), [2, 4, 1, 3]);
  const asc = sortCards(cards, { field: 'modified', direction: 'asc' });
  assert.deepStrictEqual(asc.map((c) => c.id), [4, 2, 1, 3]);
});

test('modified: an empty-string updated is treated as missing, sorts last', () => {
  const cards = [{ id: 1, updated: '' }, { id: 2, updated: '2026-07-01T10:00:00' }];
  assert.deepStrictEqual(sortCards(cards, { field: 'modified', direction: 'desc' }).map((c) => c.id), [2, 1]);
});

test('modified: a date-only updated stamp sorts against datetimes lexicographically, start-of-day read (same rule as due)', () => {
  const cards = [
    { id: 1, updated: '2026-07-09T09:00:00' },
    { id: 2, updated: '2026-07-09' },
    { id: 3, updated: '2026-07-08T23:59:59' },
  ];
  assert.deepStrictEqual(sortCards(cards, { field: 'modified', direction: 'asc' }).map((c) => c.id), [3, 2, 1]);
});

test('modified: identical updated stamps tie-break by id ascending', () => {
  const cards = [
    { id: 3, updated: '2026-07-01T10:00:00' },
    { id: 1, updated: '2026-07-01T10:00:00' },
    { id: 2, updated: '2026-07-01T10:00:00' },
  ];
  assert.deepStrictEqual(sortCards(cards, { field: 'modified', direction: 'desc' }).map((c) => c.id), [1, 2, 3]);
});

// --- the Assignee sort groups cards by owner handle. Registered
// handles rank by the config.yaml assignees REGISTRY order (human first, then
// HITL, then AFK reads better than alphabetical); unregistered handles follow
// all registered ones, lexicographic among themselves; unassigned cards sort
// last in both directions — same pin as missing due_date / missing updated.

const REGISTRY = ['@alex', '@claude-hitl', '@claude-afk'];
const ASSIGNEE_ASC = { field: 'assignee', direction: 'asc' };
const ASSIGNEE_DESC = { field: 'assignee', direction: 'desc' };

test('assignee asc ranks registered handles by registry order, not alphabetically', () => {
  const cards = [
    { id: 1, assignee: '@claude-afk' },
    { id: 2, assignee: '@alex' },
    { id: 3, assignee: '@claude-hitl' },
  ];
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC, [], REGISTRY).map((c) => c.id), [2, 3, 1]);
});

test('assignee asc puts unregistered handles after ALL registered ones, lexicographic among themselves', () => {
  const cards = [
    { id: 1, assignee: '@zed' },
    { id: 2, assignee: '@claude-afk' },
    { id: 3, assignee: '@abe' },
    { id: 4, assignee: '@alex' },
  ];
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC, [], REGISTRY).map((c) => c.id), [4, 2, 3, 1]);
});

test('assignee: unassigned cards sort LAST in both directions, id-stable', () => {
  const cards = [
    { id: 1 },
    { id: 2, assignee: '@claude-hitl' },
    { id: 3, assignee: null },
    { id: 4, assignee: '@alex' },
  ];
  const asc = sortCards(cards, ASSIGNEE_ASC, [], REGISTRY);
  assert.deepStrictEqual(asc.map((c) => c.id), [4, 2, 1, 3]);
  const desc = sortCards(cards, ASSIGNEE_DESC, [], REGISTRY);
  assert.deepStrictEqual(desc.map((c) => c.id), [2, 4, 1, 3]); // assigned order flips, unassigned STILL last
});

test('assignee: an empty-string assignee is treated as unassigned, sorts last', () => {
  const cards = [{ id: 1, assignee: '' }, { id: 2, assignee: '@alex' }];
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC, [], REGISTRY).map((c) => c.id), [2, 1]);
});

test('assignee: same handle ties break by id ascending, in both directions', () => {
  const cards = [
    { id: 3, assignee: '@alex' },
    { id: 1, assignee: '@alex' },
    { id: 2, assignee: '@alex' },
  ];
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC, [], REGISTRY).map((c) => c.id), [1, 2, 3]);
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_DESC, [], REGISTRY).map((c) => c.id), [1, 2, 3]);
});

test('assignee desc flips the whole assigned ordering: unregistered (reverse-lex) before registered (reverse registry)', () => {
  const cards = [
    { id: 1, assignee: '@claude-afk' },
    { id: 2, assignee: '@alex' },
    { id: 3, assignee: '@zed' },
    { id: 4, assignee: '@abe' },
    { id: 5 },
    { id: 6, assignee: '@claude-hitl' },
  ];
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC, [], REGISTRY).map((c) => c.id), [2, 6, 1, 4, 3, 5]);
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_DESC, [], REGISTRY).map((c) => c.id), [3, 4, 1, 6, 2, 5]);
});

test('assignee: an empty or absent registry degrades to plain lexicographic, unassigned still last', () => {
  const cards = [
    { id: 1, assignee: '@zed' },
    { id: 2 },
    { id: 3, assignee: '@abe' },
    { id: 4, assignee: '@alex' },
  ];
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC, [], []).map((c) => c.id), [3, 4, 1, 2]);
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_ASC).map((c) => c.id), [3, 4, 1, 2]); // 4th arg omitted entirely
  assert.deepStrictEqual(sortCards(cards, ASSIGNEE_DESC, [], []).map((c) => c.id), [1, 4, 3, 2]);
});

test('mergeSortState accepts a saved assignee sort as structurally valid', () => {
  const merged = mergeSortState({ todo: { field: 'assignee', direction: 'asc' }, done: { field: 'assignee', direction: 'desc' } });
  assert.deepStrictEqual(merged.todo, { field: 'assignee', direction: 'asc' });
  assert.deepStrictEqual(merged.done, { field: 'assignee', direction: 'desc' });
});

test('assignee joining SORT_FIELDS leaves the defaults untouched: DEFAULT_SORT and defaultSort() never pick it', () => {
  assert.deepStrictEqual(Object.values(DEFAULT_SORT).map((s) => s.field).sort(), ['id', 'priority', 'priority', 'priority', 'priority']);
  const derived = mergeSortState(null, ['triage', 'archive']);
  assert.deepStrictEqual(derived, {
    triage: { field: 'priority', direction: 'desc' },
    archive: { field: 'id', direction: 'asc' },
  });
});

// --- scheduleKey/scheduleLabel — the tile's top-right datetime and
// the Date sort must share one source of truth.

test('scheduleKey follows the triad precedence: due, else end, else start, else null', () => {
  assert.strictEqual(scheduleKey({ due_date: '2026-07-01', end_date: '2026-08-01' }), '2026-07-01');
  assert.strictEqual(scheduleKey({ end_date: '2026-08-01', start_date: '2026-06-01' }), '2026-08-01');
  assert.strictEqual(scheduleKey({ start_date: '2026-06-01' }), '2026-06-01');
  assert.strictEqual(scheduleKey({}), null);
});

test('scheduleLabel: compact date, time when present, ⚑ for deadlines, year only when foreign', () => {
  assert.strictEqual(scheduleLabel({ due_date: '2026-07-14T09:30' }, '2026-07-10'), '⚑ 07-14 09:30');
  assert.strictEqual(scheduleLabel({ due_date: '2026-07-14' }, '2026-07-10'), '⚑ 07-14');
  assert.strictEqual(scheduleLabel({ end_date: '2026-07-20' }, '2026-07-10'), '07-20');
  assert.strictEqual(scheduleLabel({ start_date: '2027-01-05T08:00' }, '2026-07-10'), '2027-01-05 08:00');
  assert.strictEqual(scheduleLabel({}, '2026-07-10'), '');
});

// --- scheduleRows (kanban.proj#260) — the tile's start/end/due date stack:
// one row per literal frontmatter field, fixed order, own glyph each, no row
// at all for a field the card doesn't carry (or can't be parsed).

test('scheduleRows: all three present renders start, end, due in that fixed order', () => {
  const rows = scheduleRows(
    { start_date: '2026-07-01', end_date: '2026-07-05', due_date: '2026-07-14' },
    '2026-07-10',
  );
  assert.deepStrictEqual(rows, [
    { glyph: '⇤', text: '07-01', overdue: false },
    { glyph: '⇥', text: '07-05', overdue: false },
    { glyph: '⚑', text: '07-14', overdue: false },
  ]);
});

test('scheduleRows: start_date alone', () => {
  assert.deepStrictEqual(scheduleRows({ start_date: '2026-07-01' }, '2026-07-10'), [
    { glyph: '⇤', text: '07-01', overdue: false },
  ]);
});

test('scheduleRows: end_date alone', () => {
  assert.deepStrictEqual(scheduleRows({ end_date: '2026-07-05' }, '2026-07-10'), [
    { glyph: '⇥', text: '07-05', overdue: false },
  ]);
});

test('scheduleRows: due_date alone', () => {
  assert.deepStrictEqual(scheduleRows({ due_date: '2026-07-14' }, '2026-07-10'), [
    { glyph: '⚑', text: '07-14', overdue: false },
  ]);
});

test('scheduleRows: start + end pair, no due row', () => {
  assert.deepStrictEqual(
    scheduleRows({ start_date: '2026-07-01', end_date: '2026-07-05' }, '2026-07-10'),
    [
      { glyph: '⇤', text: '07-01', overdue: false },
      { glyph: '⇥', text: '07-05', overdue: false },
    ],
  );
});

test('scheduleRows: start + due pair, no end row', () => {
  assert.deepStrictEqual(
    scheduleRows({ start_date: '2026-07-01', due_date: '2026-07-14' }, '2026-07-10'),
    [
      { glyph: '⇤', text: '07-01', overdue: false },
      { glyph: '⚑', text: '07-14', overdue: false },
    ],
  );
});

test('scheduleRows: end + due pair, no start row', () => {
  assert.deepStrictEqual(
    scheduleRows({ end_date: '2026-07-05', due_date: '2026-07-14' }, '2026-07-10'),
    [
      { glyph: '⇥', text: '07-05', overdue: false },
      { glyph: '⚑', text: '07-14', overdue: false },
    ],
  );
});

test('scheduleRows: none of the three fields set returns an empty list', () => {
  assert.deepStrictEqual(scheduleRows({}, '2026-07-10'), []);
});

test('scheduleRows: foreign-year values print the full YYYY-MM-DD', () => {
  assert.deepStrictEqual(scheduleRows({ start_date: '2027-01-05' }, '2026-07-10'), [
    { glyph: '⇤', text: '2027-01-05', overdue: false },
  ]);
});

test('scheduleRows: a datetime value appends HH:MM sliced from after the T', () => {
  assert.deepStrictEqual(scheduleRows({ due_date: '2026-07-14T09:30:00' }, '2026-07-10'), [
    { glyph: '⚑', text: '07-14 09:30', overdue: false },
  ]);
});

test('scheduleRows: an unparseable value produces no row for that field, others unaffected', () => {
  assert.deepStrictEqual(
    scheduleRows({ start_date: 'not-a-date', due_date: '2026-07-14' }, '2026-07-10'),
    [{ glyph: '⚑', text: '07-14', overdue: false }],
  );
});

test('scheduleRows: the overdue flag lands on the due row only, never start/end', () => {
  const rows = scheduleRows(
    { start_date: '2026-01-01', end_date: '2026-01-02', due_date: '2026-01-05', status: 'todo' },
    '2026-07-10',
  );
  assert.deepStrictEqual(rows, [
    { glyph: '⇤', text: '01-01', overdue: false },
    { glyph: '⇥', text: '01-02', overdue: false },
    { glyph: '⚑', text: '01-05', overdue: true },
  ]);
});

test('scheduleRows: a done card never flags its due row overdue (isOverdue\'s own gate)', () => {
  const rows = scheduleRows({ due_date: '2026-01-01', status: 'done' }, '2026-07-10');
  assert.deepStrictEqual(rows, [{ glyph: '⚑', text: '01-01', overdue: false }]);
});

// --- wiring: both tile renderers build the date stack through the shared
// helper, which in turn calls scheduleRows — structure test against the
// source, same convention as overdue.test.js's surface-wiring checks (app.js
// DOM glue isn't require-able, jsdom isn't wired into this suite).

test('cardEl and archiveCardEl both render the date stack via scheduleBlockHtml, which calls scheduleRows', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.match(appJs, /function scheduleBlockHtml\(card\)/);
  assert.match(appJs, /scheduleRows\(card, localTodayStr\(\)\)/);
  const callSites = appJs.match(/const scheduleHtml = scheduleBlockHtml\(card\);/g) || [];
  assert.strictEqual(callSites.length, 2, 'cardEl and archiveCardEl each call scheduleBlockHtml once');
});
