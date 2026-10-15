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
// selection gesture there). Anything the table does not name opens.
const PLAIN_CLICK_SELECTS = { graph: true };

function plainClickBehaviour(view) {
  return Object.prototype.hasOwnProperty.call(PLAIN_CLICK_SELECTS, view) ? 'selects' : 'opens';
}

// Whether Shift+click adds a range of cards between the range start and the
// target. The Graph's layout has no reading order to range over, so there Shift
// adds one card, like Ctrl. A view the table does not name ranges.
const SHIFT_ADDS_ONE = { graph: true };

function shiftAddsRange(view) {
  return !Object.prototype.hasOwnProperty.call(SHIFT_ADDS_ONE, view);
}

// What a click on a card does, as one pure decision — the page's click
// handler only carries it out. A cue (the assignee, a tag, a blocked or review
// pill) is a search shortcut whatever the modifiers; Shift adds a range from
// the range start; Ctrl or Cmd toggles one card; a plain click does what the
// view's plainClick says ('opens' or 'selects', from plainClickBehaviour).
// `ranges` says whether Shift adds a range (shiftAddsRange(view)); where it does
// not, Shift toggles one card as Ctrl does. Returns
// 'cue' | 'range' | 'toggle' | 'select' | 'open'.
function cardClickAction({ cue, shiftKey, ctrlKey, metaKey, plainClick, ranges = true }) {
  if (cue) return 'cue';
  if (shiftKey) return ranges ? 'range' : 'toggle';
  if (ctrlKey || metaKey) return 'toggle';
  return plainClick === 'selects' ? 'select' : 'open';
}

// --- The selection: an anchor plus an ordered list of additions ---------------
// A selection grows from an anchor (one card, or one query) by additions (cards,
// paths, trees, queries), in the order they were added. It is a value: every
// operation returns a new selection and none changes the one it is given. A part
// is { kind: 'card' | 'path' | 'tree', id } or { kind: 'query', text }. The ids
// the views paint and the bulk edits read are worked out from the parts by
// resolveSelection; the parts persist, the resolved set is worked out again.

const NO_SELECTION = Object.freeze({ anchor: null, additions: Object.freeze([]) });

function cardPart(id) { return { kind: 'card', id: Number(id) }; }
function pathPart(id) { return { kind: 'path', id: Number(id) }; }
function treePart(id) { return { kind: 'tree', id: Number(id) }; }
function queryPart(text) { return { kind: 'query', text: String(text) }; }

function samePart(a, b) {
  return a.kind === b.kind && (a.kind === 'query' ? a.text === b.text : a.id === b.id);
}

// A new selection from this part alone: the additions are dropped.
function setAnchor(selection, part) {
  return { anchor: part, additions: [] };
}

// The part joins at the end. The first part of an empty selection is its
// anchor; a part the selection already holds changes nothing (same reference).
function addPart(selection, part) {
  if (!selection.anchor) return { anchor: part, additions: [] };
  if (samePart(selection.anchor, part) || selection.additions.some((p) => samePart(p, part))) return selection;
  return { anchor: selection.anchor, additions: selection.additions.concat([part]) };
}

// Every card a part reaches on the whole board, in the order the matcher gives
// them. A card part is its card. A path part, a tree part and a query part ask
// the caller's matcher (matchQuery(text) -> the ids the search module matches for
// that text) with the text of their search term, so a part and its term cannot
// disagree. A query with no text matches nothing, never everything.
function partCards(part, matchQuery) {
  if (part.kind === 'card') return [part.id];
  const text = part.kind === 'query' ? part.text : `${part.kind}:${part.id}`;
  if (!text.trim()) return [];
  return [...matchQuery(text)];
}

function partsOf(selection) {
  return selection.anchor ? [selection.anchor].concat(selection.additions) : [];
}

// The id set the views paint and the bulk edits read: the union of each part's
// cards, limited to the cards the view shows (a card a status pill, the Archive
// pill or the search box hides never joins), in the order the parts were added.
// Worked out again on every render, so the parts persist and the set follows what
// the view shows. `shown` is a Set of ids, a function returning one (asked once,
// and only when there is a part to resolve), or null for no limit. A card that is
// gone, or a query that matches nothing, adds nothing.
function resolveSelection(selection, matchQuery, shown) {
  const resolved = new Set();
  const parts = partsOf(selection);
  if (!parts.length) return resolved;
  const visible = typeof shown === 'function' ? shown() : shown;
  for (const part of parts) {
    for (const id of partCards(part, matchQuery)) {
      if (!visible || visible.has(id)) resolved.add(id);
    }
  }
  return resolved;
}

