---
name: kanban-viewer
description: (Claude Only) Generate a self-contained interactive HTML editor for a kanban board, and apply the change payloads it produces. The editor works where kanban-web can't reach — phone, tablet, or any remote Claude session — with tappable cards (move, priority, assignee, rename, description, archive, delete, create) and a queued-changes tray whose "Copy changes" button emits an "Apply kanban changes (...)" payload the user pastes back into chat. Use whenever the user wants to edit the board away from kanban-web, asks for a "board editor", "editable board", "editable artifact", "board I can use from my phone", or wants to change cards from a remote/Cowork session. ALSO use (read references/apply-protocol.md first) whenever a user message starts with "Apply kanban changes" — that is this editor's payload and must be applied to the card files. For a desktop browser editor use kanban-web; for pure conversational editing use kanban-cli; for AI-initiated card management use kanban.
---

# Kanban Editor

Generate a single-file HTML board editor the human can open anywhere — including
the Claude mobile app's file preview — and use to queue real board changes. This
is the third leg of the surface family: `kanban-web` (desktop editor),
`kanban-cli` (conversational editor), `kanban-viewer` (read-only tap viewer —
changes queue as a payload; Claude is the write path).

The editor is read-write but indirect: nothing touches disk until the human
pastes the payload back to Claude. Claude is the write path and enforces the
board contracts — the `doing` entry gate, id allocation, archive-as-location —
as defined in the kanban skill's SKILL.md.

## Generating the editor

```bash
python <SCRIPTS_DIR>/build_editor.py <kanban-directory> [--out kanban-viewer.html] \
    [--base-label "Jul 11, 3:08 pm CT"] [--base-iso 2026-07-11T20:08Z]
```

- `python`, not `python3`. On Windows `python3` is usually the Microsoft Store's
  App Installer redirector, an alias stub that opens an install page instead of
  running the script (`py -3` also works there). Substitute `python3` only on a
  macOS/Linux box where that is the sole interpreter name.
- `kanban-directory` — path to the card files, always passed explicitly (the
  script takes no default). When the human hasn't already named it, locate it
  the same way as the other surfaces: `.kanban/` is the preferred board
  directory, `kanban/` a supported fallback for existing boards — discovery
  order: `.kanban/` first, then `kanban/`. In a Cowork/remote session, stage
  the board first (all root `*.card.md` + `config.yaml` + `notifications.md`)
  and point the script at the staged copy.
- `--base-label` / `--base-iso` — the snapshot moment shown in the header and
  embedded in payloads. Use the human's local timezone for the label. Defaults
  to now (UTC).

Then deliver the file to the human (in Cowork: SendUserFile with display
"render"). Record each staged file's `mtimeMs` at generation time — they are the
conflict guard when the payload comes back.

A search box under the header filters every view at once — same query grammar
as kanban-web: terms AND together, `#id`/`id:` exact,
`title:`/`body:`/`status:`/`priority:`/`tags:`/`file:` scoped substrings,
bare terms hit title+body+tags. `review:`/`blocked:` (ADR 0009)
are their own family: UNLIKE every scope above, a bare `review:`/`blocked:`
(no value) is itself a complete term — "the sticker is present" (the shared
predicate) — never dropped as mid-typing; `review:PR`/`blocked:vendor` is a
case-insensitive substring match on the sticker's own text. `epic:`
is its own single-field family, same never-dropped bare
shape as `review:`/`blocked:` above, matching every card with `epic: true` —
but with **no value form and no negation**: whatever follows the colon is
discarded, so `epic:` and `epic:foo` parse identically, and it filters every
view (board/map/gantt/calendar), not just the map. `tree:<id>`/`path:<id>`
(`#`-tolerant, e.g. `tree:#153`): tree is the card's whole dependency
component (undirected flood-fill over `waiting_for` + `parent:` epic
membership — the same edges the Map view draws); path is the narrower
directed cone through the card (everything transitively upstream +
downstream). An unknown id matches nothing; an isolated card is a component
of one; traversal always runs over the full live + archived snapshot
regardless of the current query or status pills (the Archive pill still
gates *display* of an archived member, never whether it counts for
connectivity), and the resolved id set intersects normally with every other
term and pill, same as any other search term.

Every view carries a status-pill row: statuses default on,
**Archive defaults off** — toggling the Archive pill reveals archived cards
(embedded display-only, bodies stripped, never tappable; archive is a
location, not a status) as a muted trailing board section, a muted gantt
group, dimmed map nodes, and gray calendar chips. The build walks `archived/`
**recursively** (ADR 0010), so a card filed in an `archived/<package>/`
grouping folder embeds like any other archived card; the editor's own
`archive` op still writes to the `archived/` root, packages being
kanban-web's and kanban-cli's to choose. The "N pending" header
indicator is tappable and jumps to the tray.

