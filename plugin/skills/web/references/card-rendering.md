How a card is drawn and what the card details show: status dot, archived ball, date stack, overdue cue, type chip, header icons, assignee color, frontmatter marks, thread and children, reading layer, last modified, and the hover and focus highlight.

**Status dot** — `statusBadge()` (status-colors.js) renders on every card rendering:
board tiles (live AND archived), the map's No relations tiles, calendar chips, and
gantt gutter rows. A small dot
colored via `statusColor()` off the card's RAW on-disk status, tooltipped with that
same raw status — **the `archived` flag never touches this color**: status dots never
mute, on any surface. The one exception is the literal on-disk status strings
`archive`/`archived` themselves, which mute to the neutral archive grey — that IS
`statusColor()`'s mapping for those two names, keyed off the raw string, not the
`archived` flag. This is the HTML twin of the map SVG node's own status dot; column
headers, gantt bar fills, and the calendar's priority/due cues are separate channels —
one more glyph, not a recoloring.

**Archived ball** — a second shared dot, `archivedBadge()` (status-colors.js): a fixed
`ARCHIVE_COLOR` grey circle, tooltipped "Archived", joining `statusBadge()` on every
surface that renders an **archived** card, and *only* those: Archive-column tiles and
the map's No relations archived tiles (both through `archiveCardEl`, which calls it
unconditionally — that builder never renders a live card), the map's own SVG nodes (a
`map-archived-dot` circle twin, gated per node), the gantt's Archive-group gutter
rows, and calendar chips (gated on `card.archived`, once the calendar's Archive pill
opts archived cards in). **`cardEl` never renders it** — a live board tile is the one
surface that structurally can't show an archived card. Glyph order, identical
everywhere both dots land together: **status, archived** —
`.status-dot + .archived-dot { margin-left: 4px; }` keeps the pair from fusing. On the
map SVG a plain node is 58px tall, roomy for the dot column on its right edge; a rich node's
height follows its content (Dependency map). The gantt
bar and the board tile's grey-border cues are untouched — one more glyph on top,
not a replacement.

