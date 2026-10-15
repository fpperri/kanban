# The web editor (desktop)

`kanban-web` is the human's live editing surface: a localhost Node server
(Node standard library only — no `node_modules`, no build step) serving a
vanilla-JS single-page app. Every drag, edit, and create writes straight back
to the `*.card.md` files, so the folder stays the single source of truth.
Desktop / localhost only — see [ADR 0002](adr/0002-kanban-app-local-server-spa.md).

## Launch

From the repo root:

```bash
node skills/web/scripts/server.js examples/demo-board
```

It prints `Kanban app: http://localhost:7777` (the next free port if 7777 is
busy) and binds to `127.0.0.1` only. Open that URL in any browser, or paste it
into VSCode's **Simple Browser**. Point the command at any folder of
`*.card.md` files to edit your own board.

A board that wants a fixed address pins one with a top-level `port:` key in
its `config.yaml`: the pin beats the `7777` default, an explicit `[port]`
argument beats the pin, and a busy *pinned* port is a startup error rather
than a silent move to some other port. The printed line is always the port
actually bound.

Pass `--home-url <url>` (http or https only; anything else stops the server at startup) and
the header shows a small home icon before the board title that leads to that address. Without
it there is no icon. In the search box, pasting `webapp#42` on the board named `webapp`
finds card 42, the same as `#42`.

All the screenshots below are the bundled `examples/demo-board` (a fictional
"Tallybird" app launch).

## Board

![Board view](images/web-board.png)

