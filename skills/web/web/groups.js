'use strict';
// The rules of groups on the page (docs/adr/0015, GLOSSARY.md "Ids, groups and the
// logbook"), apart from the DOM: which groups a card wears as badges and how a badge reads,
// which groups hold a whole selection, which folders the group form offers, and whether
// a group is running. groups-ui.js draws them and talks to the server.
//
// A group is the object the board payload carries: { id, name, folder, start_date,
// end_date, auto_join, cards, extra, file }. Its folder is its type path ('' = no type).
//
// Pure: same dual-environment export pattern as view-panel.js — loaded as a plain
// <script> in the browser (one global per function) AND required by node --test.

const GROUP_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const GROUP_BADGES_SHOWN = 2;

// `#I2 zephyr-2`: the id with its sign, then the short name.
function groupLabel(group) {
  return group.name ? `#${group.id} ${group.name}` : `#${group.id}`;
}

// The type path the folders spell: `workflow/dynamic`, or `(no type)` for a group at the root.
function groupTypePath(group) {
  return group.folder ? group.folder : '(no type)';
}

// `2026-10-12 to 2026-10-23 · iteration`: the dates when it has them, then its type path.
function groupTip(group) {
  const dates = group.start_date && group.end_date ? `${group.start_date} to ${group.end_date}`
    : group.start_date ? `from ${group.start_date}` : group.end_date ? `until ${group.end_date}` : '';
  return `${dates ? `${dates} · ` : ''}${groupTypePath(group)}`;
}

function groupById(groups, id) {
  const key = GROUP_IDS.idKey(id);
  return key === null ? null : groups.find((g) => g.id === key) || null;
}

// The groups listing a card, in id order.
function groupsOfCard(groups, cardId) {
  const key = GROUP_IDS.idKey(cardId);
  if (key === null) return [];
  return groups.filter((g) => g.cards.includes(key)).sort((a, b) => GROUP_IDS.compareIds(a.id, b.id));
}

// What a card's badges show: the first two groups, then how many more there are and what
// they are called.
function groupBadgeModel(groups, cardId, max = GROUP_BADGES_SHOWN) {
  const all = groupsOfCard(groups, cardId);
  const hidden = all.slice(max);
  return { shown: all.slice(0, max), more: hidden.length, moreTip: hidden.map(groupLabel).join('\n') };
}

// The groups that list every one of the cards, in id order; none for no cards.
function groupsHoldingAll(groups, cardIds) {
  const keys = cardIds.map((id) => GROUP_IDS.idKey(id)).filter((k) => k !== null);
  if (!keys.length) return [];
  return groups.filter((g) => keys.every((k) => g.cards.includes(k))).sort((a, b) => GROUP_IDS.compareIds(a.id, b.id));
}

// A group with dates is running from its start to its end, both days included.
function groupRunning(group, day) {
  return !!(group.start_date && group.end_date && group.start_date <= day && day <= group.end_date);
}

// The flash after a card is created: the running groups the server put it into, or ''.
function groupJoinedNote(joined) {
  return joined && joined.length ? `Joined ${joined.map(groupLabel).join(', ')}.` : '';
}

// The folders the form offers: none first (the root), then the rest in order. `payload` is
// the board's groups ({ folders }).
function groupFolderChoices(payload) {
  const folders = (payload && payload.folders) || [];
  return [{ value: '', label: '(no type)' }].concat(folders.filter((f) => f !== '').map((f) => ({ value: f, label: f })));
}

// What the form says an id will start with: the prefix the exact folder is mapped to, else `_`.
function groupPrefixFor(payload, folder) {
  const prefixes = (payload && payload.prefixes) || {};
  return Object.prototype.hasOwnProperty.call(prefixes, folder) ? prefixes[folder] : '_';
}

// The first thing wrong with a group form, or ''.
function groupFormProblem(form) {
  if (!String(form.name || '').trim()) return 'A group needs a short name.';
  if (form.start_date && form.end_date && form.end_date < form.start_date) return 'A group cannot end before it starts.';
  return '';
}

// What the group form sends: auto_join only means something with both dates.
function groupFormBody(form) {
  const start = String(form.start_date || '').trim();
  const end = String(form.end_date || '').trim();
  return {
    name: String(form.name || '').trim(),
    folder: form.folder || '',
    start_date: start,
    end_date: end,
    auto_join: !!form.auto_join && start !== '' && end !== '',
    cards: form.cards || [],
  };
}

// A group as the page last drew it, to tell whether a refresh changed it.
function groupSignature(group) {
  return group ? JSON.stringify(group) : '';
}

const GROUPS_EXPORTS = {
  groupSignature, groupLabel, groupTypePath, groupTip, groupById, groupsOfCard, groupBadgeModel, groupsHoldingAll,
  groupRunning, groupJoinedNote, groupFolderChoices, groupPrefixFor, groupFormProblem, groupFormBody,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GROUPS_EXPORTS;
} else {
  Object.assign(window, GROUPS_EXPORTS);
}
