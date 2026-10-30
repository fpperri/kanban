# The web editor

`kanban-web` is the human's live editing surface: a localhost Node server
(Node standard library only — no `node_modules`, no build step) serving a
vanilla-JS single-page app. Every drag, edit, and create writes straight back
to the `*.card.md` files, so the folder stays the single source of truth.
The server listens on `127.0.0.1` only (see [ADR 0002](adr/0002-kanban-app-local-server-spa.md)); a phone reaches it through a VS Code tunnel (`plugin/skills/web/references/launching.md`) and gets [the phone layout](#the-phone-layout).

**Boundaries** — This is the **only** skill that runs a server.

## Launch

From the repo root:

```bash
node plugin/skills/web/scripts/server.js examples/demo-board
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
finds card 42, the same as `#42`. Another board's mention is searched as text and the
panel says which board holds the card.

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
- a **type chip** on a typed card (`#1` is typed `epic`, and orange because the board's `types:` list says so), which starts with the type's icon when the list gives one,
- the assignee (`@human` / `@hitl` / `@afk`), tags, and due date.

**Config-driven columns** — Landing in **todo** auto-stamps `start_date` (landing in **done** stamps `end_date`) with today's local date-only value when the field is empty — every status-changing path stamps the same way (drag, form edit, bulk edit, restore-into-column, creating directly into the column), pinned to the literal lowercase statuses like the doing gate; an existing date is never overwritten. Dragging a card into **doing** while it is **waiting** or **blocked** is **rejected**: the card snaps back with a toast naming which gate refused — "waiting on #3 (todo)" / "blocked: <reason>". A waiting card wears the amber left-accent plus a "Waiting on:" badge listing **unresolved ids only** (deps resolve against active + archived cards; a dangling id never shows; the badge disappears on its own when every dep lands). A blocked card wears a red "blocked" pill, tooltip carrying the reason; a `review` card — "finished, approve me", `blocked`'s sibling sticker (ADR 0009) — wears its own gold pill (tooltip carries the text) and does **NOT** join the doing gate: a card can enter or stay in `doing` while wearing `review`. Both stickers are searchable (`review:`/`blocked:`, see **Search**) and clicking either pill appends that bare term to the search box. A card whose on-disk status isn't in the list renders in the **first** column (the catch-all) with a small dashed raw-status chip; the file is **never rewritten** — promotion = the human adds the status to `config.yaml`, and the next poll files the card under its real column. **Colors:** the built-in four each have one fixed hue used everywhere (backlog cyan, todo blue, doing green, done purple), at two lightnesses: a bright value on the dark theme and a deeper one on the light theme, each clearing 4.5:1 as text in its own theme. app.css carries them as `--st-*`, `--hash-a`…`--hash-h` and `--id-*` tokens in its theme blocks. The one exception is the 12% wash inside a gantt bar (`statusColorSoft()`), a fixed tint of the dark value that reads on either ground. The neutral grey belongs to Archive alone — no hashable palette slot is near-grey, and an unlisted on-disk `status: archive` **or `archived`** mutes to the archive grey instead of hashing. A custom status gets a deterministic color (its name hashed into a fixed 8-color palette) used by the column header, the map node's status dot, gantt group/bar, and the shared status-dot glyph (see plugin/skills/web/references/card-rendering.md, **Status dot**). A custom status can hash to any slot of the palette, orange included (determinism, not uniqueness, is the hash contract). The form's status dropdown offers the list's values (an unlisted status on the card being edited is appended as "(unlisted)" so saving never silently rewrites it), and new cards default to the first column (a column header's **+** pre-selects its own column instead).

**Archive column** — `archive` here is a *location* (the `archived/` folder), not a status — ADR 0002's data model — but the column has full UI parity (ADR 0005): drag a batch onto Archive to archive it (one confirm, skipped when the whole batch is already `done`), drag archived cards onto a live column to restore them **with that column's status** (confirms when the batch contains archived cards; the `doing` entry gate — waiting + blocked — applies per card), and archived tiles join ctrl/shift-click and right-click selection. Mixed live+archived selections are fine — every action skips what doesn't apply, with one summary toast. The tile's Restore button keeps the status-untouched semantics (no confirm), as does the menu's Restore selected.

Each column header carries a sort dropdown (id / priority / due / last-modified
/ assignee / outline), a collapse toggle, and a `+` to create a card straight into
that column. Outline puts a parent before its children and siblings in `rank`
order; it is the default sort on a board where any card has a `rank` or a
`parent`, except in the Archive column, which keeps id order. In an Outline column, dragging a card between two siblings writes its `rank`:
one card when there is room between the neighbours, that parent's children renumbered
in tens when there is not. The search box up top hides what it does not match only while Isolate is on, and otherwise lights
its matches and hides nothing but a `slice:` cut; typing turns Isolate on in every view but the Graph. Enter in the search box
goes to the first match, and a second Enter opens it when it is the only one.

**Collapsible columns** — every column header has a collapse/expand toggle. Collapsed = a narrow strip showing just the toggle icon and the card count; hovering it tooltips the full column name. Live columns default expanded, Archive defaults collapsed. Collapse state persists per column in `localStorage` (namespaced per board) and survives both a page reload and the 5s auto-refresh poll.

**Equal-length columns, fixed headers** — every column (Archive included) stretches to the same fixed height, the viewport under the page header, so a short column never stops short of a busy neighbor. The page header (title, search, view-switch/refresh/notif buttons and the preferences gear) and every column's own header stay on screen while the page or a column's cards scroll — the page header is `position: sticky`, and each column's header is the first flex child above that column's own scrolling card list, so it needs no sticky of its own; the board area is sized under the page header via a CSS var kept in sync with the page header's real rendered height by a `ResizeObserver` (a hardcoded px offset would drift the moment the header wraps). Board only — none of the column behaviour reaches past `#board` (the sticky page header is shared by every view, and the Map and the Graph are sized from the same CSS var).

**Per-column sorting** — each (expanded) column header has a sort-field dropdown (ID / Priority / Due date / Last modified / Assignee / Outline) and a direction toggle. "Due date" sorts by the card's schedule — `due_date`, else `end_date`, else `start_date` — honoring time within a day (a date-only value reads as start-of-day); dateless cards always sort last, in either direction. Under a Due date sort the key driving a card's position is one of the rows in its date stack — the `⚑` due row when the card has one, otherwise the `⇥` end row, otherwise the `⇤` start row, exactly the triad fallback above. "Last modified" sorts by the machine-maintained `updated` stamp, newest-first by default; unstamped cards always sort last. `updated` itself isn't shown on tiles (only in the card popup), so the what-you-see-is-what-sorted promise holds for Due date only. "Assignee" groups cards by owner, ranked by the config.yaml assignees registry's ORDER (not alphabetically); unregistered handles follow all registered ones alphabetically, and unassigned cards always sort last, in either direction. "Outline" puts a parent before its children and siblings in `rank` order (unranked siblings after the ranked ones, by priority then id), computed over the whole board so a child whose parent sits in another column still follows the order; a card with no parent on this board is a root. In an Outline column, dragging a card between two tiles reorders it instead of moving it: an accent line shows where it will land (no line shows over a drop that would be refused), and the drop writes `rank` through `POST /api/cards/<id>/reorder` with `prev` and `next`, the ids of the cards above and below the drop in outline order (`null` for none; the answer is `{ card, renumbered }`). Room for a whole number between the two ranks writes that card alone; a full gap renumbers that parent's children in tens and writes only the cards whose rank changes, archived siblings included, and no card outside that parent (cards whose parent is on another board or missing from this one are roots in the outline but siblings only of cards with that same parent, so a drop among plain roots never renumbers them). Siblings the column does not show (another column, hidden by the search) are stepped around, and a drop where the card already stands writes nothing. A drag changes rank, never the parent: a drop among another parent's children is refused with a toast (the call answers 400, an unknown card 404). Other columns still move the card, a bulk drag still moves the selection, and the Archive column is not reordered; the rule an AI writer follows is in the kanban skill. Priority defaults High-first; ties on any field break by id, ascending, so order doesn't reshuffle when you flip direction. Each column remembers its own choice independently, defaulting to priority-desc for live columns and id-asc for Archive, except that on a board where any card has a `rank` or a `parent` the live columns default to Outline. Only a column you changed is remembered (in `localStorage`, alongside collapse state, surviving reload and the poll), so a default never freezes into the columns you left alone, and a board that gains its first rank or parent switches those columns to Outline without a reload. Composes with search filtering. Hidden while a column is collapsed (nothing to sort there).

**Archive column** — Archived cards live in the Archive column, right of Done; clicking a tile opens the same detail popup as a live card (no Edit/Archive actions, since those don't apply to an already-archived card), and each tile keeps **Restore** and **Delete** buttons.

A card with children shows `▲n` (how many layers sit below it) and a status bar
of the leaves under it. Every bar is either collapsed (a thin line) or open (with
counts), and clicking any bar flips them all; the card detail shows the bar under its
title and thread, above the fields, the same way, with a line saying it counted this
board only when open. Archived leaves count as done, unless you turn that off in the
**preferences sheet** (below). The bar choice is remembered per board in your browser, and
the sheet sets the same one.
Marking a parent done while leaves below are open warns and saves anyway.

**Parent cards: altitude badge and roll-up bar** — a card with children shows `▲n` in its head row (its altitude: the layers of cards below it, whatever their types) and a status bar of the leaves below it, meaning the cards with no children, so an objective over two epics over stories counts the stories and not the epics beside them. Segments run in column order, each in its status's color, with a `status: n` tooltip. Every bar on the page shares one mode, open or collapsed: collapsed is a thin line (the default), open adds a count line (the total, the done count, then each other status). Clicking any bar, on a board card or in the card detail, flips it for all of them without opening the card, and the preferences sheet (**Preferences**) sets the same choice, so the two always agree; the mode is remembered per board in `localStorage`, surviving reload and the poll, and a browser that once saved the retired `off` reads as collapsed. Archived leaves count as done by default, so archiving a finished story leaves its parent's done count unchanged; the preferences sheet can turn that off, and then every roll-up (the board tile, the Map's rich row, and the card detail with its scope line) leaves archived leaves out. Marking a parent done while leaves below are still open (a drag, a multi-card drag or the form) shows a warning and saves anyway; only the literal status `done` counts as finished, and an archived leaf counts as finished. Altitude, roll-up and the warning are worked out from the cards on every render and never written to a card.

Open a card and the parents it sits under show above it, root first, each one a
click away; right under the roll-up bar a **Children** header with their count opens the list, in
`rank` order. A parent that does not
exist is marked *unresolved*, a parent on another board is shown but *not followed*,
and a loop of parents is flagged where it repeats.

## The phone layout

The Web draws its **phone layout** below 760 px wide; at 760 px and wider it is the desktop layout, and a window that crosses the line either way switches without a reload. Nothing scrolls sideways.

- **Header.** One row: the board's name (shortened with an ellipsis), a search button that opens a full-width field (it lights up while a query or a search filter is on), New card, the bell with its unread badge and a More (⋯) button holding Preferences, Refresh, Copy board path, the home link and the iteration picker. The server-unreachable cue stays. On the Calendar and the Gantt the **header date** (the shown range) sits beside the name.
- **View bar.** A bar at the bottom lists Board, Calendar, Gantt, Map and Graph, each a line icon and a word; the current view is marked and a tap goes straight to that view, keeping the selection. It hides while the search field has the keyboard up. The desktop header's view buttons (Calendar, Gantt, Map view, Graph, and Board view to come back) and Refresh are replaced by it and the More menu.
- **Board.** The **status tabs** across the top, each with its status's colour and count (shown/total while a search narrows the board), Archive last, replace the column headers: the Board shows one status at a time, full width. Tap a tab or swipe sideways to change status; the tab is remembered per board. A status collapsed on the desktop still shows its cards. Cards do not start a native drag. New card adds into the tab you are on.
- **Card.** A card opens full screen with a back button, and edit, archive and delete on the same row. The status changes through the edit form, which is full screen with 16 px fields; Save returns to the card on the tab of its new status, and so does leaving the form. `?card=` links open the card over its tab.
- **Statuses section.** At every width the status pills of the Map, the Gantt, the Calendar and the Graph sit at the top of the search panel; on a phone they are large enough to tap.
- **Bottom sheet.** The Graph's and the Map's option panel opens as a **bottom sheet** over the lower half of the view, scrolls inside itself, keeps its close button and does not dim the drawing. A two-finger pinch zooms the Graph and the Map.
- **Span cycle button.** The Calendar's and the Gantt's span switch becomes one button naming the current span; each tap moves to the next span and wraps. The Gantt's label column shows ids only.

The phone leaves out per-column sorting, collapsing, the AI-prompt add and the selection gestures (Shift or Ctrl click, the box, bulk edit); they stay on the desktop layout. The views other than the Board keep their desktop behaviour apart from the above.

**Left out on a phone** — the phone layout leaves out sorting (no sort dropdown), collapsing (a collapsed status shows its cards), the AI-prompt add (no sparkle button) and selection gestures (no Shift or Ctrl click, no box); they stay on the desktop layout.

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
roll-up bar). Each choice is remembered per board in your browser.
The options and the zoom (`−`, the percentage, `+` and **Fit**) sit in a panel on the
right of the view, which the panel icon at the top right, level with the top of the view,
opens and closes. The options are always shown in it; the panel is what hides them, and
a fold remembered from before the panel is ignored. The Graph keeps its zoom and its Options section in a
panel the same way; its Hierarchy | Flow choice stands in the toolbar beside the (i) and the panel icon, not in the panel. At every width the Graph's drawing starts right under the header: its card count and key sit behind an (i) button, off by default and remembered per board, and the (i) and the option button float in the drawing's top-right corner, as the Map's option button does in the Map's, staying put while the Map scrolls. The status pills of the Map and the Graph are in the search panel's Statuses section. The
panel starts closed, at every width, until you open it with the panel icon; from 760 px wide it opens beside the view, below it over the view as a
sheet with a close button of its own that adds no sideways scroll. The choice is
remembered per board in your browser, for the Map and for the Graph apart. Closed, the
view has the panel's width back, and the Graph frames its cards again in it unless you
have moved the view.
The status pills (left-click to toggle, right-click to solo), which sit in the search panel's Statuses section, and the search box both prune the graph.

## Gantt

![Gantt timeline](images/web-gantt.png)

The **Gantt** view is a day-granular timeline grouped by status: each dated
card is a **bar** for its working range (`start_date → end_date`) and/or an
amber **diamond** for its `due_date`. Drag a bar to reschedule, drag an edge to
resize, drag the diamond to move the deadline. The status pills sit in the search panel's Statuses section, not in the view. The Archive pill (off by default) folds dated archived cards in as a trailing group.

## Calendar

![Calendar month](images/web-calendar.png)

The **Calendar** view is a Monday-start month grid (with Week / 3-day / Day
sub-views). Working ranges render as linked chips; a `due_date` is its own
amber deadline chip. Drag a chip to move the range or the deadline. Double-click an empty
day, or a slot in the time grid, to start a new card there; the selection stays. Same status pills, in the search panel's Statuses section, and search as the other views.

With a `logbook:` line the Week, 3-day and Day views also draw the board's notes: a day with
timed notes keeps a strip at the right of its column, with a chip for a note and a count for
several in a half hour, and a box in the all-day row for its untimed notes. The **Notes**
button in the toolbar hides and shows them. A **divider** on the strip's left edge changes the
strip's width for every day at once: drag it (from 44px nearly to the whole column, leaving the
cards a sliver), or focus it and press Left and Right; a double click puts the default width
back. A wider strip shows more of each note's words. The width is kept per board in this browser.

Beside the view buttons a **Grouped | Each note** switch picks how the notes are drawn. Grouped is the default and is as described above. **Each note** draws every timed note as its own chip, stacked in time order from its hour line down, and an hour grows to hold them: it is as tall as the most notes any shown day has in it, never under 40px, and the same height in every column so the rows line up across the days. The card blocks stretch with the hours (a block from 09:00 to 11:00 spans whatever height those two hours take), and a drag, a resize, a click on an empty hour and a double click that makes a card all land on the time under the pointer. The month view and the untimed box are the same in both. The choice is kept per board in this browser.

The Calendar and the Gantt open on today, and until you move their window with the arrows or a jump
they follow the clock across midnight.

## Graph

The **Graph** view (the header's "Graph" button) draws every card at once as
a dot, in one of two graphs, **Hierarchy** or **Flow**, chosen with two buttons in the toolbar at the top right of the drawing,
left of the (i) and the option panel's button, so the choice shows whether the panel is open or shut
(Hierarchy opens first; see **Flow** below). Hierarchy joins the cards by their relations: a solid
line from a parent to its child, a dashed arrow from a card to the card that waits for it. The Hierarchy is drawn
as the fan called **Tiers**.

**Tiers** draws a fan all the way round the centre, but for a narrow seam at
the top: a band for each tier of the board's
`hierarchy:` that holds a card, tier 1 innermost, then a ring for each depth that holds a card
without a tier, the first ring being the cards right under a tier card; a tier or a depth with
no drawn card has no ring, no arc and no name, and the rings left close up, so a cut that leaves
out the top tiers pulls the fan in to the tiers it keeps, the dividers between sectors starting at
the first ring drawn; each tree gets its
own sector, loose cards with a tier share
one, and the other loose cards sit in an Unnested block outside the fan, a
column for each status, when the Unnested option is table (by default they are on a ring
outside the fan: see the option row below). A parent's children on one ring sit side by side, in the order the Order option shows: the children a parent has on a ring form one unbroken run among its children on that ring or nearer the centre, standing where the first of them falls, so no card of another parent sits on that ring between them, and a run on a ring further out may sit inside a nearer ring's run, between two of its cards; a parent whose children are all on one ring is laid out in that order alone. Each band has a faint arc and a caption with its name
up the seam at the top, there is a divider between sectors, and the Unnested
block is titled and each column is captioned with its status. Each tier band that
holds a card is washed in its type's colour, a neutral wash when the type has none,
behind the lines and the dots; depth rings, the Unnested ring and the Unnested block
are not washed, and a click on a wash is a click on empty space. A caption shows
its name alone; hovering it, or moving keyboard focus onto it, shows a tooltip
with its count, its split by status and the `slice:` term that cuts to it. Fit
and the first draw frame all of it.

Tiers has an option row in the option panel beside the fan: Lines (all, chain, off),
Group (brackets, lines), Dependencies (on, off), Order (status, rank), Names (relevant, all,
none) and Unnested (outermost, off, depth 0, table). Lines says which children get a parent
line: every child (the default), the end of each dependency chain, or none. Group says how those lines are
drawn: brackets, the default, draws for each parent and each ring its children sit on one
bracket from the first of them to the last, in the order the Order option shows, with a tick to each child and one line up
to the parent, and prints the number of children on it; a child alone on its ring keeps a
plain line. Lines gives each child its own line. With Lines off there is nothing to group.
A bracket's line up to the parent meets the arc in a gap between two children, never at a child's angle, the gap nearest the
parent whose line keeps clear of every other card's mark, and the count sits in the free gap nearest it.
Names puts a card's title on the fan: relevant, the default, names the
selection, what it lights and the highest parents, all names every card and none names
no card; the l key steps through them. A parent's name sits beside its ring; every other
name sits in a row outside the rim, joined to its dot by a leader, and the Unnested
block's names in a list above it. Names stay upright and the same size at any zoom and
keep off the lines, the dots and each other, though a leader may pass under one; a card
with no room goes unnamed, which can leave the block's left-hand columns unnamed.
Unnested says where the cards with no parent, no children and no tier are drawn: on one
ring outside the fan by default, not at all, on the depth 0 ring, or in the block outside
the rim. The row's choices are kept per board.

**Flow** lays the board out by its dependencies instead, in columns from left to right, with an arrow
from each card waited for to the card that waits, and no parent line. A **Dependencies** switch under the
choice, **all** by default or **frontier**, decides the columns. Frontier counts the steps until a card is
ready, and only the dependencies that are not done: the first column is `done`, faded, then `ready now`
(the first column with work in it is what you can pick up now), `1 step`, `2 steps`, and a card in or
behind a dependency loop stands in a last `loop` column. All counts the longest chain of dependencies behind
a card, done ones included: `waits for nothing`, `chain 1`, `chain 2`, a loop sharing one column. Each column
heading carries its card count. Cards with no dependency either way sit in a strip below the columns, titled
`no dependency either way` with its count. Within a column the cards are ordered to cut the arrows that cross,
ties by id, and a tall column wraps into side-by-side stacks. A **Lanes** switch beside the Dependencies
switch, **on** by default, groups the cards into lanes: each card with a dependency sits in the lane of its
nearest parent with a tier, else its root, under a header that leads with that card's type mark in its type
colour, its tier name (none for a card with no tier), `#id title`, the lane's card count and its ready
count. A card is ready when it is open, in no loop and waits for nothing that is not done. The columns line
up across the lanes. With frontier the lanes with ready cards come first, the most ready first, then the
others in outline order; with all, every lane is in outline order. With frontier a lane folds into the strip
at the bottom, which then reads `no open dependency`, when none of its cards with a dependency is open; a
lane whose open cards wait only on done cards stays, since those cards are ready now. With all no lane folds.
A card with no dependency is in no lane but in the strip, so a lane's card count is the cards drawn in it, not
every card under its lane card. A header is its card's node: a click, Shift- or Ctrl-click,
double-click, Enter, Ctrl+Space, hovering and focus act on it as on the card's dot, the card menu opens from it with the same items, and
the header and the dot of its card light and select together. A dot keeps its status colour and its type mark,
and grows with the dependencies it is in; in frontier the done ones are faded. Search lighting, the status pills,
`slice:` cuts, isolate, selection, the card menu, double-click and Enter and the zoom work as in Hierarchy, but
a lone card picked by a click lights it with the cards its dependencies join to it, not its parent, and hovering a
card lights what the Flow's *On hover show* ticks, `dlinks` and `hlinks` at first, so the cards its dependencies join to it and its parent and children. A dot cannot be dragged. The choice and the switches are remembered per board in your browser and written
in the address as `graph=hierarchy|flow`, `deps=frontier|all` and `lanes=0|1`: a link's values win on that load, and a press
replaces the page's address without adding a step to Back. A load writes the address the same way, from the link and
what the board remembered, keeping every other parameter, so a link copied after a plain reload opens the same picture. In the phone's bottom sheet the switches are its first rows; the Hierarchy | Flow choice stays in the toolbar.

A dot takes its status colour, grows with its relations, goes hollow when done
and dim when archived. A type that has an `icon:` in the board's `types:` list draws its dot
in that outline (circle, square, diamond, triangle, hexagon or star), still in the status
colour, and starts its chip with it wherever a chip is drawn; an icon is a shape, never a
colour, and a type with no icon, or an unknown name, keeps the round dot. A ring around it
means children; red is blocked, amber waiting, gold review. Hover or focus a dot to light
what *On hover show* ticks for that card, its relations at first, and dim the rest. Hovering a line lights it and the cards
at its ends the same way (a bracket, its parent and all its children), a dot under the pointer winning over a line. Click selects a dot and keeps its relations lit while it is the
only card picked; shift-click or ctrl-click adds one card or takes it out, and a
selection of several lights exactly its cards. Double-click (or Enter) opens the
card; right-click works as on the board.

A search typed in the Graph hides nothing: its matches light, done cards included,
and the rest dims. Only a `slice:` term on its own in the query cuts the Graph, as it
cuts every view; under `|` it lights. Empty the box, press Esc or double-click the empty Graph to drop it;
click a card to start a new selection, which the box shows in place of the search (`#34`), its cut kept. Switch to another view and
the box isolates it there where that view's Typing isolates is on, or lights its matches and hides nothing
where it is off, while nothing is selected by it. A dot is never dragged.
Drag the background to pan, scroll or use `−`, `+` and **Fit**, in the options panel, to zoom.
The status pills work as on the Gantt, Archive off by default. A card
whose parent is hidden (archived, or filtered out by a status pill)
is drawn as a root, and Archive starts off here, unlike the Map.
Open it directly with `?view=graph`.

A double click (or Enter) opens the card, a pan keeps the selection, and a click on the empty Graph leaves it. A search typed in the Graph is the anchor of the selection: its matches are the selected cards, and it stops being the anchor when the Graph is left (see plugin/skills/web/references/graph.md).

## More on the board

**The clock** — an open page reads the clock when it needs it, never a value it took earlier. Every
"today" (the Calendar's and the Gantt's today, the overdue marks on the tiles, the running iteration and
the notes list's "today" labels) moves to the new day across midnight and when the page is shown again,
without a reload, and a Calendar or Gantt window you have not moved moves with it. Every date or time the
page or the server stamps (a note's day and time, a card's `updated` line and its start and end dates)
is read at the moment of the write. A field you filled in yourself keeps what you typed, and a notes
date or time left on Today or Now is worked out when Enter is pressed.

**Refresh** — the app re-reads the folder on a 5-second poll, surfacing edits made by `/kanban`, hand edits, or another tool; the header Refresh button forces a re-read immediately. View mode, query, filters, selection, and collapse/sort state all survive the poll.

**Search** — the box in the header says what to look for, and Isolate says whether the rest hides:
with Isolate on the box hides what it does not match, and with it off the box lights its matches.
Typing, a pill, a tag or assignee cue and a link with a search turn Isolate on in a view whose
**Typing isolates** is on, which is every view but the Graph to start, so a search narrows the Board
as ever and lights in the Graph. Terms separated by
spaces AND together (`tags:ui status:doing`), and five forms go further, one example each:

- `|` is or, and a space binds tighter: `tags:ui status:doing | #12` is ui and doing, or card 12.
- Round brackets group and can nest: `tags:ui (status:doing | status:todo)` is the ui cards in doing or todo.
- Quotes match a whole value, ignoring case, or any one element of a list: `tags:"grill"` finds a card tagged grill and not one tagged grilling. Quoted text with no field is a phrase in a title, body or tag: `"two words"`.
- `waiting:` finds the cards waiting for at least one card that is not done, as `blocked:` and `review:` find the stickers.
- `slice:` cuts every view to a run of slices, the board's tiers (the `hierarchy:` types, top first) and then the depths of the cards with no tier, counted from the nearest tier card above (a card right under an epic is depth 0, its child depth 1, and a root with no tier above it is 0): `slice:objective..2` runs from the objective tier down to depth 2, `slice:goal` is that one slice, and `slice:goal..` and `slice:..objective` leave an end open. A reversed pair is swapped, an end the board does not have is left open, and a board with no hierarchy cuts by depth. It combines like any term: `tags:ui (slice:goal | #12)`.

**Search, more** — the header search box says *what* and Isolate says *hide or light*, in every view: with isolate on the box hides what it does not match, and with isolate off it lights its matches with the selected look (no card is selected by it, and no action reads it) and hides nothing but a top-level `slice:` cut, which hides in every view whatever isolate is (the Graph lights as it always did; see plugin/skills/web/references/graph.md). The query survives view switches and the poll. Enter in the search box goes to the first match, and a second Enter opens it when it is the only one: the first closes the panel (and the phone's field), brings the first matching card in the view's reading order to the middle and gives it focus, leaving the query, the selection and the pills as they were. Enter picks from the suggestion list only when a row of it is highlighted (arrow to one first). Space-separated terms AND together: `#42`/`id:42` is an exact card id, whole (`#G3` is the card `G3`, not card 3; a lowercase `#a371f7` is no id), and a pasted `webapp#42` is the same when `webapp` is this board's name (any case; another board's mention is searched as text and the panel says which board holds the card); `title:` `body:` `status:` `priority:` `tags:` `file:` `assignee:` `type:` are case-insensitive substring scopes (`a:` is a thin alias for `assignee:`; a recognized scope with nothing after the colon yet — `status:` mid-keystroke — is dropped as not-yet-a-term rather than matching everything for one keystroke); `tree:<id>`/`path:<id>` are dependency focus, `#` optional (`tree:74` = `tree:#74`) — grammar in plugin/skills/web/references/map.md; bare text is a substring on title OR body OR any tag, and an unrecognized `foo:bar` prefix lands there too (searched as the literal string) rather than silently matching nothing on a typo'd field name. Round brackets group and can nest, so `tags:ui (status:doing | status:todo)` is the ui cards in doing or todo (a bracket is optional, and `(draft)` finds what `draft` finds); a quoted value matches the whole value, ignoring case, or any one element of a list, so `tags:"grill"` finds a card tagged grill and not one tagged grilling, a quoted `title:` or `body:` matches the whole field, and quoted text with no scope is a phrase in a title, body or tag, so `"two words"` does not find the words apart. Half-typed input never throws: an unclosed quote or bracket reads to the end, a stray closing bracket is ignored, and an empty alternative is dropped, so `tags:ui |` finds what `tags:ui` finds and never every card. A click on a card's assignee, tag, blocked or review cue adds its term to every alternative of what the box holds (a value with spaces is written quoted). The leading `#` that Ctrl+F prefills stays while the box holds one id being typed, and through a query such as `#12 | #14`.

The box suggests slices as you type: after `slice:` and after `..` a list under the box
shows the board's slices, the tiers in hierarchy order and then the depth numbers from 0
to the deepest card with no tier, narrowed to the names that start with what you have typed, and picking one
writes the whole term (`slice:goal..objective`). A tier named with a space is written
quoted, the quote holding both ends (`slice:"big goal..2"`). The tooltip of a Graph
caption shows the same kind of term.

**Slices in the search box** — The slices are the board's tiers (the `hierarchy:` types, top first), then the depths of the cards with no tier (the parents without a tier between a card and its nearest parent with one, or its root when none has: a card right under an epic is 0, its child 1), and an end is a tier name in any letter case or a depth number. `slice:goal` is that one slice, `slice:goal..` and `slice:..objective` leave an end open, and a reversed pair is swapped (`slice:2..objective` is `slice:objective..2`). An end the board does not have is left open, and a single unknown name, `slice:..` and a bare `slice:` cut nothing, so half-typing a name never hides every card. A board with no `hierarchy:` cuts by depth, the parents above a card (`slice:1` is the depth-1 cards), and a card nested against the hierarchy, a goal under an objective, stays in its own tier with no warning. Depth is counted over the whole board, archived cards included, so a card is in the same slice whatever a view shows. An autocomplete dropdown completes the token under the caret, inside brackets, inside quotes and after a `|` — the bare term plus every field-scoped form of it; nothing is offered once the token carries a colon, except after `slice:` and after `..`, and `tree:`/`path:`, the four above and `dlinks:`/`hlinks:` are excluded (they take a card id, not free text). After `slice:` and after `..` the dropdown lists the board's slices, narrowed to the names that start with what is typed (any letter case): the tiers of the `hierarchy:` in hierarchy order, every one it names, then the depth numbers from 0 to the deepest card with no tier. Picking a row writes the whole term (`slice:goal..objective`, the end under the caret replaced and the other end kept), and a tier named with a space is written quoted, the quote holding both ends (`slice:"big goal..2"`). The dropdown is asked with the whole board, archived cards included, the arguments the cut is made with, so what it lists is what the cut reads, and a Graph caption's tooltip shows one of these same terms.

A `|` and a bracket count only at a token's edge, so `a|b` and `fix(auth)` stay literal
text, and so does `waiting:3`, while `blocked: |review:` means `blocked: | review:`. Half-typed input never
throws, and an empty alternative is dropped rather than matching every card. Clicking a
tag, assignee, blocked or review cue on a card adds that term to every alternative of
what the box holds.

**Search panel** — the search box has an arrow at its right end that is the switch of a
panel under it. With the switch on, the default, focusing the box opens the panel. A click
on the arrow switches it off, so the panel closes and focusing the box no longer opens it,
and a second click switches it on and opens the panel now. The `p` key flips the same
switch, except while you type in a field or a menu, a dialog, the notifications panel or
the preferences sheet is up. The arrow is announced as pressed while the switch is on and
is struck through while it is off, the choice is kept in your browser per board, and the
preferences sheet shows and sets it. The panel adds nothing to the header's height. It opens with a Statuses section, the current
view's own status pills (the Map, the Gantt, the Calendar and the Graph; none on the Board), where
a tap switches a status and a right-click solos it. The search chip counts the statuses switched off, so a hidden one shows with the panel closed. Under it the panel
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
then the anchor. When the anchor is a card, path or tree you picked and the box is empty, a
click on a pill leaves the box empty, since an empty box hides nothing: the pill is on and its
matches are selected, but its query is not in the box or the address, and typing in the box
drops it. The `m` key steps through the pills: each press turns on the next pill
alone, so the box holds its query alone, in the panel's order, off, blocked, review,
waiting, then the board's own pills, then off again, and Shift+m steps backwards. It works
in every view, except while you type in a field or a menu, a dialog, the notifications
panel or the preferences sheet is up. A pill is on while its query is the anchor or an addition, and is
announced as pressed, and typing in the box turns it off. A query typed by hand is never a
pill, even one that reads as a pill's query: type `review:` and the review pill stays off. With the panel
closed, a chip in the box counts what is on, and its name for a screen reader, and its hover text, say which.
Tab reaches the chip while it is shown, between the box and the clear button, and it is no tab stop when it
is hidden (the panel open, or nothing on); Enter and Space on it open the panel, and so does a click with the
mouse, with focus on the arrow either way, and it shows the pointer hand the other header buttons show.
A held Enter acts once: the arrow ignores the repeats of a held key, so Enter held on the chip opens the
panel and does not flip the switch.
A reload, or a link, carries the box's text and not the selection, so a cut and isolate come back
but a pill shows off, with its query in the box as typed text.
The pill section folds, and *Pill section starts folded* in the preferences sheet says how
it starts. Tab goes along the bar and down the panel in the order they stand: the box, the arrow, the Isolate switch, then the fold controls and pills
section by section, ending with the fold controls of the Typing isolates and On hover show sections (a folded section's checkboxes are skipped);
Enter and Space act as a click. Esc closes the suggestion list first, then the panel (focus goes back to the
arrow, and stays in the box when Esc was pressed there), and then empties the box and the selection, when
focus is in it, or steps the selection back, which also takes the added pills back out of
the box, and with nothing selected empties it; a plain click that selects a card drops the pills the same way, but a click that opens a card changes no filter: the pills stay on, the box keeps its text, the view behind the card shows the same cards, and closing the card leaves them so. Esc leaves the switch on, so the box opens the panel again when it is next focused. The box keeps its text through the first two, because the browser's own Esc, which
clears a search field, is stopped for them. The board keeps refreshing on its poll while
the panel is open, and a pill that has focus keeps it.

**Search panel, more** — the search box has a border and an arrow at its right end (a caret) that is the switch of a panel under the box. With the switch on, the default, focusing the box (a click, Tab, `/` or Ctrl+F) opens the panel. The `p` key flips the same switch. It reads the shared key guard, so it does nothing while a text field has focus or a card menu, a dialog, the notifications panel or the preferences sheet is up; the panel is no popup, so `p` works with the panel open, and a chord (Ctrl, Cmd, Alt), Shift or a held key is not it. The arrow announces the switch with `aria-pressed` (and whether the panel is open with `aria-expanded`), and is struck through while the switch is off. An open panel adds nothing to the header's height, and a press anywhere outside the search bar closes it, leaving the switch as it was. The panel has five sections, drawn on their own: the **Statuses section** first, then the **slice section** (see **Slice section**) with its fold control, the **pill section** with its fold control, a divider, then the **Typing isolates** section and the **On hover show** section, each with a fold control like the others (`#search-typing-fold`, `#search-hover-fold`) and each folded to start. The **Isolate** switch stands in the bar, just right of the box, not in the panel (see **Isolate**); the panel has no foot. The Statuses section shows the current view's own status pills with their state, for the Map, the Gantt, the Calendar and the Graph, at every width: it is open to start and folds like the others, a tap on a pill switches that status in the view and a right-click solos it, as the view's own pills do. It is hidden on the Board, still shows when the view's filter hides every card, and never touches the selection. The search chip counts the statuses switched off in the view, named "hidden" (Archive only when it is off against the view's default), so a hidden status shows with the panel closed. On a phone its pills are 44 px tall and the panel scrolls inside a maximum height. The pill section lists the built-in pills, blocked, review and waiting, in that order, each with a count of the cards its query matches, done cards included. The counts are taken over the cards the view shows after its status pills and the Archive pill and before the search box and any cut, so turning one pill on leaves the others' counts as they were, and a status pill that is off takes its cards out of them. The pills follow the status pills' rules, with every pill off to start. A click on a pill (Shift+click is a plain click) turns that one pill on or off and leaves the others as they were. On, its query joins the box as one more alternative (`review:`, then `review: | blocked:`) and its matches join the selection: outside the Graph they are the selection and so the bulk targets, and the view shows only them while the pill has turned isolate on (Typing isolates) or lights them while it has not; in the Graph they light and nothing is hidden, and the box grows there too, so a switch to another view keeps the added cards selected. Off, its query leaves the box and its matches leave the selection; the only pill that is on turns off and clears the box. A right-click solos a pill: it alone is on and the box holds its query alone, whatever else was on or in the box; a right-click on the soloed pill turns every pill off, the pills' default (the status pills' default is all on, so theirs turns all back on). The first pill on is the **anchor** of the selection and later ones are additions, so Esc takes the later pills out first and then the anchor. The `m` key steps through the pills: each press turns on the next pill alone, as a right-click does, so the box holds its query alone, in the panel's order: off, blocked, review, waiting, then the board's own pills, then off again (that last step is the right-click on the soloed pill, every pill off). Shift+m steps backwards; with none on or several on it starts from the first pill (Shift+m, from the last), and a pill that holds a query an earlier pill holds is the same step. It works in every view, the panel open or closed, and a value pill behind a **+N more** button is shown when the step reaches it. It reads the shared key guard, so it does nothing while a text field has focus or a card menu, a dialog, the notifications panel or the preferences sheet is up; a chord (Ctrl, Cmd, Alt) or a held key is not it. A pill is on while its query is the anchor or an addition, and is announced as pressed (`aria-pressed`); typing in the box, or clearing it, turns off every pill whose query the box no longer holds (in the Graph the typed text becomes the anchor). A pill's anchor is not a typed search, so it stays the anchor when the Graph is left. With the panel closed, a chip inside the box counts what is on and its accessible name says what (`1 on: review` in the Graph, `2 on: review, isolated` where the pill turned isolate on), and the chip's hover text says it too; with nothing on there is no chip. The chip is a button: Tab reaches the chip while it is shown, between the box and the clear button, and it is no tab stop when it is hidden (the panel open, or nothing on); Enter and Space on it open the panel, and so does a click with the mouse, with focus on the arrow either way, and it shows the focus ring the arrow shows and the pointer hand the other header buttons show. The panel is no popup: the 5s poll runs while it is open and updates the pills and their counts where they stand, so a pill that has focus keeps its focus; a click on any control in it never clears a selection (each wears `data-keeps-selection`, and none wears `data-holds-poll`, which a button left focused by a click would hold for good); and the single-key shortcuts keep working. The list and its counts are worked out in `pills.js`, which needs no other module so that the snapshot can embed it, and the box grows through the search module's `searchAddAlt` and shrinks through `searchRemoveGrownAlt`, which takes out the pill's alternative and any alternative a click on a cue has grown it into (`review:` with a cue term added is `review: assignee:@human`, still the pill's), and leaves the text typed beside it.

The arrow, the Isolate switch, the fold controls and every pill are buttons, so Tab reaches them and Enter and Space act as a click.

**On hover show** — in a section of its own in the search panel, six checkboxes (`dtree`, `htree`, `dpath`, `hpath`,
`dlinks` and `hlinks`, the sets of the same names) choose which sets a hover lights. The section folds like the Slice, Pill and Status sections and starts folded; *On hover show section starts folded* in the preferences sheet says how it starts. Hovering a card, or
moving keyboard focus onto it, lights the union of the sets ticked for it, in every view: the Board, the Map, the
Calendar and the Gantt give each card of the union the hover look, and the Graph lights the union, with the lines
between its cards, and dims the rest, while the hover ring stays on the hovered card alone. Leaving the card clears
it. With nothing ticked only the hovered card takes the hover look, and the Graph lights what it lights when the pointer is on no card. The choice is
remembered per board in your browser, for each kind of Graph: the Hierarchy starts with `dlinks` and `hlinks`
ticked, which is what its hover lit before the choice existed, and the Flow the same. Every view
that is not the Flow reads the Hierarchy's choice, the Board, the Map, the Calendar and the Gantt included, even
when the Graph last showed the Flow. The panel shows the choice of the view that is on and says whose it is. The
snapshot has no hover, so it has no such section.

**On hover show, more** — in a section of its own in the search panel (`#search-hover-section`, with the fold control `#search-hover-fold`, folded to start; its legend reads `For` and carries the note), a `fieldset#search-hover` of six checkboxes (`input[data-hover-kind]`: `dtree`, `htree`, `dpath`, `hpath`, `dlinks`, `hlinks`) chooses which sets a hover or a keyboard focus lights; the legend carries `#search-hover-for`, which says whose choice the boxes show (`Flow`, or `Hierarchy and the other views`). The choice is one list of sets per graph kind, `{ "hierarchy": [...], "flow": [...] }`, kept per board in `localStorage` under `hover.show`; a value this version does not offer, a set it does not know and storage that refuses read as the default, an empty list is a choice (nothing ticked). With nothing ticked the union is empty and the Graph lights what it lights when the pointer is on no card. The sets are worked out from the whole board, archived cards included, and the Graph lights those it draws. With the defaults the Hierarchy lights what it lit before: a card and its parent, its children and the cards it waits for or that wait for it. The Flow lights the same, where before the choice it lit the card and the cards its dependencies join to it alone.

The Graph's option panel, on the right of the drawing, has the same six under **On hover**, as toggles in the style of
its other switches, in the Hierarchy and in the Flow, below Dependencies and Lanes. The toggles and the search panel's
boxes are one choice: change it in either and the other shows it at once, and a card hovered at that moment lights
again with no reload. The toggles show the choice of the kind of Graph the panel is for, so the Hierarchy and the Flow
keep their own. The other views have no option panel, so the search panel is where they set it; `Space` writes the
terms of whatever is ticked, wherever it was ticked.

Both places lay the six out as a grid of two columns and three rows, read across: `hlinks` and `dlinks`, `hpath` and
`dpath`, `htree` and `dtree`, the h sets on the left and the d sets on the right. That is only how they are shown: the
choice is kept as before, and `Space` writes the terms in the order it always did.

**Space takes the hover.** With a card hovered, else focused, `Space` writes the sets *On hover show* ticks for it
into the search box as alternatives (`dlinks:12 | hlinks:12`), the box's run of slices kept and isolate as it was.
Unlike typing, that write never turns isolate on: outside the Graph the box lights the cards it names, or hides the
rest if isolate was already on, and in the Graph it is the typed search. `Shift+Space` adds that text to what the
box holds as one more alternative, so a set can be built from several cards; an empty box takes it as a plain
`Space` does. In the Graph, with no card hovered or focused, `Space` on a hovered line writes the cards that line
lights as card terms, `#176 | #50`: a parent line its parent and its child, a dependency the card waited for and the
card that waits, a bracket its parent and its children in the order it draws them; `Shift+Space` adds them, and the
sets ticked make no difference. With no card hovered or focused, in a text field, on a button, link or switch, and behind a menu, a
dialog, the notifications panel, the preferences sheet or the notes palette, `Space` keeps its own job: it scrolls,
presses the button, or ticks a todo item. `Ctrl+Space` selects the focused card in the Graph, as a click does: it is
the key `Space` was before.

**Space takes the hover**: `onHoverSpaceKey` (`hover-show-ui.js`), one `keydown` listener on the document that reads the whole key guard (`keyGuardDetailOff`: off in a field, behind a menu, a dialog, the notifications panel, the preferences sheet or the notes palette), leaves a target that answers Space itself (`HOVER_SPACE_OWN`: an input, textarea, select, button, link, summary, contenteditable, or a `button`, `checkbox`, `switch` or `tab` role), and a key a handler already took (a todo item's tick). `hotkeySpace` (`hotkeys.js`, pure) reads the chord: Space is `write`, Shift+Space `add`, Ctrl or Cmd with Space `select`, any other chord and a held key none. A poll drops the line hover, so Space then does nothing new. `hover` is a write reason of its own, not one of `ISOLATING_REASONS` (`selection.js`), so it never turns isolate on whatever the view's Typing isolates says, and `selectionFollowingBox` treats it as a write by hand: in the Graph the written terms are the typed anchor, and a pill the box no longer holds goes off. With no card, or no set ticked, nothing is written and the key is not prevented.

**Slice section** — the region of the search panel under the Statuses section lists the board's slices, top to
bottom: the tiers some card of the board is in, each with the icon its type has in the
config, then every depth (`depth 0`, `depth 1`, ...). Each entry shows how many of the
cards the view shows it holds, counted after the status pills and Archive and before the
search box and the run, so setting a run never zeroes the entries you need to grow it again.
The entries in the run are pressed, and each one's name for a screen reader says its label,
its count and whether it is in the run. The run is the `slice:` term in the search box, so
typing one updates the entries, and a run that covers every slice writes no term. A click
on an entry outside the run grows the run to it, a click on an end of the run drops that
end, a click on a run of one brings every slice back, and a click inside the run that is not
an end changes nothing. A right-click keeps only that slice, and so do the context-menu key
and Shift+F10 on a focused entry. A run set on a query that holds `|` brackets the query, so
`tags:ui | #12` becomes `(tags:ui | #12) slice:goal..objective` and the run cuts all of it. In the
Graph the run hides the cards outside it while the rest of the query lights. The keys `[`
and `]` move the bottom of the run up and down, and `{` and `}` move its top, in every view
and with the panel open or closed; each stops at the ends, and the top never passes the
bottom. They stand still while you type in a field (the search box included) or a menu, a
dialog, the notifications panel or the preferences sheet is up. With the panel closed, the
chip counts a run that cuts. The section folds, and *Slice section starts folded* in the
preferences sheet (on by default) says how it starts. Tab reaches the fold control and every
entry, and Enter and Space act as a click.

**Slice section, more** — the region of the search panel after the Statuses section (the first region on the Board, which shows none) lists the board's slices, top to bottom: first the tiers some card of the board is in (live or archived; a tier no card is in is left out), each with the icon its type has in the config's `types:` list, then every depth (`depth 0`, `depth 1`, ...). Each entry shows its count, taken over the cards the view shows after its status pills and the Archive pill and before the search box and the run, so setting a run or turning a pill on leaves every count as it was and a run never zeroes the entries needed to grow it again. The entries in the **run** are pressed (`aria-pressed`), and each entry's accessible name states its label, its count and whether it is in the run, such as `epic, 3 cards, in the run`. The run is the `slice:` term at the top level of the query in the box, so a term edited by hand updates the entries at once; a run that covers every slice writes no term, and a single unknown name, which cuts nothing, shows every entry as pressed. A run set again replaces the one there, and a run that reaches an end of the list leaves that end open (`slice:epic..`). A run is not an alternative of the box, so turning a pill on or off, or soloing it, leaves the run where it stands. In the Graph the run's term hides the cards outside it while the rest of the query lights (see plugin/skills/web/references/graph.md), and a typed search stays the anchor, following the box. **Keys:** `[` moves the bottom of the run up and `]` moves it down, `{` moves its top up and `}` moves it down, in every view and with the search panel open or closed. They read the shared key guard, so they do nothing while a text field (the search box too) has focus or while a card menu, a dialog, the notifications panel or the preferences sheet is up, and a chord (Ctrl, Cmd, Alt) is not them (AltGr, which types the brackets on a layout with none of its own, is not a chord). With the panel closed, the chip counts a run that cuts and its name says so (`1 on: slice goal..objective`). The entries are `.slice-entry` buttons, never the pills' classes, built once and updated in place by every render (the poll's included), so an entry that has focus keeps it; Tab reaches the fold control and every entry, and Enter and Space act as a click.

**Board pills** — the pill section also lists the board's own pills, after blocked, review
and waiting, in config order. Each `pills:` entry of `config.yaml` is a query, shown as its
query, or a label and a query, shown as its label; a malformed entry is skipped. A board
pill shows a count like the built-ins and clicks as they do: a click turns it on or off,
Shift+click is a plain click, a right-click solos it and `m` steps to it after the built-ins, so
the first pill on is the anchor and a later one is an addition. A `field:*`
entry, such as `tags:*` or `assignee:*` (also `status:*`, `priority:*` and `type:*`), makes
one pill per distinct value the board's active cards hold in that field, sorted and labelled
by the value. Each matches its value exactly, so the `grill` pill never catches `grilling`
and a value with a space stays one term. The first eight values of a field show, and a
**+N more** button reveals the rest and folds them back. A pill that has focus keeps it
across the poll. Next up is not built in: it is a pill a board defines, such as
`- next: 'tags:"next-up"'`, and the plugin gives it no meaning.

A pill whose own query is a `slice:` term writes a cut, which stands at the top level of the box and cuts every view, and the cut goes with the pill when it goes off; a run of slices the box held before it is not the pill's and stays, also when it is the very cut the pill holds: the box then holds that cut twice while the pill is on, and the pill takes out its copy only (Esc's step back does the same). A `field:*` entry, such as `tags:*` or `assignee:*` (also `status:*`, `priority:*` and `type:*`), makes one pill per distinct value the board's active cards hold in that field, in the place the entry holds, sorted and labelled by the value. The first eight values of a field show, and a **+N more** button, which is no pill, reveals the rest and folds them back (it reads *fewer* while they show, and keeps its place); an open field stays open for the visit. The chip counts a pill that is on even while the button hides it.

**Isolate** — the top bar holds the **Isolate** switch, just right of the search box, so it shows with the panel shut in every view (on a phone, while the search field is open); the `i` key flips
it, except while you type in a field or a menu, a dialog, the notifications panel or the
preferences sheet is up. Turning it on shows only the selection, in every view: it writes the
selection into the search box as `part | part | ...`, each part by what it names, such as
`#12 | path:40 | tags:grill` for a card, the path through card 40 and the `grill` tag, so a card
that comes to match joins on the next refresh. The text the box held is given back when you turn it off, and a `slice:` cut in it stays. The Board, Map,
Gantt and Calendar hide what the box does not match, and so does the Graph, where a search typed with
Isolate off only lights; the Calendar and the Gantt jump to the nearest match when none is on screen. While it is
on, a click on a card moves the anchor and leaves the box and the shown cards as they are, and a
click or a double click on empty space clears nothing. With the panel closed, the chip says
*isolated*. Turn it off with the switch, `i` or Esc and the box gets its text back. Esc steps
back in three stages: isolate off, then the additions, then the anchor, and with nothing left to step
back one more Esc empties the box, a `slice:` run included; with the panel open the
first Esc closes the panel, and the second turns isolate off. The switch is announced as on or
off, and Tab reaches it, and Enter and Space flip it.

**Isolate, in detail** — The key reads the shared key guard, so it does nothing while a text field has focus or a card menu, a dialog, the notifications panel or the preferences sheet is up; the panel is no popup, so `i` works with it open, and a chord (Ctrl, Cmd, Alt), Shift or a held key is not it. A click on the switch never clears a selection. Turning isolate on writes the selection into the search box as `part | part | ...`, each part by its criterion rather than as a frozen list of cards, so a card that comes to match a query part joins on the next poll: a card is `#12`, a path `path:40`, a tree `tree:40`, and a query (a search typed or written by Explore, `dpath:185` included) is its own text, in brackets when it holds `|` or more than one term (`(tags:ui status:doing)`). A card, the path through card 40 and the `grill` tag make `#12 | path:40 | tags:grill`; a query part with a card taken out of it is already its other cards (see **Multi-select**), so it is written as them. The text the box held is given back when isolate goes off, and a run of slices in it stays in the isolate text, applied to the whole of it, because a cut hides whatever isolate is. The rest of the text is not kept beside the parts: with isolate off the box hides nothing but a cut, so the selection already holds every card, path and tree it names. With nothing selected, a query the box lights is isolated as it stands (the box keeps its text and starts to hide); with nothing to write (nothing selected and no query to isolate, or only a half-typed term) the switch stays off and a toast says nothing is selected. The Calendar and the Gantt jump to the nearest match when none is on screen, through the box writer's own listener, never on a poll. **Clicks move the anchor only**: a click on a card sets the anchor and leaves the box text and the shown set as they are (in the Graph a plain click, when nothing is isolated, writes the selection into the box in place of what it held, its cut kept, and not now), a click on the empty Graph clears nothing, and so does a double click on empty space, in every view, not the Graph alone. A pill or a slice written while isolated edits the query like a hand edit does: isolate stays on while the box holds a query, and ends when the box is left holding none (the clear button, an emptied box), when the text it kept is not given back. A keystroke typed after isolating keeps the text's leading `#`. With the panel closed the chip says **isolated**, and its name lists what else is on (`2 on: review, isolated`). Turning it off, with the switch, `i` or Esc, gives the box back the text it held, with the run of slices as the box holds it now. With the search panel open the first Esc closes the panel and the second turns isolate off; with focus in the box Esc turns isolate off rather than clearing the box, and the browser's own Esc, which clears a search field, is stopped for it.

Isolate is in the menus too. A right-click on a card inside the selection offers **Isolate** in
the menu that acts on the selection, and it does what the switch does; the menu of a card outside
the selection, and the card details' own menu, do not offer it. A right-click on the empty Graph
or Map canvas, never on a card, a link or a control, opens a small menu with that one entry in
place of the browser's own. Both read **Turn isolate off** while isolate is on. With nothing
selected the entry says so, as the switch does.

A right-click on the **empty Graph or Map canvas** (the Graph's or the Map's canvas, where no card, Graph dot, Map node, link or control is) opens the same menu with every entry but Isolate out of it (`canvas-menu` in the stylesheet), in place of the browser's own menu, and leaves the selection as it is; on any other view, or outside the canvas (a toolbar, a section header), the browser's menu shows. The entry reads **Isolate**, and **Turn isolate off** while isolate is on; with nothing selected, choosing it says so and leaves isolate off, as the switch does.

The entry mirrors the switch: it reads **Isolate**, and **Turn isolate off** while isolate is on, and with nothing selected it says so and changes nothing.

The link carries it. While isolate is on, the address holds a second parameter beside `q`,
`isolate=1`, written as the box changes and never as a history entry. A reload, or a link opened
in another browser, opens isolated: the Graph and every other view show only the isolated set.
In a view whose Typing isolates is on, while the box holds a search and Isolate is off, the address says `isolate=0`
instead, so a reload reopens the same picture, lit; a link with a search and no `isolate` parameter, an
old or hand-made one, opens isolated in a view whose Typing isolates is on. Where a view's Typing isolates is off, the Graph to start with, no parameter
means off, and none is written.
The text the box held before isolating is kept in your browser, per board, so turning isolate
off after a reload gives it back; in a browser that has none, the box ends up empty. A link with
the parameter and no query opens with isolate off, and the address drops the parameter.

**The link carries it.** While isolate is on the address holds a second parameter beside `q`, `isolate=1`, so the address is `?q=%2312+%7C+%235&isolate=1` for the box `#12 | #5`. It is written by the box's own address listener (see plugin/skills/web/references/deep-links.md), as the box changes and never as a history entry; it is dropped when isolate is off and when the box holds no query, since an isolate with no query is nothing. A reload keeps isolate on: the link opens with the switch on, the box text, the address and the chip that says isolated, and so does a link opened in another browser, where the Graph, with no dot dimmed, and every other view show only the isolated set. The text the box held before isolating is kept in the browser per board (`localStorage`, the board's `isolate.kept` entry, beside its other remembered choices), with the isolate text it goes with and whether the box's own query started the isolate (`following`, so a reload keeps the switch's isolate the switch's and a typed one a typed one), and given back when isolate is turned off after the reload; where it is unknown (no record, storage that is blocked, or a record kept for another isolate) the box ends up empty. The page works without browser storage. Opening a card while isolated keeps the parameter, and Back and Forward bring the entry they land on in line with the box, isolate included. A link with `isolate=1` and no usable `q` opens with isolate off and loses the parameter from the address on load, and any value but `1` is no request.

**Typing isolates** — the search panel's Typing isolates section holds a **Typing isolates** checkbox for each view:
Board, Calendar, Gantt, Map and Graph. Where it is on, typing in the box, a pill, a tag or assignee cue
on a card and a `?q=` link turn Isolate on by themselves, so the view hides what the box does not match.
It is on in every view but the Graph, which lights what is typed and hides nothing. Where it is off, the
box lights its matches with the look of a selected card, hides nothing, and selects nothing; the switch or
`i` still isolates the query as it stands. The choice is kept in your browser, per board. The section folds like the Slice, Pill and Status sections and starts folded; *Typing isolates section starts folded* in the preferences sheet says how it starts. Isolate turned on
this way gives back the box's text as it stands when you turn it off, so the query stays in the box, lit,
and the next Esc clears it; going to a view where the checkbox is off does the same, and coming back to a view where it
is on isolates the query again, so each view follows its own checkbox on every switch; an isolate you turned on with the switch
or `i` stays through the switches. A `slice:` cut hides
in every view whatever Isolate is.

**Typing isolates, in detail** — The clear button, the Ctrl+F prefill, a cut, a click's selection and a menu item turn nothing on, and a box that holds only a `slice:` cut has no query to isolate. An isolate the box's own query started is `{ previous, following }`: what turning isolate off gives back is the box's text as it stands, so the typed query stays in the box, lit, and the next Esc clears it; going to a view whose checkbox is unticked ends such an isolate the same way, and coming back to a view whose checkbox is ticked starts it again while the box holds a query of the person's (`isolateStartFollowing`; the picks a click mirrored into the box are no query, `searchBoxHoldsTyped`), so a view's setting decides on every switch, while an isolate the switch or `i` turned on stays. A pill taken out, by a click or by Esc, turns nothing on (the reason `unpill`).

**Notifications inbox** — the header bell surfaces messages agents leave in
`notifications.md`: a bolded TLDR, a level tint (debug / info / warning /
error), and per-entry archiving.

![Notifications inbox](images/web-notifications.png)

**Notifications** — the header bell surfaces entries from `<kanban-dir>/notifications.md` (writer contract: `/kanban`'s SKILL.md; same file shape, not a second contract): unread-count badge, a toast once per session when new unread entries arrive on the poll (toasts dismiss on click, or on their own after a few seconds), and a popup listing all entries newest-first with per-entry remove and clear-all. Opening the popup marks everything read, persisted back to the file. Entries render per the contract: the TLDR segment (the message text before `; more: `) sits bold on its own line, and the rest follows under a small More label, broken into a list at its top-level `; ` clauses when there is more than one. Code spans, card-mention chips (a mention of this board's card opens it) and `**bold**` render as DOM nodes, never HTML. The meta line shows the writer and the time as `YYYY-MM-DD | HH:MM:SS`, plus the level when it isn't `info`, and `level` tints the entry — `debug` muted with a dashed edge, `warning` amber, `error` red, absent = `info`; all levels show, no filtering. Entries missing a numeric `id` or a non-empty `message` are skipped by the reader (never fatal); the next managed rewrite (mark-read / remove / clear-all) moves their raw blocks verbatim to the archive too — deletion never happens, malformed writes included.

**Notifications file** — Any agent or script can message the human by appending an entry to `<kanban-dir>/notifications.md`; the app picks it up on its next 5-second poll and renders it per **Notifications inbox**. The writer contract — entry shape, `level` values, the TLDR-first message shape, when to write, clear = archive — is defined once, in `/kanban`'s SKILL.md; this app reads and rewrites the same file shape, it does not define a second contract.

**Create & edit** — a minimal-first form (just a title and assignee) that
expands to the full field set — status, priority, parent, rank, tags, `waiting_for`,
blocked reason, type, the date triad, and a Markdown description.

**Create** — "+ New card" opens a modal (title, status, priority, parent, rank, tags, waiting-for ids, blocked reason, review text, AI prompt, assignee, start date, end date, due date, type, description). Dependencies and impediments are separate inputs: `f-waiting` ("Waiting for (ids, comma-sep)") takes the `waiting_for` dependency edges; `f-blocked` ("Blocked (reason)") takes the impediment sticker's reason as free text and wears a red border exactly while its value passes the blocked predicate, live as you type; `f-review` ("Review (text)") takes the `review` sticker's text — same predicate, same live border in gold. `f-prompt` ("AI prompt") is a third free-text field but NOT a sticker — see **AI prompt**. Every live **expanded column header also carries a small "+"** opening the same modal pre-aimed at that column — the hidden status field submits the preset even while the form is minimal, and "Show more fields" reveals the dropdown with it selected; Archive never shows the + (you can't create an archived card), collapsed strips don't either, and the global button keeps the first-column default. Next to the "+", same gate, sits an **AI-sparkle quick-create button** — the same pre-aimed modal, opened with the AI prompt row already revealed (`enableAiPrompt()`, the same helper the modal's own sparkle toggle uses), so "queue an AI-prompt card in this column" is one click. The modal opens **minimal-first**: Title (autofocused) plus Assignee (combobox suggestions included — column "+", type title, pick `@afk`, Enter queues a card to an assignee without opening "Show more fields") and a "Show more fields" button revealing the rest — one-way per open, nothing persisted; hidden fields still submit their untouched defaults, so a minimal save produces the same card a full-form save would. In the expanded/edit form the Assignee+dates row sits right after Title, so Tab visits Title then Assignee as the first two fields — Start/End/Due on the same row, everything else after. Every date field has a 📅 calendar-picker button — manual entry stays fully legal, and picking a day preserves a typed time tail. The popover carries a 🕒 clock toggle: ON reveals a hand-rolled HH:MM control and appends it to the value (default 09:00), OFF strips it back to a bare date; disabled until a date exists to attach a time to. The server assigns the next id and writes a new `<0000-id>.<slug>.card.md` (the id's number zero-padded to the board's `idDigits`, 4 by default, e.g. `0009.new-thing.card.md`). A card whose `type` has a prefix in the config's `prefixes:` takes that prefix and its own counter (`G0001.new-goal.card.md` is card `G1`), and keeps it when its type changes later; any other card takes the next plain number.

**Edit** — The body (incl.`## Narrative`) and any frontmatter keys the form doesn't manage are preserved verbatim; the form-managed fields (status, priority, type, parent, rank, tags, waiting_for, blocked, review, prompt, assignee, start/end/due date) are re-written from the form. `parent` takes `42` or `board#42` and `rank` a number; one that reads the same as the card's own is left exactly as written, so a hand-written `parent: "fpp#4"` survives every save. Text in either that reads as nothing (not a card, not a number) is refused on its own field with a message instead of clearing the line; a blank is how a card loses its parent or rank. Clearing any managed field (a blank priority/assignee/type/parent/rank/date/prompt, empty tags or waiting_for, a blocked or review value failing the sticker predicate) removes its frontmatter line entirely — no-data fields (empty string, null, empty array) are never written, so no `tags: []` boilerplate; id, status, and `updated` are always written, any real value including priority "Normal" stays, and readers default a missing priority to Normal. The 📅 pickers work here too.

**Comboboxes** — the form's Assignee (and Priority/Tags/Type, incl. the bulk-edit popups' copies of the first two) fields suggest values from `config.yaml`'s lists (see the `kanban` skill's SKILL.md) while still accepting free text. Tab/click focuses and opens the full list; typing filters it. ArrowDown/ArrowUp move a wrapping highlight through the open menu (scrolled into view, never hidden past the menu's 180px-max-height fold), Enter picks the highlighted row, Esc closes the menu only (never bubbling into the popup-level Esc in **Speedbumps**). Enter reaches the surrounding form's native submit-on-Enter ONLY when the menu is closed — any other Enter is consumed by the menu itself (picks if something's highlighted, else just closes it) — so the keyboard flow "type title, ArrowDown+Enter to pick `@afk`, Enter to submit" takes two Enters; the mouse-pick flow (click a suggestion, then Enter) submits on one, since the mousedown pick already closed the menu.

![New-card form](images/web-new-card.png)

**AI prompt** — a hand-rolled inline-SVG sparkle button (ADR 0003 — same icon-btn styling as Save/Fullscreen/Close, tooltip "AI prompt") in the create/edit modal's header actions reveals/hides a single free-text input (`f-prompt`) writing the optional `prompt` frontmatter field (field contract: the kanban skill's SKILL.md) — a signal FROM a human TO whichever agent next processes the card, the **opposite polarity** of `blocked`/`review` (those signal from the card to a human) — including as a way to answer a `blocked` or `review` sticker without touching those fields directly. Turning the toggle ON while creating a NEW card also sets Assignee straight to `@afk`; flipping it on while editing leaves the card's assignee untouched, and the column header's AI-sparkle button lands on the same "prompt row open, assignee `@afk`" state through the same helper. That flip is the human's own form gesture — distinct from prompt *servicing*, which can never escalate a card to `@afk` (only the trusted card body may pre-authorize autonomous work). How an agent finds, consumes, and clears a queued prompt is out of scope — this app's job stops at the managed write: the lean rule (a blank clears the line), plus the value is always written **quoted** (the same contract `notifications.md`'s `message` field uses — free-form text routinely carries `:`/`#`/quotes that would corrupt an unquoted single-line value), an embedded newline collapsing to a space (frontmatter is one value per physical line). **Placement:** hidden, the row's slot sits after the Assignee+dates row, not gated behind "Show more fields", so it stays reachable from the minimal create flow. The instant it's shown — sparkle toggle or auto-reveal — the row physically moves to be the form's first field, ahead of Title: reaching for the sparkle means the prompt is the thing you're about to type. Hiding moves it back; Assignee stays the fixed 2nd focusable field whenever the row is hidden; CSS `order` is deliberately unused (Tab follows DOM order, not paint order). Opening the modal auto-reveals the row when the card being edited already carries a prompt — existing data is never hidden behind an unclicked toggle; new cards start collapsed. **Visibility:** nothing beyond the detail popup's frontmatter table, which renders the raw `prompt: "…"` line verbatim, escaped — deliberately no tile glyph, unlike every other flag field: the field's consumption lifecycle isn't built yet, so what "presence" should read as is undefined, and unbounded free-form text needs its own design pass for a board-scan cue. **One narrow exception:** a card with an EMPTY title but a prompt — e.g. written by an external process before it's been given a title — shows the sparkle + the prompt text itself in the title's own spot, everywhere a title renders: board/Archive-column tiles, map node labels and the map's No relations tiles, gantt bar text / gutter label / due-marker tooltip, calendar chips and their "+N more" overflow tooltip, the detail popup's header title, and the single-card Archive/Delete `confirm()` text. Only the tiles (board, Archive-column and the map's No relations) put the sparkle before the prompt text; every other surface shows the text alone. Every call site reuses `cardTitleDisplay()` (card-title.js) — no forked title-fallback logic anywhere — paired with a `*-prompt-fallback` CSS modifier class (italic/muted, one per surface). It never appears once the card has a real title; the snapshot's own reimplementation does not carry it. **Empty titles save** when a prompt is present: the form manages the title input's `required` dynamically — required UNLESS the prompt row is shown AND carries non-empty text, re-evaluated on every reveal/hide and every prompt keystroke. Server-side, `createCard` floors the title to "Untitled" only when BOTH trimmed title and prompt are empty (a space-only title satisfies native `required`, and a direct API caller bypasses the form entirely — without the floor a permanently blank tile could persist); a title-less card WITH a prompt saves title empty. The filename slug degrades with it: `<0000-id>.<slug>.card.md` collapses to the bare zero-padded id prefix (`0212.card.md`, no dangling `.`); a number wider than `idDigits` (past 9999 by default) gets no id prefix and the filename uses `card-<id>` to stay non-empty.

**The box shows the selection** — with isolate off, a click that selects a card writes the selection into the
search box as the text Isolate would write for it: `#34`, then `#34 | #36` as more are added, `dpath:185 | #14`
beside a path you searched, with the `slice:` run kept. Isolate stays off, so the box lights those cards and
hides nothing, and the text is the selection's own, not a search you typed: the next click still works on the
cards. Ctrl-click on a picked card takes it out and the box shows what is left; with nothing left it holds only
its `slice:` run. The Graph's plain click, Shift- and Ctrl-clicks in every view, a Flow lane header and the card
menu's Add to selection all write it, and so does a switch of view with cards picked, whenever the box is not already their text. A click that
opens a card writes nothing, and while isolate is on a click moves the anchor and leaves the box and its
isolate text. Esc takes the box down with the selection, step by step, while the box holds the selection's text.
A click never pages the Calendar or the Gantt; entering one with the box showing a selection jumps to it, as it
does for any query whose matches are off screen.

**The box shows the selection.** With isolate off a click that selects (the Graph's plain click; Shift and Ctrl/Cmd clicks in every view; a Flow lane header as its card; the card menu's Add to selection) writes the selection into the search box as the text Isolate would write for it, the `slice:` run kept (`#34`, `#34 | #36`, `dpath:185 | #14`; a part that is one query is written as it was typed). Esc's step and a double click on empty space take the box down with the selection only while it holds the selection's text; a switch of view writes the picked cards, paths and trees whenever the box is not already their text, so a search typed beside them goes as it does when a click picks (leaving the Graph with cards picked beside a typed search is one case), and leaves a typed search with nothing picked in the box for the view's Typing isolates to isolate or light. A `mirror` write never makes the Calendar or the Gantt jump to the nearest match, though entering one with the box showing a selection does, as for any query whose matches are off screen.

**Bulk actions** — select cards (click, ctrl-click, shift-click) and
right-click for a context menu: assign, set priority, edit tags, schedule,
archive, restore, delete, isolate (inside the selection only), or search the path or the tree of
the card you right-clicked, by its hierarchy or by its dependencies (on every
card's menu, whatever the selection). A
right-click on a card outside the selection opens the menu for that card alone,
leading with Peek (open its details), and leaves your
selection as it was. The menu reads Peek, Add note… (with its key, `n`, muted at the right),
Add child…, then **Edit** (Assign…, Set priority…, Edit tags…, Schedule…), **Group** (Add to
group…, Make a group from them…) and **Explore** (Isolate, **Path** and **Tree**), then
Scratchpad…, Todos… and Add to selection, and last Archive, Restore and Delete, which is never in a group.
Each of the three is a row marked ▸ that opens its entries in a panel beside it: hover it for a
moment or click it. A pointer on its way to the panel across the next row does not lose it, and a
panel with no room on the right opens on the left. The menu takes the focus when it opens and gives it
back when it closes, and its keys work only while focus is in it. Up and Down move the highlight
(Home and End go to the first and last entry), Right or Enter
on a row open its panel and highlight its first entry, Left closes the panel and returns to the
row, and Esc closes the panel first and the menu second. On a phone the panel opens under its
row, inside the menu. A group whose entries are all out (Group with no `groups:` line) is out
itself, and every entry shows when it always did. The same selection grammar works in every view, and
right-clicking inside an open card opens the same menu for that card, without Peek.

**Archive packages** — the bulk menu's **Archive selected** opens an Archive popup whose one field is the package: a combobox completing against the board's existing `archived/<package>/` folder names (`archivePackages` on `/api/board`), suggest-never-validate like every other combobox here, so a name matching nothing is a NEW package and creates `kanban/archived/<name>/`. Left empty it archives to the `archived/` root, byte-identically to the package-less paths — drag-to-Archive and the tile/detail Archive button never ask, they always write to the root. The popup closes on Esc, its X, or a backdrop click (all three cancel the archive — nothing has moved yet), and it carries no fullscreen toggle: one field has nothing to expand.

**Multi-select** — one interaction grammar, uniform across **all five views** (ADR 0006), with file-manager gestures: click a card's representation to open its detail popup (in a view the preferences sheet sets to selects, a plain click selects the card alone instead, and a double click, or Enter on a focused card, opens it), ctrl+click (cmd on mac) to toggle it in/out of the selection, shift+click to ADD the whole range between the range start (the last toggled/range-started card) and the target — in the active view's rendered order, additive, never deselecting — right-click for the bulk context menu. A selection grows from an **anchor** (one card, or one query) by **additions** (cards; the same model holds paths, trees and queries), kept in the order they were added: the first card picked is the anchor and later ones are additions, ctrl/cmd+click on a picked card takes it out (the first addition becomes the anchor when the anchor goes), and taking one card out of a query, path or tree part turns that part into its other cards. The ids the views paint and the bulk edits read are worked out again on every render and poll, for the view being shown, so the selection survives a view switch and a poll, and a card a status pill, the Archive pill or the search box hides is not in it (it is back when the view shows it again). Applies on board tiles (live and archived), map nodes and the map's No relations tiles, graph nodes, calendar chips (every chip of a multi-day run highlights together — selection is by card id), and gantt bars **and their gutter labels** alike. Each view paints its own selected marker (board/calendar/gantt: blue outline + dark wash; map: dark wash + blue glow — the node's border and status dot are unaffected; graph: an accent outline on the dot plus a glow). Exceptions: the map's muted, dashed ghost stubs are click-through-to-detail only, never selectable — they stand for cards the active filters hid; a dangling-id stub (no such card) is fully inert, and a filtered-out card can't join a selection anywhere else either.

Right-click: a card outside the selection opens a menu for that card alone and leaves the selection, and its range start, exactly as it was; the menu leads with **Peek** (opens the card's details through the same path a plain open takes, so card history takes its step, and does not touch the selection) and **Add to selection** (the card joins as an addition, or becomes the anchor of an empty selection). A card inside the selection opens the menu for the whole resolved selection, the cards a path, a tree or a pill added included, and the menu has neither Peek nor Add to selection but offers **Isolate** (see **Isolate**). Right-clicking inside an open card detail opens the same menu for the card shown, without Peek, and once an action has run the popup is read again so it shows the change (or closes if the card is gone); with text selected, or on anything that already handles the right-click itself, the browser's own menu shows instead. The card details keep the selection when they close, so a peek costs nothing. The menu — **Peek**, **Add note…**, **Add child…**, then the groups **Edit** (**Assign…**, **Set priority…**, **Edit tags…**, **Schedule…**), **Group** (**Add to group…**, **Make a group from them…**) and **Explore** (**Isolate**, **Path** and **Tree**), then **Scratchpad…**, **Todos…**, **Add to selection**, and Archive, Restore, Delete (never in a group) — acts on the menu's subject, the right-clicked card alone outside the selection and the resolved selection inside it, regardless of which view opened it. The subject is fixed when the menu opens, and a popup the menu opens acts on the cards it captured, never on the selection as it is when Apply is pressed.

A panel opens when its row is hovered for 120ms (300ms when another panel is open, so the pointer crossing the rows on its way to the open one does not swap it), when the row is clicked, and on Right, Enter or Space on it; it opens beside the row, with the class `flip` on the left when the right has no room and lifted by what it would run off the bottom (`menuSubPlacement`), and at phone width (`isPhoneWidth`, phone-width.js; the stylesheet's own `max-width: 759.98px` query) it is drawn in the flow under its row, a second tap on the row shutting it. Up and Down move the highlight among the entries that show (wrapping), Right or Enter on a row open its panel and highlight its first entry, Left or Esc shut it and return to the row, Home and End go to the first and last entry of the level; the keys work the same at the third level, where Right or Enter on Path or Tree opens its panel and Left or Esc shut that panel alone and return to its row, one level back (a `.ctx-sub` may sit in a `.ctx-sub-panel`: `menuNestTopGroups` are the menu's own groups, `menuNestAllGroups` the nested ones too, and opening a group shuts the others of its level only; from a row whose own panel is open, Left and Esc both close that panel and keep the highlight on the row); a tap opens a third-level panel in place at phone width and a second tap shuts it, Explore staying open. The group rows carry `aria-controls`, and the glyphs and hints the stylesheet draws (`content: "▸" / ""`) have empty alternative text, so they are not in an accessible name. **Add note…** shows its key as `data-hint="n"` drawn by the stylesheet, so the entry's text is its name; no other entry shows a key. The conditionally-hidden items: Peek and Add to selection show only outside the selection (Peek is also left out of the card details' own menu), Path and Tree show on every card's menu, whatever the subject, and Isolate shows only inside the selection and never in the card details' own menu; the bulk edits and Archive, Restore and Delete always render (mixed-selection handling lives inside each click handler), while Add note…, Add child…, Scratchpad…, Todos… and the Group entries show by their own conditions.

Archive and Delete keep their confirmation, which names the resolved count (Delete's is the delete popup, once for the whole selection; Archive's is skipped when every card in the batch is already done). Bulk targets are fixed when an action starts: every bulk action (assign, priority, tags, schedule, archive, restore, delete and drag) takes its list of target cards once, when it starts, from the selection as it resolves then, so writes, repaints and polls during the action never change the list. An assign on a selection holding an `assignee:@afk` query part reaches every card that matched at the start, though each write takes a card off the query, and the archive and delete confirmations name the count of that list. Assign/priority open a single-choice popup with the usual combobox suggestions (empty assignee + Apply = bulk unassign); Edit tags is a workbench — add a tag to every selected card (deduped), or tick tags in the union-with-counts list and bulk-remove them; Schedule… edits the date triad in one popup (From/To/Due, each with the form's free-text input + 📅 picker): per field, a typed/picked value sets it on every selected card, ticking *clear* blanks it (clear wins over a typed value), and an untouched field leaves each card's own value alone. Bulk edits take no confirm (Apply is the speedbump; edits are reversible) and the selection survives, so actions chain on the same batch. Dragging a selected card moves the whole selection **on the board only** (cards the doing gate refuses — waiting or blocked — are skipped per card, with one summary toast naming which gate); calendar/gantt drags always move the single card under the pointer, selected or not.

**Path** and **Tree** in Explore are rows of their own, a third level: each opens **Hierarchy** and
**Dependency**, by hover, click, tap or the keys (Right or Enter opens one, Left or Esc closes that
panel alone and returns to its row, one level back; from a row whose own panel is open, Left and Esc
both close that panel and keep the highlight on the row). The hierarchy path is the card's parents up to
its root and every card nested under it, and the hierarchy tree the whole parent tree from its root
down; both follow `parent` only. The dependency path is everything the card waits for and everything
waiting on it, transitively, and the dependency tree its connected set; both follow `waiting_for`
only. Each writes its term into the search box for the card you right-clicked (the open card, in
the card details' menu) and never for the whole selection, even when that card is inside it, so a
right-click on a card in a lit path searches that card's set alone. The terms are `hpath:<id>`,
`htree:<id>`, `dpath:<id>` and `dtree:<id>` (the `#` is optional), written as if you had typed them:
a plain pick replaces what the box held but for its `slice:` run, so the Graph lights the set and
the other views show only it; Shift (a Shift-click, or Shift+Enter on the focused item) adds the
term to what the box holds as one more alternative, `htree:40 | dpath:185`, and each item's tooltip
ends "Shift: add to the search". Isolate follows the Typing isolates of the view, as typing into the box does: where it is on, a pick turns
Isolate on and the term is its text, and where it is off the set is lit. `tree:` and
`path:`, which follow both relations, are as they were.

A Shift pick (a Shift-click, or Shift+Enter on the focused item) adds the term to the box as one more alternative (`searchAddAlt`: `htree:40 | dpath:185`, bracketing what needs it), still as if typed; with an empty box it is a plain pick. Each item's title ends "Shift: add to the search". They add nothing to the selection by hand, and isolate follows the view's Typing isolates as typing into the box does: ticked, a pick turns isolate on and the term is its text; unticked, isolate stays as it was, and with it already on the term becomes the isolate text, so Isolate on a search so written is Isolate on typed text. A typed `tree:<id>`/`path:<id>` term still works.

Two more terms name a card's direct neighbours and have no Explore item; you type them.
`dlinks:<id>` is the card, what it waits for and what waits on it, one hop
over `waiting_for` both ways; `hlinks:<id>` is the card, its parent on this board and its children, one
hop over `parent`. The `#` is optional, an unknown id matches nothing, a parent on another board, a
missing one and a self-link are no link, and archived cards count, as in the four sets above.

**Add child…** in that menu (one live card only, in every view and in the card details' own
menu) opens the New card form as **New card** does, headed "New card under #42", with Parent set
to that card. Only the new card is written, never the parent; clear the Parent field and it saves
as an ordinary root card.

It shows only when the subject is one live card (not an archived one, not a batch, not the canvas), in the card details' own menu too, and writes nothing until the form is saved, then only the new card (a parent never lists its children; clearing Parent saves a root card).

A click on empty space never touches the selection, since it can be an accident. A
double click on empty space clears it: the additions, the anchor, and the anchor's text in
the box (a pill's query or a search typed in the Graph), so the pill goes off. Esc still steps back
one stage at a time: a popup, then the additions, then the anchor, and isolate goes off before
the additions; once nothing is selected, one more Esc empties the box, a `slice:` run included, so
repeated Esc ends on a clean page. Where a double click
already does something, as it does on the Calendar's empty days and time slots, it does that
and the selection stays.

**Speedbumps** — every destructive action confirms first, naming its object: archive, delete, bulk archive/delete (one confirm per batch, with the count), notification delete and clear-all; Delete's confirmation is the delete popup, which also says what goes with the card. Restore is exempt (it's the reversible direction), except that dragging archived cards onto a live column confirms, naming how many will be restored. Clicking the backdrop closes any popup; the create/edit form interposes a confirm only when it has unsaved changes. Archiving skips the confirm when EVERY card in the action is already `done` — the tile's Archive button, drag-to-Archive (single or batch), and the bulk menu's Archive selected share one pure rule (`archiveNeedsConfirm`, selection.js); a single non-done card in the batch keeps the confirm. Archive selected then asks WHERE in the Archive popup (packages, in **Archive packages**), whose Archive button is the act itself — closing that popup cancels the whole batch. **Esc** closes whichever popup is open, on the very first press, regardless of fullscreen state — only the fullscreen toggle button changes fullscreen. The detail popup and the create/edit form (through the same unsaved-changes guard the X button uses) close directly on Esc (a form opened from a card's details returns to those details, as it does when saved or left by its X), and so do the three bulk-edit popups (Assign/priority, Edit tags, Schedule…) and the Archive popup — speedbump-exempt, same as their backdrop-click. An open combobox menu gets first crack at Esc: it closes the MENU only, one level at a time, before the popup-level handling ever sees the key. An open search panel is next: it closes on Esc, with focus back on its toggle (it stays in the box when Esc was pressed there), ahead of the selection step.

Empty space is anywhere but a card or a Graph dot, a caption of the tier fan, a button, link, text field or select, a popup or the card menu, or a control wearing the `data-keeps-selection` marker (the menu, the popups, the view toggles, the status pills and fold toggles, the roll-up bars and the Graph's controls do). A double click held with Shift, Ctrl or Cmd builds a selection and never clears one.

**Esc** steps the selection back one stage at a time: the first Esc drops every addition at once and leaves the anchor, the next drops the anchor. With isolate on, a stage comes before those: Esc turns isolate off and gives the box its text back (see **Isolate**), so the steps are isolate off, then every addition, then the anchor. The step runs only while nothing is open and nobody is typing (an open menu, popup, dialog, the notifications panel or the preferences sheet takes Esc first and closes, as before); with focus in the search box Esc ends where repeated Esc does: it empties the box, the run of `slice:` included, and leaves nothing selected, so the next click starts clean (`clearBoxAndSelection`), and away from the box Esc steps the selection back and, once nothing is picked, clears the box as well, the run of `slice:` included, so repeated Esc ends on an empty box (while isolated, Esc in the box turns isolate off instead of clearing it). An open search panel takes Esc before the step and closes (a suggestion list closes before the panel), and a pill the step drops, the added ones first and then the anchor's, goes out of the box with it, so a box grown to `review: | blocked:` is back at `review:` after the first Esc and empty after the next; any other text in the box stays through those stages and goes with the last Esc, and clearing the box with Esc in it turns off the pills it held. A plain click that selects a card (the Graph's, or a view the preferences sheet sets to selects) does the same to the pills the selection held: it replaces the selection, so the pills go off and their queries out of the box (not while isolated, when the box holds the isolate text). A click that opens a card changes no filter: every pill that is on stays on, the box keeps its text, and the view behind the card details shows the same cards; the click drops only the selection's other parts, and closing the details leaves the pills and the box as they were. Enter on a focused card, a mention and Peek never touched them. A double click is two clicks and an open: where a plain click selects (the Graph, or a view set to selects) its first click selects the card and takes the pills out, as any selecting click does, and the open that follows changes nothing. A Ctrl-click that takes out a card a pill lit turns the pill into its other cards, which the box then names, so the view does not widen under the click.

![Bulk context menu](images/web-bulk-actions.png)

**Preferences** — the gear at the right end of the header opens a sheet from the right
with two sections. *This browser* holds the settings that rarely change; they are kept in
your browser, per board, and are never written to the board's files. *This board* holds
pages that write `config.yaml`, described after the list below. On a wide window (760 px
and up) the menu and a page sit side by side; on a narrow one the menu leads to a page with a
back button.

**Preferences sheet, more** — the gear at the right end of the header opens a full-height sheet from the right with two sections. **This browser** holds the settings which rarely change (the Preferences and Hotkeys pages, **Preferences**) and **This board** holds the pages that write `config.yaml` (**Preferences**, *This board*). Each setting of This browser is kept in the browser per board (`localStorage`, in the board's own `prefs` entry beside its other remembered choices), never written to the board, and applies the moment it is chosen.

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
- *Slice section starts folded* is on by default. It says how the search panel's slice
  section starts; its fold control still unfolds it for the visit.
- *Pill section starts folded* is off by default. It says how the search panel's pill
  section starts; its fold control still folds it for the visit.
- *Status section starts folded* is off by default. It says how the search panel's Statuses
  section starts; its fold control still folds it for the visit.
- *Typing isolates section starts folded* is on by default. It says how the search panel's
  Typing isolates section starts; its fold control still unfolds it for the visit.
- *On hover show section starts folded* is on by default. It says how the search panel's
  On hover show section starts; its fold control still unfolds it for the visit.
- *Panel opens when the search box is focused* is on by default. It is the switch at the
  end of the search box, the same choice the arrow and the `p` key flip, so each shows
  what the others did. Turning it off closes the panel; turning it on here leaves the
  panel closed until the box is focused.
- *Colour Markdown while editing* is on by default. The card form's description, the
  Scratchpad's Edit box and the Todos tab's Edit box show their Markdown in colour as you type (see **Coloured
  Markdown** below); off, they are plain boxes. Unlike the settings above it is one choice
  for the whole browser, every board, not one per board.
- *Hotkeys* lists every key the page answers, each with what it does, and shows the state
  it is in for the keys that have one: `names: relevant`, `slice: all` or the cut,
  `pill: off` or the pills that are on, `isolate: off` and `panel on focus: on`. The keys
  are `/`, `Ctrl/Cmd+F`, `Esc`, `Enter`, `Space`, `Shift+Space`, `Ctrl+Space`, `Ctrl/Cmd+S`, `Alt+Enter`, `n`, `e`, `a` and `d d`, `t`, `Space` `e` `c` `d d` `Alt+Up` `Alt+Down` `Tab` `Shift+Tab` on a todo item, `Alt+1` `Alt+2` `Alt+3` `Alt+4`, `Tab` and `Shift+Tab`, `Ctrl+M`, `Ctrl+B` `Ctrl+I` `Ctrl+U` `Alt+S` `Ctrl+E` `Ctrl+K`, `Ctrl+Shift+7` `Ctrl+Shift+8` `Ctrl+Shift+.`, `Ctrl+Shift+D`, `Ctrl/Cmd+Shift+V`, `l`, `[` `]` `{` `}`,
  `Menu` and `Shift+F10` on a focused slice entry, `m` and `Shift+m`, `i`, `p` and `?`. The
  state is read each time the sheet opens, and the `panel on focus` row follows the checkbox
  at once. `?` opens the sheet at this section: it is typed, not read, while a field has
  focus, and it does nothing while a card menu, a dialog, the notifications panel or the
  sheet itself is up. The list is to read, not to change.

**More on This browser** — In a view set to selects a plain click selects the card alone, and a double click, or Enter on a focused card, opens it; ctrl/cmd+click and shift+click build the selection in every view as they always did.
**Count archived leaves as done** is on by default and feeds every roll-up: the board tile, the Map's rich row and the card detail, whose scope line says "Archived leaves count as done." or "Archived leaves are left out." A value an earlier visit saved under the retired `rollup.archived` key is not read, so a browser that kept `false` there counts archived leaves again and the sheet shows the toggle on.
**Panel opens when the search box is focused** is on by default: it is the arrow's switch, the same choice the arrow and the `p` key flip, so each shows what the others did; turning it off closes the panel, and turning it on from the sheet leaves the panel closed until the box is focused. Switching it off moves focus to the arrow only when a control of the panel had it, and leaves it where it was otherwise (the box, the sheet, the board).
**Colour Markdown while editing** is on by default and is one choice for the whole browser, not per board: it is kept under the single key `kanban.md-colour` (`'false'` or `'true'`; prefs.js `loadMdColour` and `saveMdColour`), not in a board's prefs entry, and turns the coloured Markdown boxes off and on at once (see **Coloured Markdown**).
`?` opens the sheet at this section (it is Shift with the slash key on a US keyboard), with the section brought to the top of the sheet. It reads the shared key guard unchanged: it is typed, not read, while a field has focus, and does nothing while a card menu, a dialog, the notifications panel or the preferences sheet itself is up; the search panel is no popup, so `?` works with it open, and a chord (Ctrl, Cmd, Alt) or a held key is not it.

The sheet closes with Esc, a click outside it or its close button, and focus goes back to
the gear; on a narrow window Esc first steps back from a page to the menu. While it is open
the board does not refresh under it, and `/`, `p` and Ctrl+F stand still.

**Popup and search keys** — **Alt+Enter** toggles fullscreen on whichever fullscreen-capable popup is open (detail, create/edit, the three bulk-edit popups and the notes palette) — the keyboard twin of that popup's fullscreen toggle button, updating the same persisted per-modal-type preference. Works with focus anywhere inside the popup, form fields included; an open combobox menu exempts alt-chorded Enter, so the hotkey wins there too (plain Enter keeps the menu's pick grammar). No popup open = no-op; the notifications popup isn't fullscreen-capable. **Ctrl+S / Cmd+S** saves the open popup — the keyboard twin of its Save/Apply button. Only popups with ONE unambiguous save action participate: the create/edit form and the Assign/priority and Schedule… popups; Edit tags has two competing actions (add / remove), so Ctrl+S there stays a no-op rather than guessing. The chord is strict — exactly Ctrl+S or Cmd+S; Alt or Shift chords never match (save-hotkey.js). **Ctrl+F / Cmd+F** focuses the search box instead of the browser's find bar (`preventDefault`) and pre-fills `#` with the caret right after it, so typing an id immediately forms the `#<id>` exact-match term, digits (`#42`) or a prefix and digits (`#G3`; the `#` stays while the box holds a prefix such as `G`, and goes the moment anything else is typed — erase it by hand for any other query — cheap). A box already holding a query gets select-all instead of the `#` prefill — typing overwrites it, same as any focused input — so the chord can never silently clobber a typed query (search-hotkey.js owns this decision). Suppressed while a popup is up — the mirror of Ctrl+S, which only fires *inside* an open popup: every popup's backdrop covers the whole viewport, hiding the search bar behind it, so this hotkey only fires *outside* one and the browser's native find stands in while a popup is up. It still works from inside a text field, because it types nothing. **`/`** also focuses the search box. It does insert a character, so it is off while a field has focus as well as while a popup is up. Both read one **key guard** (`key-guard.js`): a typing check (a text field, a text area, a select or an editable element has focus) and a surface check (an open card menu, an open dialog, the notifications panel or the preferences sheet). `/` reads both, and so does `p`, which flips the search panel's switch (see **Search panel**), and `?`, which opens the Hotkeys list (see **Preferences**), and `m`, which steps through the pills, and `i`, which flips Isolate (see **Isolate**), and so do `[`, `]`, `{` and `}`, which move the run of slices (see **Slice section**), and `l`, which steps the names of the tier fan (see plugin/skills/web/references/graph.md, **Options**), and `n`, which opens the notes palette (see **Notes**). Ctrl+F reads only the surface check. Esc's selection step reads the same guard, with the search box as the one text field it is for: it asks `keyGuardEscape`, which answers clear the box, step back, or leave Esc alone. The search panel is deliberately not a surface, so the keys that come with it work while it is open.

The sheet closes on Esc, on a click outside it or with its close button, and focus goes back to the gear; like the other popups it traps no Tab, so Tab from its last control leaves it. While it is open the 5s refresh does not rebuild the board under it, `/`, `p` and Ctrl+F do nothing (the shared key guard names the sheet), and a click inside it never clears a selection.

*This board* has seven pages. A save changes one line of `config.yaml`, or rewrites one whole block
(`types:`, `hierarchy:` or `prefixes:`), and leaves every other byte as it was, comments
included. Comments inside a block that is rewritten go with it, and the page does not warn
first. Every save carries the version of `config.yaml` the page read: if the file changed on
disk since, nothing is saved, and the page reads it again and says so. The version leaves out the
`nextId:` and `counters:` lines, which the board moves with every card made, so making a card
while the sheet is open is no conflict. Every page shows the file or folder it reads, with a
Copy button.

Every page of This board shows the absolute path it reads (`config.yaml` for Types, Prefixes and Counters; the folder for Logbook, Scratchpad, Todos and Groups; nothing when the feature is off) with a **Copy** button that says Copied. The block is written clean in the starter's layout; every byte outside it stays, the file's line ending included, and the comments inside the old block are dropped, with no warning. A line or a block that is not in the file yet is inserted below the nearest key before it in the config's own order (`KEY_ORDER` in `config-store.js`), else at the top. A 409 that is not a stale version (a folder locked outside the board) shows its own message under its control.

- *Logbook*, *Scratchpad*, *Todos* and *Groups* have an on/off switch and a folder field. Off removes the line; on
  writes it back with the folder. A folder is a path inside the board; one that leaves the
  board is refused. A folder you wrote by hand outside the board still works, but shows as
  locked with the reason, and the page leaves it alone. Changing a folder changes the line
  only: the files stay where they are, for you to move.
- *Groups* also has the *Iterations* switch, which gives the header its iteration dropdown.
  Turning groups off leaves the iterations line, which is ignored until groups are back,
  and iterations cannot be turned on without groups. The page lists the groups it found, by type, and opens one in the palette.
- *Types* has a switch for the display of types. Off writes `typesOn: false`, on removes the line;
  it is display only, so the web and the snapshot show no chips, colors, icons or tiers, and the
  cards and the lists stay as written. Below it, the *Hierarchy* area (the `hierarchy:` list in
  order) sits above *Other types* (the rest of `types:`). A row has a name, a color (a row of
  swatches and a hex field), an icon, its prefix shown read only with a link to the Prefixes
  page, and buttons to move it up or down, to the other area, or to remove it; a row also drags by
  its handle. Nothing is enforced: a type is in the hierarchy or it is not. *Add type* adds a name,
  and *Found on cards* lists the words cards carry in `type:` that the list lacks, each with an
  *Add* button. Every change saves at once. A color already in the file may be a name, and an icon
  one the page does not draw: it shows as written and is kept unless you edit it. Each edit changes
  only its own list: renaming or removing a type leaves the hierarchy, the prefixes and the cards
  naming the old word, and the page lists each leftover as a warning that says what and why.
- *Prefixes* is editable: each row is a prefix and the card type or groups folder it stands for,
  with Remove and an Add row, and every change asks first. A prefix change changes only the ids
  given from then on; cards already made keep their ids, and an AI can migrate the board to
  rename them. A prefix that two lines name for different targets shows a warning, because saving
  the page rewrites the block without the line the board ignores. It also lets you change
  `idDigits`, the width card file names are padded to. Only new files take the new width.
- *Counters* shows `nextId` and the `counters:` line, read only.

**More on the This board pages** — **Logbook**, **Scratchpad**, **Todos** and **Groups** each have an on/off switch (off removes the line, on writes the folder) and a folder field (saving a folder turns the feature on). The page takes a folder inside the board only, saved relative to it, and the server refuses a folder that leaves the board, the board itself, or a name that would need quoting in the file (400); a folder written by hand outside the board still works for reading and writing notes and groups, shows **locked** with the reason, and every change to it is refused (409).
**Groups** adds the **Iterations** switch (`iterations: true`): turning groups off removes only the `groups:` line (`iterations:` stays and is ignored without groups), and turning iterations on without groups is refused (409). It also lists the groups found, by type path, each opening its group in the palette, and **New group…**.
**Types** (ADR 0018) is the Types switch (`typesOn`, display only, with the hint saying so), then the **Hierarchy** area (the `hierarchy:` list in order) above **Other types** (the rest of `types:`), each a list of rows. A row has an editable name, a color (a row of swatches, the starter's colors and the status palette, with one that clears it, and a hex field; no native color popup, ADR 0003), an icon (none, or one of the six, drawn as the board draws them), its prefix shown read only with a link to the Prefixes page, and the buttons Up, Down, To Hierarchy or To Other types, and Remove. A color already in the file may be a name and an icon one this build does not draw (ADR 0004): the field shows the name as written, the swatch beside it is drawn when the browser can, and a row saves untouched unless the person edits that value. Names that differ only in capitals are separate rows, each acted on by its own spelling. A row also drags by its handle within and between the areas; the buttons do the same from the keyboard, and focus stays on the Up or Down button used (on the row's name field after To Hierarchy or To Other types, or when the move leaves that button disabled). A move rewrites `hierarchy:` only (emptying the area removes the line); Other types keep the `types:` order.
**Add type** appends a name; **Found on cards** lists the words cards carry in `type:` that the list does not have, with counts, each with **Add**. Removing a type some card carries asks first. Every change saves at once through the block route with the version the page read; saves go one after the other, each worked out from the settings the one before left. The page checks only what the person just typed: a new or renamed type's name must not match another listed type (with or without capitals) and the hex field takes a hex color or nothing. Text typed into a name, hex or prefix field and not yet saved survives a redraw. A value the server refuses (400) shows under its row; a save refused for a changed `config.yaml` (409) makes the page read again and shows one bullet saying nothing was saved and why. Each edit changes only its own list, so what else names the old word stays and shows as a warning, one bullet saying what and why: a hierarchy name no type has (also a warning chip in the Hierarchy area, with a Remove from the hierarchy button), after a rename "N cards still say `old`", and a prefix naming a type no longer listed.
**Prefixes** is editable: each row is a prefix and its card type or groups folder, with Remove, and an Add row; every change asks first and saves the `prefixes:` block, and the page says in one bullet that a prefix change changes only the ids given from then on, cards already made keep their ids, and an AI can migrate the board to rename them.

**Markdown** — a card's body in the card popup, a scratchpad's Preview and the snapshot's card
sheet all draw Markdown the same way, hand-rolled and with no dependency. Headings run from `#`
to `######`; bullet (`-`, `*`, `+`), numbered and `- [x]` task lists nest and mix, and items split
by a blank line are one loose list with their text in paragraphs; `>` quotes hold lists, headings and
code and carry on over a line with no `>` after a paragraph line; `---`, `***`, `___` and the same
marks spaced out (`* * *`) are rules; pipe tables, `---` rules, `**bold**`, `*italic*`, `***both***`, `_em_`
and `__strong__` (snake_case words stay whole), `~~strike~~`, `<u>underline</u>`, `` `code` ``,
links and bare `https://` addresses all work, and two trailing spaces or a trailing `\` break a
line. A fence opens with three or more backticks or tildes and closes on a run of the same mark at
least as long, so a longer fence can show a fence. A fence with a language (` ```c# `, ` ```ts `,
` ```mermaid `) shows it as a small label over the block with a **Copy** button that copies the
block's text, and keeps it on the block as `data-lang`; the language is cut to letters, digits and
`_+#.-`. Two libraries ride with the plugin and load only when a rendered body holds a block that
needs one: **highlight.js** (BSD-3, the common-languages build) colours a fence in a language it
knows (`c#` is `csharp`, `ts` is `typescript`, `sh` is `bash`, ...), following the page's light or dark
theme; an unknown language, plain text and an untyped fence stay plain, with no detection. **Mermaid**
(MIT) draws a ```mermaid fence as a diagram in its theme's colours; a diagram that does not parse stays a
labelled code block with one line of error under it and never breaks the rest of the body. Both redraw
when the page's theme changes, and neither is requested by a page that has no block for it. The files
sit in `plugin/skills/web/web/vendor`, each with its licence beside it, pinned to mermaid 12.2.0 and
highlight.js 11.12.0, and nothing loads from the network. The snapshot, which cannot carry them, loads
highlight.js (and its themes) from `cdnjs.cloudflare.com` and mermaid from `cdn.jsdelivr.net`, the same two
versions, lazily too, each under an SRI `integrity` hash computed from the vendored file, and draws
its diagrams in a sandboxed `srcdoc` frame like the desk's (mermaid never runs in the snapshot's page, which
builds the payload). See ADR 0020. A `<details>` line, an optional `<summary>…</summary>` line and a `</details>` line, each on a
line of its own, make a collapsible section whose body is more Markdown (sections nest; `<details open>`
starts open; with no summary the title is `[...]`). Every piece of text is escaped as it is written, so
a body holds no live tag: the only tags let through are `<u>…</u>` as a pair on one line and those
section lines exactly as written, and anything else (a `<details onclick=…>`, an unclosed section, a
`<b>`) shows as typed. A link keeps its address only for `http:`, `https:`, `mailto:`, `#` or `/`.

**Markdown body** — The only tags let through are `<u>…</u>` as a pair on one line and `<details>`, `<details open>`, `<summary>…</summary>` and `</details>` each on a line of its own (an unclosed section, an attribute other than a bare `open` or any other tag shows as typed, and a section never swallows the rest of the body). Blocks: headings `#` to `######`, bullet (`-`, `*`, `+`) and numbered lists that nest by indent depth and mix (items split by a blank line make one loose list, their text in `<p>`), `- [x]` tasks (the tick in its own span, green when done and muted when open), lazy continuation lines, `>` quotes (nested, holding lists and code, continuing over an unquoted line after a paragraph line), pipe tables (alignment by class, the CSP having no inline styles; a delimiter cell is one or more dashes), rules (`---`, `***`, `___`, spaced out too) and fenced code (``` or `~~~`, closed by a run at least as long). A blank line ends a list unless an item of it follows, and a block quote, heading, rule or fence closes every open list level. A code span holding a card mention (`board#id title`, the Card mention rule in GLOSSARY.md) renders as an accent chip instead of code; a mention of a card on this board opens that card when clicked.

Mermaid writes inline styles, which the page's Content-Security-Policy (no `unsafe-inline` anywhere)
refuses and does not loosen. A diagram is drawn instead in a frame of its own, `mermaid-frame.html`,
served with a policy of its own: the response carries `sandbox allow-scripts`, so the frame has an
opaque origin and cannot reach the page, the board or the network, its scripts are its own file and
mermaid's, and it is the one place styles may be inline. The page and the frame speak by `postMessage`
(the page ignores any message not from a frame it made), and mermaid runs with `securityLevel: 'strict'`.
A browser may send a sandboxed frame's requests with the origin `null`; the server accepts that for
the frame's own files and the vendored libraries (they are public and carry nothing of the board) and
for nothing else.

**Diagrams** — A drawn diagram replaces the block at the height the frame reports; one that does not parse, or a frame that does not answer in 20 seconds, leaves the labelled block with `Diagram error: <first line>` under it. A diagram waits for layout (mermaid measures what it draws), so one written into a popup that is not yet shown, or inside a closed `<details>`, is drawn when the browser gives it a box (a `ResizeObserver` on the block). Both libraries follow the page's theme (`data-theme` on the root, else the system's) and redraw when it changes.

**Edit from the details** — `e` with a card's details open opens its edit form, as the details' Edit button does (its tooltip names the key), with the cursor in the title field so you can type at once. It is read through the shared key guard, as `n` is: a field in the details gets the letter, it does nothing behind a menu, the edit form, the notifications panel or the preferences sheet, and with the notes palette up, which draws above the details, `e` stays the palette's (it edits the listed note). An archived card has no Edit button and no `e`.

A form opened from a card's details gives the card back. **Save** (the button or Ctrl/Cmd+S) writes the card and shows its details again with what was saved, focus on the details, and does not close the card; **Esc**, the X and a click on the backdrop leave the form and show the details as they were. When the form has unsaved changes, leaving it asks first, and cancel keeps you in the form. The details always agree with the address: if Back or Forward moved the address while the form was up, leaving the form shows the card the address names, or the board when it names none. If you open or close another card while Save is still reading the board, that choice stands and the saved card does not pull you back. A card deleted on disk while its form was up closes to the board with a toast saying the card is gone, and `?card=` leaves the address. A form opened any other way (New card, Add child…) closes to the board when saved or left.

**Notes** — with a `logbook:` line in `config.yaml`, `n` opens a palette on the card whose
details are open, else the hovered or selected card; it draws above the details, and a field in the
details gets the letter instead. While the palette is aimed at a card, a group or several cards, **Esc**
clears the chip, as the backspace does, and the palette stays open on the range it opens on with no card;
with no chip showing Esc closes it, and from its filter field Esc closes it at once. From a card's
details that is three presses: the chip, the palette, then the details. With no card, `n` on the Calendar
opens it on the Calendar's own mode and range (Month, Week, 3 days or Day), or on the day under the
pointer when the pointer is over a day (that only chooses what is listed: the note still goes to
today); anywhere else it opens on today. A card with notes wears a
small count that opens its notes, and the card menu has **Add note…**.

**Notes (logbook)** — with a `logbook:` line in `config.yaml` (the folder of the board's day files, see `plugin/skills/kanban/references/notes-kit.md`) the page keeps a **notes palette**, the one surface for notes. Without the line nothing of it shows: no count, no menu entry, and `n` only says the logbook is off. A card with notes wears a small count on its tile (live and archived); a click on it opens the card's notes. `n` opens the palette on the card whose details are open, else on the hovered card, else on the one selected card, else on nothing: on the Calendar (`loadViewMode() === 'calendar'`) with the Calendar's own sub-view and anchor as the range, or with the pointer over a day cell or column (`calendarHoverDay`, tracked by a `mouseover` on `#calendar-view`, kept nowhere) as the range (Day), the note still going to today; elsewhere on Day, today (`notesCalendarOpening`). The Calendar has no way to select a day or a range of days, and none was added. The card details are the one popup `n` works over (`keyGuardOff(document, '#detail-modal')`): any other popup, a menu, or a field with focus still turns it off. Its rows, top down: the subject row (a chip that says what the palette is about, a **date** field with the date picker's grid (`wireDatePickButton`, `data-date-only`) and a **Today** button, a time field with a menu (`notesTimeOptions`: Now, then every half hour) and a **Now** button, an *untimed* tick and a **card picker**, the form's `attachCombobox` over *no card* and the live cards in id order), the note box, the preview line that says exactly what Enter will write (`Note at 10:30 on #7 Port the zephyr schema`), the filter row (a filter field of its own, with an All, Human and AI switch beside it, and a **Grouped | Timeline** switch, kept per board in this browser as `notes.layout`), the **range** row (All, Month, Week, 3 days, Day, the ‹ and › buttons and the label) and the list of notes, grouped by day and card, newest day first, each with its time and its author, the human's included.

Type a note and press Enter: it is written into the card's day file and the palette stays open for
the next note; Shift+Enter starts a new line. The note box starts one line high and grows with its
text, typed and wrapped lines both, up to 12 lines or 40% of the window, whichever is less (30 lines or 70% of the window when the palette is full screen), and
scrolls inside past that; the box a listed note is edited in grows the same way and opens sized to
the note. The subject row sets where and when the note goes: a **date** (with a picker; Today, or the
day of the hour or all-day box the palette was opened from) beside the **time** (with a menu of Now and
the half hours; Now, or the time of the hour or card it was opened from), the *untimed* tick,
which drops the time and keeps the day, and a **card** picker, a searchable list of *no card* and the
live cards that aims the palette at the one chosen, as typing a bare `#22` and Enter does; a card id
typed in it (`22` or `#22`) aims it too, on Enter or on leaving the field. Its menu hangs off the page
and is never clipped by the palette. A leading
`10:30` sets that note's time, a leading `-` makes it untimed, and a leading `#22` aims it at another
card and wins over the picker; the line under the box says exactly which day, time and card Enter
will write. A palette left open reads the clock when it writes, not when it opened: the date and time
fields start on **Today** and **Now**, and Enter works them out when it is pressed, so a note written
after midnight, or an hour later, gets that moment's day and time. The **Today** and **Now** buttons
beside the fields (or typing the word) put a field back on it. A date or time you picked or typed is
used as it is, even when it equals today or now, and stays for the next note; a day or time the request
gave (an hour or all-day box of the Calendar, a card's time) opens as that picked value. The line under
the box says what Enter will write now, and is drawn again every 15 seconds and when the page is shown again.

**Enter** writes the note to the day in the date field (Today, to start with, or the day of the hour or all-day box the palette was opened from; a day that is not a date is said in the preview and written nowhere) at the time field's time (Now, to start with) and keeps the palette open for the next. A field on Today or Now stays on it after a write, and a date or time picked or typed is used as it is, even when it equals today or now, and stays. The page's clock tick (`clockTick`, app.js, every 15 seconds and when the page becomes visible) draws the preview again (`notesFollowClock`) and moves a subject and a range that took their day from the clock to the new today. The untimed tick drops the time and keeps the day, a leading `10:30` sets the time alone, and the preview names the day when it is not today (`noteWritePlan`, notes.js). The **card picker** shows the note's target (`noteSubjectTarget`: the card or group, `N cards` for several, `no card`, else the card Enter would write on) and a choice from its menu, which arrives through `attachCombobox`'s `onPick` option, aims the palette at that card as a bare mention and Enter does, keeping the note box's text; choosing *no card* (`noteSubjectNoCard`) makes the note about nothing whatever card was last noted, and on several cards choosing one makes it the single target. Neither has a resize grip. A leading `10:30` in the line sets that one note's time, a leading `-` or `untimed` (or the tick) makes it untimed, and a leading mention of a card (`#22`, `plan#22`) aims that one note at it and is cut from the text; a mention anywhere later is only text. A line that is only a mention, then Enter, moves the palette to that card and writes nothing; **Backspace** on an empty box clears the chip.

The list below groups the notes by day and card, newest first, with a filter field of its own
(`by:@afk` keeps one author's notes) and an All, Human and AI switch on who wrote them; a note
written in the palette stays listed whatever they say. A **Grouped | Timeline** switch beside them,
remembered per board, changes the list's shape: Timeline is one flat list, days newest first and
inside a day the timed notes in time order, then the untimed ones, each row naming its card (a link
to it, or "no card"); the filter, the switches and the keys work on it as on the grouped one. A
**range** row over the list, All, Month, Week, 3 days or Day, with ‹ and › buttons (off on All) and a
label (`Wed 21 Oct`, `19–25 Oct`; a click on it goes back to the range that holds today), limits the
list to a span of days; weeks start on Monday, as the Calendar's do. The palette opens on All for a
card, a group or several cards (so a card's whole history is listed), on Day for the day of an hour or
the all-day box it was opened from (widening the range lists the rest of it), on the Calendar's own
range or the day under the pointer for `n` there, and on Day, today for `n` anywhere else. The range
is set each time the palette opens and is no memory. It only chooses which notes are listed: the date
field decides the day a note is written to, and a note written outside the range stays listed.
`Alt+1` to `Alt+4` switch the open palette's first to fourth tab (Notes, Group, Scratchpad,
Todos, as the tab row shows them; each tab carries its key), from the note box too. On a listed
note, `e` edits it, `a` assigns it to another card (or to none) and `d d` deletes it. The palette's
header has the card details' full screen button, and `Alt+Enter` does the same while the palette is the
popup that is up, from any box of it (over the card details it toggles the palette, not the details):
full screen it fills the window, and the list, the Scratchpad tab's box and its Preview take the
height, as the Todos tab's Edit box and Preview do. The choice is kept per board; every key, tab and Esc work as before. With focus in the palette
while another popup is up, `Alt+Enter` does nothing. On a phone (under 760 px) the palette is always full screen, as the card details are: the button is not
there, a saved choice makes no difference and `Alt+Enter` does nothing. Without a
`logbook:` line nothing of this shows. The Graph's names step moved to `l` to free `n`.

A day line shows where the grouped list shows one, and so whenever more than one day is listed. The ‹ and › buttons step one unit and are off on All, a click on the label goes back to the range that holds today, and `noteListNotes` lists the subject's notes in it. It is set at every opening (`noteRangeFor`) and kept nowhere: All for a card, a group or several cards, Day of the hour or all-day box's day for those (the hour or the untimed box alone until the range is changed, then the rest of the range), the Calendar's range or the day under the pointer for `n` there, and Day, today otherwise; aiming the palette (the picker, a bare mention) opens it again for the new subject. A number past the last tab does nothing, each tab shows its key, and they work from the note box (`noteTabKey`, notes.js; Alt+Left and Alt+Right stay the browser's). The filter field narrows the list by every word typed (in the text or the card's name) and never touches the note box; `by:@afk` in it keeps one author's notes. The switch keeps the notes of human authors (the assignee registry's kind `human`, or no author at all) or of every other author, a handle the registry does not list included. **↓** moves into the list: **e** edits a note's text and time, **a** assigns it to another card or to no card (the note moves to that target's file for the same day, and a file left empty is removed), **d** twice deletes it. **Esc** clears the chip while the palette is aimed at a card, a group or several cards on its Notes tab (`notesChipClearable`: exactly what the backspace does, the range going back to the opening rule with no card), and closes the palette otherwise, from the filter field at once; the footer's Esc hint reads *clear the chip* or *close*; a press outside the palette closes it too. Every key typed in the palette stays in it, so none reaches the board's own shortcuts. The palette is no modal: the board keeps refreshing behind it, and each refresh repaints the list unless a note is being edited.

**Text boxes** — five multiline boxes take editing keys: the notes palette's note box, the box a
listed note is edited in, the Scratchpad's box, the Todos tab's Edit box and the card form's description. **Tab** indents by two
spaces (every selected line, when several are selected) and **Shift+Tab** outdents by up to two;
**Ctrl+M** switches Tab to moving focus for keyboard-only use, until the page is reloaded; a small hint
in the box always says which Tab it is now and what Ctrl+M changes ("Tab indents · Ctrl+M: Tab moves
focus"), so Tab is never a trap. On the selection, **Ctrl+B** makes bold (`**`), **Ctrl+I** italic (`*`),
**Ctrl+U** underline (`<u>`), **Alt+S** strikethrough (`~~`), **Ctrl+E** code and **Ctrl+K** a
Markdown link with the placeholder `url` selected, ready to be typed over; with nothing selected the
pair goes in with the cursor between (a link's cursor goes between its brackets). **Ctrl+Shift+7**, **Ctrl+Shift+8** and **Ctrl+Shift+.** put
a number, a bullet or a quote on each selected line, and **Ctrl+Shift+D** wraps the selected lines in a
collapsible `<details>` section with its `<summary>` text selected to type over. Each key takes its
mark off again when the selection already has it (the cursor inside a section it made, for Ctrl+Shift+D), and the browser's Undo takes any of them back in one step. Their browser
actions (view source, the address bar) are stopped only while one of these boxes has focus. Enter,
Shift+Enter, Ctrl+Enter and Ctrl+S keep what they do in each box, and the single-line fields (the
filter, the time, a combobox) keep the browser's Tab.

**Text box keys in detail** — The rules are `textEditKey(text, start, end, event)` (text-edit.js, pure): **Tab** indents two spaces at the cursor or on every selected line (a selection inside one line is replaced, a blank line stays blank, a selection ending at the start of a line leaves that line), **Shift+Tab** takes up to two spaces or a tab off; **Ctrl+B** (`**`), **Ctrl+I** (`*`), **Ctrl+U** (`<u>…</u>`), **Alt+S** (`~~`) and **Ctrl+E** (`` ` ``) wrap the selection and unwrap it when the markers are inside it or just outside it (a run of stars is italic when odd and bold from two, so italic on bold adds one star); with no selection the pair goes in with the cursor between and a cursor in an empty pair takes it away; **Ctrl+K** makes `[selection](url)` with `url` selected (`[](url)` with the cursor in the brackets when nothing is selected); **Ctrl+Shift+7**, **Ctrl+Shift+8** and **Ctrl+Shift+.** number, bullet or quote each line the selection spans (blank lines left alone, a line of the other list kind converted) or take it off when every line has it; **Ctrl+Shift+D** wraps the lines the selection spans in `<details>`, `<summary>[...]</summary>`, a blank line, the lines, a blank line and `</details>` and selects `[...]` (nothing selected: the same block on lines of its own, with an empty line for the body), and with the cursor inside a section of that shape it takes the wrapper off and selects the lines it kept. Cmd does what Ctrl does, and the digits and the period are read by key or by key position. The browser's own action for a handled key is stopped, only while the box has focus (Ctrl+U view source, Ctrl+K and Ctrl+E the address bar). **Ctrl+M** switches Tab to moving focus (VS Code's); `#text-edit-hint` shows while an attached box has focus and says which Tab it is now and what Ctrl+M changes (WCAG 2.1.2: Tab is never a trap); the mode is a module variable, kept nowhere. Enter, Shift+Enter, Ctrl+Enter and Ctrl+S are not read by these boxes' keys, so each keeps its own meaning (Enter writes a note, Ctrl+Enter saves a scratchpad or a todo list's text, Ctrl+S saves the form); none of the new keys clashes with an existing hotkey.

**Coloured Markdown** — the card form's description, the Scratchpad's Edit box and the Todos tab's
Edit box draw what you type in colour: headings, **bold**, *italic*, ~~strike~~ (struck through), `inline code` and fenced
blocks, links (a dotted line under them, as in the preview), the marks of lists, quotes, rules and tables, the `<u>`, `<details>` and
`<summary>` tags, and card mentions (`` `webapp#12 Title` `` and a bare `#12`) on the chip's ground. It is
colour and nothing else: no weight, style or size changes, so a line wraps exactly where it would in
a plain box, in the popup, full screen and on a phone. The text is still the box's own: typing, Undo,
Tab and the editing keys, Ctrl+S and Ctrl+Enter work as before, and the colours show only what the
preview would make of the text (a `**` that never closes, or a table without its delimiter row, stays
plain). A sixth-level heading stays muted, as it does in the preview, where h4 to h6 share a size and
colour is all that sets h6 apart. The notes palette's note box and the single-line fields stay plain.
**Colour Markdown while editing** in the preferences sheet turns it off and on, remembered in your browser,
one choice for every board; off, the boxes are exactly the plain boxes they were. The colours are the
`--md-edit-*` tokens in `app.css`, one set for each theme. Bold and italic are blue-greys and a
mention is a muted terracotta; in the preview, bold takes `--md-preview-bold` and a mention chip
`--mention`, so a mention reads the same wherever it is drawn.

`markdownEditSpans(text)` (markdown-edit.js, pure, tested in Node) returns the sorted, non-overlapping `{ from, to, kind }` spans to colour, reading the text a line at a time as markdown.js does: `heading` (the whole `#` line, the marks inside it keeping their own kind), `heading-six` (the same for a sixth-level one, which the preview keeps muted: h4 to h6 share a size, so colour is all that sets h6 apart), `bold`, `italic`, `strike`, `code` (inline code, and a fenced block as one span from its opening line to its closing one, or to the end of the text), `link` (`[text](address)`, an image, a bare address; drawn with a dotted line under it, `border-bottom: 1px dotted`, the preview's cue, which is no height on an inline box), `marker` (a list bullet, number or task box, a quote `>`, a rule, a table's pipes and its delimiter row, which needs the pipes of the row above it), `tag` (`<u>`, `<details>`, `<summary>`, opening and closing) and `mention` (a code span naming a card, and a bare `#12`, `board#12` or `#G3`, by the mention pattern in ids.js). It is bounded: each scan for a closing mark remembers where one failed, only the first 4000 characters of a line are read for marks (the rest keeps its block colour), and a text over 400000 characters has no spans. Under `forced-colors` the copy is hidden and the textarea is given `CanvasText` on `Canvas` by name, not left to the browser to override `transparent`. Bold and italic in the copy are blue-greys and the edit mention is a muted terracotta on a pale ground, none of them the accent. A card mention in the rendered body, notifications, notes, the scratchpad refs and the todos is `--mention` on `--mention-bg` (the accent wash); a same-board one keeps its dotted line and focus ring in `--mention`. Each pair clears 4.5:1 in both themes (theme-contrast.test.js).

**Scratchpad** — with a `scratchpad:` line in `config.yaml`, a card or a group has a disposable
page, kept as `0007.scratchpad.md` in that folder, with optional `refs:` (the notes, files and
folders it points at) and a free body. The notes palette gains a **Scratchpad** tab: open it from
the card menu's **Scratchpad…**, from a group's **Scratchpad** button, or beside Notes. It shows
the page's file, its refs and a multi-line box; **Ctrl+Enter** or **Save** writes the body. An
**Edit | Preview** switch sits over the box: Edit, the default, is the box, and Preview draws its
text, saved or not, as Markdown (see **Markdown** below). **Ctrl+Shift+V** (VS Code's preview key) flips
the switch from the box or anywhere else in the palette on that tab: to Edit it puts the cursor at the end
of the text, to Preview it keeps the palette's keys working; in the box it would only paste, as Ctrl+V does,
and off the tab it is the browser's. The two buttons show the key (`Cmd+Shift+V` on a Mac, where Cmd works as Ctrl). Text
you have not saved stays in the page until you reload it. The kanban never deletes a page: the
delete popup's **Its scratchpad** box is unticked, and only ticking it removes the page. Without a
`scratchpad:` line nothing of this shows.

**Scratchpad, more** — The notes palette gains a **Scratchpad** tab, after Notes (and after a group's Group tab); a card opens on it alone when the logbook and the todo lists are off, and opens on it from the card menu's **Scratchpad…** (one card) or the Group tab's **Scratchpad** button. The tab shows the page's file (`(not written yet)` until the first save), its refs (a mention among them is a chip that opens the card) and a multi-line box with an **Edit | Preview** switch over it (Edit, the default, is the box; Preview draws the box's text, saved or not, through `markdownInto()`, and is off until the page has loaded; **Ctrl+Shift+V** flips the switch from the box or anywhere in the palette on that tab (Cmd+Shift+V works too, and both buttons show the key for the platform); **Ctrl+Enter** or **Save** writes the body, and the frontmatter stays as written. The page is read when the tab opens, so a refresh does not redraw it under the person's hands, and text not yet saved is kept in the page until it is reloaded.

**Todos** — with a `todos:` line in `config.yaml`, a card or a group has a todo list: a Markdown
task list kept as `0007.todo.md` in that folder (`- [ ] open`, `- [x] done`, a child indented two
or more spaces or a tab under its parent), which a person or an AI can edit by hand. The folder may
be the scratchpad's: the two kinds of file never share a name. The notes palette gains a **Todos**
tab, after Scratchpad: open it with `t` on the card whose details are open, else the hovered or
selected card, from the card menu's **Todos…**, or by clicking the small count on a card tile or
group badge, which reads open over all (`2/5`) and is worked out each time, never written. In the
tab, a box adds an item at the end with **Enter**; under it, **Up** and **Down** move through the
items, and on one **Space** ticks it, `e` or **Enter** edits its text in place, `c` aims the box under it so
**Enter** in the box adds a child, `d d` deletes it with its children and the lines indented under it, and **Alt+Up** and **Alt+Down** move it
among its siblings, **Tab** indents it (it becomes the last child of the sibling above, its children along) and **Shift+Tab** outdents it (just after its parent, its children along, the siblings after it staying under the parent); on a row Tab never moves focus. A ticked item stays where it is, struck and muted, until someone deletes it:
there is no bulk clear. A held key acts once, and a change is ignored while another is on its way. An item's text is drawn as inline Markdown, and a line of the file that is
not an item shows muted and read only. The list is read again when the board refreshes, so an
edit by hand or by an agent shows, and every change names the version of the list it read: a list
changed meanwhile is refused with the reason and read again, and nothing is overwritten. A
**List | Edit | Preview** switch sits over the tab, as on the Scratchpad: List, the default, is the
list. **Edit** is the list's whole file as text, to paste a list, reorder a block or add notes
between items; **Ctrl+Enter** or **Save** writes it, and the file then holds exactly that text in its
own line endings (a list not written yet starts empty, and Save makes the file). A save names the
version of the list it read: if the list changed meanwhile, nothing is written, the reason is said and
your text stays in the box. The line under the box then says that Save again replaces the list with your
text and that List shows the list as it is now; a second save writes it over the list. **Preview** draws
the text, saved or not, as Markdown, read only, and **Ctrl+Shift+V** turns it on and off again, back
to List or Edit. Text you have not saved stays until you reload the page, and the tab opens on Edit
while there is some; with none, the box follows the list. A text over 300000 characters is refused. A todo
list means nothing to the board: it never changes a card's status or holds a card out of `doing`,
and adds into no parent's roll-up. The delete popup's **Its todo list** box is unticked. Without a
`todos:` line nothing of this shows. The mobile snapshot has no todo lists.

**Todos, the tab** — `todos:` may name the scratchpad's folder, since the two kinds of file never share a name, and each store reads only its own. The notes palette gains a **Todos** tab, last (after Scratchpad); a card opens on it alone when the logbook and the scratchpad are off. It opens from `t` (the card whose details are open, else the hovered card, else the one selected card; the key guard of `n`, the details being the one popup it works over), the card menu's **Todos…** (one card), or the small count on a card tile and on a group badge (`2/5`: open over all, shown when the list has an item, worked out on each board read and never written). The tab is a box where **Enter** adds an item at the end and the list under it: **Up** and **Down** move between the box and the rows; on a row **Space** ticks it, **e** or **Enter** edits its text in place (Enter saves, Esc puts it back), **c** aims the box under it (a chip says so; Esc clears it) so Enter adds a child, **d d** deletes it with its children and the lines indented under it, **Alt+Up** and **Alt+Down** move it among its siblings (each row also has these as buttons), **Tab** indents it (the last child of the sibling above it, its children along; with no sibling above, nothing) and **Shift+Tab** outdents it (just after its parent, its children along, the siblings after it staying under the parent; at the top level, nothing). On a row Tab never moves focus; in the box and the other fields it is the browser's. The list is read when the tab opens and read again, redrawn only if it changed, whenever the board refreshes (not while an item is being edited or a write is on its way).

**Todos Edit box, more** — Refused (409, 413), the reason is said and the text stays in the box; after a 409 the list is read again and the text names it, so a second save writes it over that list, and the `.sp-status` line says so: "The list changed on disk. Save again to replace it with this text; List shows it as it is now." **Preview** draws the box's text, saved or not, through `markdownInto()`, read only; **Ctrl+Shift+V** (`todosPreviewKey`, the Scratchpad's chord) turns it on and off, back to List or Edit, and the palette's foot names each mode's keys. Text not yet saved is kept in the page's memory per target, with the version it was read at, until the page is reloaded, and the tab opens on Edit while there is some; with none, the box follows the list (a change from List, a hand edit at a refresh).

**Iteration folders** — `logbook:`, `scratchpad:` and `todos:` may hold `<iteration>` as a whole path
segment, as in `logbook: sprints/<iteration>/.logbook`. It stands for the folder of an iteration,
named as its group file is without `.md` (`0005.sprint-496`); a folder is matched to its
iteration by the id at the front of its name, so renaming the group keeps the folder. A note for
a day and card that already have a day file joins that file, in whichever folder it is; a new
file goes to the iteration the note is aimed at, else the one whose dates hold its day (the one
that started first, if two do). A scratchpad or a todo list goes to the iteration its card or group is a member
of, else the one holding the day it is first written. With none, the segment is dropped
(`sprints/.logbook`). A file that exists is read and edited where it is, and nothing moves one:
assigning a note to another card keeps it in its folder (joining that card's day file if one
exists), except that assigning it to an iteration itself takes it into that iteration's folder.
Notes and pages are read from every folder the path can name, past iterations included. The gear
shows the path as written and, under it, the folder a new write goes to today, and it will not
save a path that starts with `<iteration>`. A write to a path with any other `<word>` is
refused, since Windows cannot make that folder; reading it stays tolerant. A path without
`<iteration>` reads as it always did.

**Iteration folders, the gear** — The gear's path bar shows both and the folder field accepts a `<iteration>` segment, as in `0005.sprint-496`.

**Variables, `<repo>` and `<card>`** — the same three paths take more words, each as a whole
segment. A `vars:` block of `name: value` lines in `config.yaml` (a name is letters, digits,
`-` and `_`) names folders once: `vars:` / `cortex: <repo>/.cortex` lets
`logbook: <cortex>/execution/<iteration>/.logbook` stand for a host's own layout. A value is a
path relative to the board or absolute, and may use the built-in words but not another
variable; the server names one that does, and a variable named like a built-in word
(`iteration`, `repo`, `card`), on stderr at startup and is not stopped by either. `<repo>` is
the git root that holds the board, the nearest folder at or above it with a `.git` entry (a
folder, or a file as in a git worktree); with none, the server names the path and that
feature is off, as if its line were absent. `<card>` is the file name of the card or group a
note, page or list is about, without its extension (`0007.fix-login`, `I0002.zephyr-2`); the
folder is matched to its target by the id at the front of its name, so renaming the card keeps
its folder, and a note about nothing drops the segment. With `<iteration>` and `<card>` side by
side, a folder both could name (`work/0007.fix-login`, a card's folder with no iteration) is
read once, as the kind its id says: an iteration's id makes it the iteration's, a card's or a
group's makes it the card's. The gear does not write `vars:` and
keeps the block as it is. Any other `<word>` is a folder name, named on stderr as a likely
typo.

**Groups** — with a `groups:` line in `config.yaml`, a card shows up to two small group badges
(`#I2 zephyr-2`, then `+N`) below its title, with the group's dates and type path as a tooltip.
A badge opens the notes palette on that group's **Group** tab, which edits its name, dates,
`auto_join` and one-line extra keys (a cleared field empties the value, a separate x removes
the key; a list or multi-line key is shown as written and left alone), takes members out, and
has **Show this group's cards**, which fills
the search box with `group:I2`. A note written on a group goes in that group's day file. The
card menu has **Add to group…** and, on two or more cards, **Make a group from them…**, which
opens a form for the short name, the folder (the group's type), the dates and `auto_join`.
**Add note…** on several cards asks for a group they all share, or offers to make one, or to
write the note on each card. `group:I2` and `group:zephyr-2` find a group's cards, a bare
`group:` every card that is in a group and `-group:` the cards that are in none. A group with
both dates and `auto_join` on is running from its start to its end, both days included, and a
card you make in the New card form while it runs joins it; the flash after saving names the
groups it joined (`Joined #I2 zephyr-2.`). A dated group without `auto_join` never takes a new
card. Without a `groups:` line nothing of this shows.

**Groups** — with a `groups:` line in `config.yaml` (the folder of the board's group files, see `plugin/skills/kanban/references/groups.md`) a card shows **badges** below its title: up to two small buttons (`#I2 zephyr-2`) and `+N` for the rest, the dates and the type path (the folders the group sits in; `(no type)` at the root) in the tooltip. A badge opens the **notes palette** on that group, on its **Group tab** (the palette then has a tab row, Notes and Group; with the logbook off a group still opens, on its Group tab alone). The Group tab edits the group's name, dates, `auto_join` (on offer only with both dates) and one-line extra keys (a cleared field keeps the key with an empty value; a separate x takes the key out; a key whose value is a list or several lines is shown as written, read only, and never rewritten), with a Save button, lists its members each with an x that takes it out (the card is never touched), and has **+ Note** (back to the Notes tab, on the group) and **Show this group's cards**, which fills the search box with `group:<id>` and closes the palette. A note written on a group lands in `<day>.<padded group id>.logbook.md`, and a group lists its own notes and its members'; a mention of a group's id (`#I2 mid check`) aims a note at it. The card menu has **Add to group…** (a dialog of the board's groups by type path; a click adds the menu's cards) and, on two or more cards, **Make a group from them…**, which opens the group form (short name, a folder from the board's folders, optional start and end dates, `auto_join`, the cards) and creates it. **Add note…** on several cards asks which group all of them share (the groups that list every one), or offers **Make a group from them…** (then note on it) and **Add the note to each card** (the palette's chip reads `each of N cards` and Enter writes one note on every card). A group file that cannot be read (no id, a repeated id, no frontmatter) or that sits more than two folders deep is skipped, named with its reason in the payload and a server warning, and never fatal. `group:<id or name>` (any letter case; a quoted name may hold a space), a bare `group:` (every card in a group) and `-group:` or `-group:<id or name>` (the cards in none, or not in that group) are search terms. A group with both dates and `auto_join: true` is running from its start to its end, both days included, by the local date of the board's server; a card made in the New card form (`POST /api/cards`) is written into the `cards:` of every running auto-join group in that same request, and no other, and the reply carries `joined` (`[{id, name}]`) so the page's flash can say `Joined #I2 zephyr-2.` A dated group without `auto_join` never takes a new card, a card edited later joins nothing, and a card the doing-gate refuses joins nothing.

**Iterations** — with `iterations: true` in `config.yaml` over a `groups:` line, the header has a
dropdown of the groups in the `iteration/` folder: All cards, the iterations newest first with
their dates, and New iteration…. It opens on the running iteration, or on All cards when none
runs. A pick narrows the Board, Calendar, Gantt, Map and Graph to its cards on top of the search
box, without writing the box or changing any group, and is kept in this browser only; a kept
pick (All cards included) yields to the running iteration once the iteration that was running
when it was made has ended. The Calendar shades the picked iteration's days and moves to its
first day when you pick it, never when the page loads. New iteration… opens the
group form with the name bumped (`zephyr-2` becomes `zephyr-3`), the dates continuing at the same
length and `auto_join` on.

**Iterations, more** — with `iterations: true` in `config.yaml` over a `groups:` line, the header beside the board name has a dropdown of the groups in the `iteration/` folder (no subtype): **All cards**, the iterations newest first, each with its id, name, dates and `running` when it is, and **New iteration…**. It opens on the running iteration (the newest one whose dates include today, both days), or on All cards when none runs. A pick narrows the Board, Calendar, Gantt, Map and Graph to the iteration's cards on top of the search box: both must say yes, the pick never writes the box, and it never changes a group or its membership. The pick is kept in this browser only (`localStorage`, not the board), with the iteration that was running when it was made; a kept pick, All cards included, beats the running iteration until that one has ended, and one whose iteration is gone falls back to the running one. The Calendar shades the picked iteration's days (an iteration with both dates) and moves to its first day when the person picks it, never on page load. **New iteration…** opens the group form in the `iteration` folder with the newest iteration's name bumped (`zephyr-2` becomes `zephyr-3`; a name with no trailing number is left blank), the dates continuing the day after its end at the same length, and `auto_join` on; the pick stays where it was.

**Delete.** Deleting a card, or a selection of cards, opens one popup that says what goes and which
groups lose the card: its id always leaves every group's list. **Its logbook** (the count of its
notes) is a box left unticked; unticked, the day files stay and read as dangling. **Its
scratchpad** is another, for a card or a group that has a page, and **Its todo list** a third. The Group tab's
**Delete group…** opens the same popup for a group, with **Its member cards**, which lists the
cards it would delete and names the ones another group holds, which it skips; ticking it
offers, unticked, those members' logbooks, scratchpads and todo lists too. Archiving never opens it.

**Delete, more** — permanently removes the card file, after the **delete popup** (the tile's and the detail's Delete…, and the right-click menu's Delete on one card or on a selection: one popup for the whole selection, so it asks once). The popup says what goes, and says which groups lose the card: its id always leaves every group's list, so no group points at a gone card. **Its scratchpad** (only when the board keeps scratchpads and the card has a page, or **Their scratchpads** with the count over a selection) deletes its page, and unticked the page stays: the kanban never deletes one otherwise. **Its todo list** (only when the board keeps todo lists and the card has one, or **Their todo lists** over a selection) is the third, the same way. A group's popup (the Group tab's **Delete group…**) deletes the group file and offers the same logbook, scratchpad and todo list boxes, plus **Its member cards**: the list shows each member it would delete and names the members another group holds as skipped, with the groups that hold them, and only the others are deleted. Ticking it offers, each unticked, **Their logbooks**, **Their scratchpads** and **Their todo lists**, counted over the members it would delete; unticked, those files stay.

**Board config: `config.yaml`** — What follows is how *this app* reads the file; the contract of each key is in `plugin/skills/kanban/SKILL.md` and `plugin/skills/kanban/references/config.md`. Optional, human-edited, per board:
```yaml
name: webapp              # BOARD NAME — heading, tab title, and the qualifier in
                          # every card mention (`webapp#28 Card title`). Must precede the
                          # assignees block: those entries carry their own INDENTED
                          # `name:`, and only a top-level key is the board name.
nextId: 28                # monotonic id counter; ids stay unique even when the
                          # max card is deleted or two writers race a max+1 scan
idDigits: 4               # the width an id's number is padded to in a file name (default 4)
prefixes:                 # a prefix for a card type; a new card of that type takes it
  G: goal                 # a value that names a groups folder is a folder, not a type
  _: .groups              # the groups: folder itself is the root (a group with no type)
  I: .groups/iteration    # a group in iteration/ is I1, I2...
counters: { G: 3 }        # one line, one counter per prefix (the web writes it)
groups: .groups           # the folder of the board's groups (absent = no groups)
assignees:                # who can own cards; feeds the form's assignee combobox
  - handle: "@human"
    name: "Human"
    kind: human           # suggested: human | ai-hitl | ai-afk (free string)
    description: "A human can grab it. Final say on trusted and destructive calls."
    color: "#58a6ff"      # OPTIONAL — reserves this handle's text color; absent = hashed
  - handle: "@hitl"
    name: "AI (HITL)"
    kind: ai-hitl
    description: "AI will grab it but needs a human in the loop (grilling, spec, tickets, approval) — it should make the AI think twice."
  - handle: "@afk"
    name: "AI (AFK)"
    kind: ai-afk
    description: "The AI can execute fully autonomously."
priorities: [High, Normal, Low]   # official list, ordered highest first
tags: [skills, config, design]    # curated tag vocabulary
statuses: [backlog, todo, doing, done]   # official COLUMN list, in board order
types:                    # suggested card types; color and icon are OPTIONAL
  - name: objective
    color: "#a371f7"
    icon: diamond         # circle | square | diamond | triangle | hexagon | star
  - story                 # bare entry = name only, neutral chip
hierarchy: [goal, strategy, objective, epic]   # the types that are the levels of the plan, top first
pills:                    # the board's own one-click search queries, in block form
  - next: 'tags:"next-up"'   # label: query
  - "assignee:@human"        # a query on its own is its own label
```
- This app is config-driven and doesn't enforce the grab semantics — it renders whatever handle a card carries.
- **`name`** IS the app heading — the board name alone, no app label in front of it (the app is a kanban; a "Kanban —" prefix only buried the one token that tells boards apart) — and it IS the tab title too (the bare name, no "Kanban" suffix, so side-by-side tabs stay tellable apart). The app only reads it: renaming a board is a human edit to `config.yaml`, and the first AI to service a nameless board seeds the key (`/kanban`'s SKILL.md carries that seeding rule). The value also namespaces this board's `localStorage` view preferences, so a rename resets collapse/sort/view state once, by design.
- **`priorities`** (ordered, highest first) drives everything positional: sort rank (unknown values sort after all known ones, ties by id), the form's priority combobox, and badge emphasis (first = hot red, last of a 3+ list = muted, middle/unknown = neutral).
- **`tags`** feeds the form's tag suggestions.
- **`types`** (block, bare-entry or inline `[a, b]` form; order kept) names the card types the board suggests, each with an OPTIONAL `color` kept as an opaque string (hex, name, anything CSS reads). It feeds the form's Type field (suggested in the order listed) and the type chip's color only: a card's `type:` may be any text, and a type outside the list still reads as a neutral chip.
- **`typesOn`** (`typesOn: false`; absent or any other value = on) is types off (ADR 0018). The page reads the two lists through one gate (`boardTypeView` in `type-badge.js`): with types off it holds no types and no hierarchy, so there is no type chip, color or icon on a tile, the Map, the Graph's dots and tints or the detail, the slices are the depths and the Graph's tier fan falls back to depth as on a board with no hierarchy, and the edit form's Type field is hidden. The form then sends no `type`, so a save leaves a card's `type:` line as written. Turning types back on shows everything again; nothing in the cards or the lists changed.
- **`assignees[].color`** (OPTIONAL) reserves a fixed text color for that handle, mirroring `statuses`' own color rule exactly: reserved wins; absent, the handle hashes into the SAME 8-color `STATUS_PALETTE` custom statuses use (reusing status-colors.js's hash — not a forked one), so every assignee gets a stable color with zero state to store. A hashed color follows the theme like a status does; a reserved color paints exactly as written in both themes, so pick one that reads on light and dark grounds. See `plugin/skills/web/references/card-rendering.md`, **Assignee text color**, for where it renders.
- **`statuses`** (inline or block form) IS the live column set, in order — board columns, drag targets, per-column sort/collapse defaults (priority-desc, or Outline on a board that nests, / expanded for live columns, id-asc / collapsed for Archive), the form's status dropdown, and the gantt's group order all follow it.
- The app never creates `config.yaml` on its own.
- With a counter, new-card ids come from `max(nextId, scanMax+1)` (a stale counter self-heals rather than re-issuing a taken id) and the advanced counter is written back atomically.
- **`groups`** (a folder, relative to the board; absolute when written by hand) turns groups on: the board payload then carries `groups: { folder, list, skipped, folders, prefixes }`, every group file under it (see **Groups**) and the files it skipped and why. Absent, the payload carries `groups: null` and nothing of it shows. A `prefixes:` value names a groups folder when it is that `groups:` folder itself (the root, `_: .groups`, which has no slash) or a path under it (`I: .groups/iteration`), or any path with a slash read relative to the groups folder (`W: workflow/`); a bare word is a card type.
- **`todos`** (a folder, relative to the board; absolute when written by hand) turns todo lists on: the board payload then carries `todos: { folder, targets, counts }` and the page shows the palette's Todos tab. Absent, the payload carries `todos: null` and nothing of it shows.
- **`scratchpad`** (a folder, relative to the board; absolute when written by hand) turns scratchpads on: the board payload then carries `scratchpad: { folder, targets }` and the page shows the palette's Scratchpad tab. Absent, the payload carries `scratchpad: null` and nothing of it shows.
- **`logbook`** (a folder, relative to the board; absolute when written by hand) turns the logbook on: the board payload then carries `logbook: { folder, notes }`, every note of the day files in it, and the page shows the notes palette. Absent, the payload carries `logbook: null` and nothing of it shows.

## Other surfaces

The **[mobile snapshot](snapshot.md)** is the tap-through board for a phone or
tablet. See [`GLOSSARY.md`](../GLOSSARY.md) for the full parity table across
every surface.
