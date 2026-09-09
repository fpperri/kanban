'use strict';
// Pure date math + month-grid construction for the calendar view.
// No DOM/localStorage access here on purpose — same dual-environment pattern
// as column-sort.js / selection.js: unit-testable from node --test AND loaded
// as a plain <script> in the browser (app.js calls these as bare globals).
//
// Date values are tolerant, never validated: a date is 'YYYY-MM-DD', a
// local datetime 'YYYY-MM-DDTHH:MM'. Anything unparseable simply yields no
// chip (dayPart '') rather than an error — the calendar shows what it can.

// The view switcher is a closed set. Persisted under
// storageKey(projectName, 'view.mode'); an unknown/corrupt saved value falls
// back to 'board', same defensive stance as mergeSortState.
const VIEW_MODES = ['board', 'map', 'calendar', 'gantt'];

function mergeViewMode(saved) {
  return VIEW_MODES.includes(saved) ? saved : 'board';
}

// --- date-value parsing ------------------------------------------------------

function dayPart(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value == null ? '' : value));
  return m ? m[1] : '';
}

// Everything after the 'T' verbatim (normally 'HH:MM') so a reschedule
// re-attaches exactly what the card carried — tolerant, no validation.
function timePart(value) {
  const m = /^\d{4}-\d{2}-\d{2}T(.+)$/.exec(String(value == null ? '' : value));
  return m ? m[1] : '';
}

// --- day arithmetic ------------------------------------------------------------
// UTC-based on purpose: local-time Date math would make a day 23/25 hours long
// across a DST switch and shift ranges off by one.

const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');

