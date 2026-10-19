'use strict';
// Pure multi-select logic. The selection is an anchor plus an ordered list of
// additions (see "The selection" below), never DOM state, so it survives
// renderBoard() rebuilds including auto-refresh polls; the set of card ids the
// views paint is worked out from those parts. Dual-environment module, same
// pattern as refresh-policy.js.

// Shift+click adds a RANGE: union of the current selection with
// every id between the range start and target in the active view's rendered order.
// Additive on purpose — the grammar is "shift to ADD a range", so a
// previous range never gets un-selected by the next one, and a stale/missing
// range start degrades to adding just the target (never a toggle — shift must not
// deselect). A target that isn't rendered returns the input set unchanged
// (same reference).
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

// Hover/focus highlight (kanban.proj#261): unlike selection, only ever ONE
// card is hovered or focused at a time, so the membership test every
// render call site needs is a plain equality check — pulled out so it has
// one tested place to live rather than a raw `===` repeated at each of the
// six card-representing surfaces.
function isHoverHighlighted(hoveredId, cardId) {
  return hoveredId != null && hoveredId === cardId;
}

// The card menu a right-click on card `id` opens, as one decision the page only
// carries out. Outside the selection the menu is for that card alone and the
// selection stays as it was (the menu leads with Peek and Add to selection);
// inside it the menu is for the whole resolved selection, a path's, a tree's or
// a pill's cards included, in the order they were picked. `resolved` is the id
// set the selection stands for now and is never written to. The card details'
// own menu (`fromDetail`) has no Peek, the card is already open. Path and Tree
// are offered only when the subject is one card. Isolate is offered inside the
// selection only, since it shows the selection and a card outside it is not part of
// it, and never in the card details' own menu. Returns
// { ids, inSelection, peek, add, dependency, isolate }.
function cardMenuFor(resolved, id, { fromDetail = false } = {}) {
  const inSelection = resolved.has(id);
  const ids = inSelection ? [...resolved] : [id];
  return { ids, inSelection, peek: !inSelection && !fromDetail, add: !inSelection, dependency: ids.length === 1, isolate: inSelection && !fromDetail };
}

