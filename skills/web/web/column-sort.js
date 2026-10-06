'use strict';
// Pure helpers for per-column sorting. No DOM/localStorage access
// here on purpose — same dual-environment pattern as column-state.js /
// refresh-policy.js / search.js: unit-testable from node --test AND loaded as
// a plain <script> in the browser (app.js calls these as bare globals).
//
// localStorage discipline: reuses column-state.js's storageKey() scheme
// (`kanban.<projectName>.<feature>`), under the feature name
// 'columns.sort' — a sibling key to 'columns.collapsed', never
// colliding since each feature gets its own key.

// The old 'date' field was ambiguous (deadline? recency?) and split
// into 'due' (the triad-aware schedule sort) and 'modified' (the
// machine-maintained `updated` stamp); mergeSortState still migrates a saved 'date'.
const SORT_FIELDS = ['id', 'priority', 'due', 'modified', 'assignee', 'outline'];
const SORT_FIELD_LABELS = { id: 'ID', priority: 'Priority', due: 'Due date', modified: 'Last modified', assignee: 'Assignee', outline: 'Outline' };
// Natural starting direction when a column is switched to a field for the
// first time: id/due ascending (oldest id / earliest due date first),
// priority descending (High first, matching the "High-first by
// default" rule), modified descending (most recently touched first — recency
// is what you switch to that sort for), assignee ascending (registry order —
// human first — is the reading order you switch to that sort for).
// outline ascending: the parent first, then its children, is how an outline reads.
const DEFAULT_SORT_DIRECTION = { id: 'asc', priority: 'desc', due: 'asc', modified: 'desc', assignee: 'asc', outline: 'asc' };

// Default per column, until the user picks a sort: live columns
// priority-desc/id-tiebreak, Archive plain id-asc. Kept as the static
// default shape; defaultSort() below derives the same rule for any dynamic
// column set.
const DEFAULT_SORT = {
  backlog: { field: 'priority', direction: 'desc' },
  todo: { field: 'priority', direction: 'desc' },
  doing: { field: 'priority', direction: 'desc' },
  done: { field: 'priority', direction: 'desc' },
  archive: { field: 'id', direction: 'asc' },
};

// Per-column sort default derived for whatever column set is in play:
// live columns priority-desc, archive id-asc — the rule DEFAULT_SORT
// encodes for the built-in set. On a nested board (any card has a rank or a
// parent) the live columns open in outline order instead.
function defaultSort(columnIds, opts) {
  const live = opts && opts.nested
    ? { field: 'outline', direction: 'asc' }
    : { field: 'priority', direction: 'desc' };
  const out = {};
  for (const col of columnIds || Object.keys(DEFAULT_SORT)) {
    out[col] = col === 'archive' ? { field: 'id', direction: 'asc' } : Object.assign({}, live);
  }
  return out;
}

function isValidSortEntry(entry) {
  return !!entry && typeof entry === 'object'
    && SORT_FIELDS.includes(entry.field)
    && (entry.direction === 'asc' || entry.direction === 'desc');
}

// A structurally valid {field, direction} copy, else null.
// rename migration: a pre-split saved 'date' sort keeps working
// as 'due' (same comparator it always resolved to), direction preserved.
function normalizeSortEntry(entry) {
  if (entry && typeof entry === 'object' && entry.field === 'date') {
    entry = { field: 'due', direction: entry.direction };
  }
  return isValidSortEntry(entry) ? { field: entry.field, direction: entry.direction } : null;
}

// Merge the user's picks (a per-column {field, direction} object, which may be
// missing, null, not an object, or carry stale/unknown column keys or a
// malformed entry) with the defaults — same defensive shape as
// column-state.js's mergeCollapsedState: unknown keys are dropped,
// missing/invalid entries fall back to the default, only a structurally valid
// {field, direction} pair is trusted.
// Pass the board's current column ids to merge against a dynamic
// column set; omitting them keeps the built-in five. opts.nested picks the
// nested board's defaults.
function mergeSortState(saved, ids, opts) {
  const defaults = defaultSort(ids, opts);
  const result = {};
  for (const col of Object.keys(defaults)) {
    result[col] = Object.assign({}, defaults[col]);
  }
  if (saved && typeof saved === 'object') {
    for (const col of Object.keys(defaults)) {
      const entry = normalizeSortEntry(saved[col]);
      if (entry) result[col] = entry;
    }
  }
  return result;
}

// Only what the user picked is stored, as { picked: { column: entry } }. The
// whole merged state used to be stored, which froze whatever default was
// showing into every column the moment one column was changed — and a default
// that depends on the cards (outline on a nested board) must stay free to
// change. A value in that old shape carries picks and frozen defaults alike;
// an entry equal to the old default is read as not picked.
function readSortPicks(saved, ids) {
  const out = {};
  if (!saved || typeof saved !== 'object') return out;
  const versioned = !!saved.picked && typeof saved.picked === 'object';
  const source = versioned ? saved.picked : saved;
  const frozen = defaultSort(ids);
  for (const col of Object.keys(source)) {
    const entry = normalizeSortEntry(source[col]);
    if (!entry) continue;
    const old = Object.prototype.hasOwnProperty.call(frozen, col) ? frozen[col] : null;
    if (!versioned && old && old.field === entry.field && old.direction === entry.direction) continue;
    out[col] = entry;
  }
  return out;
}

