'use strict';
// Pure pill list for the search panel: the pills a board offers as one-click
// queries, each with the number of cards it matches, and which of them are on.
// No DOM, no storage, and no other module on purpose: the snapshot embeds this
// file's source verbatim, where nothing else is loaded. Same dual-environment
// pattern as slices.js.
//
// The matching is the caller's: `matchIds(query)` answers the ids the search
// module matches for that text over the whole board, so `waiting:` sees a card
// it waits for that the view hides. The list counts those matches among the
// cards it is given, which the page makes the view's cards after the status
// pills and Archive, before the search box and any cut, so turning one pill on
// leaves the others' counts as they were.
//
// The pills are the three built-ins, then the board's own, in config order. The
// board's `pills:` entries reach here as the config reader kept them, { label,
// query } (a bare string is a query too): an entry shows its label, or its query
// when it has none. An entry of the form `field:*` (tags:*, assignee:*, and also
// status, priority and type) stands for one pill per distinct value the board's
// active cards hold in that field, sorted and labelled by the value, each
// matching its value exactly (`tags:"grill"`, which never catches `grilling`). The
// first eight values of a field show; pillRows puts a "+N more" row after them for
// the rest. Next up is not built in: it is a pill a board defines.
//
// The caller gives the board's side as { pills, cards, term }: the entries, the
// cards the values come from, and the search module's term writer (searchTermText),
// which writes each value as one exact term. Nothing here throws on what reaches it:
// an entry or a value that cannot be a pill is skipped.

// The built-in pills, in the order the panel lists them. A pill is { key, label,
// query }; the list adds `count`.
const BUILT_IN_PILLS = [
  { key: 'blocked', label: 'blocked', query: 'blocked:' },
  { key: 'review', label: 'review', query: 'review:' },
  { key: 'waiting', label: 'waiting', query: 'waiting:' },
];

// The fields a `field:*` entry can expand, and the spellings that mean one.
const PILL_VALUE_FIELDS = ['tags', 'assignee', 'status', 'priority', 'type'];
const PILL_FIELD_ALIASES = { a: 'assignee' };

// How many of a field's value pills show before the rest are behind "+N more".
const PILLS_SHOWN = 8;

// A query as it is compared: spacing does not matter.
function pillQueryKey(query) {
  return String(query).trim().replace(/\s+/g, ' ');
}

// One `pills:` entry as the reader kept it → { label, query }, or null when it
// cannot be a pill. The label is the query when the entry has none.
function pillBoardEntry(entry) {
  const raw = typeof entry === 'string' ? { query: entry } : entry;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.query !== 'string') return null;
  const query = pillQueryKey(raw.query);
  if (!query) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  return { label: label || query, query };
}

// The field a query expands, or null when it is not a `field:*` query. A field that
// has no list of values (title:*) answers '' so that the entry is skipped.
function pillExpandedField(query) {
  const m = /^([A-Za-z]+):\*$/.exec(query);
  if (!m) return null;
  const low = m[1].toLowerCase();
  const field = PILL_FIELD_ALIASES[low] || low;
  return PILL_VALUE_FIELDS.includes(field) ? field : '';
}

// The distinct values the cards hold in a field, one spelling each (the first met),
// sorted without regard to letter case. Spacing inside a value collapses, as the
// search module's exact match collapses it; a blank value, and one with a quote
// in it, which the term writer cannot carry, have no pill.
function pillValues(cards, field) {
  const seen = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || typeof card !== 'object') continue;
    const held = field === 'tags' ? card.tags : [card[field]];
    for (const item of Array.isArray(held) ? held : []) {
      if (typeof item !== 'string' && typeof item !== 'number') continue;
      const value = String(item).replace(/\s+/g, ' ').trim();
      if (!value || value.includes('"') || seen.has(value.toLowerCase())) continue;
      seen.set(value.toLowerCase(), value);
    }
  }
  return [...seen.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((key) => seen.get(key));
}

// The pills the panel lists, without counts: the built-ins, then the board's own in
// config order, a `field:*` entry expanded in its place. A pill whose key is already
// listed is left out (the same query twice, or a field expanded twice).
function pillEntries(board) {
  const made = BUILT_IN_PILLS.map((pill) => ({ ...pill }));
  if (!board || !Array.isArray(board.pills)) return made;
  const keys = new Set(made.map((pill) => pill.key));
  const add = (pill) => {
    if (keys.has(pill.key)) return;
    keys.add(pill.key);
    made.push(pill);
  };
  for (const entry of board.pills) {
    const own = pillBoardEntry(entry);
    if (!own) continue;
    const field = pillExpandedField(own.query);
    if (field === null) {
      add({ key: `pill:${own.query}`, label: own.label, query: own.query });
    } else if (field && typeof board.term === 'function') {
      for (const value of pillValues(board.cards, field)) {
        add({ key: `value:${field}:${value.toLowerCase()}`, label: value, query: board.term(field, value, true), group: field });
      }
    }
  }
  return made;
}

