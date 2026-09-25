const { test } = require('node:test');
const assert = require('node:assert');
const { addDays } = require('../web/calendar-model');
const {
  GANTT_STATUS_ORDER, GANTT_MAX_DAYS, GANTT_DAY_PX,
  barSpan, ganttGroups, ganttArchiveGroup, appendArchiveGroup, rowWindowSpans, ganttWindow, isMonday, weekMarkLabel,
  ganttBarClip,
  barShiftChanges, barResizeChanges, dueShiftChanges,
  GANTT_SUBVIEWS, mergeGanttSubview, ganttSubviewWindow, ganttDayPx,
} = require('../web/gantt-model');

// --- constants ----------------------------------------------------

test('GANTT_STATUS_ORDER is the four live columns in board order', () => {
  assert.deepStrictEqual(GANTT_STATUS_ORDER, ['backlog', 'todo', 'doing', 'done']);
});

test('GANTT_MAX_DAYS is 180 and GANTT_DAY_PX is a positive integer (drag math divides by it)', () => {
  assert.strictEqual(GANTT_MAX_DAYS, 180);
  assert.ok(Number.isInteger(GANTT_DAY_PX) && GANTT_DAY_PX > 0);
});

// --- barSpan: which days does a card's bar cover? -----------------------------
// The bar is the WORKING RANGE: same shapes as the calendar's
// cardSchedule (which it reuses). Due is an independent diamond marker now —
// a due-only card has NO bar (the diamond owns due).

test('barSpan: start + end gives the inclusive range; a due alongside changes nothing', () => {
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-03', end_date: '2026-07-06' }),
    { startDay: '2026-07-03', endDay: '2026-07-06' });
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-03', end_date: '2026-07-06', due_date: '2026-07-20' }),
    { startDay: '2026-07-03', endDay: '2026-07-06' });
});

test('barSpan: COMPAT — start + due with no end_date still bars start->due (pre-end_date cards)', () => {
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-03', due_date: '2026-07-06' }),
    { startDay: '2026-07-03', endDay: '2026-07-06' });
});

test('barSpan: due-only has NO bar any more — the diamond owns it', () => {
  assert.strictEqual(barSpan({ due_date: '2026-07-09' }), null);
});

test('barSpan: start-only is a 1-day bar at start, end-only a 1-day bar at end', () => {
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-03' }),
    { startDay: '2026-07-03', endDay: '2026-07-03' });
  assert.deepStrictEqual(barSpan({ end_date: '2026-07-06' }),
    { startDay: '2026-07-06', endDay: '2026-07-06' });
});

test('barSpan: reversed range is a 1-day bar at the range end — consistent with the calendar', () => {
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-10', end_date: '2026-07-05' }),
    { startDay: '2026-07-05', endDay: '2026-07-05' });
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-10', due_date: '2026-07-05' }), // compat pair
    { startDay: '2026-07-05', endDay: '2026-07-05' });
});

test('barSpan: datetime values contribute their day part', () => {
  assert.deepStrictEqual(barSpan({ start_date: '2026-07-03T09:00', end_date: '2026-07-06T17:30' }),
    { startDay: '2026-07-03', endDay: '2026-07-06' });
});

test('barSpan: no parseable range date at all means no bar (null)', () => {
  assert.strictEqual(barSpan({}), null);
  assert.strictEqual(barSpan({ start_date: '', end_date: '', due_date: '' }), null);
  assert.strictEqual(barSpan({ end_date: 'whenever' }), null);
});

// --- ganttGroups: rows grouped by status in board column order -----------------

const card = (id, status, dates) => ({ id, status, title: `c${id}`, ...dates });

test('ganttGroups drops undated cards entirely', () => {
  const groups = ganttGroups([
    card(1, 'todo', { due_date: '2026-07-09' }),
    card(2, 'todo', {}),
    card(3, 'doing', { start_date: 'someday' }),
  ]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].status, 'todo');
  assert.deepStrictEqual(groups[0].bars.map((b) => b.card.id), [1]);
});

test('ganttGroups: a due-only card gets a row with NO bar span but a dueDay', () => {
  const groups = ganttGroups([card(1, 'todo', { due_date: '2026-07-09T14:30' })]);
  const row = groups[0].bars[0];
  assert.strictEqual(row.startDay, null);
  assert.strictEqual(row.endDay, null);
  assert.strictEqual(row.dueDay, '2026-07-09');
});

test('ganttGroups: a ranged card with a due carries both the span and the dueDay', () => {
  const groups = ganttGroups([card(1, 'todo', { start_date: '2026-07-03', end_date: '2026-07-06', due_date: '2026-07-20' })]);
  const row = groups[0].bars[0];
  assert.strictEqual(row.startDay, '2026-07-03');
  assert.strictEqual(row.endDay, '2026-07-06');
  assert.strictEqual(row.dueDay, '2026-07-20');
});

