How the Dependency map (the Map view) works: its button, option panel, nodes, lines, focus, zoom, pan and keys.

**Dependency map** — a top-bar "Map view" button (a line icon, then the words) swaps the board for a hand-rolled
layered SVG graph: nodes are cards (id + title), solid edges are `waiting_for` (arrow from
the depended-on card to the card waiting on it), dashed lines are parents (below).
Nodes come from both live and archived cards — blocking is location-independent.
**Parent lines:** a child card's `parent: <id>` (this board's own name in `board#id` form is read as a plain id,
here and in `tree:`/`path:`) is drawn as a dashed line in the dependency grey, one hop
from a parent to an immediate child and never from a grandparent to a grandchild, with
a small dot on the parent's end. The parent sits **below** its children by default —
down is later on the map and a parent is the end of the work under it (its own status
stays the human's call: done with open leaves warns, never gates). Which children get a
line is the **Parent lines** option. **Chain ends**, the default: per parent, only the
children where the siblings' dependency chain meets the parent — with the parent below,
the children no sibling waits for; with it above, the children that wait for no sibling
— and always a child with no dependency to or from a sibling (a chain that loops has no
end, so all of it takes a line). **All** draws a line to every child and **off** draws
none. Which children are the ends is read on the whole board, so a search or a status
pill never moves a line. A parent is not a dependency: it never makes a card waiting,
the `doing` gate ignores it, and a card with only a parent relation is in a graph, not
in the No relations row. A parent hidden by a filter, or with no card, is a dimmed stub
("not found" when no card answers to the id) and a parent on another board is one
dimmed stub per `board#id` mention, labelled with it and not clickable; each child keeps
its own line to the stub, drawn dimmed. Self-parent is ignored. A child that waits on
its parent, or the reverse, is placed by that dependency alone and still gets its
parent line. A parent line that runs against the layout (a loop of parents, or a
dependency that put the parent on the other side) bows out to the side like a back
edge, one that would lie on a solid arrow is nudged 9px aside, and a parent with three
or more lines spreads where they meet it.
**Graphs and rows:** by default one small graph per **tree** — every card any
dependency or parent relation joins, drawn or not — stacked biggest first (ties by the
lowest card), each under a heading with its root titles (three at most, then "+N more")
and its card count, stubs counted apart. The **Graphs** option's "one graph" shows
everything in a single graph with no headings. A card is in a graph when any relation
touches it, so turning a kind of line off never moves a card out of its tree; the
bottom row, **No relations**, holds only cards with no dependency, no parent and no
children. Within each row the **Row order** option's "by status" (the default) reads
left to right: doing, todo, backlog, any other live status in column order, done,
archived, then stubs, ties keeping the layout order (lowest id first); "layout" leaves
the layout's own order. The **Layout** option's "keep" (the default) places cards by
every relation, so toggling lines never moves one; "reflow" places them by the lines
drawn. **Align** centers each row in its graph and each graph on the page, or sets them
left. **Rich nodes** (the **Cards** option, the default) carry, under the title, the
type chip and the ▲ altitude badge and, on a parent whose leaves are counted, the
roll-up bar in the board's bar mode (thin while collapsed, with counts when
open); a click on a bar flips every bar and never opens the card. A node's
height follows what it holds (a plain node is 58px tall), and stubs stay plain; "plain"
draws id and title only.
**Map options:** one compact row in the option panel, under the zoom, holds the eight choices as
segmented controls — Parent lines (chain ends / all / off), Dependency lines (on / off),
Graphs (one per tree / one graph), Parent sits (below / above), Align (center / left),
Row order (by status / layout), Layout (keep / reflow), Cards (rich / plain) — defaults
first. They persist per board in `localStorage` as one object (`map.options`, merged
defensively: a value this version does not offer reads as its default), survive the
poll and a reload, and are not URL parameters. The rules behind them (which parent
lines, which trees, the row order, the No relations set, where cards and lines fall) are map-relations.js, pure and
unit-tested, with no other module behind it so a page without the web app's scripts can
embed it as is, like nesting.js. The options row is always shown in the option panel,
with no toggle of its own; an `options` value left in `map.sections.collapsed` by an older version is dropped when that entry is read.
**Node treatments:** the border is one neutral weight for every node — status never
strokes it. A small dot in the node's corner carries the status color (same palette as
the column headers), its own tooltip naming the **raw on-disk status**; status dots
never mute for archived nodes — on any board with archived history, archived chains
dominate the map, and muting would empty the one channel that carries status. The
archived cues are their own channels: the node strokes a visibly lighter grey
(`--st-archive`) than the plain neutral border tone (`--line`), the SVG tooltip gains an "(archived)"
suffix, and the grey **Archived ball** (`plugin/skills/web/references/card-rendering.md`) joins the dot column — an archived node
carries its true status color, a grey border, and a grey ball at once. Two more border
exceptions, board-tile parity: a high-priority card strokes the node red (`--id-high`,
`#f85149` on the dark theme) and a **waiting** card strokes it amber (`--id-waiting`,
`#d29922` on the dark theme) — the exact colors the board tile
(`.card.high`/`.card.waiting`), calendar chips, and gantt bars use, via the same
precomputed flags rather than a map-only reclassification. Waiting wins over high when
a node is both, same declaration-order convention as every other surface. Mutually
exclusive with the archived stroke — an archived node never gets the priority/waiting
stroke, matching how the Archive column's tiles never wear those classes either. The
manual **blocked** sticker is no border at all: a blocked node wears a red pill (the
same `--blocked-bg` ground and `--blocked-ink` text as the tile's pill) — the map twin of the board tile's blocked pill,
tooltipped "blocked: <reason>" (bare "blocked" when the reason is unspecified) — shown
on archived nodes too: a stop sign is identity, not location, and unlike the stroke it
doesn't share a channel with the archived grey. Cycles in `waiting_for` render as a
visibly distinct amber curved "back edge" rather than hanging the layout.
**Status-filter row** — the Map draws no pill row of its own: its status pills sit in the search panel's Statuses section, which keeps the guarantee that a control is always left to turn a status back on. One toggle pill per board column (the configured statuses in
column order + Archive, the location pseudo-column), each led by a dot in its column's
color (hollow, with the label struck through, when the pill is off) — all ON by default, and the section is there even when everything is filtered out (so a toggle can always be turned back on). These are the glossary's **status pills**: they
hide cards, and they are not the search panel's pills, which are queries (see **Search panel** in docs/web.md).
**Pill interaction grammar, shared by
every status-filter row in the app** (this one, the gantt's, the calendar's and the graph's):
left-click toggles that one pill on/off; right-click SOLOs it — that pill on, every
other pill in the row off — and right-clicking the already-soloed pill again restores
ALL pills on. `contextmenu` is suppressed only on a pill itself, not on the gap between
pills; everywhere else (map nodes, isolated tiles, calendar chips, gantt bars) keeps
the shared right-click bulk menu untouched. Each pill is a button with `aria-pressed`
and a visible focus ring, and focus stays on the pill after a toggle, a solo or a fold. A pill OFF hides that column's cards from
the map: an unlisted on-disk status follows the FIRST column's pill (the catch-all —
exactly where the board files the card) and archived cards follow the Archive pill
regardless of their parked status. The choice persists per board in `localStorage`
(`map.statusFilter`, merged defensively like collapse/sort state) and composes with
search by **intersection** — a card stays visible only when both agree. The active
search query filters the map exactly as it filters the board: matching cards are full
nodes; a card hidden by either filter that's still referenced by a visible one's
`waiting_for` or `parent` (in either direction) renders as a dimmed, dashed ghost stub — never
silently dropped — and is itself clickable through to its detail popup. A
`waiting_for` or `parent` id with no matching card at all renders as a "not found" ghost. Cards
with no relation at all always render in the No relations row below the
graphs. Real nodes + No relations tiles carry the full shared grammar (click for
detail, ctrl/shift-select, right-click menu); ghost stubs stay click-through only.
View mode, query, and status filter all persist across the poll's re-render.
**Collapsible sections** — the graphs (one section for all of them), the No
relations row each get their own collapse/expand toggle (same chevron + look as the board's per-column
collapse), sharing one header builder. State persists per board in `localStorage`
(`map.sections.collapsed`, merged defensively) and survives the poll; collapsing
skips the expensive layout/SVG work entirely rather than hiding it via CSS.
**Option panel** — the Map's zoom toolbar and options row, and the Graph's zoom
buttons and option row (Tiers), stand in an `<aside class="view-panel">` on the right of the view, built
by `buildViewPanel` in app.js, which `graphBuildPanel` and `buildMapPanel` fill. One icon button
(`.view-panel-toggle`, a rectangle with a bar on its right, `aria-label="Options panel"`, `aria-expanded`)
opens and closes it, at the top right, the side the panel comes out of: it floats in the top-right corner of the Map (`.view-bar`, which holds only that button, and stays put while `.map-main` scrolls) and of the Graph (`.graph-controls`, beside the (i) button). The Graph's card count and key sit behind that (i) button (`.graph-info-toggle`, `aria-pressed`, off by default, remembered per board); they stay in the DOM, hidden by a class while it is off. The Graph's status pills are in the search panel's Statuses section. The
Map's graphs scroll in `.map-main` beside the panel, and the pan, the zoom and Fit read and move that
element (`mapMain`). Closed, the panel is not built at all, so the view has its width back and no
control of it can take focus; the Graph then frames an untouched view again in the new width
(`graphRefitNext`), and a view the person moved stays where it is. view-panel.js keeps whether it is open:
per board in `localStorage` under `viewpanel` as `{ map, graph }` (a boolean for a view the person has
chosen for, null for one they have not, validated on every read like prefs.js), else the panel starts closed at every width (`viewPanelDefault` is false):
a kept `true` opens it, from 760 px wide beside the view, and a window that crosses the line draws the view again. Under
760 px the panel is a sheet over the view (`position: absolute` against `.map-view` / `.graph-view`, so it adds
no width and no sideways scroll), with a `.view-panel-close` button that hands focus back to the icon button.
The panel and both buttons wear `data-keeps-selection`; the icon and close buttons are in `REFOCUS_SELECTOR`,
so a poll's redraw gives them focus back. Every control keeps its class, label, title, data attributes and hotkey
(the `l` key still steps the Graph's names with the panel closed).
**Dependency focus** — a second way to populate the map's visible
set, alongside typed search and the status pills: the `tree:<id>` and `path:<id>`
search terms, resolved over dependency-graph.js's dependency edge set (`waiting_for`
+ `parent:` relation, with sequencing-wins-the-pair/terminal-only suppression
already applied — see its `treeIds`/`pathIds` for the grammar, not restated here;
the map's own graphs are shaped by map-relations.js, above).
`tree:` is the connected component (every card the id's relations reach,
undirected); `path:` is the narrower directed cone — everything transitively upstream
and downstream through the id, excluding sibling branches. Traversal is ALWAYS over
live + archived cards; an archived member's on-screen visibility still follows the
Archive pill, same as any other search hit. Composes with the rest of the query and
the status pills by the usual intersection rule; an unknown id matches nothing (no
error), and a card with no edges resolves to a component/cone of one — itself.
Focusing hides everything outside the result and re-lays-out, exactly like a typed
search — a cone edge exiting the focused set renders as the existing ghost stub, no
new rendering path. The right-click menu does not offer these two: its Path and Tree write the
narrower `hpath:`, `htree:`, `dpath:` and `dtree:` terms into the box — see Multi-select.
Mirrored in the snapshot: it reads the same `tree:` and `path:` terms, and its card sheet writes the four narrower `hpath:`, `htree:`, `dpath:` and `dtree:` terms, as the right-click menu does — see GLOSSARY.md's parity table.
**Pan & zoom** — press-and-drag anywhere in the graph (background or a node) scrolls
the `.map-view` panel with the pointer, grab/grabbing cursor, primary button only. A
drag starting on a node still pans once the pointer clears a small threshold; that
gesture's click is suppressed so the card doesn't also open, but a plain click under
the threshold opens it as always. Pointer capture (drag-vs-click threshold shape shared
with the gantt's bar drag, see `plugin/skills/web/references/gantt.md`) is claimed on `#map-view` itself — a
delegated parent, not the specific node pressed — and deliberately deferred until the
drag clears the threshold: claiming it at pointerdown retargets the click that follows
EVERY press (including an unmoved one) to the container, which broke plain-click/
Ctrl-click on a node entirely. The options row, section header, graph headings and the No relations row are outside the drag surface, so filter clicks, the
collapse chevron and text selection there are untouched. A zoom toolbar
(−/percentage/+/Fit) is the first thing in the option panel (see **Option panel**): the buttons step the zoom by one
rung of a 1.25^n ladder (10%–200%) around the panel's center, rounding the current zoom
to its nearest rung before each step so true size (100%) stays reachable even after a
clamp at either edge; Ctrl+wheel (what a trackpad pinch sends) zooms continuously from
the wheel event's own delta around the point under the pointer (a fixed rung per event
made a pinch's burst of small deltas hit the clamp in a handful of events), anchored
against the SVG's actual on-screen origin — not the panel's raw (0,0) — since the
panel's own padding and the rows above the graph don't scale with zoom;
`preventDefault`ed so it never falls through to the browser's own page zoom. Fit sets
the largest zoom (capped at 100%) that shows the widest and tallest graph, measured against the space
actually left for it once the panel's padding and those same rows above are subtracted
out. Zoom scales the SVG's `width`/`height` attributes with the `viewBox` held fixed, so
text/strokes stay crisp at any zoom and the panel's scroll range matches exactly what a
CSS transform would decouple. The calculations — clamp/step, the continuous wheel
factor, the scroll offset that keeps a zoom's anchor point fixed (origin-aware), the fit
zoom for a graph/panel size, and the drag-vs-click threshold — live in map-zoom.js
(pure, unit-tested); the DOM measurements that feed them (the SVG's origin within the
scroll area, the panel's padding) are app.js's own job, since map-zoom.js stays
DOM-free. The chosen zoom persists per board in `localStorage` (`map.zoom`, same
per-board convention as the status filter/section collapse) and survives the poll,
a popup opening/closing, and a reload; a poll tick is skipped for the whole pan gesture
the same way it already skips for every other pointer-capture drag (`isDragging`), with
a document-level pointerup/pointercancel/lostpointercapture net so a release that lands
outside `#map-view` before capture is even claimed can't leave that guard stuck forever.
