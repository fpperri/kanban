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
// every id between anchor and target in the active view's rendered order.
// Additive on purpose — the grammar is "shift to ADD a range", so a
// previous range never gets un-selected by the next one, and a stale/missing
// anchor degrades to adding just the target (never a toggle — shift must not
// deselect). A target that isn't rendered returns the input set unchanged
// (same reference — no re-render needed, mirroring contextSelection's
// no-change contract).
function rangeSelection(set, orderedIds, anchorId, targetId) {
  const t = orderedIds.indexOf(targetId);
  if (t === -1) return set;
  const a = orderedIds.indexOf(anchorId);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toggleSelection, pruneSelection, contextSelection, partitionByMovable, dragPlan, archiveNeedsConfirm, rangeSelection, isHoverHighlighted };
} else {
  window.toggleSelection = toggleSelection;
  window.pruneSelection = pruneSelection;
  window.contextSelection = contextSelection;
  window.partitionByMovable = partitionByMovable;
  window.dragPlan = dragPlan;
  window.archiveNeedsConfirm = archiveNeedsConfirm;
  window.rangeSelection = rangeSelection;
  window.isHoverHighlighted = isHoverHighlighted;
}