test('ganttGroups: no due means dueDay null', () => {
  const groups = ganttGroups([card(1, 'todo', { start_date: '2026-07-03', end_date: '2026-07-06' })]);
  assert.strictEqual(groups[0].bars[0].dueDay, null);
});

test('ganttGroups orders groups backlog/todo/doing/done and omits statuses with no dated cards', () => {
  const groups = ganttGroups([
    card(1, 'done', { due_date: '2026-07-01' }),
    card(2, 'backlog', { due_date: '2026-07-02' }),
    card(3, 'doing', { due_date: '2026-07-03' }),
  ]);
  assert.deepStrictEqual(groups.map((g) => g.status), ['backlog', 'doing', 'done']);
});

test('ganttGroups sorts a group by id ascending regardless of input order', () => {
  const groups = ganttGroups([
    card(9, 'todo', { due_date: '2026-07-09' }),
    card(2, 'todo', { due_date: '2026-07-01' }),
    card(5, 'todo', { due_date: '2026-07-05' }),
  ]);
  assert.deepStrictEqual(groups[0].bars.map((b) => b.card.id), [2, 5, 9]);
});

test('ganttGroups bars carry the barSpan days for the row', () => {
  const groups = ganttGroups([card(1, 'todo', { start_date: '2026-07-03', due_date: '2026-07-06' })]);
  assert.strictEqual(groups[0].bars[0].startDay, '2026-07-03');
  assert.strictEqual(groups[0].bars[0].endDay, '2026-07-06');
});

test('ganttGroups appends unknown statuses after done, alphabetically (tolerant, same as the map view)', () => {
  const groups = ganttGroups([
    card(1, 'zzz', { due_date: '2026-07-01' }),
    card(2, 'done', { due_date: '2026-07-02' }),
    card(3, 'aaa', { due_date: '2026-07-03' }),
  ]);
  assert.deepStrictEqual(groups.map((g) => g.status), ['done', 'aaa', 'zzz']);
});

test('ganttGroups of nothing dated is empty', () => {
  assert.deepStrictEqual(ganttGroups([]), []);
  assert.deepStrictEqual(ganttGroups([card(1, 'todo', {})]), []);
});

test('ganttGroups follows a configured statuses list for group order; unlisted still append alphabetically', () => {
  const groups = ganttGroups([
    card(1, 'done', { due_date: '2026-07-01' }),
    card(2, 'review', { due_date: '2026-07-02' }),
    card(3, 'triage', { due_date: '2026-07-03' }),
    card(4, 'zzz', { due_date: '2026-07-04' }),
  ], ['triage', 'review', 'done']);
  assert.deepStrictEqual(groups.map((g) => g.status), ['triage', 'review', 'done', 'zzz']);
});

// --- ganttArchiveGroup: dated ARCHIVED cards get ONE group, after the live ------
// status groups. Every
// archived card lands in this bucket regardless of its own on-disk status
// field (archive is a LOCATION, not a status — ADR 0002); the group key is
// the literal string 'archive' so the render layer's EXISTING
// statusColor/isBuiltinStatus/columnLabel lookups already mute+label it
// (statusColor('archive') mutes to ARCHIVE_COLOR; columnLabel
// ('archive') is already 'Archive', column-state.js) with no extra
// branching needed downstream.

const archivedCard = (id, dates) => ({ id, status: 'done', archived: true, title: `a${id}`, ...dates });

test('ganttArchiveGroup buckets every dated archived card into one "archive" group, ignoring each card\'s own on-disk status', () => {
  const group = ganttArchiveGroup([
    archivedCard(1, { due_date: '2026-07-01' }),
    { id: 2, status: 'todo', archived: true, title: 'a2', start_date: '2026-07-03', end_date: '2026-07-05' },
  ]);
  assert.strictEqual(group.status, 'archive');
  assert.deepStrictEqual(group.bars.map((b) => b.card.id), [1, 2]);
});

test('ganttArchiveGroup sorts by id ascending regardless of input order', () => {
  const group = ganttArchiveGroup([
    archivedCard(9, { due_date: '2026-07-09' }),
    archivedCard(2, { due_date: '2026-07-01' }),
    archivedCard(5, { due_date: '2026-07-05' }),
  ]);
  assert.deepStrictEqual(group.bars.map((b) => b.card.id), [2, 5, 9]);
});

test('ganttArchiveGroup drops undated archived cards entirely, same rule as ganttGroups', () => {
  const group = ganttArchiveGroup([
    archivedCard(1, { due_date: '2026-07-01' }),
    archivedCard(2, {}),
  ]);
  assert.deepStrictEqual(group.bars.map((b) => b.card.id), [1]);
});