function dayToUtc(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToDay(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function addDays(day, n) {
  return utcToDay(dayToUtc(day) + n * DAY_MS);
}

// Signed whole days from a to b (positive when b is later).
function diffDays(a, b) {
  return Math.round((dayToUtc(b) - dayToUtc(a)) / DAY_MS);
}

// --- month grid ------------------------------------------------------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Flat list of day cells (weeks * 7, row-major) covering the given month,
// weeks starting MONDAY. Leading/trailing cells outside the month
// carry inMonth:false so the glue can dim them. Always 5 or 6 rows: a 28-day
// February starting on Monday would naturally be 4, but padding it with a
// trailing week keeps the grid from visibly collapsing between months.
function monthGrid(year, monthIndex) {
  const first = Date.UTC(year, monthIndex, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7; // days back to Monday (getUTCDay: 0=Sunday)
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const weeks = Math.max(5, Math.ceil((lead + daysInMonth) / 7));
  const start = first - lead * DAY_MS;
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const ms = start + i * DAY_MS;
    const dt = new Date(ms);
    cells.push({
      date: utcToDay(ms),
      day: dt.getUTCDate(),
      inMonth: dt.getUTCFullYear() === year && dt.getUTCMonth() === monthIndex,
    });
  }
  return cells;
}

function monthTitle(year, monthIndex) {
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

function shiftMonth(year, monthIndex, delta) {
  const t = year * 12 + monthIndex + delta;
  return { year: Math.floor(t / 12), monthIndex: ((t % 12) + 12) % 12 };
}

// --- range fields: which fields form the working range? ------------------
// The date triad: from = start_date, to = end_date, due = due_date. The
// working range is start_date -> end_date. COMPAT FALLBACK: when end_date is
// absent (or unparseable — tolerant) but start AND due are both present, the
// range is start_date -> due_date, so cards created under the old start/due
// semantics keep rendering as ranges. This is the single shape-decider:
// cardSchedule renders from it, and every drag-math function (calendar
// reschedule, gantt shift/resize) writes back through the SAME fields it
// reports — a compat-range drag shifts start and due and never invents an
// end_date, because both sides consult rangeFields.

function rangeFields(card) {
  const startDay = dayPart(card.start_date) || null;
  const startField = startDay ? 'start_date' : null;
  const endDay = dayPart(card.end_date);
  if (endDay) return { startDay, startField, endDay, endField: 'end_date' };
  const dueDay = dayPart(card.due_date);
  if (startDay && dueDay) return { startDay, startField, endDay: dueDay, endField: 'due_date' }; // compat fallback
  return { startDay, startField, endDay: null, endField: null };
}

// --- due marker: the independent deadline --------------------------------
// due_date stopped being the range end (except via the compat fallback) and
// became its own marker: a deadline chip in the calendar, a diamond in the
// gantt — rendered whether or not the card also has a range.

function dueMarker(card) {
  const day = dayPart(card.due_date);
  return day ? { day, time: timePart(card.due_date) } : null;
}

// --- card schedule: which day(s) does the RANGE occupy? -------------------------------
// The schedule is
// the working range only — rangeFields above decides which fields that is.
// Shapes: start+end = inclusive range; start-only = 1-day at start; end-only
// = 1-day at end; a REVERSED pair (range start after range end) collapses to
// 1 day at the range END; due-only = NO schedule (kind 'none' — the due
// marker owns that rendering). `time` is the range end's time-of-day
// (start's, for start-only) for the chip text.

function cardSchedule(card) {
  const rf = rangeFields(card);
  if (!rf.startDay && !rf.endDay) return { kind: 'none' };
  if (rf.startDay && rf.endDay) {
    if (rf.startDay <= rf.endDay) {
      return { kind: 'range', startDay: rf.startDay, endDay: rf.endDay, time: timePart(card[rf.endField]) };
    }
    return { kind: 'single', day: rf.endDay, time: timePart(card[rf.endField]) };
  }
  if (rf.startDay) return { kind: 'single', day: rf.startDay, time: timePart(card.start_date) };
  return { kind: 'single', day: rf.endDay, time: timePart(card[rf.endField]) };
}

// null = no chip on that day; otherwise the chip's range-position class:
// 'single' | 'range-start' | 'range-mid' | 'range-end'. Plain string compare
// is a correct date compare for zero-padded YYYY-MM-DD.
function chipPositionForDay(schedule, day) {
  if (schedule.kind === 'single') return schedule.day === day ? 'single' : null;
  if (schedule.kind !== 'range') return null;
  if (day < schedule.startDay || day > schedule.endDay) return null;
  if (schedule.startDay === schedule.endDay) return 'single';
  if (day === schedule.startDay) return 'range-start';
  if (day === schedule.endDay) return 'range-end';
  return 'range-mid';
}

// --- drag & drop reschedule math -----------------
// Given the card's current dates and the drop day, returns the PATCH changes
// object, or null for "don't PATCH" — no working range, or a zero-delta drop
// (same-day drops must not spend a PATCH or an `updated` bump).
// Dragging a RANGE chip moves the range: the drop day becomes the range END
// day and the range start shifts by the same delta, so duration AND both
// times-of-day are preserved. Writes go to THE FIELDS THE RANGE ACTUALLY USED
// (rangeFields): real range -> start_date+end_date, compat range ->
// start_date+due_date — the used pair is KEPT, a compat drag never invents an
// end_date. Other shapes:
//   - start-only: the drop day becomes the START day;
//   - end-only: the drop day becomes the END day;
//   - REVERSED range: the chip the user sees sits at the range END, so only
//     that field moves and the nonsensical start is deliberately left
//     untouched — shifting a field the user never dragged would be a surprise
//     write;
//   - due-only: null — the due marker drags through rescheduleDueChanges.

function shiftValue(value, newDay) {
  const t = timePart(value);
  return t ? `${newDay}T${t}` : newDay;
}

// null when every write would re-state the card's current value (zero-delta).
function pruneNoopChanges(card, changes) {
  return Object.keys(changes).every((k) => changes[k] === card[k]) ? null : changes;
}

function rescheduleChanges(card, targetDay) {
  const rf = rangeFields(card);
  if (!rf.startDay && !rf.endDay) return null;
  let changes;
  if (rf.startDay && rf.endDay && rf.startDay <= rf.endDay) {
    const delta = diffDays(rf.endDay, targetDay);
    changes = {
      [rf.endField]: shiftValue(card[rf.endField], targetDay),
      [rf.startField]: shiftValue(card[rf.startField], addDays(rf.startDay, delta)),
    };
  } else if (rf.endDay) { // end-only, or reversed (chip sits at the range end)
    changes = { [rf.endField]: shiftValue(card[rf.endField], targetDay) };
  } else { // start-only
    changes = { [rf.startField]: shiftValue(card[rf.startField], targetDay) };
  }
  return pruneNoopChanges(card, changes);
}

// Dragging the DUE marker chip moves due_date alone (time-of-day preserved);
// zero-delta and no-parseable-due are null.
function rescheduleDueChanges(card, targetDay) {
  const due = dueMarker(card);
  if (!due) return null;
  return pruneNoopChanges(card, { due_date: shiftValue(card.due_date, targetDay) });
}

// --- chips-per-day capping ---------------------------------------------
// Crowded day cells show the first N chips plus a "+N more" line (the glue
// renders overflow as a cheap tooltip-titled element, no popup).

const CALENDAR_MAX_CHIPS_PER_DAY = 4;

function capChips(chips, max) {
  if (chips.length <= max) return { visible: chips, overflow: [] };
  return { visible: chips.slice(0, max), overflow: chips.slice(max) };
}

// === calendar sub-views (month / week / 3-day / day) ====================
// Outlook/Teams-style span switcher. The month sub-view keeps monthGrid's
// layout above; the three sub-month views share one layout: a column per day, an "all day" band
// on top (date-only cards + multi-day ranges) and a time-of-day grid below
// (datetime-carrying cards at their time). The choice persists per board under
// storageKey(projectName, 'calendar.subview') with the same defensive merge
// stance as mergeViewMode.

const CALENDAR_SUBVIEWS = ['month', 'week', '3day', 'day'];

function mergeCalendarSubview(saved) {
  return CALENDAR_SUBVIEWS.includes(saved) ? saved : 'month';
}

// Monday of the containing week — the calendar's week convention, same
// (getUTCDay()+6)%7 lead math as monthGrid.
function weekStartOf(day) {
  return addDays(day, -((new Date(dayToUtc(day)).getUTCDay() + 6) % 7));
}

// The day columns a sub-month view shows around its anchor day. week: the
// anchor's Monday-to-Sunday; 3day: the anchor plus the next two (a rolling
// window, like Outlook's); day: the anchor alone. month: null — monthGrid
// owns that layout, day columns don't apply.
function calendarSubviewDays(subview, anchorDay) {
  if (subview === 'week') {
    const start = weekStartOf(anchorDay);
    return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i));
  }
  if (subview === '3day') return [anchorDay, addDays(anchorDay, 1), addDays(anchorDay, 2)];
  if (subview === 'day') return [anchorDay];
  return null;
}

// prev/next step by the ACTIVE view's span. One anchor day drives all four
// sub-views, so the
// month case normalizes to the FIRST of the shifted month — the grid only
// needs y/m, and pinning day 1 keeps a Jan-31 anchor from skipping February.
function shiftAnchorDay(subview, anchorDay, delta) {
  if (subview === 'month') {
    const [y, m] = anchorDay.split('-').map(Number);
    const s = shiftMonth(y, m - 1, delta);
    return `${s.year}-${pad2(s.monthIndex + 1)}-01`;
  }
  const span = subview === 'week' ? 7 : subview === '3day' ? 3 : 1;
  return addDays(anchorDay, delta * span);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; // getUTCDay order

// The header title for each sub-view: month keeps monthTitle's "July 2026";
// day is weekday-qualified; week/3day render their window as a range that
// only spells out what differs across the boundary.
function subviewTitle(subview, anchorDay) {
  if (subview === 'month') {
    const [y, m] = anchorDay.split('-').map(Number);
    return monthTitle(y, m - 1);
  }
  const days = calendarSubviewDays(subview, anchorDay);
  const first = days[0];
  const last = days[days.length - 1];
  const [fy, fm, fd] = first.split('-').map(Number);
  const [ly, lm, ld] = last.split('-').map(Number);
  if (subview === 'day') return `${WEEKDAY_NAMES[new Date(dayToUtc(first)).getUTCDay()]} ${fd} ${MONTH_NAMES[fm - 1]} ${fy}`;
  if (fy === ly && fm === lm) return `${fd}–${ld} ${MONTH_NAMES[fm - 1]} ${fy}`;
  if (fy === ly) return `${fd} ${MONTH_NAMES[fm - 1]} – ${ld} ${MONTH_NAMES[lm - 1]} ${fy}`;
  return `${fd} ${MONTH_NAMES[fm - 1]} ${fy} – ${ld} ${MONTH_NAMES[lm - 1]} ${ly}`;
}

// --- time-of-day parsing -----------------------------------------------------------
// timePart() hands back whatever followed the 'T' verbatim; this turns it into
// minutes since midnight for the grid. Tolerant like dayPart: 1-digit hours and
// trailing seconds parse (prefix wins), anything else — including out-of-range
// values — is null, which the layout reads as "no time, all-day".

function timeToMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time == null ? '' : time));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Inverse of timeToMinutes. Defensive clamp: a caller math bug
// degrades to a valid time string (23:59 ceiling / 00:00 floor) rather than
// writing an invalid time to disk. 1440 (24:00) caps at 23:59 — cross-midnight
// is out of scope, so a block that would end exactly at midnight loses its last
// minute rather than rolling into the next day.
function minutesToTime(min) {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// internal (unexported, like pad2): a 'YYYY-MM-DDTHH:MM' from a day + minutes.
function withDateTime(day, min) {
  return `${day}T${minutesToTime(min)}`;
}

// Default block height (in minutes) for a time-point without duration — a
// lone datetime start, a datetime due, a one-sided same-day range.
const CALENDAR_DEFAULT_BLOCK_MIN = 60;

// The minute the time-grid drag/resize snaps to, and the minimum
// duration a resize can shrink a block to. 15 min = Outlook/Google's default.
const CALENDAR_DRAG_SNAP_MIN = 15;

// --- overlap lanes ------------------------------------------------------------------
// Outlook-style side-by-side layout for overlapping timed blocks in one day
// column: greedy first-free-lane assignment over start-sorted blocks, with
// `lanes` = the lane count of the block's transitive-overlap CLUSTER (not the
// whole day), so an isolated block keeps full width even when another hour is
// crowded. Back-to-back blocks (end == next start) don't overlap. Inputs are
// copied, never mutated.

function assignLanes(blocks) {
  const sorted = blocks.map((b) => Object.assign({}, b)).sort((a, b) =>
    a.startMin - b.startMin || a.endMin - b.endMin || ((a.card && a.card.id) || 0) - ((b.card && b.card.id) || 0));
  const out = [];
  let cluster = [];
  let laneEnds = []; // per-lane end minute within the current cluster
  let clusterEnd = -1;
  const flush = () => {
    for (const b of cluster) b.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = b.endMin;
    b.lane = lane;
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.endMin);
  }
  flush();
  return out;
}

