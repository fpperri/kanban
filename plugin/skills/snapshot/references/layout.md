# Layout: width tiers, title and header

Holds how the page lays out at phone, tablet and desktop widths, its tab icon and title, and the sticky header with the pending-changes pill.

The page carries the plugin's icon (`assets/icon.svg`) inline as its tab icon, so it shows
without fetching anything; `test/snapshot/icon.test.js` keeps the inlined copy identical.

## Width tiers

The snapshot is tap-first at every size — no layout tier changes the queue,
payload, or action grammar, only how much of the screen the board uses:

- **<560px (phone):** the baseline single centered column, unchanged.
- **560-899px:** the column (`#scroll`) widens to ~720px; nothing else about
  the layout changes.
- **>=900px (desktop/tablet landscape):** `#scroll` drops its width cap
  entirely (~24px side padding only, instead of the narrower centered
  column lower tiers use) so the header, search, tabs, and board use the
  real viewport. The board renders as a side-by-side column strip instead
  of a stacked accordion — each visible status section (board order)
  becomes a flex column that FILLS the freed width (`flex:1 1 0`,
  min-width still ~260px), with its own independent vertical scroll,
  mirroring kanban-web's `main#board`/`.column` mechanism
  (`skills/web/web/app.css`); at the default five statuses that's ~1350px
  of minimums, so 1400px+ viewports show no horizontal scrollbar, and the
  strip keeps `overflow-x:auto` purely as a fallback for narrower desktop
  widths or more columns than that. A tap-collapsed section narrows into a
  slim strip rather than holding the full column width. The card detail
  sheet, new-card form, and notifications pop-up center as a dialog capped
  at ~640px instead of sheeting up from the bottom — same content, same
  behavior. `render()` wraps every board section (header + its cards) in a
  `.boardcol` container at every width so this tier's CSS can column-ize
  the existing DOM without a different render path below 900px, where
  `.boardcol` renders as a plain unstyled block, identical to the old flat
  sibling layout.

Of `#scroll`'s other descendants at this tier: the map and gantt views'
SVG canvases size themselves from data inside their own
`overflow-x:auto` scroller, so an uncapped `#scroll` never stretches
them — no cap needed. The calendar's 7-column month grid reads badly
stretched edge to edge on an uncapped `#scroll`, so `#calview` gets its
own readable cap (centered, ~900px), independent of `#scroll`'s width.
The pending-changes tray (`.pend`) gets a readable ~640px cap at this
tier, same as the calendar, but stays an ordinary block at the bottom of
the page at every width: a fixed bottom-left overlay read as "always on top"
over board content. It is gated by "any ops queued, or a note to show" (the
check `render()` makes), so it only appears while there's something to show.

`hnav` (the horizontal-scroll step buttons above each of the Map view's
graphs) hides on `(hover:hover) and (pointer:fine)` — a **capability** query,
not a width breakpoint, so a touch device keeps the buttons regardless of
screen size and a mouse/trackpad loses them regardless of screen size
(scrollbars and shift-wheel cover it there). The scroll-button stack
(`#scrollbtns`, see `references/phone.md`) sits outside every width tier and every media
query — it's the context menu, unrelated to layout, and starts collapsed
(only the ellipsis) with its mode remembered per page in localStorage.
Font/tap sizing is untouched by width tiers.

## Title and header

The page title is `<name> — Kanban Snapshot` and the header's lead word is the
**board name** alone — `config.yaml`'s top-level `name:`, the token that
qualifies every card mention, falling back to the folder above the board
directory when the board hasn't declared one (`read_board_name()`; only an
UNINDENTED `name:` counts, since each assignee entry carries its own indented
one). The header's base stamp sits in its own span, labeled `snapshot · base:`.
The value is HTML-escaped and substituted last, so a name can never smuggle in
another template token.

The header line (`.hdr`: board name, base label, "N pending" pill,
🔔) is `position:sticky` at the top of `#scroll` at **every** width, not
just >=900px — it's the one piece of chrome deliberately exempted from
the width-tier split above. A scroll listener on `#scroll` toggles a
`.hdr.thin` class once the page has scrolled past a small threshold,
compacting the header's padding and title size so it stays out of the
way of board content; only the header line sticks, the search box and
view tabs scroll away normally. The "N pending" indicator (`#pill`) is a
solid red (`--crit`, never the calmer `--accent` blue) pill with bold
on-fill text — not just colored text — so queued changes are never mistaken for
already applied. It also flashes: a CSS-only `@keyframes` animation cycles
the pill red -> white -> red on an irregular, lightning-like cadence (a fast
double strike, then one long dark pause — not an even pulse), with a fixed
dark text color at the white stop so it stays readable at both ends of the
flash in either color scheme. The animation steps (`step-end`) rather than
interpolating, so the pill is only ever painted in one of those two
high-contrast states — a linear tween would spend ~14% of every cycle in
unreadable mid-blends. The animation stops outright (not just
visually) once the pill is empty, and `prefers-reduced-motion: reduce`
replaces it with a static red pill. It collapses to nothing when no ops are
queued, and stays tappable, jumping to the tray at the bottom of the page.
