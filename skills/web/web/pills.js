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

// The built-in pills, in the order the panel lists them. A pill is { key, label,
// query }; the list adds `count`.
const BUILT_IN_PILLS = [
  { key: 'blocked', label: 'blocked', query: 'blocked:' },
  { key: 'review', label: 'review', query: 'review:' },
  { key: 'waiting', label: 'waiting', query: 'waiting:' },
];

// A fresh list: each built-in pill with the number of `cards` its query matches.
function pillList(cards, matchIds) {
  const shown = new Set(cards.map((c) => c.id));
  return BUILT_IN_PILLS.map((pill) => {
    let count = 0;
    for (const id of matchIds(pill.query)) if (shown.has(id)) count++;
    return { ...pill, count };
  });
}

// A query as it is compared: spacing does not matter.
function pillQueryKey(query) {
  return String(query).trim().replace(/\s+/g, ' ');
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

// The chip a closed panel shows: how many things are on, and a name that says
// which, for a screen reader. `names` is what each one is called. Nothing on, no
// chip (count 0, no name).
function panelChip(names = []) {
  return names.length ? { count: names.length, name: `${names.length} on: ${names.join(', ')}` } : { count: 0, name: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BUILT_IN_PILLS, pillList, pillIsOn, pillsOn, panelChip };
} else {
  window.BUILT_IN_PILLS = BUILT_IN_PILLS;
  window.pillList = pillList;
  window.pillIsOn = pillIsOn;
  window.pillsOn = pillsOn;
  window.panelChip = panelChip;
}