// --- the sub-month layout: all-day band + per-day timed blocks -----------------------
// Splits the window-visible cards in two:
//   all-day band — date-only cards and EVERY multi-day range (times on a
//     multi-day range's endpoints don't demote it to the grid: the span is the
//     story). Entries carry window-column indices (clamped, clip-flagged like
//     the gantt's cut bars) and a packed `row` (greedy, longest-first, so
//     disjoint spans share rows instead of stacking one-per-card).
//   timed grid — datetime-carrying same-day work at its time-of-day: a
//     same-day start->end with both times spans its real duration; a lone
//     time (single start/end, one-sided same-day range, datetime due) is a
//     point with the default block height. A REVERSED same-day time pair
//     collapses to a point at the END time — the same collapse-at-end rule
//     cardSchedule applies to reversed date ranges. Blocks clamp at midnight.
// Due markers stay independent: a datetime due is a timed due
// point, a date-only due an all-day due chip — rendered alongside the same
// card's range, exactly like the month view.

function timeGridLayout(cards, days) {
  const first = days[0];
  const last = days[days.length - 1];
  const allDay = [];
  const timedRaw = {};
  for (const d of days) timedRaw[d] = [];

  const pushTimed = (card, day, startMin, endMin, point, due, time) => {
    timedRaw[day].push({ card, startMin, endMin: Math.min(endMin, 1440), point, due, time });
  };
  const pushAllDay = (card, startDay, endDay, due) => {
    if (endDay < first || startDay > last) return; // fully outside the window
    const s = startDay < first ? first : startDay;
    const e = endDay > last ? last : endDay;
    allDay.push({
      card, startIdx: days.indexOf(s), endIdx: days.indexOf(e),
      clipStart: startDay < first, clipEnd: endDay > last, due,
    });
  };
  const inWindow = (day) => day >= first && day <= last;

  for (const card of cards) {
    const schedule = cardSchedule(card);
    if (schedule.kind === 'range' && schedule.startDay !== schedule.endDay) {
      pushAllDay(card, schedule.startDay, schedule.endDay, false);
    } else if (schedule.kind === 'range' && inWindow(schedule.startDay)) {
      // same-day range: real duration needs BOTH endpoint times
      const rf = rangeFields(card);
      const startTime = timePart(card[rf.startField]);
      const endTime = timePart(card[rf.endField]);
      const sMin = timeToMinutes(startTime);
      const eMin = timeToMinutes(endTime);
      if (sMin != null && eMin != null && eMin > sMin) {
        pushTimed(card, schedule.startDay, sMin, eMin, false, false, startTime);
      } else if (eMin != null) { // end-time only, or reversed/zero-length pair — collapse at the end
        pushTimed(card, schedule.startDay, eMin, eMin + CALENDAR_DEFAULT_BLOCK_MIN, true, false, endTime);
      } else if (sMin != null) { // start-time only
        pushTimed(card, schedule.startDay, sMin, sMin + CALENDAR_DEFAULT_BLOCK_MIN, true, false, startTime);
      } else {
        pushAllDay(card, schedule.startDay, schedule.endDay, false);
      }
    } else if (schedule.kind === 'single' && inWindow(schedule.day)) {
      const min = timeToMinutes(schedule.time);
      if (min != null) pushTimed(card, schedule.day, min, min + CALENDAR_DEFAULT_BLOCK_MIN, true, false, schedule.time);
      else pushAllDay(card, schedule.day, schedule.day, false);
    }
    const due = dueMarker(card);
    if (due && inWindow(due.day)) {
      const min = timeToMinutes(due.time);
      if (min != null) pushTimed(card, due.day, min, min + CALENDAR_DEFAULT_BLOCK_MIN, true, true, due.time);
      else pushAllDay(card, due.day, due.day, true);
    }
  }

  // Pack the band: longest span first at equal starts (it anchors the low
  // rows), then greedy first-free-row — same shape as assignLanes but over
  // column indices, and row count is global (the band is one shared strip).
  allDay.sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx || a.card.id - b.card.id);
  const rowEnds = []; // per-row last occupied column index
  for (const entry of allDay) {
    let row = rowEnds.findIndex((end) => end < entry.startIdx);
    if (row === -1) { row = rowEnds.length; rowEnds.push(-1); }
    rowEnds[row] = entry.endIdx;
    entry.row = row;
  }

  const timed = {};
  for (const d of days) timed[d] = assignLanes(timedRaw[d]);
  return { allDay, allDayRows: rowEnds.length, timed };
}