// Each pill in `pills` with the number of `cards` its query matches.
function pillCounts(pills, cards, matchIds) {
  const shown = new Set(cards.map((c) => c.id));
  return pills.map((pill) => {
    let count = 0;
    for (const id of matchIds(pill.query) || []) if (shown.has(id)) count++;
    return { ...pill, count };
  });
}

// A fresh list: every pill, hidden ones too, with the number of `cards` its query
// matches.
function pillList(cards, matchIds, board) {
  return pillCounts(pillEntries(board), cards, matchIds);
}

// What the panel draws for a list: each pill, and after the value pills of a field
// that has more than eight, a "+N more" row (or "fewer" once the field is open) in
// place of the ones that are folded away. `open` names the fields that are open.
// A row is a pill, or { kind: 'more', key, group, hidden, expanded, label }; the
// more row's key is the same open or folded, so the button stays the one button.
function pillRows(list, open) {
  const opened = new Set(Array.isArray(open) ? open : []);
  const total = {};
  for (const pill of list) if (pill.group) total[pill.group] = (total[pill.group] || 0) + 1;
  const met = {};
  const rows = [];
  for (const pill of list) {
    if (!pill.group) { rows.push(pill); continue; }
    const group = pill.group;
    met[group] = (met[group] || 0) + 1;
    if (met[group] <= PILLS_SHOWN || opened.has(group)) rows.push(pill);
    if (met[group] === total[group] && total[group] > PILLS_SHOWN) {
      const hidden = total[group] - PILLS_SHOWN;
      const expanded = opened.has(group);
      rows.push({ kind: 'more', key: `more:${group}`, group, hidden, expanded, label: expanded ? 'fewer' : `+${hidden} more` });
    }
  }
  return rows;
}

// Whether a pill is on: its query is the anchor of the selection, or one of its
// additions. A query typed in the box is not a pill, even when it reads as one.
// `selection` is { anchor, additions }, each part { kind: 'query', text, source? }
// for a query.
function pillIsOn(selection, pill) {
  const key = pillQueryKey(pill.query);
  const parts = selection.anchor ? [selection.anchor].concat(selection.additions) : [];
  return parts.some((part) => part.kind === 'query' && !part.source && pillQueryKey(part.text) === key);
}

// The pills that are on, in list order.
function pillsOn(selection, pills) {
  return pills.filter((pill) => pillIsOn(selection, pill));
}

// The pill the m key's next step solos, or null for a list with no pill. The cycle runs
// off, every pill in list order, then off again (Shift+m runs it backwards), and each step
// is a solo, like a right-click: the pill alone is on and the box holds its query alone. The
// place in the cycle is the pill that is on alone; with none on, several on, or only a card,
// a path or a typed search selected, the cycle is at off, so m answers the first pill and
// Shift+m the last. The step off is the solo of the pill that is on alone, which turns
// every pill off, so the step after the last pill answers that pill again, and so does the
// step before the first. Pills that hold one query are one step, the first of them (a board
// pill for tags:"next-up" and the tag's own value pill are on together, and one filter is
// not two stops). `direction` is 1 for m, -1 for Shift+m.
function pillStep(pills, selection, direction) {
  const seen = new Set();
  const cycle = pills.filter((pill) => !seen.has(pillQueryKey(pill.query)) && seen.add(pillQueryKey(pill.query)));
  if (!cycle.length) return null;
  const on = pillsOn(selection, cycle);
  const here = on.length === 1 ? cycle.indexOf(on[0]) : -1;
  if (here === -1) return direction < 0 ? cycle[cycle.length - 1] : cycle[0];
  return cycle[here + direction] || cycle[here];
}

// The chip a closed panel shows: how many things are on, and a name that says
// which, for a screen reader. `names` is what each one is called. Nothing on, no
// chip (count 0, no name).
function panelChip(names = []) {
  return names.length ? { count: names.length, name: `${names.length} on: ${names.join(', ')}` } : { count: 0, name: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BUILT_IN_PILLS, PILLS_SHOWN, pillEntries, pillCounts, pillList, pillRows, pillIsOn, pillsOn, pillStep, panelChip };
} else {
  window.BUILT_IN_PILLS = BUILT_IN_PILLS;
  window.PILLS_SHOWN = PILLS_SHOWN;
  window.pillEntries = pillEntries;
  window.pillCounts = pillCounts;
  window.pillList = pillList;
  window.pillRows = pillRows;
  window.pillIsOn = pillIsOn;
  window.pillsOn = pillsOn;
  window.pillStep = pillStep;
  window.panelChip = panelChip;
}