**Board tile date stack** (kanban.proj#260) — `scheduleRows()` (column-sort.js) reads
the card's three LITERAL frontmatter fields directly (`start_date`/`end_date`/
`due_date`), not the `scheduleKey` triad the Due date sort collapses to, so a card
carrying all three shows all three instead of hiding two behind the deadline. One row
per field the card has, fixed start/end/due order, each with its own glyph — `⇤`
start, `⇥` end, `⚑` due (the same flag the calendar's due chip draws) — and a field
with no leading `YYYY-MM-DD` produces no row at all, so a two-row card is simply
shorter than a three-row one. The day is a PREFIX match and the time needs the `T`,
matching calendar-model's `dayPart`/`timePart`, so the tile and the calendar/gantt
agree on what counts as a date. Sits under the title as its own block
(`.card-schedule`, flex-column), not in the `.card-head` flex row it used to share
with the id/badges — three stacked lines don't fit a nowrap flex child. Each glyph
rides a fixed-width `.card-schedule-glyph` box (the arrows and the flag come from
different fallback faces and measure ~1.6px apart) so the three dates line up in one
column. Both `cardEl` and `archiveCardEl` render it
through the shared `scheduleBlockHtml()` helper. 

**Overdue cue** — `isOverdue()` (column-sort.js): the card's `due_date` day part is
strictly earlier than today, and the card is neither `done` nor archived. Day-granular
like every other date read in the app — a 09:00 deadline isn't overdue until the date
rolls over — and keyed on `due_date` alone, never the `due`/`end`/`start` triad the
Due date sort uses: a working range sliding past today is a schedule slip, not a missed
deadline. An unparseable value never flags (fails safe rather than string-comparing
free text). It recolors the deadline cue each surface ALREADY draws, in the same danger
red as the blocked pill: in the board tile's date stack (kanban.proj#260, under the
title), the due row alone (text + weight — the tile's `border-left` is
priority/waiting's channel, untouched); on the calendar's due chip (border + `⚑` glyph,
winning over that chip's amber); and the gantt's due diamond (fill). Tooltips say so in
words too. Not a new glyph anywhere — nothing to lose to, and a card without a deadline
can never show it. The Archive column's `archiveCardEl` renders the date stack but
never this: archived retires the deadline by definition.

**Card type chip** — a card's optional `type:` frontmatter line (free text) shows as a
chip, `typeBadge()` (type-badge.js), in the tile's head row beside the assignee on
live and archived tiles, and in the detail popup's frontmatter table in place of the
raw word. The board's `types:` list in `config.yaml` may give a type a color; the match
is by name, ignoring case and surrounding space, and the chip keeps the card's own
spelling. A listed type with a color wears it as text and border; a type the list does
not name, or names without a color, is a neutral chip. Like a reserved assignee color,
the value is free-form, so the chip rides a `data-type-color` attribute and
`paintTypeColors()` (app.js) paints it with CSSOM assignments after `innerHTML` lands
(the CSP blocks style attributes). The app attaches no meaning to a type, `epic`
included: it wears a color only when the list gives it one.
**Icons:** a listed type may also carry an `icon:` (see the `icon` key under Board config in docs/web.md). A type with an icon starts its chip with that glyph, in the chip's own
colour (the glyph is plain text inside the chip, so it takes the colour the chip is
painted), wherever a chip is drawn: Board and Archive tiles, the Map's rich rows and the
card details. Calendar and Gantt draw no chip, so they show none. A type with no icon, or
an unknown icon name, draws the plain chip: its name alone. The six glyphs live in their own
module, `type-icons.js`, which has no dependencies and loads before the type chip and the
Graph.

**Header icons** — the header's New card, Calendar, Gantt, Map view, Graph and Refresh
buttons each hold an icon slot and a label span; the active view's button reads
"Board view" and wears the Board icon. The line icons (a 24 px box, stroked with the
current colour, so they read in light and dark) live in `view-icons.js`, which loads right
after `type-icons.js`. A views table in `app.js`, beside `VIEW_CONTAINERS`, lists each
view's id, label and icon and drives the painter, which writes a label or `aria-pressed`
only when it changes and puts `aria-pressed` on every element marked `data-view`.

**Assignee text color** — `assigneeBadge()` (assignee-badge.js) tints the handle text
itself — the handle carries the color; there is no separate glyph. A config.yaml
`assignees[].color` reservation wins; absent, the handle hashes into the same 8-color
`STATUS_PALETTE` custom statuses use (assignee-colors.js's
`assigneeColor`/`assigneeColorClass`). The hashed case gets an
`.assignee-text--palette-N` CSS class — a parallel family to
`.status-dot--palette-N`, same 8 slots/numbering (the `--hash-a`…`--hash-h` tokens), but setting `color` not `background`
(a hashed assignee CAN land on the same hex a hashed status does — one shared pool;
determinism, not uniqueness, is still the contract). A RESERVED color is an open value
space with no class to reuse, so the assignee span rides a `data-assignee-color`
attribute instead; `paintAssigneeColors()` (app.js) paints it with one small CSSOM
assignment after the tile's `innerHTML` lands — never a string style attribute (the
CSP ships `style-src 'self'` without `unsafe-inline`, so inline `style` attributes are
blocked; CSSOM assignment is the compliant path). Renders wherever `assigneeBadge()`
reaches: board tiles (live and archived) and the map's No relations tiles. The
edit/create modal tints the assignee input's own text directly (`syncAssigneeColor()`,
always CSSOM) — synced on open and on every keystroke/combobox pick, the same
"reflect the live typed value" pattern as the blocked input's red border. The snapshot
carries the same rule in its own reimplementation — see that skill's write-up.

**Frontmatter marks** — the detail popup's frontmatter table prints every field as
written, except the few the board itself understands: `status` gets its status dot and
colour, `priority: High` the high-priority red, `assignee` its chip, `parent` a
mention chip that opens the parent card, `review` and `blocked` their sticker grounds, and
`tags` tag chips. The card path shows its folders muted and the file name in full ink.