// --- month grid: per-week packed chip layout -----------------------------------------
// The all-day band's one packed strip, re-run PER WEEK: a month is 5-6 rows
// of columns, and a DOM element can't span a line wrap, so a run crossing a
// week boundary becomes one squared-off piece per week it touches instead of
// one element — the band's own window-clip cue, applied at every wrap.
// `days` is monthGrid()'s flat cell list, dates only (row-major, 7 per week).
// Working range (cardSchedule) and due marker both feed ONE packer per week,
// exactly as timeGridLayout never separates the two either — so a due chip
// contends for rows like any other entry, and still renders when its own
// card's range already covers that day.
// clipStart/clipEnd mean "this piece is not the run's true edge", set from
// the one test of clamped-edge vs run-edge — which covers a week boundary and
// the grid's own first/last cell at once, since week 0 starts at the grid's
// first day. Capping is the glue's job, not this one's (same split as the
// band) — see CALENDAR_MAX_CHIP_ROWS_PER_WEEK below.
function monthChipLayout(cards, days) {
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const runs = [];
  for (const card of cards) {
    const schedule = cardSchedule(card);
    if (schedule.kind === 'range') runs.push({ card, startDay: schedule.startDay, endDay: schedule.endDay, time: schedule.time, due: false });
    else if (schedule.kind === 'single') runs.push({ card, startDay: schedule.day, endDay: schedule.day, time: schedule.time, due: false });
    const due = dueMarker(card);
    if (due) runs.push({ card, startDay: due.day, endDay: due.day, time: due.time, due: true });
  }

  return weeks.map((weekDays) => {
    const weekStart = weekDays[0];
    const weekEnd = weekDays[6];
    const entries = [];
    for (const run of runs) {
      if (run.endDay < weekStart || run.startDay > weekEnd) continue; // no overlap with this week
      const pieceStart = run.startDay < weekStart ? weekStart : run.startDay;
      const pieceEnd = run.endDay > weekEnd ? weekEnd : run.endDay;
      entries.push({
        card: run.card, time: run.time, due: run.due,
        startIdx: weekDays.indexOf(pieceStart), endIdx: weekDays.indexOf(pieceEnd),
        clipStart: pieceStart !== run.startDay, clipEnd: pieceEnd !== run.endDay,
      });
    }
    // Same packing shape as timeGridLayout's allDay band: longest span first
    // at equal starts (it anchors the low rows, same reasoning as there),
    // then greedy first-free-row.
    entries.sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx || a.card.id - b.card.id);
    const rowEnds = []; // per-row last occupied column index, THIS WEEK only
    for (const entry of entries) {
      let row = rowEnds.findIndex((end) => end < entry.startIdx);
      if (row === -1) { row = rowEnds.length; rowEnds.push(-1); }
      rowEnds[row] = entry.endIdx;
      entry.row = row;
    }
    return { days: weekDays, rows: rowEnds.length, entries };
  });
}