A card wears a gold "review" badge (card tile head, or a "review: `<text>`"
line on the detail sheet) whenever its `review` field passes the shared
sticker predicate (ADR 0009; the predicate lives in the kanban skill's
SKILL.md) — blocked's sibling: "finished, approve me" rather than blocked's
"stuck, act so I can proceed", and unlike blocked it never gates `doing`
entry. Both stickers are set/cleared the same way, through the "All fields"
grid (live gold/red border feedback while the value passes the predicate) —
there's no dedicated form field for either. **Deliberate gap:** no badge is
tap-to-filter here — unlike kanban-web's tap-an-assignee-or-tag-to-filter,
this editor has no additive query-append affordance (its tree:/path: buttons
overwrite the whole query box).

**Deliberate gap:** kanban-web's AI-prompt sparkle button (a dedicated
control for writing the `prompt` field) has no twin here — a card that
already carries a `prompt` line gets an editable row in the generic "All
fields" grid like any other key, but a card without one can't have a prompt
freshly added from this editor.

The create form's assignee suggestions come from the board registry
(`config.yaml` `assignees`); with no registry it suggests the
`@human`/`@hitl`/`@afk` role trio (CONTEXT.md's Role trio glossary).
Every place an assignee handle shows (board tile meta line, the archived
sheet's read-only pill, the editable sheet's assignee pill) has its TEXT
tinted in that assignee's color — parity with kanban-web's own assignee
text tint: an `assignees[].color` reservation in `config.yaml` wins, else
the handle hashes into the same fixed 8-color palette kanban-web uses for
statuses (same hash, same hexes), so a handle colors identically on both
surfaces. An unregistered handle just hashes, same as an unlisted status.

Besides the board, the editor ships three read-only views over the same
embedded snapshot: **Map** (`waiting_for` dependency graph,
ghost stubs for off-board references), **Gantt** (working-range bars + due
diamonds per the date-triad semantics, grouped in `statuses` order, undated
cards in a chip row below), and **Calendar** (Monday-start month grid, range
chips + due markers, tap month navigation, and month/week/3-day/day sub-views
— the sub-month views are stacked tap-friendly day rows). Tapping a
card in any view opens its detail pop-up in place with the full
action set; edits always queue through the tray. The sheet
also carries two read-only "Dependency tree"/"Dependency path" buttons (any
card with a real id, including archived read-only sheets) — tapping one
writes `tree:<id>`/`path:<id>` into the search box and closes the sheet, no
view switch; the view underneath re-filters itself immediately (Map redraws
the pruned graph with ghost stubs where a cone edge exits the focus, Board
shows only the focused cards in their columns, same machinery every other
search term uses). Map view's own status-pill row also carries an
**"Epics" chip** (map view only) that toggles the `epic:` search term into
the box — tap sets it, tap again clears it — same "write straight into the
box, then re-render" pattern as the Dependency tree/path buttons above, but
a toggle rather than an overwrite. Epic-marked matches render as full map
nodes; their members still render as the usual dimmed ghost stubs, and
tapping an epic node opens its detail sheet with the same "Dependency
tree"/"Dependency path" buttons described above.

## The change loop

1. Human taps cards, queues changes; the tray shows every pending op with a
   remove button. Two-tap confirm on delete is the speedbump.
2. Human taps "Copy changes" and pastes the payload into chat:
   `Apply kanban changes (N ops, base <ISO>):` followed by a JSON op array.
3. Claude applies the ops to the card files. **Read
   `references/apply-protocol.md` before applying** — it defines op semantics,
   validation order, conflict policy, date-landing rules, id allocation, and the
   write mechanics for both local and Cowork (device-bridge) sessions.
4. Reply with a per-op result (applied / skipped + reason), append one entry to
   `notifications.md` per the notifications contract (TLDR-first `message`,
   `level`, enumerate what changed — the contract lives in the kanban skill's
   SKILL.md), then regenerate and redeliver a fresh editor with a new base
   stamp so the loop continues.

## Width tiers

The viewer is tap-first at every size — no layout tier changes the queue,
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
the page at every width — an earlier revision floated it as a fixed
bottom-left overlay; that read as "always on top" over board content and
was reverted. It's still gated by the exact same "any ops queued, or a
note to show" check `render()` always used, so it only appears while
there's something to show.

`hnav` (the horizontal-scroll step buttons on the Map view's dependency
graph) hides on `(hover:hover) and (pointer:fine)` — a **capability** query,
not a width breakpoint, so a touch device keeps the buttons regardless of
screen size and a mouse/trackpad loses them regardless of screen size
(scrollbars and shift-wheel cover it there). The scroll-button stack
(`#scrollbtns`, see below) sits outside every width tier and every media
query — it's the swipe-down insurance and context menu, unrelated to
layout. Font/tap sizing is untouched by width tiers.

The page title and the header's lead word are both the **board name** —
`config.yaml`'s top-level `name:`, the token that qualifies every card mention,
falling back to the folder above the board directory when the board hasn't
declared one (`read_board_name()`; only an UNINDENTED `name:` counts, since each
assignee entry carries its own indented one). The value is HTML-escaped and
substituted last, so a name can never smuggle in another template token.

The header line (`.hdr`: board name, base label, "N pending" pill,
🔔) is `position:sticky` at the top of `#scroll` at **every** width, not
just >=900px — it's the one piece of chrome deliberately exempted from
the width-tier split above. A scroll listener on `#scroll` toggles a
`.hdr.thin` class once the page has scrolled past a small threshold,
compacting the header's padding and title size so it stays out of the
way of board content; only the header line sticks, the search box and
view tabs scroll away normally. The "N pending" indicator (`#pill`) is a
solid accent-filled pill with bold white text — not just colored text —
so queued changes are never mistaken for already applied; it collapses
to nothing when no ops are queued, and stays tappable, jumping to the
tray at the bottom of the page.

## Mobile viewer notes (learned the hard way)

- The Claude mobile app dismisses the HTML viewer on swipe-down, so the editor
  ships a fixed scroll-button stack — do not remove it. The stack IS the
  context menu, and the ⋯ cycles THREE modes:
  **medium** (default: ▲ ▼ ⋯) → **extended** (the full context — no pop-up:
  ＋ ⤒ ⤓; card pop-up open: Archive/Delete SVG buttons
  ⤒ ⤓, no ＋; delete arms red on first tap, fires on second) → **off** (only
  ⋯, everything hidden incl. the ✕ — backdrop/Esc still close) → medium. An ✕
  rides above the ⋯ in medium/extended whenever a pop-up is open
  and the scroll buttons drive the pop-up's scroll area instead of the board.
  The header also carries a 🔔 with an unread badge: tapping it
  opens a read-only notifications sheet rendered per the notifications
  contract (TLDR bold, level tints, unread accent) from the embedded
  notifications.md snapshot — read-flips/clears stay conversational board
  writes. The "N pending" pill scrolls to the page bottom, same as ⤓. The card
  pop-up leads with a status/assignee/priority pill row — tap a pill to edit
  that field, tap the title to rename — and keeps
  the description dead last. New-card creation happens in the same
  sheet via Accept/Cancel; nothing joins the board until Accept. Board status
  sections are tap-collapsible and start collapsed on phone widths —
  name + count only — so the board opens as a compact overview; at >=900px
  live sections open by default and only Archive starts collapsed (evaluated
  once at load), with the status-pill row on its own line above the strip;
  queueing a create auto-expands the section the new card lands in.
- Inline chat widgets don't render on all clients; the HTML-file route is the
  reliable one. Clipboard access can fail in embedded viewers, so the payload is
  always also visible in a selectable text box under the Copy button.
- All card text is rendered via `textContent` (never string-built HTML) — card
  titles and bodies are user data; keep it XSS-safe by construction.
- Desktop right-click card menu (not the mobile scroll-button stack above,
  despite both being called "the context menu" — this one is a real
  right-click): on `(hover:hover) and (pointer:fine)` devices, right-clicking
  a live board card opens a hand-rolled menu at the cursor — Open, one
  "Move to `<Status>`" row per status in `statuses` order except the card's
  own, then (below a separator) Archive, Delete (arms red with "Delete?" on
  the first click, fires on the second, same two-tap shape as the mobile
  stack's own delete arm), Dependency tree, Dependency path — every action
  routes through the same `queue()`/`graphFocus()` machinery the detail
  sheet's own buttons use, no parallel path. Move is the tap-free
  alternative to drag-and-drop, which this editor deliberately does not
  offer (see below); because it rides `queue()` it inherits the `doing`
  entry gate unchanged — moving a card with unresolved `waiting_for` or a
  `blocked` sticker into `doing` is refused there with the reason left in
  the tray note, exactly as from the detail sheet's status pill. It closes on click-away, Esc, scroll, or switching views. The gate is
  checked per-event off a live `MediaQueryList`, so it never registers any
  behavior for a coarse-pointer device — no `preventDefault`, no menu; native
  long-press is untouched there. Archived cards are excluded for now — right-
  clicking one still shows the browser's native menu.

## What the editor deliberately does not do

Archived cards are read-only in the tap UI — restore or edit them
conversationally or in kanban-web. Everything else on a live card is tap-
editable, including dates/tags/`waiting_for` and unknown frontmatter keys
via the "All fields" grid (raw strings, `edit.fm` op). The payload
format still has room to grow; extend the op vocabulary in
`references/apply-protocol.md` first, then the UI.

**No drag-and-drop, at any width.** kanban-web moves cards by drag; this
editor moves them by the status pill or the right-click menu's "Move to"
rows. On touch that is a correctness call, not a taste one: the Claude
mobile app dismisses the HTML viewer on swipe-down, and a card drag is
indistinguishable from that gesture at gesture-start, so a misfire costs
the whole unsent op tray — which lives only in page memory until the
payload is pasted. Horizontal finger-drags were already rejected for the
weaker version of this problem (see `hscrollNav`, which exists because
sideways drags "bleed into vertical scroll and the artifact view hijacks
the gesture"), and native HTML5 DnD — what kanban-web uses — has no touch
support to reuse anyway. At >=900px the column strip could carry native
drag safely behind the same `(hover:hover) and (pointer:fine)` query
`hnav` uses, but that is precisely the tier where kanban-web is available
and writes straight to disk with no payload round-trip, so the viewer
leaves drag to it.