test('ganttArchiveGroup returns null when nothing dated is archived — no empty group row (same "omit empty" rule as ganttGroups)', () => {
  assert.strictEqual(ganttArchiveGroup([]), null);
  assert.strictEqual(ganttArchiveGroup([archivedCard(1, {})]), null);
  assert.strictEqual(ganttArchiveGroup(undefined), null);
});

test('ganttArchiveGroup rows carry the same bar/due shape as ganttGroups (start/end/due days)', () => {
  const group = ganttArchiveGroup([archivedCard(1, { start_date: '2026-07-03', end_date: '2026-07-06', due_date: '2026-07-20' })]);
  const row = group.bars[0];
  assert.strictEqual(row.startDay, '2026-07-03');
  assert.strictEqual(row.endDay, '2026-07-06');
  assert.strictEqual(row.dueDay, '2026-07-20');
});

test('ganttArchiveGroup: a due-only archived card gets a row with no bar span', () => {
  const group = ganttArchiveGroup([archivedCard(1, { due_date: '2026-07-09T14:30' })]);
  const row = group.bars[0];
  assert.strictEqual(row.startDay, null);
  assert.strictEqual(row.endDay, null);
  assert.strictEqual(row.dueDay, '2026-07-09');
});

// --- appendArchiveGroup: append-or-merge into the caller's `groups` ------------
// Defect: ganttGroups (above) buckets LIVE cards by their raw, never-
// validated on-disk status with no guard against the literal value
// 'archive' — a card sitting in kanban/ (archived: false) with a hand-typed
// `status: archive` lands in its own group keyed 'archive', same as any
// other unlisted status (see "appends unknown statuses" above). Naively
// pushing ganttArchiveGroup's OWN 'archive'-keyed group after that produces
// TWO group rows sharing one key — indistinguishable in the DOM (same
// columnLabel, same muted color), one silently holding a live, draggable
// card. appendArchiveGroup merges into an existing 'archive'-keyed group
// instead of duplicating it, consistent with the mute-everywhere precedent
// a raw 'archive' status already gets elsewhere (statusColor/statusBadge):
// this card already READS as archived, so one merged row is the
// honest picture, not two adjacent copies of it.

test('appendArchiveGroup appends the archive group when no live group already uses that key', () => {
  const groups = [{ status: 'todo', bars: [{ card: { id: 1 } }] }];
  const archiveGroup = { status: 'archive', bars: [{ card: { id: 9 } }] };
  const result = appendArchiveGroup(groups, archiveGroup);
  assert.strictEqual(result, groups, 'mutates and returns the same array (matches the old groups.push contract)');
  assert.deepStrictEqual(groups.map((g) => g.status), ['todo', 'archive']);
  assert.deepStrictEqual(groups[1].bars.map((b) => b.card.id), [9]);
});

test('appendArchiveGroup is a no-op when archiveGroup is null (ganttArchiveGroup found nothing dated)', () => {
  const groups = [{ status: 'todo', bars: [] }];
  appendArchiveGroup(groups, null);
  assert.deepStrictEqual(groups.map((g) => g.status), ['todo']);
});

test('appendArchiveGroup MERGES into a live group already keyed "archive" instead of pushing a duplicate (the defect)', () => {
  // A live, non-archived card whose raw status is literally 'archive' —
  // ganttGroups already produced this bucket before appendArchiveGroup runs.
  const liveArchiveBar = { card: { id: 5, status: 'archive', archived: false } };
  const groups = [
    { status: 'todo', bars: [{ card: { id: 1 } }] },
    { status: 'archive', bars: [liveArchiveBar] },
  ];
  const archiveGroup = { status: 'archive', bars: [{ card: { id: 9, status: 'done', archived: true } }] };
  appendArchiveGroup(groups, archiveGroup);
  const archiveGroups = groups.filter((g) => g.status === 'archive');
  assert.strictEqual(archiveGroups.length, 1, 'no duplicate "archive"-keyed group — the reported two-row collision');
  assert.deepStrictEqual(archiveGroups[0].bars.map((b) => b.card.id), [5, 9], 'the live card and the truly archived card share one row');
});

test('appendArchiveGroup sorts the merged bars by id regardless of arrival order', () => {
  const groups = [{ status: 'archive', bars: [{ card: { id: 9 } }] }];
  const archiveGroup = { status: 'archive', bars: [{ card: { id: 5 } }, { card: { id: 2 } }] };
  appendArchiveGroup(groups, archiveGroup);
  assert.deepStrictEqual(groups[0].bars.map((b) => b.card.id), [2, 5, 9]);
});

// --- ganttWindow: the visible day range ----------------------------------------
// Natural window = min(start)-3d .. max(due)+3d. When that exceeds
// GANTT_MAX_DAYS the window is clamped to exactly GANTT_MAX_DAYS days,
// ideally centered on today, slid to stay inside the natural window.

const span = (startDay, endDay) => ({ startDay, endDay });