// Visible chip ROWS per week before the rest fold into a "+N more" line — the
// packed-row equivalent of the old per-day CALENDAR_MAX_CHIPS_PER_DAY, same 4
// so a day cell keeps roughly its old vertical budget. Applied AFTER packing,
// so WHICH cards overflow follows the packer's row assignment, not input
// order, and overflow is per week: a run shown in one week can fold into the
// next week's "+N more" if that week is more crowded.
const CALENDAR_MAX_CHIP_ROWS_PER_WEEK = 4;

// === time-grid drag-to-retime + edge-resize =============================
// These three pure functions mirror the
// gantt's barShiftChanges/barResizeChanges/dueShiftChanges (day-granular) but
// work in MINUTES within a day: the glue hit-tests the pointer to a day column
// + snapped minute and passes them as absolute targets (targetDay/targetMin),
// same absolute-target style as rescheduleChanges above (not the gantt's
// deltas). All route through rangeFields, so the triad + compat contract (ADR
// 0007) holds by construction — a compat range shifts/resizes start+due and
// never invents an end_date. Null = no PATCH, no `updated` bump,
// same convention as rescheduleChanges.

// Body-drag of the RANGE block to a new day + start minute. Handles every
// shape the TIME GRID can hand it — same-day duration, same-day one-time point,
// start-only, end-only, reversed — in one function, mirroring rescheduleChanges'
// own all-shapes-in-one convention. A real duration keeps its length (start
// clamped so the span stays inside the target day); a same-day range with only
// ONE time keeps its date-only sibling on the SAME (target) day so the drag
// never splits it into a multi-day range. A genuine forward MULTI-day range
// (startDay < endDay) is never a timed block — it renders in the all-day band
// and drags via the native day-drag (rescheduleChanges) — so it matches no
// branch here and returns null by design; the glue never calls this for one.
function rescheduleRangeAtTime(card, targetDay, targetMin) {
  const rf = rangeFields(card);
  if (!rf.startField && !rf.endField) return null;
  const min = Math.max(0, Math.min(1439, Math.round(targetMin)));

  if (rf.startDay && rf.endDay && rf.startDay > rf.endDay) { // reversed: only the visible end moves (same rule as rescheduleChanges)
    return pruneNoopChanges(card, { [rf.endField]: withDateTime(targetDay, min) });
  }
  if (rf.startDay && rf.endDay && rf.startDay === rf.endDay) { // same-day pair
    const sMin = timeToMinutes(timePart(card[rf.startField]));
    const eMin = timeToMinutes(timePart(card[rf.endField]));
    if (sMin != null && eMin != null && eMin > sMin) { // real duration — preserve it
      const duration = eMin - sMin;
      const start = Math.max(0, Math.min(1440 - duration, min));
      return pruneNoopChanges(card, {
        [rf.startField]: withDateTime(targetDay, start),
        [rf.endField]: withDateTime(targetDay, start + duration),
      });
    }
    if (eMin != null) { // end-time-only point: retime the end, drag the date-only start sibling to the same day
      return pruneNoopChanges(card, {
        [rf.endField]: withDateTime(targetDay, min),
        [rf.startField]: shiftValue(card[rf.startField], targetDay),
      });
    }
    if (sMin != null) { // start-time-only point: symmetric
      return pruneNoopChanges(card, {
        [rf.startField]: withDateTime(targetDay, min),
        [rf.endField]: shiftValue(card[rf.endField], targetDay),
      });
    }
    return null; // no times at all — not a timed block, the glue never calls this
  }
  if (rf.startDay && !rf.endDay) return pruneNoopChanges(card, { [rf.startField]: withDateTime(targetDay, min) }); // start-only
  if (rf.endDay && !rf.startDay) return pruneNoopChanges(card, { [rf.endField]: withDateTime(targetDay, min) }); // end-only
  return null;
}