// Rank comes from the board's configured `priorities` list (ordered,
// highest first) — falling back to the built-in list. Earlier in the list =
// higher rank; a priority not in the list at all ranks 0 (unknown).
const DEFAULT_PRIORITIES = ['High', 'Normal', 'Low'];

function priorityRank(card, priorities) {
  const list = priorities && priorities.length ? priorities : DEFAULT_PRIORITIES;
  const i = list.indexOf(card.priority);
  return i === -1 ? 0 : list.length - i;
}

// Comparator for a single column's active sort. Direction only flips the
// PRIMARY comparison; tie-breaks (priority ties, both-missing-date ties, and
// same-due-date ties) always fall back to id ascending — a stable order
// never reshuffles on a direction toggle.
//
// One source of truth for "which date drives this card" — the tile
// label and the Due date sort share it, so what you see is what sorted.
function scheduleKey(card) {
  return card.due_date || card.end_date || card.start_date || null;
}

// Compact tile label: '⚑ MM-DD[ HH:MM]' for deadlines (due), 'MM-DD[ HH:MM]'
// for range dates; the year appears only when it isn't todayStr's year.
function scheduleLabel(card, todayStr) {
  const key = scheduleKey(card);
  if (!key) return '';
  const [day, time] = key.split('T');
  const sameYear = day.slice(0, 4) === String(todayStr).slice(0, 4);
  const datePart = sameYear ? day.slice(5) : day;
  const timePart = time ? ` ${time.slice(0, 5)}` : '';
  return `${card.due_date ? '⚑ ' : ''}${datePart}${timePart}`;
}

// A card is overdue when its due_date's day part (before any 'T') is
// strictly earlier than today — day-granular on purpose, same as
// localTodayStr/chipPositionForDay/the gantt's day columns: a 09:00 deadline
// today isn't overdue until tomorrow. `due_date` specifically, not the
// scheduleKey triad — a range's start/end drifting past today is a schedule
// slip, not a missed deadline. `status !== 'done'` matches the idiom
// unresolvedWaits/selection.js already use; archived is checked separately
// since it's a location, not a status — either one retires the deadline as
// no-longer-actionable.
function isOverdue(card, todayStr) {
  if (!card.due_date || card.status === 'done' || card.archived) return false;
  const day = String(card.due_date).split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < todayStr;
}

// Same MM-DD[ HH:MM]/YYYY-MM-DD[ HH:MM] formatting scheduleLabel uses for its
// one triad-collapsed value, applied per literal field instead. The day is a
// PREFIX match and the time needs the 'T' — byte-for-byte calendar-model's
// dayPart/timePart tolerance, so a hand-written `2026-09-01 09:30` (a day
// everywhere else in the app) still draws its row here instead of silently
// vanishing off the tile. Anything with no leading ISO day returns null
// rather than echoing garbage.
function formatScheduleDate(value, todayStr) {
  const raw = String(value == null ? '' : value);
  const day = (/^(\d{4}-\d{2}-\d{2})/.exec(raw) || [])[1];
  if (!day) return null;
  const time = (/^\d{4}-\d{2}-\d{2}T(.+)$/.exec(raw) || [])[1] || '';
  const sameYear = day.slice(0, 4) === String(todayStr).slice(0, 4);
  const datePart = sameYear ? day.slice(5) : day;
  const timePart = time ? ` ${time.slice(0, 5)}` : '';
  return `${datePart}${timePart}`;
}

// The tile's date stack: one row per LITERAL frontmatter field the card
// actually carries, fixed start/end/due order, each with its own glyph —
// deliberately NOT scheduleKey's triad (that collapses to a single
// deadline-or-range value; this shows all three a card has, so a card
// carrying all three no longer hides two of them behind the due date). A
// missing or unparseable field produces no row, not a blank one, so the
// renderer needs no CSS gap trick — a two-row card is just shorter than a
// three-row one. Only the due row can be overdue: isOverdue() already gates
// on due_date/status/archived and start/end never carry a deadline meaning.
const SCHEDULE_ROW_GLYPHS = {
  start_date: '⇤', // LEFTWARDS ARROW TO BAR
  end_date: '⇥', // RIGHTWARDS ARROW TO BAR
  due_date: '⚑', // BLACK FLAG — the same deadline flag the calendar's due chip draws
};

function scheduleRows(card, todayStr) {
  const rows = [];
  for (const field of ['start_date', 'end_date', 'due_date']) {
    const text = formatScheduleDate(card[field], todayStr);
    if (!text) continue;
    rows.push({
      glyph: SCHEDULE_ROW_GLYPHS[field],
      text,
      overdue: field === 'due_date' && isOverdue(card, todayStr),
    });
  }
  return rows;
}

