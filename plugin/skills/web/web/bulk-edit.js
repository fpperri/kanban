'use strict';
// Pure rules for the bulk Edit-tags popup. No DOM — same
// dual-environment pattern as the other web modules. The popup shows the
// union of tags across the selected cards (with per-tag counts), adds a tag
// everywhere it's missing, and strips chosen tags from the cards carrying
// them. Only cards that actually change are returned — the caller PATCHes
// exactly those, bulk-move semantics.

function tagUnion(cards) {
  const counts = new Map();
  for (const c of cards) for (const t of c.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function addTagChanges(cards, tag) {
  const has = (c) => (c.tags || []).some((t) => t.toLowerCase() === String(tag).toLowerCase());
  return cards.filter((c) => !has(c)).map((c) => ({ id: c.id, tags: [...(c.tags || []), tag] }));
}

function removeTagsChanges(cards, remove) {
  const doomed = new Set(remove.map((t) => String(t).toLowerCase()));
  return cards
    .filter((c) => (c.tags || []).some((t) => doomed.has(t.toLowerCase())))
    .map((c) => ({ id: c.id, tags: c.tags.filter((t) => !doomed.has(t.toLowerCase())) }));
}

// Pure rules for the Schedule… popup. fields =
// { start: {value, clear}, end: {...}, due: {...} } straight off the three
// rows. Per field: a checked clear box WINS (PATCH '' — the card-store clear
// contract) even over a typed value; otherwise a non-empty value sets the
// field (trimmed, verbatim — never validated, the free-text date contract);
// empty + unchecked leaves the key out so the card keeps its value. A fully
// untouched popup returns null — Apply is then a no-op (no PATCHes, no
// `updated` bumps).
const SCHEDULE_FIELDS = [
  ['start', 'start_date'],
  ['end', 'end_date'],
  ['due', 'due_date'],
];

function scheduleChanges(fields) {
  const changes = {};
  for (const [key, patchKey] of SCHEDULE_FIELDS) {
    const f = (fields && fields[key]) || {};
    if (f.clear) changes[patchKey] = '';
    else if (String(f.value || '').trim()) changes[patchKey] = String(f.value).trim();
  }
  return Object.keys(changes).length ? changes : null;
}

// Toast fragment naming what a scheduleChanges() result does, in triad order:
// 'start → 2026-07-01, end cleared, due → 2026-07-10'.
function scheduleSummary(changes) {
  const parts = [];
  for (const [key, patchKey] of SCHEDULE_FIELDS) {
    if (!(patchKey in changes)) continue;
    parts.push(changes[patchKey] === '' ? `${key} cleared` : `${key} → ${changes[patchKey]}`);
  }
  return parts.join(', ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tagUnion, addTagChanges, removeTagsChanges, scheduleChanges, scheduleSummary };
} else {
  window.tagUnion = tagUnion;
  window.addTagChanges = addTagChanges;
  window.removeTagsChanges = removeTagsChanges;
  window.scheduleChanges = scheduleChanges;
  window.scheduleSummary = scheduleSummary;
}