// Body-drag of the DUE block: move due_date alone (day + time). No handles.
function rescheduleDueAtTime(card, targetDay, targetMin) {
  const due = dueMarker(card);
  if (!due) return null;
  const min = Math.max(0, Math.min(1439, Math.round(targetMin)));
  return pruneNoopChanges(card, { due_date: withDateTime(targetDay, min) });
}

// Edge-resize of a DURATION block (edge 'start' | 'end'); the day never
// changes. Returns null for anything that isn't a genuine same-day eMin>sMin
// duration — that null is exactly what makes point / reversed / multi-day /
// single blocks refuse resize, with no separate classifier. Boundaries CLAMP
// (never reject): min duration = CALENDAR_DRAG_SNAP_MIN, day edges [0, 1439].
function resizeRangeAtTime(card, edge, targetMin) {
  const rf = rangeFields(card);
  if (!rf.startDay || !rf.endDay || rf.startDay !== rf.endDay) return null;
  const sMin = timeToMinutes(timePart(card[rf.startField]));
  const eMin = timeToMinutes(timePart(card[rf.endField]));
  if (sMin == null || eMin == null || eMin <= sMin) return null;
  const day = rf.startDay;
  const min = Math.max(0, Math.min(1439, Math.round(targetMin)));
  if (edge === 'start') {
    const start = Math.max(0, Math.min(min, eMin - CALENDAR_DRAG_SNAP_MIN));
    return pruneNoopChanges(card, { [rf.startField]: withDateTime(day, start) });
  }
  if (edge === 'end') {
    const end = Math.min(1439, Math.max(min, sMin + CALENDAR_DRAG_SNAP_MIN));
    return pruneNoopChanges(card, { [rf.endField]: withDateTime(day, end) });
  }
  return null; // unknown edge — defensive, never throw from a drag handler
}

