# What the snapshot deliberately does not do

Holds the ledger of kanban-web features the snapshot has no counterpart for, and why; read it before adding a feature to either surface.

**Deliberate gap:** no badge is tap-to-filter here — unlike kanban-web's tap-an-assignee-or-tag-to-filter, a tap on a badge never adds its term to the box, and the sheet's Hierarchy and Dependency path/tree buttons replace what the box held but for its `slice:` run (as kanban-web's Explore does); the panel's pills and slice entries are the controls that edit the box in place.

**Deliberate gap, narrowed:** kanban-web's AI-prompt sparkle button (a
dedicated control for writing the `prompt` field) still has no twin on an
*existing* card here — a card that already carries a `prompt` line gets an
editable row in the generic "All fields" grid like any other key, and a
card without one still can't have a prompt added to it after the fact from
the snapshot. A *new* card is different: every live column head's second
control (the small AI-prompt button next to its "+") opens the new-card
sheet with the prompt field already visible, and Accept carries a non-empty
value through as `create.fm.prompt` — the only representation the payload
protocol can actually apply, since a `create` op has no id yet for a
follow-up `edit.fm` (`references/apply-protocol.md`).

**No rank editing.** The All fields grid hides `rank` even on a card that has one,
and no other control writes it; the payload never carries `rank`. A card's place
among its siblings is changed by dragging in kanban-web, or by asking. A half-working
reorder would be worse than none.

**No warning for a parent marked done with leaves open.** kanban-web warns, after the
save, when a parent is marked done while leaves below it are open. Here a move to
`done` queues like any other and says nothing, since the page only queues changes for
Claude to apply; read the parent's roll-up before marking it done.

**No bar mode.** kanban-web's click on a bar, which flips every bar between open and
collapsed, has no counterpart: a parent's tile always carries the thin bar and its
sheet the open one.

**No Isolate switch and no selection.** kanban-web's panel has an Isolate switch in its foot, which
shows only the selection in every view, and a selection that a click on a card, a path, a tree or a
pill builds. This page has neither: a tap opens a card, the panel has no foot, and a pill click only
writes the box, with no anchor and no Shift addition. It has no `m` key that steps through the
pills either, and no preferences sheet for the panel's switch and folds.

**No hover set.** kanban-web's panel has an *On hover show* section, six checkboxes that choose which sets a
hover or a keyboard focus lights on a card, per board and per kind of Graph. This page has none: a tap hovers
nothing, so the panel has no such section and a card lights nothing beside the selection's own marks. Web-only.

**No jump to the nearest match.** kanban-web's Calendar and Gantt, when a change to the search box
leaves no match inside the range on screen, move to the match nearest that range (`nearestMatchDay`
in `calendar-model.js`, and its Gantt counterpart). This page's Calendar and Gantt filter by the box
the same way but stay on the month or the range they show, so a search can leave an empty stretch:
page the Calendar or scroll the Gantt to the match yourself. The jump is not ported, since the page
ports those models and does not embed them.

**No Graph view.** kanban-web's Graph, which draws every card at once as a dot in the tier fan or the Flow,
with its option row, its lighting and its names, has no counterpart: the Map is this
page's one picture of the relations, and the slices and pills of the panel cut every view without it.
The `l` key that steps the fan's names goes with it.

**No logbook.** kanban-web's notes palette (the `n` key, the card menu's note entry, the count a
card wears), the notes on the Calendar as chips and the author switch have no counterpart: the
snapshot reads no `logbook:` folder and shows no note. Web-only in this release.

**No groups beyond the search term.** kanban-web's group badges on a card, the palette's Group tab,
the group form, the delete popup and the iteration dropdown have no counterpart: the snapshot reads
`group:` in the box (`references/search.md`) but draws no group, so nothing here lists a group's members or
narrows the views to an iteration. Web-only in this release.

**No scratchpad.** kanban-web's Scratchpad tab, the page for one card or group, and the gear's
Scratchpad page have no counterpart: the snapshot reads no `scratchpad:` folder. The scratchpad is
only in kanban-web, web-only in this release.

**No todo lists.** kanban-web's Todos tab, the open/total count on a card tile and a group badge, and
the gear's Todos page have no counterpart: the snapshot reads no `todos:` folder (docs/adr/0021).

**No Map options.** kanban-web's Map options row (parent lines, dependency lines,
graphs, parent sits, align, row order, layout, cards) has no counterpart: the Map
always draws the defaults in "The Map" (`references/views.md`), and with no bar mode to flip, a click on a
roll-up bar opens the card.

Archived cards are read-only in the tap UI — restore or edit them
conversationally or in kanban-web. Everything else on a live card is tap-
editable, including dates/tags/`waiting_for` and unknown frontmatter keys
via the "All fields" grid (raw strings, `edit.fm` op). The payload
format still has room to grow; extend the op vocabulary in
`references/apply-protocol.md` first, then the UI.

**No touch drag, not yet.** Desktop pointer drag exists (`references/pointer.md`).
Touch input is untouched by it: touch drag is its own piece of work, not built, so
board tiles get no `touchstart`/`pointerdown` handling.
