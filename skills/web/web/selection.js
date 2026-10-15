'use strict';
// Pure multi-select logic. Selection is a Set of card ids — never
// DOM state — so it survives renderBoard() rebuilds including auto-refresh
// polls. Dual-environment module, same pattern as refresh-policy.js.

function toggleSelection(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

// Shift+click adds a RANGE: union of the current selection with
// every id between the range start and target in the active view's rendered order.
// Additive on purpose — the grammar is "shift to ADD a range", so a
// previous range never gets un-selected by the next one, and a stale/missing
// range start degrades to adding just the target (never a toggle — shift must not
// deselect). A target that isn't rendered returns the input set unchanged
// (same reference — no re-render needed, mirroring contextSelection's
// no-change contract).
function rangeSelection(set, orderedIds, startId, targetId) {
  const t = orderedIds.indexOf(targetId);
  if (t === -1) return set;
  const a = orderedIds.indexOf(startId);
  if (a === -1) { const next = new Set(set); next.add(targetId); return next; }
  const next = new Set(set);
  const [lo, hi] = a < t ? [a, t] : [t, a];
  for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
  return next;
}

// Cards can vanish between polls (deleted/archived by another actor); the
// selection must not keep ghost ids.
function pruneSelection(set, liveIds) {
  const live = new Set(liveIds);
  return new Set([...set].filter((id) => live.has(id)));
}

// Hover/focus highlight (kanban.proj#261): unlike selection, only ever ONE
// card is hovered or focused at a time, so the membership test every
// render call site needs is a plain equality check — pulled out so it has
// one tested place to live rather than a raw `===` repeated at each of the
// six card-representing surfaces.
function isHoverHighlighted(hoveredId, cardId) {
  return hoveredId != null && hoveredId === cardId;
}

// Right-click semantics: the gesture's target REPLACES the
// selection when it wasn't selected; an already-selected target keeps the
// whole batch as the menu's subject. Returns the input set unchanged (same
// reference) in the no-change case so callers can skip a re-render.
function contextSelection(set, id) {
  return set.has(id) ? set : new Set([id]);
}

// Bulk-move rule: the doing entry gate stays PER CARD, and only
// gates entering 'doing'. `refusesDoingFn` is the caller's combined predicate
// (waiting OR blocked) — this module stays mechanism, the
// vocabulary lives in waiting-blocked.js. Returns { movable, refused,
// unchanged } card lists; ids with no matching card (deleted mid-selection)
// are dropped silently.
function partitionByMovable(ids, byId, targetStatus, refusesDoingFn) {
  const movable = [], refused = [], unchanged = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (!card) continue;
    if (card.status === targetStatus) { unchanged.push(card); continue; }
    if (targetStatus === 'doing' && refusesDoingFn(card)) { refused.push(card); continue; }
    movable.push(card);
  }
  return { movable, refused, unchanged };
}

// Archiving a fully-done batch is the natural completion flow, not
// a destructive act, so the confirm is skipped — but only when EVERY card
// in the batch is done; one non-done card keeps today's single confirm.
// Shared by the tile Archive button, drag-to-Archive (via dragPlan below),
// and the bulk menu's Archive selected — one rule, three callers.
function archiveNeedsConfirm(cards) {
  return cards.some((c) => c.status !== 'done');
}

// One plan for any drag batch (archive column parity). Cards carry
// `archived`; dest is 'archive' or a live column. The doing entry gate
// (waiting OR blocked via `refusesDoingFn`) stays per card and
// only guards entering 'doing' — applied to archived cards too, since a
// drop names their destination status. Speedbump matrix: a batch
// -> archive confirms unless every card in it is already done; a
// batch containing archived cards -> live column confirms naming the
// restore count; pure live -> live stays confirm-free.
function dragPlan(ids, byId, dest, refusesDoingFn) {
  const toArchive = [], toRestore = [], toMove = [], refused = [], unchanged = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (!card) continue;
    if (dest === 'archive') {
      if (card.archived) unchanged.push(card);
      else toArchive.push(card);
      continue;
    }
    if (dest === 'doing' && refusesDoingFn(card)) { refused.push(card); continue; }
    if (card.archived) toRestore.push(card);
    else if (card.status === dest) unchanged.push(card);
    else toMove.push(card);
  }
  let confirmMessage = null;
  if (dest === 'archive' && toArchive.length && archiveNeedsConfirm(toArchive)) {
    confirmMessage = `Archive ${toArchive.length} card(s)? (moves their files to archived/)`;
  } else if (toRestore.length) {
    const n = toRestore.length + toMove.length;
    confirmMessage = `Move ${n} card(s) to ${dest} — ${toRestore.length} of them ${toRestore.length === 1 ? 'is' : 'are'} archived and will be restored. Proceed?`;
  }
  return { toArchive, toRestore, toMove, refused, unchanged, confirmMessage };
}

// What a plain click on a card does, per view: it opens the card, except in
// the Graph, where a bare click selects (dragging a card makes a click a
// selection gesture there). The preferences sheet sets the other views one by
// one; `choices` is its click map ({ board: 'opens' | 'selects', ... }). A view
// the map leaves out, or fills with anything but 'selects', opens. The Graph
// selects whatever the map says.
const PLAIN_CLICK_SELECTS = { graph: true };

function plainClickBehaviour(view, choices) {
  if (Object.prototype.hasOwnProperty.call(PLAIN_CLICK_SELECTS, view)) return 'selects';
  const own = choices && Object.prototype.hasOwnProperty.call(choices, view);
  return own && choices[view] === 'selects' ? 'selects' : 'opens';
}

// What a click on a card does, as one pure decision — the page's click
// handler only carries it out. A cue (the assignee, a tag, a blocked or review
// pill) is a search shortcut whatever the modifiers; Shift adds a range from
// the range start; Ctrl or Cmd toggles one card; a plain click does what the
// view's plainClick says ('opens' or 'selects', from plainClickBehaviour).
// Returns 'cue' | 'range' | 'toggle' | 'select' | 'open'.
function cardClickAction({ cue, shiftKey, ctrlKey, metaKey, plainClick }) {
  if (cue) return 'cue';
  if (shiftKey) return 'range';
  if (ctrlKey || metaKey) return 'toggle';
  return plainClick === 'selects' ? 'select' : 'open';
}

// A double click, or Enter on a focused card, opens it where a plain click only
// selects it. Where a plain click already opens the card, there is nothing to
// add; a held Shift, Ctrl or Cmd belongs to building a selection. Returns
// 'open' | 'none'.
function cardOpenAction({ shiftKey, ctrlKey, metaKey, plainClick }) {
  if (shiftKey || ctrlKey || metaKey) return 'none';
  return plainClick === 'selects' ? 'open' : 'none';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toggleSelection, pruneSelection, contextSelection, partitionByMovable, dragPlan, archiveNeedsConfirm, rangeSelection, isHoverHighlighted, plainClickBehaviour, cardClickAction, cardOpenAction };
} else {
  window.toggleSelection = toggleSelection;
  window.pruneSelection = pruneSelection;
  window.contextSelection = contextSelection;
  window.partitionByMovable = partitionByMovable;
  window.dragPlan = dragPlan;
  window.archiveNeedsConfirm = archiveNeedsConfirm;
  window.rangeSelection = rangeSelection;
  window.isHoverHighlighted = isHoverHighlighted;
  window.plainClickBehaviour = plainClickBehaviour;
  window.cardClickAction = cardClickAction;
  window.cardOpenAction = cardOpenAction;
}