// --- rowWindowSpans: each row's full extent for the window -----------
// A row's window contribution covers its bar AND its due diamond, so a due
// far outside the range — or a due-only row with no bar at all — still lands
// inside the rendered window.

test('rowWindowSpans: bar-only rows pass their span through', () => {
  assert.deepStrictEqual(rowWindowSpans([{ startDay: '2026-07-03', endDay: '2026-07-06', dueDay: null }]),
    [{ startDay: '2026-07-03', endDay: '2026-07-06' }]);
});

test('rowWindowSpans: a due-only row contributes a 1-day extent at due', () => {
  assert.deepStrictEqual(rowWindowSpans([{ startDay: null, endDay: null, dueDay: '2026-07-09' }]),
    [{ startDay: '2026-07-09', endDay: '2026-07-09' }]);
});

test('rowWindowSpans: a due outside the bar stretches the extent to include it, either side', () => {
  assert.deepStrictEqual(rowWindowSpans([{ startDay: '2026-07-03', endDay: '2026-07-06', dueDay: '2026-07-20' }]),
    [{ startDay: '2026-07-03', endDay: '2026-07-20' }]);
  assert.deepStrictEqual(rowWindowSpans([{ startDay: '2026-07-03', endDay: '2026-07-06', dueDay: '2026-06-28' }]),
    [{ startDay: '2026-06-28', endDay: '2026-07-06' }]);
});

test('rowWindowSpans: a due inside the bar changes nothing', () => {
  assert.deepStrictEqual(rowWindowSpans([{ startDay: '2026-07-03', endDay: '2026-07-06', dueDay: '2026-07-05' }]),
    [{ startDay: '2026-07-03', endDay: '2026-07-06' }]);
});

test('ganttWindow: no spans means no window (null)', () => {
  assert.strictEqual(ganttWindow([], '2026-07-09'), null);
});

test('ganttWindow pads 3 days on each side of a single span', () => {
  const w = ganttWindow([span('2026-07-10', '2026-07-12')], '2026-07-09');
  assert.deepStrictEqual(w, { startDay: '2026-07-07', endDay: '2026-07-15', days: 9, clamped: false });
});

test('ganttWindow spans the overall min start / max end across all bars', () => {
  const w = ganttWindow([
    span('2026-07-10', '2026-07-12'),
    span('2026-07-01', '2026-07-02'),
    span('2026-07-08', '2026-07-20'),
  ], '2026-07-09');
  assert.strictEqual(w.startDay, '2026-06-28');
  assert.strictEqual(w.endDay, '2026-07-23');
  assert.strictEqual(w.clamped, false);
});

test('ganttWindow at exactly 180 natural days stays unclamped', () => {
  const s = '2026-01-10';
  const e = addDays(s, 173); // +3 pad each side + inclusive count = 180
  const w = ganttWindow([span(s, e)], '2026-03-01');
  assert.deepStrictEqual(w, { startDay: addDays(s, -3), endDay: addDays(e, 3), days: 180, clamped: false });
});

test('ganttWindow over 180 natural days clamps to exactly 180, inside the natural window, keeping today visible', () => {
  const s = '2026-01-10';
  const e = addDays(s, 174); // natural = 181 days
  const today = addDays(s, 87);
  const w = ganttWindow([span(s, e)], today);
  assert.strictEqual(w.days, 180);
  assert.strictEqual(w.clamped, true);
  assert.ok(w.startDay >= addDays(s, -3), 'window starts inside the natural window');
  assert.ok(w.endDay <= addDays(e, 3), 'window ends inside the natural window');
  assert.ok(w.startDay <= today && today <= w.endDay, 'today stays visible');
});

test('ganttWindow centers today when the data stretches far on both sides', () => {
  const today = '2026-07-09';
  const w = ganttWindow([span(addDays(today, -400), addDays(today, 400))], today);
  assert.strictEqual(w.startDay, addDays(today, -89)); // today at index 89 of 0..179
  assert.strictEqual(w.endDay, addDays(today, 90));
  assert.strictEqual(w.days, 180);
  assert.strictEqual(w.clamped, true);
});

test('ganttWindow with all data far in the past hugs the data\'s tail end instead of showing 180 empty days', () => {
  const today = '2026-07-09';
  const w = ganttWindow([span(addDays(today, -500), addDays(today, -300))], today);
  assert.strictEqual(w.endDay, addDays(today, -297)); // natural end (max due +3)
  assert.strictEqual(w.startDay, addDays(w.endDay, -179));
  assert.strictEqual(w.clamped, true);
});

test('ganttWindow with all data far in the future hugs the data\'s near edge', () => {
  const today = '2026-07-09';
  const w = ganttWindow([span(addDays(today, 300), addDays(today, 500))], today);
  assert.strictEqual(w.startDay, addDays(today, 297)); // natural start (min start -3)
  assert.strictEqual(w.endDay, addDays(w.startDay, 179));
  assert.strictEqual(w.clamped, true);
});