**Thread and children** — the detail popup shows the card's thread above its
frontmatter: the parents up to the root, root first, each a mention chip that opens
that card (an archived parent too, marked `archived`, as an archived
child is). A parent id with no card on this board ends the
thread with an `unresolved` marker; a parent on another board ends it with that
board's mention marked `not followed` (the single-board release names it and never
follows it); a loop of parents stops at the card that would repeat and flags it
`loop`, so a mistake never hangs the popup. Right under the roll-up bar, above the
frontmatter and the body, behind a **Children** header
that carries their count, the card's children are listed in rank order (unranked after
ranked, then priority, then id), an archived child marked `archived`, each a mention
chip too. The list starts collapsed every time a card opens; one click on the header
expands it and another collapses it. Both lists are worked out from the
board already loaded (`threadOf` and `childrenOf` in `nesting.js`), a root shows no
thread and a leaf no child list, and every entry that names a card on this board
rides the popup's one mention listener, so opening one is a step in the card popup
history.

**Reading layer** — card bodies and notifications use four tokens of their own:
`--prose` for body text, `--code-ink` for code on a borderless `--raised` ground, and
`--line-strong` for table-header and evidence rules. Headings and bold take
`--ink-strong`, so a body has separate lightness steps for headings, prose, code and
muted text. Prose, tables and code blocks all run the full width of the modal,
full screen included, and a table's first column carries the heading
ink so a reader can scan down it. A list nested under a task item (the step's proof and evidence lines) reads one step
quieter behind a thin rail; that is structure only, and no text is recognised.

**Last modified** — the detail popup shows a "Last modified" line: the card's
`updated` frontmatter timestamp when present, else the file's on-disk mtime labeled
`(file mtime)` as a fallback for cards written before the field existed. `updated` is
stamped by the server on create and bumped on every content write — single edits,
drag-driven status changes, and bulk edits alike, since all go through the same PATCH
endpoint — and is left untouched by archive/restore (those move the file, not its
content). ADR 0008.

**Hover/focus highlight** (kanban.proj#261) — resting the pointer over, or moving
keyboard focus onto, any piece of a card lights every piece sharing its id, the same
card-el grammar and same "one card, several DOM elements" reach as selection: on the
calendar a run cut at a week boundary is two chips, and the card's own deadline chip is
a third on a different day — this is the only way to see a card's whole extent at a
glance. A background wash (`hoveredId`, app.js, one id — never a Set, only one card is
hovered/focused at a time; the cards that take the wash are the Set `hoverLit`, see **On hover show** in docs/web.md), a different tone from selection's own wash (`--accent-soft`) so the two
never read alike, and never an outline, so a selected card stays reading as selected
while hovered. Applies everywhere `.selected` does (board tiles, archived tiles,
calendar chips on the month grid AND the sub-month grids, gantt bars and their gutter
labels, map nodes, graph nodes) except the gantt's due diamond, which `.selected` skips too. Every
card-representing element carries `tabindex="0"` for this (Tab reaches the same cue the
mouse does), plus a dashed grey `:focus-visible` ring — the wash rides one shared
`hoveredId`, so the pointer wandering onto another card takes it off the card that still
holds keyboard focus, and the ring is that card's own cue nothing can steal. Cards are
deliberately NOT in the `boardControlFocused` poll guard the other rebuilt controls sit
in: a plain click leaves a card focused indefinitely, so blocking there would quietly
freeze the refresh; `applyBoardData` re-finds the focused card after the render instead.
The status pills (in the Statuses section) and the Map's fold toggles are treated the same way (a click or a
keypress leaves one focused, so guarding them would stop the 5s refresh): the guard keeps
only real form controls, and `applyBoardData` refocuses the focused pill without scrolling.
A caption of the Graph's tier fan is a tab stop that every render rebuilds, so it is found
again after the render by its `data-caption` key and takes focus back, which shows its tooltip again.
Two delegated pairs on `document`, mirroring the selection's click/contextmenu pair (docs/web.md, **Multi-select**): `mouseover`/`mouseout` and `focusin`/`focusout`, each just keeping `hoveredId`
current and repainting the *current* DOM directly — a full `renderBoard()` per mouse
move would be needless work. The auto-refresh poll's own full rebuild carries the
highlight forward on its own: every render call site reads `hoveredId` the same way it
already reads `selectedIds`, so a poll landing under a stationary pointer doesn't lose
the highlight the way a naive `:hover`-only or event-only approach would.