// === click-to-create prefill =============================================
// The calendar's create affordance (double-click on empty cell space — see
// app.js's dblclick glue) hands this a day and, for the time grid only, the
// raw pointer minute; this decides the create modal's `start_date` prefill.
// A month/all-day double-click has only a DAY to offer, so the prefill is
// date-only. A time-grid double-click also snaps to the same
// CALENDAR_DRAG_SNAP_MIN grid the retime/resize gestures already use, so a
// card created here lands exactly where a dragged one would. Pre-fills START
// only (ADR 0007: start_date is the working range's "from") — never
// due_date, and the modal's status is left at its own default (unlike the
// column-header "+", which also presets status).
function calendarCreateStart(day, rawMin) {
  if (rawMin == null) return day;
  const snapped = Math.round(rawMin / CALENDAR_DRAG_SNAP_MIN) * CALENDAR_DRAG_SNAP_MIN;
  return withDateTime(day, Math.max(0, Math.min(1439, snapped)));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VIEW_MODES, CALENDAR_MAX_CHIPS_PER_DAY,
    mergeViewMode, dayPart, timePart, addDays, diffDays, dayToUtc, shiftValue, // dayToUtc/shiftValue exported for gantt-model.js
    monthGrid, monthTitle, shiftMonth,
    rangeFields, dueMarker, cardSchedule, chipPositionForDay, // rangeFields/dueMarker also reused by gantt-model.js
    rescheduleChanges, rescheduleDueChanges, capChips,
    CALENDAR_SUBVIEWS, CALENDAR_DEFAULT_BLOCK_MIN, // sub-views
    mergeCalendarSubview, weekStartOf, calendarSubviewDays, shiftAnchorDay,
    subviewTitle, timeToMinutes, assignLanes, timeGridLayout,
    monthChipLayout, CALENDAR_MAX_CHIP_ROWS_PER_WEEK, // month-grid packed layout
    minutesToTime, CALENDAR_DRAG_SNAP_MIN, // time-grid drag/resize
    rescheduleRangeAtTime, rescheduleDueAtTime, resizeRangeAtTime,
    calendarCreateStart, // click-to-create prefill
  };
} else {
  window.VIEW_MODES = VIEW_MODES;
  window.CALENDAR_MAX_CHIPS_PER_DAY = CALENDAR_MAX_CHIPS_PER_DAY;
  window.mergeViewMode = mergeViewMode;
  window.dayPart = dayPart;
  window.timePart = timePart;
  window.addDays = addDays;
  window.diffDays = diffDays;
  window.dayToUtc = dayToUtc; // gantt-model.js reads these off window
  window.shiftValue = shiftValue;
  window.monthGrid = monthGrid;
  window.monthTitle = monthTitle;
  window.shiftMonth = shiftMonth;
  window.rangeFields = rangeFields; // gantt-model.js + app.js read these off window
  window.dueMarker = dueMarker;
  window.cardSchedule = cardSchedule;
  window.chipPositionForDay = chipPositionForDay;
  window.rescheduleChanges = rescheduleChanges;
  window.rescheduleDueChanges = rescheduleDueChanges;
  window.capChips = capChips;
  window.CALENDAR_SUBVIEWS = CALENDAR_SUBVIEWS; // sub-views
  window.CALENDAR_DEFAULT_BLOCK_MIN = CALENDAR_DEFAULT_BLOCK_MIN;
  window.mergeCalendarSubview = mergeCalendarSubview;
  window.weekStartOf = weekStartOf;
  window.calendarSubviewDays = calendarSubviewDays;
  window.shiftAnchorDay = shiftAnchorDay;
  window.subviewTitle = subviewTitle;
  window.timeToMinutes = timeToMinutes;
  window.assignLanes = assignLanes;
  window.timeGridLayout = timeGridLayout;
  window.monthChipLayout = monthChipLayout; // month-grid packed layout
  window.CALENDAR_MAX_CHIP_ROWS_PER_WEEK = CALENDAR_MAX_CHIP_ROWS_PER_WEEK;
  window.minutesToTime = minutesToTime; // time-grid drag/resize
  window.CALENDAR_DRAG_SNAP_MIN = CALENDAR_DRAG_SNAP_MIN;
  window.rescheduleRangeAtTime = rescheduleRangeAtTime;
  window.rescheduleDueAtTime = rescheduleDueAtTime;
  window.resizeRangeAtTime = resizeRangeAtTime;
  window.calendarCreateStart = calendarCreateStart; // click-to-create prefill
}