// --- week marks -----------------------------------------------------------------

test('isMonday matches Mondays only', () => {
  assert.strictEqual(isMonday('2026-06-29'), true); // known Monday (see calendar monthGrid tests)
  assert.strictEqual(isMonday('2026-07-13'), true);
  assert.strictEqual(isMonday('2026-07-09'), false);
  assert.strictEqual(isMonday('2026-07-12'), false);
});

test('weekMarkLabel renders a short "Mon D" date', () => {
  assert.strictEqual(weekMarkLabel('2026-07-13'), 'Jul 13');
  assert.strictEqual(weekMarkLabel('2026-01-05'), 'Jan 5');
  assert.strictEqual(weekMarkLabel('2025-12-01'), 'Dec 1');
});

// --- ganttBarClip: the visible slice of a bar inside a window -------------------
// A sized sub-view's window clips bars routinely (not just past the 180-day
// clamp), so this is the shared fact ganttBarEl's rendering AND its
// cut-side-handle omission both read off of — a handle on a cut side sits on
// the window edge, not the card's true date, so it must never be offered
// (barResizeChanges always resizes the TRUE edge).

test('ganttBarClip: bar fully inside the window is not clipped either side', () => {
  const win = { startDay: '2026-09-01', endDay: '2026-09-30' };
  assert.deepStrictEqual(ganttBarClip({ startDay: '2026-09-10', endDay: '2026-09-15' }, win),
    { clipStart: false, clipEnd: false, from: '2026-09-10', to: '2026-09-15' });
});

test('ganttBarClip: bar entirely before or after the window is null (nothing to draw)', () => {
  const win = { startDay: '2026-09-08', endDay: '2026-09-14' };
  assert.strictEqual(ganttBarClip({ startDay: '2026-09-01', endDay: '2026-09-05' }, win), null);
  assert.strictEqual(ganttBarClip({ startDay: '2026-09-20', endDay: '2026-09-25' }, win), null);
});

test('ganttBarClip: bar starting before the window clips ONLY the start edge', () => {
  const win = { startDay: '2026-09-08', endDay: '2026-09-14' };
  assert.deepStrictEqual(ganttBarClip({ startDay: '2026-09-01', endDay: '2026-09-10' }, win),
    { clipStart: true, clipEnd: false, from: '2026-09-08', to: '2026-09-10' });
});

test('ganttBarClip: bar ending after the window clips ONLY the end edge', () => {
  const win = { startDay: '2026-09-08', endDay: '2026-09-14' };
  assert.deepStrictEqual(ganttBarClip({ startDay: '2026-09-12', endDay: '2026-09-20' }, win),
    { clipStart: false, clipEnd: true, from: '2026-09-12', to: '2026-09-14' });
});

test('ganttBarClip: bar spanning past both edges clips both sides', () => {
  const win = { startDay: '2026-09-08', endDay: '2026-09-14' };
  assert.deepStrictEqual(ganttBarClip({ startDay: '2026-09-01', endDay: '2026-09-25' }, win),
    { clipStart: true, clipEnd: true, from: '2026-09-08', to: '2026-09-14' });
});

test('ganttBarClip: a bar edge exactly on the window boundary is NOT clipped there', () => {
  const win = { startDay: '2026-09-08', endDay: '2026-09-14' };
  assert.deepStrictEqual(ganttBarClip({ startDay: '2026-09-08', endDay: '2026-09-14' }, win),
    { clipStart: false, clipEnd: false, from: '2026-09-08', to: '2026-09-14' });
});

// --- barShiftChanges: drag the bar body = shift the WORKING RANGE ----------------
// Writes go to the fields the range actually used (rangeFields) —
// real range shifts start+end, compat range shifts start+due (the used pair
// is KEPT, an end_date is never invented), one-field ranges shift their one
// field. Due is an independent marker: a bar drag never touches it unless
// due IS the compat range end.

test('barShiftChanges: zero delta is a no-op (null) — same-position drop must not PATCH', () => {
  assert.strictEqual(barShiftChanges({ start_date: '2026-07-01', end_date: '2026-07-04' }, 0), null);
});

test('barShiftChanges: no bar is a no-op (null) — nothing to drag, due-only included', () => {
  assert.strictEqual(barShiftChanges({}, 3), null);
  assert.strictEqual(barShiftChanges({ end_date: 'someday' }, 3), null);
  assert.strictEqual(barShiftChanges({ due_date: '2026-07-09' }, 3), null); // the diamond drags via dueShiftChanges
});

