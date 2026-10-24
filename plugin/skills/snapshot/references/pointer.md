# Desktop pointer: right-click menu and drag and drop

Holds the right-click card menu and pointer drag and drop, which run only where the pointer is fine and hovers.

## Right-click card menu

The right-click card menu (not the mobile scroll-button stack in `references/phone.md`,
despite both being called "the context menu" — this one is a real
right-click): on `(hover:hover) and (pointer:fine)` devices, right-clicking
a live board card opens a hand-rolled menu at the cursor — Open, one
"Move to `<Status>`" row per status in `statuses` order except the card's
own, then (below a separator) Archive, Delete (arms red with "Delete?" on
the first click, fires on the second, same two-tap shape as the mobile
stack's own delete arm), then the four Explore sets as flat items, Hierarchy path, Dependency
path, Hierarchy tree and Dependency tree (the menu does not nest), each writing its `hpath:`,
`dpath:`, `htree:` or `dtree:` term as the sheet's buttons do — every action
routes through the same `queue()`/`graphFocus()` machinery the detail
sheet's own buttons use, no parallel path. Move is the tap
alternative to drag-and-drop (see "Drag and drop" below) for anyone
who would rather not drag; because it rides `queue()` it inherits the
`doing` entry gate unchanged — moving a card with unresolved `waiting_for` or a
`blocked` sticker into `doing` is refused there with the reason left in
the tray note, exactly as from the detail sheet's status pill. It closes on click-away, Esc, scroll, or switching views. The gate is
checked per-event off a live `MediaQueryList`, so it never registers any
behavior for a coarse-pointer device — no `preventDefault`, no menu; native
long-press is untouched there. Archived cards are excluded for now — right-
clicking one still shows the browser's native menu.

## Drag and drop

Desktop pointer drag lives beside the right-click menu above and is gated
the same way. Native HTML5 drag-and-drop (the shape kanban-web's own
`wireDrag()` uses) is enabled on a board tile only when
`(hover: hover) and (pointer: fine)` matches **at the moment `dragstart`
fires**, read live off the same `fineMQ` MediaQueryList `contextmenu`
uses — never decided once at load. Live tiles carry the `draggable`
attribute unconditionally (archived tiles never do — they stay read-only
as everywhere else), so a coarse-pointer device's own `dragstart` still
fires; the gate cancels it right there with `preventDefault()` before any
drag visuals appear, no different in spirit from the right-click gate
letting a coarse-pointer's native context menu through untouched. Every
live status section (`.boardcol[data-status]`, both the >=900px column
strip and the stacked/accordion layout below it — archive is excluded,
it is not a move destination) accepts `dragover`/`drop` and shows a
dashed `--accent` outline on the section a drag is over, cleared on
`dragleave`/`drop`/`dragend`. A drop routes through the exact same
`queue()` a status-pill tap or a right-click "Move to" row uses — one
`move` op — so the `doing` entry gate and its tray-note refusal apply
unchanged; dropping a card back onto its own current section queues
nothing.

A **Drag** switch lives in the ⋯ stack's extended mode alongside
＋ ⤒ ⤓ (see `references/phone.md`) — a move/arrows glyph,
with a dashed border when off, and `aria-pressed` carrying the state. Default on; the choice persists per
page in `localStorage` (key `kanbanViewer.drag`; a missing key or a
blocked/throwing read both fall back to on — only a stored `"0"` turns
it off), read live by the same `dragstart` gate, same pattern as
`stackMode`.

Touch drag is deliberately absent: board tiles get no `touchstart`/`pointerdown`
handling (`references/gaps.md`, "No touch drag, not yet").

Verified so far only against a local build of the page — the live
Board artifact page still needs a human mouse test, since the host page
must not steal the drag gesture the way it once stole mobile's
swipe-down.
