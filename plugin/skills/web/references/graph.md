How the Graph view works in its Hierarchy graph (the tier fan): bands, rings, captions, names, options, lighting, the address and the phone sheet.

**Graph view** — a top-bar "Graph" button (a line icon, then the word; `aria-pressed`; it reads "Board view" with the Board icon
while the graph is up) swaps the board for the **Graph**: every card at once as a dot,
joined by its relations. The Hierarchy draws the **tier fan**, which this entry calls
**Tiers** where an option or a key names it; it opens first and is the default for any
unknown saved value. The centre is the apex and the fan goes all the way round the centre but for a narrow **seam**
straight up, a **band** for each tier of the
board's `hierarchy:` that holds a drawn card, tier 1 innermost, then a **ring** for each depth that holds a card
without a tier (a card whose type is not in the hierarchy, or that has none), counted
from the nearest tier card above, so the first ring is the cards right under a tier card.
A depth with no such card has no ring, and neither has a tier with no drawn card: its band, arc and
caption are not drawn and the rings left close up, with Types on or off, so a board with no
cards draws no ring, and a `slice:` cut that leaves out the top tiers pulls the fan in to the
rings it keeps, the dividers between sectors starting at the first ring drawn. A card is in
the band of its slice, worked out from the whole board, so a hidden or archived parent
never moves it, and a tier 1 card under the lowest tier sits in its own tier's band,
with no warning. Each band and each ring has a faint **guide arc** and a **caption** on
the seam with its name (a tier by its name, a depth as
`depth N`), standing one above another up the seam with neighbours on opposite
sides of the seam so they never touch; a tier or a
depth with no drawn card draws nothing; a tier whose cards nest in one another gets a lighter
arc through each further row. Each tier band that holds a card is washed in its type's
colour (the `color:` of that type in the board's `types:` list), one **wash** across its
whole ring, behind the lines, the dots and the captions, so the hierarchy reads as coloured
areas; a tier whose type has no colour gets a neutral wash, and a depth
ring, the Unnested ring and the Unnested block get none (a tier with no drawn card has no band, so no wash). The wash takes no click: a click or
a double click on it is a click on empty space. A `slice:` cut, a status pill and isolate keep
the washes of the bands still drawn and drop those of the bands they leave empty. A caption shows its name alone: hovering it, or moving
keyboard focus onto it (a caption is a tab stop), shows a **tooltip** with the number of
its cards, how they split by status (`backlog 1 · doing 1`) and, for a tier or a depth, the
`slice:` term that cuts to it (`slice:epic`, `slice:1`). The tooltip stands under the
caption, kept on the stage, and goes when the pointer or focus leaves or the view pans or
zooms. A root and the cards nested under it take a **sector**
of the fan, its width following the arc its leaves need. A divider separates each sector
from the next; loose cards with a tier share a sector of their own, and the sector of
loose cards with a tier has its own caption, outside the rim, whose tooltip counts them. The other **unnested** cards (no
parent, no children and no tier) are drawn as the Unnested option of the option row says
(see **Options**): on one ring outside the fan by default, or, with the table choice, in the **Unnested** block outside the rim, a
column for each status in the board's order, archived cards last: the block is under the
title Unnested, each column captioned with its status, with an
archived column while the Archive status pill is on; the tooltips of the title and of a
column count their cards. Fit and the first draw frame the
whole circle, every dot, every caption and the Unnested block, and no two captions
overlap, in every mode of the Unnested option. On a board with no hierarchy every
slice is a depth, so Tiers draws a ring for each depth.
**A dot** shows the card's status colour (the same fixed hues and palette as the rest
of the app), is bigger the more relations the card has, is hollow when the card is
`done`, and is dimmed when archived. A type with an icon draws its dot in that outline
(circle, square, diamond, triangle, hexagon or star), still in the card's status colour,
hollow when `done` and dimmed when archived; a card with no icon, or an unknown icon name,
keeps the round dot. An outer ring marks a card with children; a red
ring is **blocked**, an amber ring **waiting**, a gold ring **review**; the child ring and
the flag rings sit outside every shape, the star's points included. A card's id
prints beside its dot when it has three or more relations, is hovered or selected, when
the view is zoomed in, or when the graph is small; a card the Tiers fan names and finds room for shows its title instead,
beside its ring or in a row outside the rim (see **Options**). **Relations:** the Lines option says which parent
lines are drawn (see **Options**), and a dashed arrow runs from a card to the card that waits for it, its head on the waiter.
A parent is drawn only when it is also drawn on this view, otherwise the card is a
root there; a card waiting on a hidden card still reads waiting.
**Options.** Tiers has an **option row** in the option panel beside the fan, always shown, with no fold or toggle of its own, like the Map's. It holds six options, the first value of each the
default. **Lines** says which children get a parent line: **all** (the default) gives a line to every
child; **chain** gives a line to every chain end and none to the other children, as the Map draws its chain ends;
**off** draws no parent line. **Group** says how those lines are drawn: **brackets** (the default) gives each
parent, for each ring its children with a line sit on, one **bracket**, a **counted line** whose arc runs from the
first of those children to the last in the order the Order option draws them, never through the parent's angle, with
a tick to each child, one stem up to the parent and the number of children it holds printed on it, and a child alone
on its ring keeps a plain line; **lines** gives each child its own line. With Lines off there is nothing to group:
the Group buttons stay shown and change nothing. A bracket is drawn heavier and brighter than the ring guides, its
arc hooks out to its first and last child, and brackets side by side on one ring alternate between two insets so
neighbours never meet. A bracket's stem is one straight line from the parent to the middle of a gap between two
neighbouring children, never to a child's angle: it takes the gap nearest the parent's angle whose line keeps clear of
every other card's mark, the next nearest when a mark is in the way, and the count sits in the free gap nearest the
stem, beside the stem's end when no other gap is wide enough.  **Dependencies** are
on (the default) or off, the dashed arrows for `waiting_for`. **Order** sorts siblings within a sector: by
**status** (the default), doing, todo, backlog, the other live statuses in column order, done, archived, as the Map
orders its rows, or by **rank**, the outline's own order; cards of one status keep the outline's order.
**Names** says which cards carry their title: **relevant** (the default) names the selection
and the cards it lights (a lone card's one-hop relations and a pill's matches among them), then the parents from
the highest altitude down while fewer than 24 cards are named, and on a fan of 24 cards or fewer every card;
**all** names every card; **none** names no card. Altitude is the glossary's: the layers of cards below a
card on the board, drawn or not, blind to type, as the badge on its tile counts them. A name is the card's id and
title as plain text (`#12 The title`), cut to 38 characters, and shorter, with an ellipsis, when its place has less room, the id
never cut; a named card that
finds room shows it in place of its id label; a click on a card names it and what it lights in place, with no redraw.
Names never run the layout
again: the setting is in neither the layout's cache key nor what re-fits an untouched view, so only the named
set changes. **l** steps the setting relevant, all, none and round to relevant while the Graph shows Tiers,
whether the panel is open or not; it reads the shared key guard, so it does nothing while a field has focus (the
search box types an l) or while a card menu, a dialog, the notifications panel or the preferences sheet is
open, and it works with the search panel open. The footer line under the Graph shows the setting (`l steps the
names: relevant`). The Flow has no names.
**Where names sit.** A name is never tilted and keeps its size on screen at any zoom. A parent, a card with children,
which wears the outer ring, is named beside its ring, inside the rim. Every other named card is named in a row outside
the rim on its own side of the fan, the cards of a side taking the rows in the order of their rays down it, and a
leader runs from its dot out along its own ray, round any dot in the way, along a rail just outside the rim and out to
its name. With the table choice, the Unnested block's named cards sit in one list above the block, the column furthest
right nearest it, each joined to its dot by a leader that runs up its column's left side. A name keeps off every dot,
caption and other name, and off an id label that shows without a hover or a selection, and never crosses a parent
line or a dependency line that is drawn, or a divider between sectors; a card with no room is left unnamed, and its
id label shows as it would with no name. A leader keeps off no name, caption or line: it can run under a parent's
name or across a caption. In the block's list a card whose column line would run inside or hard against the rim, or
across a name or a caption, is left unnamed, so the block's left-hand columns, nearest the fan, are the first to lose
their names and can lose all of them. Rows are
bounded by the fan, not by the panel, so a long name at the panel's edge can run past it until the view is panned.
Names are placed again once a zoom settles (zoomed out, a name takes more of the fan's own room, so fewer find a
place) and when what they depend on changes, the selection, the setting, a card's title or sticker or a line; a pan
moves none, and a poll that brings nothing new places nothing.
**Unnested** says where the cards with no parent, no children and no tier are drawn: **outermost** (the default) draws
them on one ring outside every depth ring, grouped by status in the board's order, archived cards last,
under an `unnested` caption on the seam, level with the ring, whose tooltip counts them and names no slice;
**off** does not draw them, and neither is a line or an arrow that joins one to a card that is drawn, and a selection
reaches only the cards the Graph draws, so they leave it with the dots and come back with them (so a
switch into or out of Tiers while Unnested is off works the selection and the pill counts out again);
**depth 0** draws them on the depth 0 ring, between the tier bands and depth 1, in a sector of their own, and
the ring's caption is the depth 0 band's, `depth 0`, and its tooltip counts them; **table** draws the Unnested
block outside the rim. The Unnested option is Tiers' own: the Flow draws every card. A counted line or
bracket lights whenever its parent does. **Hovering a line**, in the Hierarchy or the Flow, lights that line and the
cards at its ends and dims the rest, as a card's hover does: a parent line its parent and its child, a dependency line
its two cards, a bracket its parent and every child it holds, and no other line with them. Each line has an invisible
stroke of about 8 pixels (`.graph-link-hit`, the same width at any zoom) that takes the pointer; a card under the
pointer wins over a line, leaving the line brings back what was lit before it, the lit line is drawn above the other
lines while it is lit, and a line has no click action and no keyboard focus. The chain ends are read on the whole board, so hiding a card with a status pill or a search
never moves a line. The lines and dependencies only redraw; the order moves siblings along their own stretch of the
sector, and no card changes its band, its ring or its sector; the Unnested option moves the cards with no relative and no tier to
another ring, a sector or out of the Graph. The choices are kept per board in `localStorage` under
`graph.options`; the row is always shown in the option panel, with no fold. A press on the row never starts a pan,
never clears the selection and never pauses the 5-second poll. Pressing Lines, Dependencies or Order never pans, zooms or
re-fits the view, so a fan framed once keeps its place and **Fit** frames every card again.
Pressing Unnested, which changes what the fan draws and what Fit frames, frames an untouched view again; a view the person has panned or zoomed stays where it is.
The Graph draws no status pill row: its status pills sit in the search panel's Statuses section, as the Gantt's do. Left-click toggles a
status, right-click solos it (right-click the soloed pill to restore all), and the
Archive pill is **off by default** (unlike the Map). A card whose parent is hidden
(archived, or filtered out by a pill) is drawn as a root, the top of its own sector, in the band of its slice. The search box hides nothing
here but a `slice:` cut (see **Lighting**), and it spans live and archived cards alike. A count of cards
and relations sits in the header; a board with nothing to draw says "No cards to show".
**Lighting.** The Graph dims everything but what is lit, and one dimming serves the
pointer, a lone card, a selection and a search typed in the box. **Hover or keyboard
focus** on a dot lights the sets *On hover show* ticks for that card (by default the card and the cards it has a
relation with), with the lines between them, until the pointer leaves. **Click** a dot to select it (painted in place,
so a double click is not interrupted by a rebuild): a **lone card** picked by a click
stays lit with its one-hop relations after the pointer leaves, and the relations light
without being selected; hovering another dot shows that one's relations until the
pointer leaves. A selection of several cards lights exactly those cards and the lines
between them, not their relations, and the rest dims. A **search typed in the Graph** is
the anchor of the selection instead of a filter: nothing hides, every dot stays where it
is (typing does not run the layout again), and the matches light, done cards included,
while the rest dims; a query that matches one card lights that card alone, without its
relations. The one thing it hides is the cards outside the cut of a `slice:` term that
stands on its own in the query, as in every other view: the rest of the query lights
inside the cut, and a `slice:` term under `|` or in a bracket of alternatives is only a
term to match, so it lights and hides nothing. Emptying the box, **Esc** and a double click on the empty Graph drop the anchor and
the dimming (Esc and the double click leave the box its cut, the `slice:` terms that stand on their own: a cut is no search);
a plain click on a card sets a new card anchor and the box shows that card in place of the search, its cut kept, so the Graph
keeps drawing what the box says;
shift+click or ctrl/cmd+click on an unlit card adds it and writes it beside the query (`(move the) | #5`), which stays the
typed anchor, and on a card
the query lit takes it out and turns the query into its other cards, which the box then names (`#2 | #8`),
since it no longer names the anchor. The status pills still decide which cards are
drawn, so with the Done pill off a done match is not drawn, whatever the query. A typed
search stops being the anchor when you leave the Graph, and each view follows its own Typing
isolates: where it is ticked (the Board, Map, Gantt and Calendar to start) the typed search isolates
there on the switch and shows its matches alone, and where it is unticked the view lights its matches
with the selected look and hides nothing; nothing is selected by it, and a bulk action has no cards to
act on. Back in the Graph with the box unchanged and nothing selected, isolate ends and its matches
light again; a selection carried in from another view stays, and
the box has no effect in the Graph until it is edited. **Double-click** (or **Enter** on
a focused dot) opens the card, and **Ctrl+Space** on a focused dot selects it, as a click does. The Graph is a deliberate exception to
"click opens" (ADR 0006): a click makes the dot's card the anchor of a new selection, and
shift+click or ctrl/cmd+click adds one card or takes it out (the layout has no reading
order, so there is no range). Every dot carries `.card-el` and `data-id`, so right-click
(bulk menu) is the shared grammar of ADR 0006. A dot is never dragged. **Pan** by dragging the background
(a drag moves past 4px and the click that ends it is swallowed, so a pan is never read as
a click on empty space and keeps the selection); the **wheel** zooms at the pointer and the `−`, `+` and **Fit** buttons zoom
about the centre or fit every card in the panel. Choosing a graph re-fits the view; after
that a pan or zoom is kept, and an untouched view re-fits when the set of cards changes.
Per board in `localStorage`: the graph choice under `graph.layout` and the status pills under
`graph.statusFilter` (same defensive merge as the Gantt's: a saved value with no
`archive` key merges in OFF), and in Tiers the option row's choices under `graph.options`.
The 5-second poll rebuilds the view and keeps the
layout, pills, pan and zoom. `?view=graph` is a deep link to it. The snapshot has no
Graph view. The Graph draws one of two graphs, chosen by the Hierarchy and Flow buttons in the toolbar at the top right of the drawing, whether the option panel is open or shut:
**Hierarchy**, which is all of the above, and **Flow** (see `plugin/skills/web/references/graph-flow.md`).