// outlineIndex is nesting.js's Map of card id -> position over the whole board:
// a column cannot work out the outline from its own cards, since a child's
// parent may sit in another column.
function compareCards(a, b, sort, priorities, assignees, outlineIndex) {
  const dir = sort.direction === 'desc' ? -1 : 1;
  switch (sort.field) {
    case 'id':
      return dir * (a.id - b.id);
    case 'priority': {
      const ra = priorityRank(a, priorities);
      const rb = priorityRank(b, priorities);
      if ((ra > 0) !== (rb > 0)) return ra > 0 ? -1 : 1; // unknown priority sorts last, regardless of direction — same rule as missing due_date
      const diff = dir * (ra - rb);
      return diff !== 0 ? diff : a.id - b.id;
    }
    case 'due': {
      // triad-aware key — the deadline wins, else the range's end,
      // else its start, so scheduled-but-not-due cards join the order instead
      // of clumping with the dateless. Lexicographic ISO compare orders time
      // within a day; a date-only value reads as start-of-day.
      const ka = scheduleKey(a);
      const kb = scheduleKey(b);
      if (!!ka !== !!kb) return ka ? -1 : 1; // truly dateless sorts last, regardless of direction
      if (!ka) return a.id - b.id; // both dateless: stable by id
      const diff = dir * (ka < kb ? -1 : ka > kb ? 1 : 0);
      return diff !== 0 ? diff : a.id - b.id;
    }
    case 'modified': {
      // keys on the machine-maintained `updated` stamp
      // (YYYY-MM-DDTHH:MM:SS local — lexicographic ISO compare, same as due).
      // Cards a stamp never reached (hand-authored) sort last in
      // both directions, same rule as missing due_date.
      const ka = a.updated || null;
      const kb = b.updated || null;
      if (!!ka !== !!kb) return ka ? -1 : 1;
      if (!ka) return a.id - b.id;
      const diff = dir * (ka < kb ? -1 : ka > kb ? 1 : 0);
      return diff !== 0 ? diff : a.id - b.id;
    }
    case 'assignee': {
      // group by owner handle. Registered handles rank by the
      // config.yaml assignees REGISTRY order (`assignees` = ordered handle
      // list — human first, then HITL, then AFK reads better than
      // alphabetical); unregistered handles come after ALL registered ones,
      // lexicographic among themselves — "suggest never validate", so an
      // unregistered assignee still sorts, it just can't outrank the
      // registry. No/empty registry degrades to plain lexicographic. Only
      // the assigned ordering flips on 'desc'; unassigned cards sort last in
      // both directions — exact same pin as missing due_date / updated.
      const ka = a.assignee || null;
      const kb = b.assignee || null;
      if (!!ka !== !!kb) return ka ? -1 : 1; // unassigned sorts last, regardless of direction
      if (!ka) return a.id - b.id; // both unassigned: stable by id
      const list = assignees || [];
      const ia = list.indexOf(ka);
      const ib = list.indexOf(kb);
      const cmp = ia !== -1 && ib !== -1 ? ia - ib
        : ia !== -1 || ib !== -1 ? (ia !== -1 ? -1 : 1)
        : ka < kb ? -1 : ka > kb ? 1 : 0;
      const diff = dir * cmp;
      return diff !== 0 ? diff : a.id - b.id;
    }
    case 'outline': {
      const ia = outlineIndex ? outlineIndex.get(a.id) : undefined;
      const ib = outlineIndex ? outlineIndex.get(b.id) : undefined;
      if ((ia === undefined) !== (ib === undefined)) return ia === undefined ? 1 : -1; // a card outside the index sorts last in both directions
      if (ia === undefined) return a.id - b.id;
      const diff = dir * (ia - ib);
      return diff !== 0 ? diff : a.id - b.id;
    }
    default:
      return 0;
  }
}

// Convenience wrapper: never mutates the input array (renderBoard() needs the
// same discipline drag-drop/search already rely on — sorting is a pure view
// concern, state.active/state.archived stay the source of truth).
function sortCards(cards, sort, priorities, assignees, outlineIndex) {
  return cards.slice().sort((a, b) => compareCards(a, b, sort, priorities, assignees, outlineIndex));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SORT_FIELDS, SORT_FIELD_LABELS, DEFAULT_SORT_DIRECTION, DEFAULT_SORT, DEFAULT_PRIORITIES,
    defaultSort, mergeSortState, readSortPicks, priorityRank, scheduleKey, scheduleLabel, isOverdue, scheduleRows, compareCards, sortCards,
  };
} else {
  window.SORT_FIELDS = SORT_FIELDS;
  window.SORT_FIELD_LABELS = SORT_FIELD_LABELS;
  window.DEFAULT_SORT_DIRECTION = DEFAULT_SORT_DIRECTION;
  window.DEFAULT_SORT = DEFAULT_SORT;
  window.defaultSort = defaultSort;
  window.DEFAULT_PRIORITIES = DEFAULT_PRIORITIES;
  window.mergeSortState = mergeSortState;
  window.readSortPicks = readSortPicks;
  window.priorityRank = priorityRank;
  window.scheduleKey = scheduleKey;
  window.scheduleLabel = scheduleLabel;
  window.isOverdue = isOverdue;
  window.scheduleRows = scheduleRows;
  window.compareCards = compareCards;
  window.sortCards = sortCards;
}