test('barShiftChanges shifts both ends of a real range by the delta, due untouched', () => {
  const changes = barShiftChanges({ start_date: '2026-07-01', end_date: '2026-07-04', due_date: '2026-07-20' }, 3);
  assert.deepStrictEqual(changes, { start_date: '2026-07-04', end_date: '2026-07-07' });
  assert.ok(!('due_date' in changes), 'due is an independent marker — a bar drag never writes it');
});

test('barShiftChanges: COMPAT range shifts start and due, never invents an end_date', () => {
  const changes = barShiftChanges({ start_date: '2026-07-01', due_date: '2026-07-04' }, 3);
  assert.deepStrictEqual(changes, { start_date: '2026-07-04', due_date: '2026-07-07' });
  assert.ok(!('end_date' in changes), 'the compat pair is KEPT');
});

test('barShiftChanges preserves both times-of-day through the shift', () => {
  assert.deepStrictEqual(barShiftChanges({ start_date: '2026-07-01T09:00', end_date: '2026-07-04T17:30' }, 3),
    { start_date: '2026-07-04T09:00', end_date: '2026-07-07T17:30' });
  assert.deepStrictEqual(barShiftChanges({ start_date: '2026-07-01T09:00', due_date: '2026-07-04T17:30' }, 3),
    { start_date: '2026-07-04T09:00', due_date: '2026-07-07T17:30' });
});

test('barShiftChanges shifts backward across a month boundary', () => {
  assert.deepStrictEqual(barShiftChanges({ start_date: '2026-07-02', end_date: '2026-07-03' }, -3),
    { start_date: '2026-06-29', end_date: '2026-06-30' });
});

test('barShiftChanges: start-only / end-only shift their one date', () => {
  assert.deepStrictEqual(barShiftChanges({ start_date: '2026-07-03' }, -2),
    { start_date: '2026-07-01' });
  assert.deepStrictEqual(barShiftChanges({ end_date: '2026-07-06T18:00' }, 2),
    { end_date: '2026-07-08T18:00' });
});

test('barShiftChanges: reversed range shifts the used end field only, nonsensical start left untouched', () => {
  const real = barShiftChanges({ start_date: '2026-07-10', end_date: '2026-07-05T11:00' }, 4);
  assert.deepStrictEqual(real, { end_date: '2026-07-09T11:00' });
  assert.ok(!('start_date' in real), 'start_date left out of the PATCH entirely');
  const compat = barShiftChanges({ start_date: '2026-07-10', due_date: '2026-07-05T11:00' }, 4);
  assert.deepStrictEqual(compat, { due_date: '2026-07-09T11:00' });
  assert.ok(!('start_date' in compat));
});

// --- dueShiftChanges: drag the due diamond = move due_date alone -------

test('dueShiftChanges moves due_date alone by the delta, time-of-day preserved', () => {
  assert.deepStrictEqual(dueShiftChanges({ due_date: '2026-07-09' }, 2), { due_date: '2026-07-11' });
  assert.deepStrictEqual(dueShiftChanges({ due_date: '2026-07-09T14:30' }, -2), { due_date: '2026-07-07T14:30' });
});

test('dueShiftChanges never touches the range fields', () => {
  const changes = dueShiftChanges({ start_date: '2026-07-01', end_date: '2026-07-04', due_date: '2026-07-09' }, 3);
  assert.deepStrictEqual(changes, { due_date: '2026-07-12' });
});

test('dueShiftChanges: zero delta and absent/unparseable due are null (no PATCH)', () => {
  assert.strictEqual(dueShiftChanges({ due_date: '2026-07-09' }, 0), null);
  assert.strictEqual(dueShiftChanges({ due_date: 'someday' }, 2), null);
  assert.strictEqual(dueShiftChanges({ start_date: '2026-07-01' }, 2), null);
});

// --- barResizeChanges: drag an edge = move that RANGE endpoint alone -------------
// The start handle writes start_date, the end handle writes
// end_date — EXCEPT compat ranges (start+due, no end), where the end handle
// edits due_date, the field the range actually used. Clamped so the bar never
// inverts: a resize stops at the other endpoint (a 1-day bar is the minimum),
// and a fully clamped-away resize is null (no PATCH).

test('barResizeChanges: zero delta is a no-op (null) on either edge', () => {
  const c = { start_date: '2026-07-01', end_date: '2026-07-04' };
  assert.strictEqual(barResizeChanges(c, 'start', 0), null);
  assert.strictEqual(barResizeChanges(c, 'end', 0), null);
});

test('barResizeChanges: no bar is a no-op (null) — due-only included (the diamond is not resizable)', () => {
  assert.strictEqual(barResizeChanges({}, 'start', -2), null);
  assert.strictEqual(barResizeChanges({ end_date: 'someday' }, 'end', 2), null);
  assert.strictEqual(barResizeChanges({ due_date: '2026-07-09' }, 'start', -3), null);
  assert.strictEqual(barResizeChanges({ due_date: '2026-07-09' }, 'end', 2), null);
});

