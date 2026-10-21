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

Each column header carries a sort dropdown (id / priority / due / last-modified
/ assignee / outline), a collapse toggle, and a `+` to create a card straight into
that column. Outline puts a parent before its children and siblings in `rank`
order; it is the default sort on a board where any card has a `rank` or a
`parent`, except in the Archive column, which keeps id order. In an Outline column, dragging a card between two siblings writes its `rank`:
one card when there is room between the neighbours, that parent's children renumbered
in tens when there is not. The search box up top filters every view at once, except the
Graph, which lights its matches and hides nothing but a `slice:` cut. Enter in the search box
goes to the first match, and a second Enter opens it when it is the only one.

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
a fold remembered from before the panel is ignored. The Graph keeps its layouts, its zoom and its Options section in a
panel the same way. At every width the Graph's drawing starts right under the header: its card count and key sit behind an (i) button, off by default and remembered per board, and the (i) and the option button float in the drawing's top-right corner, as the Map's option button does in the Map's, staying put while the Map scrolls. The status pills of the Map and the Graph are in the search panel's Statuses section. The
panel is open from 760 px wide and closed below it, where it opens over the view as a
sheet with a close button of its own and adds no sideways scroll. The choice is
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

## Graph

The **Graph** view (the header's "Graph" button) draws every card at once as
a dot, joined by its relations: a solid line from a parent to its child, a
dashed arrow from a card to the card that waits for it. Three layouts, remembered
per board, with **Tiers** first:

- **Tiers** draws a fan all the way round the centre, but for a narrow seam at
  the top: a band for each tier of the board's
  `hierarchy:`, tier 1 innermost, then a ring for each depth that holds a card
  without a tier; each tree gets its own sector, loose cards with a tier share
  one, and the other loose cards sit in an Unnested block outside the fan, a
  column for each status, when the Unnested option is table (by default they are on a ring
  outside the fan: see the option row below). Each band has a faint arc and a caption with its name
  up the seam at the top, there is a divider between sectors, and the Unnested
  block is titled and each column is captioned with its status. Each tier band that
  holds a card is washed in its type's colour, a neutral wash when the type has none,
  behind the lines and the dots; depth rings, the Unnested ring and the Unnested block
  are not washed, and a click on a wash is a click on empty space. A caption shows
  its name alone; hovering it, or moving keyboard focus onto it, shows a tooltip
  with its count, its split by status and the `slice:` term that cuts to it. Fit
  and the first draw frame all of it.
- **Force** pulls related cards together and rings the unrelated ones round the
  edge.
- **Status** makes one ring per status, with the last column innermost (done,
  doing, todo, backlog from the centre out). Archived cards form a second group
  when the Archive pill is on.

Tiers has an option row in the option panel beside the fan: Lines (folded, chain,
all, off), Dependencies (on, off), Order (status, rank), Names (relevant, all, none)
and Unnested (outermost, off, depth 0, table). Folded, the default, draws a line to the
end of each dependency chain and one counted line for a parent's other children on one
ring. Names puts a card's title on the fan: relevant, the default, names the
selection, what it lights and the highest parents, all names every card and none names
no card; the l key steps through them. A parent's name sits beside its ring; every other
name sits in a row outside the rim, joined to its dot by a leader, and the Unnested
block's names in a list above it. Names stay upright and the same size at any zoom and
keep off the lines, the dots and each other, though a leader may pass under one; a card
with no room goes unnamed, which can leave the block's left-hand columns unnamed.
Unnested says where the cards with no parent, no children and no tier are drawn: on one
ring outside the fan by default, not at all, on the depth 0 ring, or in the block outside
the rim. The row's choices are kept per board.

A dot takes its status colour, grows with its relations, goes hollow when done
and dim when archived. A type that has an `icon:` in the board's `types:` list draws its dot
in that outline (circle, square, diamond, triangle, hexagon or star), still in the status
colour, and starts its chip with it wherever a chip is drawn; an icon is a shape, never a
colour, and a type with no icon, or an unknown name, keeps the round dot. A ring around it
means children; red is blocked, amber waiting, gold review. Hover or focus a dot to light
that card and its relations and dim the rest. Click selects a dot and keeps its relations lit while it is the
only card picked; shift-click or ctrl-click adds one card or takes it out, and a
selection of several lights exactly its cards. Double-click (or Enter) opens the
card; right-click works as on the board.

A search typed in the Graph hides nothing: its matches light, done cards included,
and the rest dims. Only a `slice:` term on its own in the query cuts the Graph, as it
cuts every view; under `|` it lights. Empty the box, press Esc or double-click the empty Graph to drop it;
click a card to start a new selection and clear the box but for its cut. Switch to another view and
the box goes on filtering there, while nothing is selected by it. In Force, drag a dot and the cards related to it follow, like pulling on
a thread; the arrangement stays until the cards change or the page reloads.
Drag the background to pan, scroll or use `−`, `+` and **Fit**, in the options panel, to zoom.
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

The box suggests slices as you type: after `slice:` and after `..` a list under the box
shows the board's slices, the tiers in hierarchy order and then the depth numbers from 0
to the deepest card with no tier, narrowed to the names that start with what you have typed, and picking one
writes the whole term (`slice:goal..objective`). A tier named with a space is written
quoted, the quote holding both ends (`slice:"big goal..2"`). The tooltip of a Graph
caption shows the same kind of term.

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
it starts. Tab reaches the arrow, the fold control and every pill, and Enter and Space act
as a click. Esc closes the suggestion list first, then the panel (focus goes back to the
arrow, and stays in the box when Esc was pressed there), and then clears the box, when
focus is in it, or steps the selection back, which also takes the added pills back out of
the box; a plain click that selects a card drops the pills the same way, but a click that opens a card changes no filter: the pills stay on, the box keeps its text, the view behind the card shows the same cards, and closing the card leaves them so. Esc leaves the switch on, so the box opens the panel again when it is next focused. The box keeps its text through the first two, because the browser's own Esc, which
clears a search field, is stopped for them. The board keeps refreshing on its poll while
the panel is open, and a pill that has focus keeps it.

**Slice section** — the first region of the search panel lists the board's slices, top to
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

**Isolate** — the foot of the search panel holds the **Isolate** switch, and the `i` key flips
it, except while you type in a field or a menu, a dialog, the notifications panel or the
preferences sheet is up. Turning it on shows only the selection, in every view: it writes the
selection into the search box as `part | part | ...`, each part by what it names, such as
`#12 | path:40 | tags:grill` for a card, the path through card 40 and the `grill` tag, so a card
that comes to match joins on the next refresh. The text the box held is kept, and where it was
hiding cards a picked path or card would bring back, it stays beside them in the box
(`path:40 tags:ui`), so those cards stay hidden. The Board, Map,
Gantt and Calendar show only the matches, and so does the Graph, where a typed search only
lights; the Calendar and the Gantt jump to the nearest match when none is on screen. While it is
on, a click on a card moves the anchor and leaves the box and the shown cards as they are, and a
click or a double click on empty space clears nothing. With the panel closed, the chip says
*isolated*. Turn it off with the switch, `i` or Esc and the box gets its text back. Esc steps
back in three stages: isolate off, then the additions, then the anchor; with the panel open the
first Esc closes the panel, and the second turns isolate off. The switch is announced as on or
off, and Tab reaches it, and Enter and Space flip it.

Isolate is in the menus too. A right-click on a card inside the selection offers **Isolate** in
the menu that acts on the selection, and it does what the switch does; the menu of a card outside
the selection, and the card details' own menu, do not offer it. A right-click on the empty Graph
or Map canvas, never on a card, a link or a control, opens a small menu with that one entry in
place of the browser's own. Both read **Turn isolate off** while isolate is on. With nothing
selected the entry says so, as the switch does.

The link carries it. While isolate is on, the address holds a second parameter beside `q`,
`isolate=1`, written as the box changes and never as a history entry. A reload, or a link opened
in another browser, opens isolated: the Graph and every other view show only the isolated set.
The text the box held before isolating is kept in your browser, per board, so turning isolate
off after a reload gives it back; in a browser that has none, the box ends up empty. A link with
the parameter and no query opens with isolate off, and the address drops the parameter.

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
archive, restore, delete, isolate (inside the selection only), or add a dependency tree/path to
the selection. A
right-click on a card outside the selection opens the menu for that card alone,
leading with Peek (open its details), and leaves your
selection as it was. The menu reads Peek, Add note… (with its key, `n`, muted at the right),
Add child…, then **Edit** (Assign…, Set priority…, Edit tags…, Schedule…), **Group** (Add to
group…, Make a group from them…) and **Explore** (Isolate, Dependency tree, Dependency path), then
Scratchpad… and Add to selection, and last Archive, Restore and Delete, which is never in a group.
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

**Add child…** in that menu (one live card only, in every view and in the card details' own
menu) opens the New card form as **New card** does, headed "New card under #42", with Parent set
to that card. Only the new card is written, never the parent; clear the Parent field and it saves
as an ordinary root card.

A click on empty space never touches the selection, since it can be an accident. A
double click on empty space clears it: the additions, the anchor, and the anchor's text in
the box (a pill's query or a search typed in the Graph), so the pill goes off. Esc still steps back
one stage at a time: a popup, then the additions, then the anchor, and isolate goes off before
the additions. Where a double click
already does something, as it does on the Calendar's empty days and time slots, it does that
and the selection stays.

![Bulk context menu](images/web-bulk-actions.png)

**Preferences** — the gear at the right end of the header opens a sheet from the right
with two sections. *This browser* holds the settings that rarely change; they are kept in
your browser, per board, and are never written to the board's files. *This board* holds
pages that write `config.yaml`, described after the list below. On a wide window (760 px
and up) the menu and a page sit side by side; on a narrow one the menu leads to a page with a
back button.

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
- *Panel opens when the search box is focused* is on by default. It is the switch at the
  end of the search box, the same choice the arrow and the `p` key flip, so each shows
  what the others did. Turning it off closes the panel; turning it on here leaves the
  panel closed until the box is focused.
- *Hotkeys* lists every key the page answers, each with what it does, and shows the state
  it is in for the keys that have one: `names: relevant`, `slice: all` or the cut,
  `pill: off` or the pills that are on, `isolate: off` and `panel on focus: on`. The keys
  are `/`, `Ctrl/Cmd+F`, `Esc`, `Enter`, `Space`, `Ctrl/Cmd+S`, `Alt+Enter`, `n`, `e`, `a` and `d d`, `Alt+1` `Alt+2` `Alt+3`, `Tab` and `Shift+Tab`, `Ctrl+M`, `Ctrl+B` `Ctrl+I` `Ctrl+U` `Alt+S` `Ctrl+E` `Ctrl+K`, `Ctrl+Shift+7` `Ctrl+Shift+8` `Ctrl+Shift+.`, `Ctrl+Shift+D`, `Ctrl/Cmd+Shift+V`, `l`, `[` `]` `{` `}`,
  `Menu` and `Shift+F10` on a focused slice entry, `m` and `Shift+m`, `i`, `p` and `?`. The
  state is read each time the sheet opens, and the `panel on focus` row follows the checkbox
  at once. `?` opens the sheet at this section: it is typed, not read, while a field has
  focus, and it does nothing while a card menu, a dialog, the notifications panel or the
  sheet itself is up. The list is to read, not to change.

The sheet closes with Esc, a click outside it or its close button, and focus goes back to
the gear; on a narrow window Esc first steps back from a page to the menu. While it is open
the board does not refresh under it, and `/`, `p` and Ctrl+F stand still.

*This board* has six pages. A save changes one line of `config.yaml`, or rewrites one whole block
(`types:`, `hierarchy:` or `prefixes:`), and leaves every other byte as it was, comments
included. Comments inside a block that is rewritten go with it, and the page does not warn
first. Every save carries the version of `config.yaml` the page read: if the file changed on
disk since, nothing is saved, and the page reads it again and says so. The version leaves out the
`nextId:` and `counters:` lines, which the board moves with every card made, so making a card
while the sheet is open is no conflict. Every page shows the file or folder it reads, with a
Copy button.

- *Logbook*, *Scratchpad* and *Groups* have an on/off switch and a folder field. Off removes the line; on
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
sit in `skills/web/web/vendor`, each with its licence beside it, pinned to mermaid 12.2.0 and
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

Mermaid writes inline styles, which the page's Content-Security-Policy (no `unsafe-inline` anywhere)
refuses and does not loosen. A diagram is drawn instead in a frame of its own, `mermaid-frame.html`,
served with a policy of its own: the response carries `sandbox allow-scripts`, so the frame has an
opaque origin and cannot reach the page, the board or the network, its scripts are its own file and
mermaid's, and it is the one place styles may be inline. The page and the frame speak by `postMessage`
(the page ignores any message not from a frame it made), and mermaid runs with `securityLevel: 'strict'`.
A browser may send a sandboxed frame's requests with the origin `null`; the server accepts that for
the frame's own files and the vendored libraries (they are public and carry nothing of the board) and
for nothing else.

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

Type a note and press Enter: it is written into the card's day file and the palette stays open for
the next note; Shift+Enter starts a new line. The note box starts one line high and grows with its
text, typed and wrapped lines both, up to 12 lines or 40% of the window, whichever is less (30 lines or 70% of the window when the palette is full screen), and
scrolls inside past that; the box a listed note is edited in grows the same way and opens sized to
the note. The subject row sets where and when the note goes: a **date** (with a picker; today, or the
day of the hour or all-day box the palette was opened from) beside the **time**, the *untimed* tick,
which drops the time and keeps the day, and a **card** picker, a searchable list of *no card* and the
live cards that aims the palette at the one chosen, as typing a bare `#22` and Enter does; a card id
typed in it (`22` or `#22`) aims it too, on Enter or on leaving the field. Its menu hangs off the page
and is never clipped by the palette. A leading
`10:30` sets that note's time, a leading `-` makes it untimed, and a leading `#22` aims it at another
card and wins over the picker; the line under the box says exactly which day, time and card Enter
will write.

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
`Alt+1`, `Alt+2` and `Alt+3` switch the open palette's first, second and third tab (Notes, Group,
Scratchpad, as the tab row shows them; each tab carries its key), from the note box too. On a listed
note, `e` edits it, `a` assigns it to another card (or to none) and `d d` deletes it. The palette's
header has the card details' full screen button, and `Alt+Enter` does the same while the palette is the
popup that is up, from any box of it (over the card details it toggles the palette, not the details):
full screen it fills the window, and the list, the Scratchpad tab's box and its Preview take the
height. The choice is kept per board; every key, tab and Esc work as before. With focus in the palette
while another popup is up, `Alt+Enter` does nothing. On a phone (under 760 px) the palette is always full screen, as the card details are: the button is not
there, a saved choice makes no difference and `Alt+Enter` does nothing. Without a
`logbook:` line nothing of this shows. The Graph's names step with `l`.

**Text boxes** — four multiline boxes take editing keys: the notes palette's note box, the box a
listed note is edited in, the Scratchpad's box and the card form's description. **Tab** indents by two
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

**Iteration folders** — `logbook:` and `scratchpad:` may hold `<iteration>` as a whole path
segment, as in `logbook: sprints/<iteration>/.logbook`. It stands for the folder of an iteration,
named as its group file is without `.md` (`0005.sprint-496`); a folder is matched to its
iteration by the id at the front of its name, so renaming the group keeps the folder. A note for
a day and card that already have a day file joins that file, in whichever folder it is; a new
file goes to the iteration the note is aimed at, else the one whose dates hold its day (the one
that started first, if two do). A scratchpad goes to the iteration its card or group is a member
of, else the one holding the day it is first written. With none, the segment is dropped
(`sprints/.logbook`). A file that exists is read and edited where it is, and nothing moves one:
assigning a note to another card keeps it in its folder (joining that card's day file if one
exists), except that assigning it to an iteration itself takes it into that iteration's folder.
Notes and pages are read from every folder the path can name, past iterations included. The gear
shows the path as written and, under it, the folder a new write goes to today, and it will not
save a path that starts with `<iteration>`. A write to a path with any other `<word>` is
refused, since Windows cannot make that folder; reading it stays tolerant. A path without
`<iteration>` reads as it always did.

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

**Delete.** Deleting a card, or a selection of cards, opens one popup that says what goes and which
groups lose the card: its id always leaves every group's list. **Its logbook** (the count of its
notes) is a box left unticked; unticked, the day files stay and read as dangling. **Its
scratchpad** is another, for a card or a group that has a page. The Group tab's
**Delete group…** opens the same popup for a group, with **Its member cards**, which lists the
cards it would delete and names the ones another group holds, which it skips; ticking it
offers, unticked, those members' logbooks and scratchpads too. Archiving never opens it.

## Other surfaces

The **[mobile snapshot](snapshot.md)** is the tap-through board for a phone or
tablet. See [`GLOSSARY.md`](../GLOSSARY.md) for the full parity table across
every surface.