The columns are driven by `config.yaml`'s `statuses` list (default
`backlog → todo → doing → done`), with **Archive** always pinned at the far
right. Drag a card between columns to move it; drop it on **doing** and the
entry gate refuses it if the card is **waiting** (a `waiting_for` dependency
isn't `done` yet) or **blocked** (a manual sticker). The tile cues you see:

- a **red left accent** on a High-priority card (`#1`, `#8`),
- an amber **"Waiting on: #6"** badge (`#7` can't start until `#6` lands),
- a red **blocked** pill (`#8`),
- a **type chip** on a typed card (`#1` is typed `epic`, and orange because the board's `types:` list says so),
- the assignee (`@human` / `@hitl` / `@afk`), tags, and due date.

Each column header carries a sort dropdown (id / priority / due / last-modified
/ assignee / outline), a collapse toggle, and a `+` to create a card straight into
that column. Outline puts a parent before its children and siblings in `rank`
order; it is the default sort on a board where any card has a `rank` or a
`parent`, except in the Archive column, which keeps id order. In an Outline column, dragging a card between two siblings writes its `rank`:
one card when there is room between the neighbours, that parent's children renumbered
in tens when there is not. The search box up top filters every view at once, except the
Graph, which lights its matches and hides nothing but a `slice:` cut.

A card with children shows `▲n` (how many layers sit below it) and a status bar
of the leaves under it. Every bar is either collapsed (a thin line) or open (with
counts), and clicking any bar flips them all; the card detail shows the bar under its
title and thread, above the fields, the same way, with a line saying it counted this
board only when open. Archived leaves count as done, unless you turn that off in the
**preferences sheet** (below). The bar choice is remembered per board in your browser, and
the sheet sets the same one.
Marking a parent done while leaves below are open warns and saves anyway.

Open a card and the parents it sits under show above it, root first, each one a
click away; right under the roll-up bar a **Children** header with their count opens the list, in
`rank` order. A parent that does not
exist is marked *unresolved*, a parent on another board is shown but *not followed*,
and a loop of parents is flagged where it repeats.

## Dependency map

![Dependency map](images/web-map.png)

The **Map view** draws every relation between your cards: solid arrows for
`waiting_for`, pointing from the card you depend on to the card that's waiting, and
dashed lines from a **parent** to its children. A parent sits *below* its children,
as the end of the work under it; its status stays your call, and marking it done
with leaves still open only warns. By default a parent is joined only to the
children where their dependency chain ends, so a family with one long chain shows
one dashed line rather than one per child.
Each tree, the cards joined by any dependency or parent, is its own small graph under
a heading with its roots, the biggest first. Cards with no relation at all drop into a
**No relations** row below. Within each row the cards in play come first: doing, todo,
backlog, then done and archived.
A **Map options** row sets which parent lines are drawn, the dependency lines, one graph
per tree or one graph, which side the parent sits, alignment, row order, whether a
toggled line moves the cards, and how much detail a card shows (type, altitude and the
roll-up bar). Each choice is remembered per board in your browser. The row starts folded
behind an **Options** toggle; open or folded, it is remembered too.
A status-filter pill row (left-click to toggle, right-click to solo) and the
search box both prune the graph.

## Gantt

![Gantt timeline](images/web-gantt.png)

The **Gantt** view is a day-granular timeline grouped by status: each dated
card is a **bar** for its working range (`start_date → end_date`) and/or an
amber **diamond** for its `due_date`. Drag a bar to reschedule, drag an edge to
resize, drag the diamond to move the deadline. The Archive pill (off by
default) folds dated archived cards in as a trailing group.

## Calendar

![Calendar month](images/web-calendar.png)

The **Calendar** view is a Monday-start month grid (with Week / 3-day / Day
sub-views). Working ranges render as linked chips; a `due_date` is its own
amber deadline chip. Drag a chip to move the range or the deadline. Double-click an empty
day, or a slot in the time grid, to start a new card there; the selection stays. Same
status-filter pills and search as the other views.

## Graph

The **Graph** view (the header's "◉ Graph" button) draws every card at once as
a dot, joined by its relations: a solid line from a parent to its child, a
dashed arrow from a card to the card that waits for it. Three layouts, remembered
per board, with **Tiers** first:

- **Tiers** draws a fan all the way round the centre, but for a narrow seam at
  the top: a band for each tier of the board's
  `hierarchy:`, tier 1 innermost, then a ring for each depth that holds a card
  without a tier; each tree gets its own sector, loose cards with a tier share
  one, and the other loose cards sit in an Unnested block outside the fan, a
  column for each status. Each band has a faint arc and a caption with its name
  and count up the seam at the top, there is a divider between sectors, and the
  Unnested block is titled with its count and each column is captioned with its
  status and count. Fit and the first draw frame all of it.
- **Force** pulls related cards together and rings the unrelated ones round the
  edge.
- **Status** makes one ring per status, with the last column innermost (done,
  doing, todo, backlog from the centre out). Archived cards form a second group
  when the Archive pill is on.

A dot takes its status colour, grows with its relations, goes hollow when done
and dim when archived. A ring around it means children; red is blocked, amber
waiting, gold review. Hover or focus a dot to light that card and its relations
and dim the rest. Click selects a dot and keeps its relations lit while it is the
only card picked; shift-click or ctrl-click adds one card or takes it out, and a
selection of several lights exactly its cards. Double-click (or Enter) opens the
card; right-click works as on the board.

A search typed in the Graph hides nothing: its matches light, done cards included,
and the rest dims. Only a `slice:` term on its own in the query cuts the Graph, as it
cuts every view; under `|` it lights. Empty the box, press Esc or double-click the empty Graph to drop it;
click a card to start a new selection and clear the box. Switch to another view and
the box goes on filtering there, while nothing is selected by it. In Force, drag a dot and the cards related to it follow, like pulling on
a thread; the arrangement stays until the cards change or the page reloads.
Drag the background to pan, scroll or use `−`, `+` and **Fit** to zoom.
The status pills work as on the Gantt, Archive off by default. A card
whose parent is hidden (archived, or filtered out by a status pill)
is drawn as a root, and Archive starts off here, unlike the Map.
Open it directly with `?view=graph`.

## More on the board

**Search** — the box in the header filters every view as you type, except the Graph, where
it lights its matches. Terms separated by
spaces AND together (`tags:ui status:doing`), and five forms go further, one example each:

- `|` is or, and a space binds tighter: `tags:ui status:doing | #12` is ui and doing, or card 12.
- Round brackets group and can nest: `tags:ui (status:doing | status:todo)` is the ui cards in doing or todo.
- Quotes match a whole value, ignoring case, or any one element of a list: `tags:"grill"` finds a card tagged grill and not one tagged grilling. Quoted text with no field is a phrase in a title, body or tag: `"two words"`.
- `waiting:` finds the cards waiting for at least one card that is not done, as `blocked:` and `review:` find the stickers.
- `slice:` cuts every view to a run of slices, the board's tiers (the `hierarchy:` types, top first) and then the depths of the cards with no tier: `slice:objective..2` runs from the objective tier down to depth 2, `slice:goal` is that one slice, and `slice:goal..` and `slice:..objective` leave an end open. A reversed pair is swapped, an end the board does not have is left open, and a board with no hierarchy cuts by depth. It combines like any term: `tags:ui (slice:goal | #12)`.

A `|` counts only as a token of its own and a bracket only at a token's edge, so `a|b`
and `fix(auth)` stay literal text, and so does `waiting:3`. Half-typed input never
throws, and an empty alternative is dropped rather than matching every card. Clicking a
tag, assignee, blocked or review cue on a card adds that term to every alternative of
what the box holds.

**Search panel** — the search box has a toggle at its right end that opens a panel under
it; focusing the box never opens it, and the panel adds nothing to the header's height. It
lists the built-in pills, blocked, review and waiting, each with a count of the cards its
query matches, done cards included. The counts are taken over the cards the view shows
after its status pills and Archive, and before the search box, so turning one pill on
leaves the others' counts as they were. The pills follow the
status pills' rules, with every pill off to start. A click on a pill (Shift+click is a
plain click) turns that one pill on or off and leaves the others as they were: on, its
query joins the box as one more alternative, such as `review:` and then
`review: | blocked:`, and its matches join the selection, so outside the Graph the bulk
edits act on them and in the Graph they light; off, its query leaves the box and its
matches leave the selection. A right-click solos a pill, so it alone is on and the box
holds its query alone, and a right-click on the soloed pill turns every pill off (the
status pills turn all back on, since they start all on). The first pill on is the anchor
of the selection and later ones are additions, so Esc takes the later pills out first and
then the anchor. A pill is on while its query is the anchor or an addition, and is
announced as pressed, and typing in the box turns it off. With the panel
closed, a chip in the box counts what is on, and its name for a screen reader says which.
The pill section folds, and *Pill section starts folded* in the preferences sheet says how
it starts. Tab reaches the toggle, the fold control and every pill, and Enter and Space act
as a click. Esc closes the suggestion list first, then the panel (focus goes back to the
toggle, and stays in the box when Esc was pressed there), and then clears the box, when
focus is in it, or steps the selection back, which also takes the added pills back out of
the box. The box keeps its text through the first two, because the browser's own Esc, which
clears a search field, is stopped for them. The board keeps refreshing on its poll while
the panel is open, and a pill that has focus keeps it.

**Board pills** — the pill section also lists the board's own pills, after blocked, review
and waiting, in config order. Each `pills:` entry of `config.yaml` is a query, shown as its
query, or a label and a query, shown as its label; a malformed entry is skipped. A board
pill shows a count like the built-ins and clicks as they do: a click makes its query the
anchor and puts it in the box, and Shift+click grows the box to `anchor | pill`. A `field:*`
entry, such as `tags:*` or `assignee:*` (also `status:*`, `priority:*` and `type:*`), makes
one pill per distinct value the board's active cards hold in that field, sorted and labelled
by the value. Each matches its value exactly, so the `grill` pill never catches `grilling`
and a value with a space stays one term. The first eight values of a field show, and a
**+N more** button reveals the rest and folds them back. A pill that has focus keeps it
across the poll. Next up is not built in: it is a pill a board defines, such as
`- next: 'tags:"next-up"'`, and the plugin gives it no meaning.

**Notifications inbox** — the header bell surfaces messages agents leave in
`notifications.md`: a bolded TLDR, a level tint (debug / info / warning /
error), and per-entry archiving.

![Notifications inbox](images/web-notifications.png)

**Create & edit** — a minimal-first form (just a title and assignee) that
expands to the full field set — status, priority, parent, rank, tags, `waiting_for`,
blocked reason, type, the date triad, and a Markdown description.

![New-card form](images/web-new-card.png)

**Bulk actions** — select cards (click, ctrl-click, shift-click) and
right-click for a context menu: assign, set priority, edit tags, schedule,
archive, restore, delete, or add a dependency tree/path to the selection. A
right-click on a card outside the selection opens the menu for that card alone,
leading with Peek (open its details) and Add to selection, and leaves your
selection as it was. The same selection grammar works in every view, and
right-clicking inside an open card opens the same menu for that card, without Peek.

A click on empty space never touches the selection, since it can be an accident. A
double click on empty space clears it: the additions, the anchor, and the anchor's text in
the box (a pill's query or a search typed in the Graph), so the pill goes off. Esc still steps back
one stage at a time: a popup, then the additions, then the anchor. Where a double click
already does something, as it does on the Calendar's empty days and time slots, it does that
and the selection stays.

![Bulk context menu](images/web-bulk-actions.png)

**Preferences** — the gear at the right end of the header opens a sheet from the right
with the settings that rarely change. They are kept in your browser, per board, and are
never written to the board's files.

- *A plain click on a card* opens the card or selects it, chosen separately for the
  Board, Map, Gantt and Calendar (it opens, by default). The Graph is shown fixed at
  selects. Where a click selects, a double click on a card, or Enter on a focused card,
  opens it and leaves the selection as it was; Ctrl or Cmd click and Shift click build a
  selection as before, and a double click on a Calendar card opens it rather than starting
  a new one.
- *Roll-up bar* is open or collapsed, the same choice a click on any bar flips.
- *Count archived leaves as done* is on by default. Off, the board's tiles, the Map's
  cards and the card detail (whose scope line says so) leave archived leaves out of the
  count.
- *Pill section starts folded* is off by default. It says how the search panel's pill
  section starts; its fold control still folds it for the visit.

The sheet closes with Esc, a click outside it or its close button, and focus goes back to
the gear. While it is open the board does not refresh under it, and `/` and Ctrl+F stand
still.

## Other surfaces

The **[mobile snapshot](snapshot.md)** is the tap-through board for a phone or
tablet. See [`GLOSSARY.md`](../GLOSSARY.md) for the full parity table across
every surface.