test('barResizeChanges: start edge moves start_date alone, time-of-day preserved', () => {
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-03', end_date: '2026-07-06' }, 'start', -2),
    { start_date: '2026-07-01' });
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-03T09:00', end_date: '2026-07-06' }, 'start', -2),
    { start_date: '2026-07-01T09:00' });
});

test('barResizeChanges: end edge moves end_date alone on a real range, time-of-day preserved', () => {
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-03', end_date: '2026-07-06T17:00' }, 'end', 2),
    { end_date: '2026-07-08T17:00' });
});

test('barResizeChanges: COMPAT range end edge edits due_date — the field the range actually used', () => {
  const changes = barResizeChanges({ start_date: '2026-07-03', due_date: '2026-07-06T17:00' }, 'end', 2);
  assert.deepStrictEqual(changes, { due_date: '2026-07-08T17:00' });
  assert.ok(!('end_date' in changes), 'no end_date invented');
});

test('barResizeChanges: start edge clamps at the range end — a multi-day bar shrinks to 1 day at most', () => {
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-03', end_date: '2026-07-06' }, 'start', 10),
    { start_date: '2026-07-06' });
});

test('barResizeChanges: end edge clamps at the start day', () => {
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-03', end_date: '2026-07-06' }, 'end', -10),
    { end_date: '2026-07-03' });
  assert.deepStrictEqual( // compat pair: same clamp, due_date written
    barResizeChanges({ start_date: '2026-07-03', due_date: '2026-07-06' }, 'end', -10),
    { due_date: '2026-07-03' });
});

test('barResizeChanges: inward resize of a same-day range is fully clamped away (null, no PATCH)', () => {
  const c = { start_date: '2026-07-09', end_date: '2026-07-09' };
  assert.strictEqual(barResizeChanges(c, 'start', 3), null);
  assert.strictEqual(barResizeChanges(c, 'end', -3), null);
});

test('barResizeChanges: end-only start edge dragged left CREATES a plain-date start_date', () => {
  assert.deepStrictEqual(barResizeChanges({ end_date: '2026-07-09T14:30' }, 'start', -3),
    { start_date: '2026-07-06' }); // new field: plain date, no time to preserve
  assert.strictEqual(barResizeChanges({ end_date: '2026-07-09' }, 'start', 2), null); // rightward: clamped away
});

test('barResizeChanges: end-only end edge moves the end date itself (the only range date there is)', () => {
  assert.deepStrictEqual(barResizeChanges({ end_date: '2026-07-09T14:30' }, 'end', 2),
    { end_date: '2026-07-11T14:30' });
  // dragging it left would shrink the 1-day bar below the minimum — clamped away
  assert.strictEqual(barResizeChanges({ end_date: '2026-07-09' }, 'end', -2), null);
});

test('barResizeChanges: start-only end edge dragged right CREATES a plain-date end_date', () => {
  assert.deepStrictEqual(barResizeChanges({ start_date: '2026-07-03T08:00' }, 'end', 4),
    { end_date: '2026-07-07' });
  assert.strictEqual(barResizeChanges({ start_date: '2026-07-03' }, 'end', -2), null);
});

test('barResizeChanges: start-only start edge moves the start date itself, clamped rightward', () => {
  assert.deepStrictEqual(barResizeChanges({ start_date: '2026-07-03T08:00' }, 'start', -2),
    { start_date: '2026-07-01T08:00' });
  assert.strictEqual(barResizeChanges({ start_date: '2026-07-03' }, 'start', 2), null);
});

test('barResizeChanges: reversed range start edge dragged left repairs it into a real range (start time preserved)', () => {
  // the rendered bar is 1 day at the range end; pulling its start edge left
  // writes a sensible start_date at last — the nonsensical stored one goes
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-10T09:00', due_date: '2026-07-05' }, 'start', -2),
    { start_date: '2026-07-03T09:00' });
  assert.deepStrictEqual(
    barResizeChanges({ start_date: '2026-07-10T09:00', end_date: '2026-07-05' }, 'start', -2),
    { start_date: '2026-07-03T09:00' });
  assert.strictEqual(
    barResizeChanges({ start_date: '2026-07-10', due_date: '2026-07-05' }, 'start', 2), null);
});

test('barResizeChanges: reversed range end edge moves the used end field, start untouched', () => {
  const compat = barResizeChanges({ start_date: '2026-07-10', due_date: '2026-07-05T11:00' }, 'end', 3);
  assert.deepStrictEqual(compat, { due_date: '2026-07-08T11:00' });
  assert.ok(!('start_date' in compat));
  const real = barResizeChanges({ start_date: '2026-07-10', end_date: '2026-07-05T11:00' }, 'end', 3);
  assert.deepStrictEqual(real, { end_date: '2026-07-08T11:00' });
});

