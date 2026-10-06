# 0006. One interaction grammar across all views

Date: 2026-07-09 · Status: accepted
Amended: 2026-07-13 (selection gestures — see Amendment below)

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