// Esc's step in the selection: the additions go, all at once; with none left,
// the anchor goes. Nothing picked, nothing to step back from (same reference).
function stepBack(selection) {
  if (selection.additions.length) return { anchor: selection.anchor, additions: [] };
  return selection.anchor ? NO_SELECTION : selection;
}

// The parts a poll leaves standing: a card, path or tree part whose card is no
// longer on the board goes, and a query stays (it may match again). The first
// part left becomes the anchor if the anchor went.
function pruneSelectionParts(selection, liveIds) {
  const live = new Set(liveIds);
  const parts = partsOf(selection);
  const kept = parts.filter((part) => part.kind === 'query' || live.has(part.id));
  return kept.length === parts.length ? selection : kept.reduce((next, part) => addPart(next, part), NO_SELECTION);
}

// Takes one card out of the selection, wherever it comes from. A card part that
// is that card is removed. A path, tree or query part that reaches it turns into
// its other cards on the whole board, so the cards the view hides stay picked.
// A part that does not reach it is left as it is. When the anchor goes, the part
// that follows it becomes the anchor, and the selection keeps its order.
function removeCard(selection, id, matchQuery) {
  let touched = false;
  const kept = [];
  for (const part of partsOf(selection)) {
    if (part.kind === 'card') {
      if (part.id === Number(id)) touched = true; else kept.push(part);
      continue;
    }
    const cards = partCards(part, matchQuery);
    if (!cards.includes(Number(id))) { kept.push(part); continue; }
    touched = true;
    for (const card of cards) if (card !== Number(id)) kept.push(cardPart(card));
  }
  return touched ? kept.reduce((next, part) => addPart(next, part), NO_SELECTION) : selection;
}

// What a click on a card does to the selection, given the gesture cardClickAction
// named: the selection and the range start after it. `resolved` is the id set the
// selection stands for now, `order` the active view's rendered order (only a range
// reads it) and `matchQuery` the search module's matcher. A select makes the card
// a new anchor and drops the additions; a toggle takes a selected card out and
// adds an unselected one; a range adds the cards between the range start and the
// card that are not selected yet, each as an addition; a click that opens the card
// empties the selection. The first card picked becomes the anchor, because adding
// to an empty selection does that. A cue is the caller's search shortcut.
function selectionAfterClick(action, id, { selection, resolved, rangeStart, order, matchQuery }) {
  if (action === 'select') return { selection: setAnchor(selection, cardPart(id)), rangeStart: id };
  if (action === 'toggle') {
    const next = resolved.has(id) ? removeCard(selection, id, matchQuery) : addPart(selection, cardPart(id));
    return { selection: next, rangeStart: id };
  }
  if (action === 'range') {
    const start = order.includes(rangeStart) ? rangeStart : id;
    const added = [...rangeSelection(resolved, order, start, id)].filter((card) => !resolved.has(card));
    return { selection: added.reduce((next, card) => addPart(next, cardPart(card)), selection), rangeStart: start };
  }
  if (action === 'open') return { selection: NO_SELECTION, rangeStart: null };
  return { selection, rangeStart };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NO_SELECTION, cardPart, pathPart, treePart, queryPart, setAnchor, addPart, partCards, resolveSelection, removeCard, stepBack, pruneSelectionParts, toggleSelection, pruneSelection, contextSelection, partitionByMovable, dragPlan, archiveNeedsConfirm, rangeSelection, isHoverHighlighted, plainClickBehaviour, cardClickAction, shiftAddsRange, selectionAfterClick };
} else {
  window.NO_SELECTION = NO_SELECTION;
  window.cardPart = cardPart;
  window.pathPart = pathPart;
  window.treePart = treePart;
  window.queryPart = queryPart;
  window.setAnchor = setAnchor;
  window.addPart = addPart;
  window.partCards = partCards;
  window.resolveSelection = resolveSelection;
  window.removeCard = removeCard;
  window.stepBack = stepBack;
  window.pruneSelectionParts = pruneSelectionParts;
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
  window.shiftAddsRange = shiftAddsRange;
  window.selectionAfterClick = selectionAfterClick;
}
