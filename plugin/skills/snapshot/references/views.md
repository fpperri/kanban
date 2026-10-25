# Map, Gantt, Calendar and the card sheet

Holds the three read-only views over the embedded snapshot (Map, Gantt, Calendar), what the Map draws and how it shares kanban-web's rules, and the card sheet's Explore buttons.

## The views

Besides the board, the snapshot ships three read-only views over the same
embedded snapshot: **Map** (`waiting_for` arrows and dashed parent lines, one
graph per tree, stubs for what a filter hides or the board does not hold; see
"The Map"), **Gantt** (working-range bars + due
diamonds per the date-triad semantics, grouped in `statuses` order, undated
cards in a chip row below), and **Calendar** (Monday-start month grid, range
chips + due markers, tap month navigation, and month/week/3-day/day sub-views
— the sub-month views are stacked tap-friendly day rows). Tapping a
card in any view opens its detail pop-up in place with the full
action set; edits always queue through the tray. The sheet
also carries four read-only buttons, "Hierarchy path", "Dependency path", "Hierarchy tree" and
"Dependency tree" (any card with a real id, including archived read-only sheets), the same four
Explore writes into kanban-web's search box — tapping one
writes `hpath:<id>`, `htree:<id>`, `dpath:<id>` or `dtree:<id>` into the search box, in place of what it held
but for its `slice:` run (as kanban-web's Explore does), and closes the sheet, no
view switch; the view underneath re-filters itself immediately (Map redraws
the pruned graph with ghost stubs where a cone edge exits the focus, Board
shows only the focused cards in their columns, same machinery every other
search term uses).

## The Map

The page embeds `skills/web/web/map-relations.js` as is, beside `nesting.js`, so which
parent lines the Map draws, which cards share a graph, how a row reads, which cards
have no relation at all and where cards and lines fall are kanban-web's own rules;
`test/snapshot/map-embed.test.js` pins the embedded source to that file, under the same build
guards as the nesting module. The build reads it from the kanban-web skill installed
beside this one, like `nesting.js`.

The page keeps only the drawing of those results as SVG, and the relations it hands the
rules are built twice: `buildRelGraph` here, `buildRelationsGraph` in `dependency-graph.js`
there. `test/snapshot/map-parity.test.js` runs both over a board with every kind of relation,
whole and filtered, and fails when they stop giving the same graphs. The Map shows the
board as embedded, like the Gantt and the Calendar: a queued edit does not move it.

It always draws kanban-web's defaults:

- **Parent lines.** A dashed line in the dependency grey joins a parent to the children
  where their dependency chain ends: with the parent below its children, the children
  no sibling waits on. A child with no dependency to or from a sibling always has its
  line. A parent on another board is one dimmed stub per `board#id`, a parent that is
  not on the board is a stub too, and each child keeps its line to it. There is never a
  line from a grandparent to a grandchild.
- **One graph per tree.** Cards joined by any dependency or parent share a graph,
  stacked biggest first, each under a heading with its root titles and card count and
  with its own scroll buttons. A status pill or a search that hides a card turns it into
  a dimmed stub where a card that is shown relates to it.
- **No relations.** The last row holds only the cards with no dependency, no parent and
  no children. A card with only a parent is in a graph, not in this row.
- **Row order and alignment.** A row reads doing, todo, backlog, any other live status
  in the board's order, done, archived, then stubs, and sits centered in its graph, each
  graph centered on the page.
- **Rich cards.** A node carries the type chip, the altitude badge and, on a parent, the
  thin roll-up bar read off the board as embedded, and is as tall as what it holds. A
  tap anywhere on a node, the bar included, opens the card.
