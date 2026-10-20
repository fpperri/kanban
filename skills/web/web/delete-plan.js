'use strict';
// What the delete popup says and offers (GLOSSARY.md "Ids, groups and the logbook"), apart from
// the DOM: a card's id always leaves every group's list and the popup says which; the extras
// (its logbook, its scratchpad) are boxes, each unticked; deleting a group adds "Its member cards", listing what it
// would delete and naming the members another group holds, which it skips. delete-ui.js draws the
// plan and sends the request; the server's delete-store.js does the deleting.
//
// An extra is one entry in DELETE_EXTRAS: { key, count(ctx, kind, targets), label(kind, n, many) }.
// `key` is the option the request carries (and delete-store's SWEEPS key); `count` is how much the
// extra would delete, and 0 leaves the box out; `ctx` is what the caller passed to deletePlan, so an
// extra reads whatever it needs from there. A new kind of file kept per card joins the popup by
// pushing one entry here.
//
// Pure: same dual-environment export pattern as view-panel.js — loaded as a plain <script>
// in the browser (one global per function) AND required by node --test.

const DELETE_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const deletePlural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const DELETE_EXTRAS = [
  {
    key: 'logbook',
    count: (ctx, kind, targets) => {
      if (!ctx.logbookOn) return 0;
      const keys = new Set(targets.map((t) => DELETE_IDS.idKey(t)));
      return (ctx.notes || []).filter((n) => keys.has(n.target)).length;
    },
    label: (kind, n, many) => `${many ? 'Their logbooks' : 'Its logbook'} (${deletePlural(n, 'note')})`,
  },
  {
    key: 'scratchpad',
    count: (ctx, kind, targets) => {
      if (!ctx.scratchpadOn) return 0;
      const have = new Set((ctx.scratchpads || []).map((t) => DELETE_IDS.idKey(t)));
      return targets.filter((t) => have.has(t)).length;
    },
    label: (kind, n, many) => (many ? `Their scratchpads (${n})` : 'Its scratchpad'),
  },
];

function deleteCardLabel(cards, id) {
  const card = cards.find((c) => c.id === id);
  return card ? `#${id} ${card.title}` : `#${id}`;
}

function deleteGroupLabel(group) {
  return group.name ? `#${group.id} ${group.name}` : `#${group.id}`;
}

// The popup for a delete. `kind` is 'card' (one or more) or 'group' (one); `targets` their ids;
// the rest is the board as the page holds it: { cards, groups, notes, logbookOn, scratchpadOn, scratchpads }. Returns
// { title, chips?, lines, options: [{ key, label }], members, hint }.
function deletePlan(ctx) {
  const { kind, cards = [], groups = [] } = ctx;
  const targets = ctx.targets.map((t) => DELETE_IDS.idKey(t)).filter((t) => t !== null);
  const many = kind === 'card' && targets.length > 1;
  const plan = { title: '', lines: [], options: [], members: null, hint: 'Unticked, they stay on disk.' };
  if (kind === 'group') {
    const group = groups.find((g) => g.id === targets[0]);
    plan.title = `Delete group ${deleteGroupLabel(group)}?`;
    plan.lines.push(`Deletes ${group.file}. Its cards stay unless you tick them below.`);
  } else {
    plan.title = many ? `Delete ${targets.length} cards?` : `Delete ${deleteCardLabel(cards, targets[0])}?`;
    if (many) plan.chips = targets.map((t) => deleteCardLabel(cards, t));
    else plan.lines.push(`Deletes ${deleteCardLabel(cards, targets[0])}.`);
    const holders = groups.filter((g) => targets.some((t) => g.cards.includes(t)));
    plan.lines.push(holders.length
      ? `${many ? 'They come' : 'It comes'} out of every group's list: ${holders.map(deleteGroupLabel).join(', ')}.`
      : `No group lists ${many ? 'them' : 'it'}.`);
  }
  for (const extra of DELETE_EXTRAS) {
    const n = extra.count(ctx, kind, targets);
    if (n > 0) plan.options.push({ key: extra.key, label: extra.label(kind, n, many) });
  }
  if (kind === 'group') {
    const group = groups.find((g) => g.id === targets[0]);
    const rows = [];
    for (const member of group.cards) {
      if (!cards.some((c) => c.id === member)) continue;
      const others = groups.filter((g) => g.id !== group.id && g.cards.includes(member));
      rows.push(others.length
        ? { id: member, skip: true, text: `Skips ${deleteCardLabel(cards, member)}: also in ${others.map(deleteGroupLabel).join(', ')}` }
        : { id: member, skip: false, text: `Deletes ${deleteCardLabel(cards, member)}` });
    }
    if (rows.length) {
      // Their files too, counted over the members it would delete (the ones another group holds are skipped).
      const going = rows.filter((r) => !r.skip).map((r) => r.id);
      const extras = [];
      for (const extra of DELETE_EXTRAS) {
        const n = going.length ? extra.count(ctx, 'card', going) : 0;
        if (n > 0) extras.push({ key: `member${extra.key[0].toUpperCase()}${extra.key.slice(1)}`, label: extra.label('card', n, true) });
      }
      plan.members = { key: 'members', label: `Its member cards (${rows.length})`, rows, extras };
    }
  }
  return plan;
}