// The menu a right-click on the empty Graph or Map canvas opens: Isolate alone. It has no
// card, so no bulk entry, Peek, Add, Path or Tree; `canvas` tells the page to show nothing
// else. Isolate acts on the selection as it is, whatever it holds (nothing selected says
// so, as the switch does).
function canvasMenuFor() {
  return { ids: [], inSelection: false, peek: false, add: false, dependency: false, isolate: true, canvas: true };
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
function plainClickBehaviour(view, choices) {
  if (view === 'graph') return 'selects';
  const own = choices && Object.prototype.hasOwnProperty.call(choices, view);
  return own && choices[view] === 'selects' ? 'selects' : 'opens';
}

// Whether Shift+click adds a range of cards between the range start and the
// target. The Graph's layout has no reading order to range over, so there Shift
// adds one card, like Ctrl. Every other view ranges.
function shiftAddsRange(view) {
  return view !== 'graph';
}

// What a click on a card does, as one pure decision — the page's click
// handler only carries it out. A cue (the assignee, a tag, a blocked or review
// pill) is a search shortcut whatever the modifiers; Shift adds a range from
// the range start; Ctrl or Cmd toggles one card; a plain click does what the
// view's plainClick says ('opens' or 'selects', from plainClickBehaviour).
// `ranges` says whether Shift adds a range (shiftAddsRange(view)); where it does
// not, Shift toggles one card as Ctrl does.
//
// A double click is its second click, so a view whose plain click selects opens
// the card there: `detail` is the click count the browser puts on the click (2
// for the second of a double click), and that click is a peek — the first click
// already made the card the anchor, and the selection stays as it made it. The
// page cannot wait for a double click event: the first click's repaint replaces
// the card, and that event is aimed at the card that was replaced, so it never
// reaches the document. Returns
// 'cue' | 'range' | 'toggle' | 'select' | 'peek' | 'open'.
function cardClickAction({ cue, shiftKey, ctrlKey, metaKey, plainClick, ranges = true, detail = 1 }) {
  if (cue) return 'cue';
  if (shiftKey) return ranges ? 'range' : 'toggle';
  if (ctrlKey || metaKey) return 'toggle';
  if (plainClick !== 'selects') return 'open';
  return detail === 2 ? 'peek' : 'select';
}

// Enter on a focused card opens it where a plain click only selects it. Where a
// plain click already opens the card, there is nothing to add, and a held Shift,
// Ctrl or Cmd belongs to building a selection. Returns 'open' | 'none'.
function cardOpenAction({ shiftKey, ctrlKey, metaKey, plainClick }) {
  if (shiftKey || ctrlKey || metaKey) return 'none';
  return plainClick === 'selects' ? 'open' : 'none';
}

// --- The selection: an anchor plus an ordered list of additions ---------------
// A selection grows from an anchor (one card, or one query) by additions (cards,
// paths, trees, queries), in the order they were added. It is a value: every
// operation returns a new selection and none changes the one it is given. A part
// is { kind: 'card' | 'path' | 'tree', id } or { kind: 'query', text }. The ids
// the views paint and the bulk edits read are worked out from the parts by
// resolveSelection; the parts persist, the resolved set is worked out again.

const NO_SELECTION = Object.freeze({ anchor: null, additions: Object.freeze([]) });

const SEL_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

// A part holds its card's whole id as a string, so `#7` and `#G7` are two cards.
function partId(id) { const key = SEL_IDS.idKey(id); return key === null ? String(id) : key; }
function cardPart(id) { return { kind: 'card', id: partId(id) }; }
function pathPart(id) { return { kind: 'path', id: partId(id) }; }
function treePart(id) { return { kind: 'tree', id: partId(id) }; }
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

// A selection built from parts in order: the first is the anchor, the rest are additions
// (a part the list holds twice counts once).
function selectionFromParts(parts) {
  return parts.reduce((next, part) => addPart(next, part), NO_SELECTION);
}

// The range start a selection implies when its anchor changed: the anchor card, or none, so
// a Shift range cannot begin at a card that is no longer picked.
function rangeStartOf(selection) {
  return selection.anchor && selection.anchor.kind === 'card' ? selection.anchor.id : null;
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

// What Esc does to the selection state ({ selection, rangeStart, isolate }): three
// stages. With isolate on, the first Esc turns it off and leaves the selection and
// the range start exactly as they were (isolate is { previous }, the text the box
// held before; the caller gives the box that text back). Then one stepBack, with the
// range start kept honest. After the additions go the range start is the
// anchor card, as if it had just been clicked, so a Shift range cannot begin at a
// card that is no longer picked; with no anchor card it is dropped, so a dead
// selection leaves no invisible range start behind. Nothing picked and no isolate:
// the same state comes back, and the caller skips the repaint.
function selectionAfterEscape(current) {
  if (current.isolate) return { selection: current.selection, rangeStart: current.rangeStart, isolate: null };
  const next = stepBack(current.selection);
  if (next === current.selection) return current;
  return { selection: next, rangeStart: rangeStartOf(next) };
}

// The parts a poll leaves standing: a card, path or tree part whose card is no
// longer on the board goes, and a query stays (it may match again). The first
// part left becomes the anchor if the anchor went.
function pruneSelectionParts(selection, liveIds) {
  const live = new Set(liveIds);
  const parts = partsOf(selection);
  const kept = parts.filter((part) => part.kind === 'query' || live.has(part.id));
  return kept.length === parts.length ? selection : selectionFromParts(kept);
}

// Takes one card out of the selection, wherever it comes from. A card part that
// is that card is removed. A path, tree or query part that reaches it turns into
// its other cards on the whole board, so the cards the view hides stay picked.
// A part that does not reach it is left as it is. When the anchor goes, the part
// that follows it becomes the anchor, and the selection keeps its order.
function selectionWithoutCard(selection, id, matchQuery) {
  let touched = false;
  const kept = [];
  for (const part of partsOf(selection)) {
    if (part.kind === 'card') {
      if (part.id === partId(id)) touched = true; else kept.push(part);
      continue;
    }
    const cards = partCards(part, matchQuery);
    if (!cards.includes(partId(id))) { kept.push(part); continue; }
    touched = true;
    for (const card of cards) if (card !== partId(id)) kept.push(cardPart(card));
  }
  return touched ? selectionFromParts(kept) : selection;
}

// What a click on a card does to the selection, given the gesture cardClickAction
// named: the selection and the range start after it. `resolved` is the id set the
// selection stands for now, `order` the active view's rendered order (only a range
// reads it) and `matchQuery` the search module's matcher. A select makes the card
// a new anchor and drops the additions; a toggle takes a selected card out and
// adds an unselected one; a range adds the cards between the range start and the
// card that are not selected yet, each as an addition; a click that opens the card
// empties the selection but for its pills, because opening a card changes no filter: a
// pill that is on stays on, in its order (the first is the anchor), and every other part
// goes. The first card picked becomes the anchor, because adding to an empty selection
// does that. A cue is the caller's search shortcut.
function selectionAfterClick(action, id, { selection, resolved, rangeStart, order, matchQuery }) {
  if (action === 'select') return { selection: setAnchor(selection, cardPart(id)), rangeStart: id };
  if (action === 'toggle') {
    const next = resolved.has(id) ? selectionWithoutCard(selection, id, matchQuery) : addPart(selection, cardPart(id));
    return { selection: next, rangeStart: id };
  }
  if (action === 'range') {
    const start = order.includes(rangeStart) ? rangeStart : id;
    const added = [...rangeSelection(resolved, order, start, id)].filter((card) => !resolved.has(card));
    return { selection: added.reduce((next, card) => addPart(next, cardPart(card)), selection), rangeStart: start };
  }
  if (action === 'open') {
    const parts = partsOf(selection);
    const pills = parts.filter(isAnyPillPart);
    const next = pills.length === parts.length ? selection : selectionFromParts(pills);
    return { selection: next, rangeStart: rangeStartOf(next) };
  }
  return { selection, rangeStart };
}

// --- A search typed in the Graph is the anchor ----------------------------------
// The Graph lights a selection and dims the rest, so a search typed there does not
// hide cards: its text becomes the anchor, and its matches are the lit cards. An
// anchor keeps where it came from, because the one typed in the Graph is the one
// anchor that stops being one when the Graph is left: the box goes on
// filtering the other views, and nothing is selected by it there. A pill's query
// (queryPart) keeps being the anchor in every view.

function typedQueryPart(text) { return { kind: 'query', text: String(text), source: 'typing' }; }

function isTypedAnchor(selection) {
  const anchor = selection.anchor;
  return !!anchor && anchor.kind === 'query' && anchor.source === 'typing';
}

// What a write to the box leaves of the selection while the Graph is shown. Text
// makes the box the anchor: a new one, with the selection it replaced gone, as a
// click on a card does the other way round; when the box was the anchor
// already, only its text changes and the additions stay. An empty box takes the
// anchor and the additions with it, since the model has no anchor-less state; a
// selection that is not the box's stays.
function selectionAfterTyping(selection, text) {
  if (!String(text).trim()) return isTypedAnchor(selection) ? NO_SELECTION : selection;
  if (!isTypedAnchor(selection)) return setAnchor(selection, typedQueryPart(text));
  if (selection.anchor.text === text) return selection;
  return { anchor: typedQueryPart(text), additions: selection.additions };
}

// What a view switch leaves of the selection. Leaving the Graph drops a typed
// anchor, and the first addition becomes the anchor, as when any anchor goes.
// Entering it makes the box the anchor again, but only when nothing is selected:
// a selection carried in from another view stays, and the box has no effect in
// the Graph until it is edited.
function selectionOnViewSwitch(selection, { from, to, boxText }) {
  if (from === 'graph' && to !== 'graph') {
    return isTypedAnchor(selection) ? selectionFromParts(selection.additions) : selection;
  }
  if (to === 'graph' && from !== 'graph' && !selection.anchor && String(boxText).trim()) {
    return setAnchor(selection, typedQueryPart(boxText));
  }
  return selection;
}

// --- A click on a pill ----------------------------------------------------------
// A pill is a search query offered as one click, and it follows the status pills'
// rules, with every pill off as the default. Its part in the selection is a query
// part with no source (a typed query has one). The page carries out what this
// function decides: the selection and the text of the box change together, worked
// out here from the search module's alternatives (`alts`: has, add and remove one
// alternative of a box's text), so what the box shows and what is selected cannot
// disagree.

function pillQueryText(query) { return String(query).trim().replace(/\s+/g, ' '); }

function isPillPart(part, query) {
  return part.kind === 'query' && !part.source && pillQueryText(part.text) === pillQueryText(query);
}

// A part that is some pill's query: a query with no source.
function isAnyPillPart(part) { return part.kind === 'query' && !part.source; }

// The pill with this text turned off: its part leaves the selection (when it was
// the anchor the next part is, as when any anchor goes) and its query leaves the
// box as the one alternative it is, whatever else the box holds.
function selectionWithoutPill(selection, boxText, text, alts) {
  const kept = selectionFromParts(partsOf(selection).filter((part) => !isPillPart(part, text)));
  const anchorWent = kept.anchor !== selection.anchor;
  return { selection: kept, boxText: alts.remove(boxText, text), rangeStart: anchorWent ? rangeStartOf(kept) : undefined };
}

// What a click on a pill does. A click ('toggle', with or without Shift) turns that
// one pill on or off and leaves the others as they were. On, its query joins the
// selection (the first pill on is the anchor, later ones are additions) and the box
// as one more alternative, `box | pill`, so the pill's cards are not hidden by what
// the box held; with a hand-picked anchor and an empty box the box stays empty, as
// an empty box hides nothing. Off, its part leaves the selection and its query
// leaves the box. A right-click ('solo') makes the pill the only one on: it becomes
// the anchor of a selection of its own and the box holds its query alone, whatever
// was selected and whatever the box held. On the pill that is already the only one
// on it turns every pill off instead, which is turning that pill off: cards the
// selection holds and text the pills did not put in the box stay. Returns
// { selection, boxText, rangeStart }; a rangeStart of undefined leaves the range
// start as it was, and a query anchor leaves none (null).
function selectionAfterPill(gesture, query, { selection, boxText, alts }) {
  const text = pillQueryText(query);
  const parts = partsOf(selection);
  const on = parts.some((part) => isPillPart(part, text));
  if (gesture === 'solo') {
    const alone = on && parts.every((part) => !isAnyPillPart(part) || isPillPart(part, text));
    return alone ? selectionWithoutPill(selection, boxText, text, alts) : { selection: setAnchor(selection, queryPart(text)), boxText: text, rangeStart: null };
  }
  if (on) return selectionWithoutPill(selection, boxText, text, alts);
  const hasText = !!String(boxText).trim();
  const joined = addPart(selection, queryPart(text));
  if (!selection.anchor) return { selection: joined, boxText: hasText ? alts.add(boxText, text) : text, rangeStart: null };
  return { selection: joined, boxText: hasText ? alts.add(boxText, text) : boxText, rangeStart: undefined };
}

// What an edit of the box by hand (typing, the clear button) leaves of the
// selection ({ selection, rangeStart }): a pill's query the box no longer holds as
// an alternative stops being the anchor or an addition, so the pill is off. A card,
// a path, a tree and a typed query stay. `holds(boxText, query)` is the search
// module's. Nothing to drop: the same state comes back, and the caller skips the
// repaint. When the anchor goes the next part is the anchor, and the range start
// follows it, as when any anchor goes.
function selectionAfterBoxEdit(current, boxText, holds) {
  const parts = partsOf(current.selection);
  const kept = parts.filter((part) => !isAnyPillPart(part) || holds(boxText, part.text));
  if (kept.length === parts.length) return current;
  const selection = selectionFromParts(kept);
  if (selection.anchor === current.selection.anchor) return { selection, rangeStart: current.rangeStart };
  return { selection, rangeStart: rangeStartOf(selection) };
}

// The pill queries a step from `before` to `after` took out of the selection, in
// the order they were picked. Esc's step reads it to take them out of the box as
// well: the additions go together, then the anchor. A card, a path, a tree and a
// typed query are not pill queries.
function pillQueriesDropped(before, after) {
  const kept = partsOf(after);
  return partsOf(before)
    .filter((part) => isAnyPillPart(part) && !kept.some((k) => samePart(k, part)))
    .map((part) => part.text);
}

// --- Isolate -------------------------------------------------------------------
// Isolate shows only the selection by writing it into the search box as a query
// (searchIsolateBox, search.js), so it is no selection state: it is a flag, { previous },
// the text the box held before, kept while it is on (null while off). A click on a
// card while it is on moves the anchor and writes nothing to the box, and it ends
// when the box is left holding no query.

// The text the box holds after a click on a card in the Graph, given the gesture
// (`action`, from cardClickAction) and whether the selection's anchor was the typed
// query before and after it. A plain click sets a new anchor and clears the box. Shift
// or Ctrl keeps the query, unless it took out a card the typed query lit: the query is
// then its other cards, and the box no longer names the anchor. What a clear leaves is
// `cut`, the run of slices the box holds (searchCutOnly, search.js; none when the page
// names none): the cut is no search, and the Graph keeps drawing what it hides. While
// isolated the box holds the isolate text, which a click never touches: it moves the
// anchor only.
function boxAfterGraphClick(action, { boxText, cut = '', typedBefore, typedAfter, isolated }) {
  if (isolated) return boxText;
  return action === 'select' || (typedBefore && !typedAfter) ? cut : boxText;
}

// The isolate state after the box was written with `reason`. Isolate is a query in the
// box, so a write that leaves the box holding none (a hand edit, the clear button, a
// pill turned off) ends it. Its own writes, turning it on and off, never do: the page
// ends it itself when it gives the box its text back.
function isolateAfterWrite(isolate, text, reason) {
  if (!isolate || reason === 'isolate') return isolate;
  return String(text == null ? '' : text).trim() ? isolate : null;
}

// What the browser keeps, per board, while isolate is on: the text the box held before isolating
// (what turning isolate off gives back) and the isolate text the box held when it was last
// written, as one JSON string. The text says which isolate the previous text belongs to.
function isolateRecord(previous, text) {
  return JSON.stringify({ previous: String(previous == null ? '' : previous), text: String(text == null ? '' : text).trim() });
}

// The text to give back when isolate comes from a link whose query is `q`: the record's previous
// text when the record is for that very query, and the empty string when it is unknown (no
// record, an unreadable one, storage that refused, or a record kept for another isolate), so
// turning isolate off leaves the box empty rather than restoring an unrelated text.
function isolatePreviousFrom(raw, q) {
  if (typeof raw !== 'string') return '';
  let record;
  try { record = JSON.parse(raw); } catch (e) { return ''; }
  if (!record || typeof record.previous !== 'string' || record.text !== String(q == null ? '' : q).trim()) return '';
  return record.previous;
}

// The card a click picked on its own, or null: a selection that is one card part,
// the anchor with no additions. Only such a card lights with its relations; a
// query or a path that matches one card lights that card alone.
function loneCard(selection) {
  const anchor = selection.anchor;
  return anchor && anchor.kind === 'card' && !selection.additions.length ? anchor.id : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NO_SELECTION, selectionAfterPill, selectionAfterBoxEdit, pillQueriesDropped, typedQueryPart, isTypedAnchor, selectionAfterTyping, selectionOnViewSwitch, loneCard, cardPart, pathPart, treePart, queryPart, setAnchor, addPart, selectionFromParts, rangeStartOf, partsOf, partCards, resolveSelection, selectionWithoutCard, stepBack, selectionAfterEscape, pruneSelectionParts, boxAfterGraphClick, isolateAfterWrite, isolateRecord, isolatePreviousFrom, cardMenuFor, canvasMenuFor, partitionByMovable, dragPlan, archiveNeedsConfirm, rangeSelection, isHoverHighlighted, plainClickBehaviour, cardClickAction, cardOpenAction, shiftAddsRange, selectionAfterClick };
} else {
  window.NO_SELECTION = NO_SELECTION;
  window.selectionAfterPill = selectionAfterPill;
  window.selectionAfterBoxEdit = selectionAfterBoxEdit;
  window.pillQueriesDropped = pillQueriesDropped;
  window.partsOf = partsOf;
  window.typedQueryPart = typedQueryPart;
  window.isTypedAnchor = isTypedAnchor;
  window.selectionAfterTyping = selectionAfterTyping;
  window.selectionOnViewSwitch = selectionOnViewSwitch;
  window.loneCard = loneCard;
  window.cardPart = cardPart;
  window.pathPart = pathPart;
  window.treePart = treePart;
  window.queryPart = queryPart;
  window.setAnchor = setAnchor;
  window.addPart = addPart;
  window.selectionFromParts = selectionFromParts;
  window.rangeStartOf = rangeStartOf;
  window.partCards = partCards;
  window.resolveSelection = resolveSelection;
  window.selectionWithoutCard = selectionWithoutCard;
  window.stepBack = stepBack;
  window.selectionAfterEscape = selectionAfterEscape;
  window.pruneSelectionParts = pruneSelectionParts;
  window.boxAfterGraphClick = boxAfterGraphClick;
  window.isolateAfterWrite = isolateAfterWrite;
  window.isolateRecord = isolateRecord;
  window.isolatePreviousFrom = isolatePreviousFrom;
  window.cardMenuFor = cardMenuFor;
  window.canvasMenuFor = canvasMenuFor;
  window.partitionByMovable = partitionByMovable;
  window.dragPlan = dragPlan;
  window.archiveNeedsConfirm = archiveNeedsConfirm;
  window.rangeSelection = rangeSelection;
  window.isHoverHighlighted = isHoverHighlighted;
  window.plainClickBehaviour = plainClickBehaviour;
  window.cardClickAction = cardClickAction;
  window.cardOpenAction = cardOpenAction;
  window.shiftAddsRange = shiftAddsRange;
  window.selectionAfterClick = selectionAfterClick;
}
