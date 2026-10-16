# 0006. One interaction grammar across all views

Date: 2026-07-09 · Status: accepted
Amended: 2026-07-13 (selection gestures), 2026-10-14 (anchor, peek, isolate), 2026-10-15 (empty space) — see Amendments below

## Context

Board, map, calendar, gantt, and later the graph each grew their own click/selection wiring.
Four grammars means four drift surfaces.

## Decision

Every card-representing element in every view carries `.card-el` +
`data-id`; ONE document-level delegated click+contextmenu pair implements
the grammar (click = detail, shift-click = toggle selection, right-click =
select + shared context menu, plain click elsewhere = clear). The board's
handlers were refactored INTO the shared path, not mirrored. Selection is a
pure id-set that survives polls and view switches; each view paints its own
selected marker.

## Consequences

New views join the grammar by stamping the class/attribute pair. Exceptions
are explicit: map ghost stubs (filter-hidden cards) are never selectable;
bulk-drag of a selection stays board-only. Gantt clicks ride the native
post-pointerup click with a one-shot phantom-click suppressor — the one
timing-sensitive spot (documented at suppressGanttPhantomClick). The Graph's pan and node drag swallow the phantom click after a drag too, alongside the Gantt's, but arm a one-shot capture listener per drag instead of keeping a flag.

The Graph is a deliberate exception to "click opens": a plain click on a Graph card selects it (painted in place, no re-render) and a double click, or Enter on a focused card, opens it. Dragging a card in the Force layout makes a bare click a selection gesture, so opening moves to the double click. A capture-phase listener on the Graph stops a plain click before the shared document handler sees it; ctrl/cmd+click, shift+click and right-click stay the shared grammar.

## Amendment (2026-07-13): file-manager selection gestures

The selection gestures changed; the one-grammar principle did not.
Ctrl/cmd+click toggles one card in/out of the selection and plants the
range ANCHOR; shift+click ADDS the whole range between the anchor and the
target, in the active view's rendered order (`visibleCardIds`), additive —
shift never deselects. A right-click that replaces the selection
(contextSelection) re-plants the anchor; a stale anchor (card gone,
filtered out, or other view) makes shift+click start a fresh range at the
target. Everything else above stands: click = detail, right-click = menu,
plain click elsewhere = clear (selection AND anchor). Range logic is pure
(rangeSelection, selection.js); only the grammar handler mutates anchor
state.

## Amendment (2026-10-14): anchor, peek and isolate

A selection now grows from an **anchor**: one card, or one query (a pill, or
the search box in the Graph). A plain click on a card, where a plain click
selects, sets the anchor and drops the rest; with Shift it adds to the
selection instead. A Path or Tree from the menu adds that card's path or tree.
In the Graph, Shift+click adds one card (or takes it out), because its layout
has no reading order for a range, and Ctrl/Cmd+click does the same; the other
views keep the range. A pill is not a card: it follows the status pills' rules,
so a click turns it on or off, a right-click keeps only that pill and
Shift+click is a plain click. The first pill on is the anchor and later ones
are additions. Esc steps back in three stages: isolate off, then every addition
at once, then the anchor.

A right-click outside the selection no longer replaces it. The menu opens for
that card alone and leads with **Peek** (open the card, selection untouched)
and **Add to selection**. Losing a hand-built selection to a right-click was
the cost the old rule carried.

**Isolate** shows only the selection in every view. It writes the selection
into the search box as a query that keeps each part's criterion
(`#12 | path:40 | tags:grill`) rather than freezing a list of cards, so the
address carries it and a card that comes to match a pill joins on the next
load. It takes a copy when switched on; later clicks move the anchor inside the
isolated set without rewriting it.

What a plain click on a card does (open it, or select it) becomes a per-view
preference, kept in the browser per board. The defaults stay as above: the
other views open, and the Graph always selects.

## Amendment (2026-10-15): empty space

A click on empty space can be an accident, so the rule above, "plain click
elsewhere = clear", is reversed: a plain click on empty space no longer clears
the selection. On the Board, Map, Gantt and Calendar backgrounds and the Graph
canvas, a single click leaves the selection, its anchor, the pills and the
search box as they were. A double click on empty space clears it: the
additions, the anchor, and the anchor's text in the box (a pill's query, a
search typed in the Graph), and the chip goes off. Empty space is anywhere but a
card, a control, a text field, a popup or a control that keeps the selection.
Esc keeps its order: a popup, then the additions, then the anchor.

Where a double click on empty space already means something, that meaning
stands and the selection stays. The one such place is the Calendar's day cells
and time-grid columns, which create a card; the other views give a double click
on their empty space no meaning. The page reads a double click as the second
click of a pair (the click's count), as it reads a peek: the first click's
repaint can replace the element under the pointer, and a double click event aimed
at the replaced element never reaches the document.