test('barResizeChanges: unknown edge name is a defensive no-op (null)', () => {
  assert.strictEqual(barResizeChanges({ end_date: '2026-07-09' }, 'middle', 2), null);
});

// --- gantt sub-views: All / Month / Week / 3 days / Day --------------------

test('GANTT_SUBVIEWS lists All first, then month / week / 3day / day', () => {
  assert.deepStrictEqual(GANTT_SUBVIEWS, ['all', 'month', 'week', '3day', 'day']);
});

test('mergeGanttSubview passes through every known sub-view', () => {
  for (const sv of GANTT_SUBVIEWS) assert.strictEqual(mergeGanttSubview(sv), sv);
});

test('mergeGanttSubview falls back to "all" for unknown/missing/corrupt saved values — the default keeps today\'s behaviour', () => {
  assert.strictEqual(mergeGanttSubview('fortnight'), 'all');
  assert.strictEqual(mergeGanttSubview(''), 'all');
  assert.strictEqual(mergeGanttSubview(null), 'all');
  assert.strictEqual(mergeGanttSubview(undefined), 'all');
  assert.strictEqual(mergeGanttSubview('month'.toUpperCase()), 'all'); // case-sensitive, same as mergeCalendarSubview
});

// --- ganttSubviewWindow: the day-range a SIZED sub-view shows --------------

test('ganttSubviewWindow "all" is null — the caller falls back to ganttWindow', () => {
  assert.strictEqual(ganttSubviewWindow('all', '2026-07-09'), null);
});

test('ganttSubviewWindow week: Monday-to-Sunday of the anchor week, 7 days, same convention as the calendar', () => {
  assert.deepStrictEqual(ganttSubviewWindow('week', '2026-07-09'),
    { startDay: '2026-07-06', endDay: '2026-07-12', days: 7 });
  assert.strictEqual(ganttSubviewWindow('week', '2026-07-12').startDay, '2026-07-06'); // Sunday belongs to the preceding Monday
});

test('ganttSubviewWindow 3day: the anchor plus the next two days, 3 days total', () => {
  assert.deepStrictEqual(ganttSubviewWindow('3day', '2026-07-30'),
    { startDay: '2026-07-30', endDay: '2026-08-01', days: 3 }); // across a month end
});

test('ganttSubviewWindow day: just the anchor, 1 day', () => {
  assert.deepStrictEqual(ganttSubviewWindow('day', '2026-07-09'),
    { startDay: '2026-07-09', endDay: '2026-07-09', days: 1 });
});

test('ganttSubviewWindow month: the whole calendar month, no leading/trailing padding (unlike monthGrid)', () => {
  assert.deepStrictEqual(ganttSubviewWindow('month', '2026-07-15'),
    { startDay: '2026-07-01', endDay: '2026-07-31', days: 31 });
  assert.deepStrictEqual(ganttSubviewWindow('month', '2026-02-01'), // non-leap Feb
    { startDay: '2026-02-01', endDay: '2026-02-28', days: 28 });
  assert.deepStrictEqual(ganttSubviewWindow('month', '2028-02-15'), // leap Feb
    { startDay: '2028-02-01', endDay: '2028-02-29', days: 29 });
});

test('ganttSubviewWindow month across a year boundary', () => {
  assert.deepStrictEqual(ganttSubviewWindow('month', '2026-12-25'),
    { startDay: '2026-12-01', endDay: '2026-12-31', days: 31 });
});

// --- ganttDayPx: adaptive day width for a sized sub-view --------------------

test('ganttDayPx "all" always returns the fixed GANTT_DAY_PX, regardless of days/width — unchanged behaviour', () => {
  assert.strictEqual(ganttDayPx('all', 7, 700), GANTT_DAY_PX);
  assert.strictEqual(ganttDayPx('all', 180, 50), GANTT_DAY_PX);
  assert.strictEqual(ganttDayPx('all', 0, 0), GANTT_DAY_PX);
});

test('ganttDayPx fills the scroller: width / days for a sized sub-view', () => {
  assert.strictEqual(ganttDayPx('week', 7, 700), 100);
  assert.strictEqual(ganttDayPx('day', 1, 300), 300);
  assert.strictEqual(ganttDayPx('month', 31, 620), 20);
});

test('ganttDayPx falls back to GANTT_DAY_PX for a non-positive or unmeasured scroller width', () => {
  assert.strictEqual(ganttDayPx('week', 7, 0), GANTT_DAY_PX);
  assert.strictEqual(ganttDayPx('week', 7, -10), GANTT_DAY_PX);
  assert.strictEqual(ganttDayPx('week', 7, undefined), GANTT_DAY_PX);
});

test('ganttDayPx falls back to GANTT_DAY_PX when days is 0/falsy (defensive — a sized window is never actually empty)', () => {
  assert.strictEqual(ganttDayPx('week', 0, 700), GANTT_DAY_PX);
});