// What the request sends: only the boxes that are ticked.
function deleteBody(ticked) {
  const body = {};
  for (const [key, on] of Object.entries(ticked)) if (on === true) body[key] = true;
  return body;
}

// What the toast says once a delete is done. `results` are the server's answers, one per target
// that went; `failed` the ones that did not, as `#7 (reason)`.
function deleteSummary(kind, targets, results, failed) {
  if (kind === 'group') {
    const r = { deleted: [], kept: [], swept: {}, ...results[0] };
    const parts = [`Deleted group #${targets[0]}`];
    if (r.deleted.length) parts.push(`deleted ${deletePlural(r.deleted.length, 'member card')} (${r.deleted.map((x) => `#${x}`).join(', ')})`);
    if (r.kept.length) parts.push(`kept ${r.kept.map((k) => `#${k.id} (also in ${k.groups.map((g) => `#${g}`).join(', ')})`).join(', ')}`);
    if (r.swept.logbook) parts.push(`deleted its ${deletePlural(r.swept.logbook, 'logbook file')}`);
    if (r.swept.scratchpad) parts.push('deleted its scratchpad');
    const theirs = r.membersSwept || {};
    if (theirs.logbook) parts.push(`deleted their ${deletePlural(theirs.logbook, 'logbook file')}`);
    if (theirs.scratchpad) parts.push(`deleted their ${deletePlural(theirs.scratchpad, 'scratchpad')}`);
    return `${parts.join('; ')}.`;
  }
  const left = [...new Set(results.flatMap((r) => r.groups || []))];
  const files = results.reduce((n, r) => n + ((r.swept && r.swept.logbook) || 0), 0);
  const pads = results.reduce((n, r) => n + ((r.swept && r.swept.scratchpad) || 0), 0);
  const parts = [results.length === 1 && targets.length === 1 ? `Deleted #${targets[0]}` : `Deleted ${deletePlural(results.length, 'card')}`];
  if (left.length) parts.push(`out of ${left.map((g) => `#${g}`).join(', ')}`);
  if (files) parts.push(`deleted ${deletePlural(files, 'logbook file')}`);
  if (pads) parts.push(`deleted ${deletePlural(pads, 'scratchpad')}`);
  const text = parts.join('; ');
  return failed.length ? `${text}; failed: ${failed.join(', ')}` : `${text}.`;
}

const DELETE_EXPORTS = { deletePlan, deleteBody, deleteSummary, DELETE_EXTRAS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DELETE_EXPORTS;
} else {
  Object.assign(window, DELETE_EXPORTS);
}
