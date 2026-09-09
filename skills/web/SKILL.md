---
name: kanban-web
description: Stand up a local web app (Node server + browser SPA) to edit a Markdown kanban board live — drag-drop cards between columns and full CRUD (create, edit, archive, delete), writing straight back to the *.card.md files. Use when the user wants an interactive, editable board in a browser (incl. VSCode's Simple Browser). Desktop/localhost only — for remote/mobile use kanban-cli; for AI-driven card management use kanban.
---

# Kanban Web (live editor)

Stand up a localhost web server whose **source of truth and persistence layer is the
board folder itself**. It serves a vanilla-JS SPA that renders the board and writes
every drag-drop / create / edit / archive / delete straight back to the `*.card.md`
files. Desktop/localhost only (ADR 0002); open it in any browser or VSCode's
**Simple Browser**.

The board file contracts — card fields, sticker predicates, the `doing` gate,
`config.yaml`, `notifications.md` — are defined once, in the `kanban` skill's SKILL.md;
shared vocabulary (waiting, blocked, review, archive) and cross-surface parity live in
CONTEXT.md. This skill documents how *this app* renders and edits against those contracts.

## Locating the board

`.kanban/` is the preferred board directory; `kanban/` remains supported as a fallback
for existing boards. Default to the current working directory's `.kanban/`, falling
back to `kanban/` when only that exists (`server.js`'s CLI entry point applies this
same discovery order when no directory argument is given — see Launching below). If
the user names a board, resolve its path directly (a board is any directory of
`*.card.md` files, conventionally `<project>/.kanban/` or, on an older board,
`<project>/kanban/`). The scripts live with this skill — find them with glob
`**/web/scripts/server.js` and use that `scripts/` dir.

## Launching

Start the server **in the background** (it runs until stopped):

```bash
node <SCRIPTS_DIR>/server.js <kanban-dir> [port]
```

- Pass `<kanban-dir>` explicitly (the path resolved above) — omitting it makes the
  server apply the same discovery itself, relative to *its own* working directory:
  `.kanban/` first, then `kanban/`.
- **Port precedence: CLI argument > `config.yaml`'s `port:` > default `7777`.**
  A board's `config.yaml` may carry a top-level `port:` key (same top-level-only
  rule as `name:` — an indented `port:` inside an assignee entry is not it; see
  the `kanban` skill's `config.yaml` section for the full key contract) to **pin**
  its serving port so a bookmarked or VS Code-tunneled URL never drifts across
  launches. The `[port]` CLI argument wins over the pin whenever it is a
  usable port number (a whole number in 1-65535) — it's the launcher's
  explicit override for one run. An argument that isn't (`0`, `abc`, `70000`)
  is treated as "no argument given" and falls through to the pin/default,
  saying so on stderr.
  - **No `port:` key:** unchanged default behavior — starts at `7777` and
    **auto-increments** past a busy port.
  - **`port:` set, no CLI argument:** the server binds exactly that port. If it's
    already in use, this is a **startup error, not a silent increment** — the pin
    exists so the address never drifts, so a busy pinned port fails loudly
    instead of quietly moving the board to a different URL. Free the port (or
    edit/remove the `port:` line) and relaunch.
  - **`port:` set to something unusable** (`port: seventy`, `port: 0`,
    `port: 70000` — anything but a whole number in 1-65535): the key is
    **ignored, never fatal**, and the board falls back to `7777` with
    auto-increment. The parser stays tolerant because every surface shares
    it, so the *server* is what complains: it prints a stderr line naming the
    offending value and warning that the URL can now drift. A typo'd pin is
    the one case where a board with a `port:` line still moves — treat that
    warning as "fix the line", not noise.
  - It always **prints the actual URL** on stdout
    (`Kanban app: http://localhost:<port> ...`, suffixed with
    `[pinned by config.yaml]` when the pin was used) — read that line for the
    real port, and relay the "pinned by config.yaml" note to the user when
    present.
- It writes `<kanban-dir>/.kanban-app.pid` (line 1 = pid, line 2 = **the real
  port actually bound** — the pid file and the log line always agree, pin or no
  pin). This dotfile is ignored by the board scripts (only `*.card.md` are
  cards).
- The `kanban-cli` and `kanban-viewer` skills ignore `port:` entirely — it's a
  serving fact for this app, not board content either of them renders.

Then open the URL. On Windows: `start http://localhost:<port>`. Tell the user they can
also paste the URL into VSCode's **Simple Browser** (Command Palette → "Simple Browser").

## Behind a VS Code tunnel

Reaching the board through a VS Code Remote Tunnel means the browser sees a
`https://<tunnel-id>.<cluster>.devtunnels.ms` origin, not `localhost` — the
Origin/Referer guard (SECURITY.md) refuses that origin by default. Forward
the server's port **Private** in the tunnel window, then start the server
with that tunnel origin allowlisted:

```bash
node <SCRIPTS_DIR>/server.js <kanban-dir> <port> --allow-origin https://<tunnel-id>.<cluster>.devtunnels.ms
```

`--allow-origin` is repeatable (`--allow-origin=<origin>` works too);
`KANBAN_WEB_ALLOWED_ORIGINS` (comma-separated) does the same from the
environment, and the two merge. Only `http://` and `https://` origins can be
allowlisted, and an entry that does not parse is a startup error — the server
never comes up half-configured. Both are opt-in and
default to nothing extra allowed — leave them unset and the guard behaves
exactly as it always has. The CSP (`'self'`) needs no change: the browser
still sees one origin, whichever one it loaded the app from.

## Stopping

```bash
# read the pid from the first line of the pidfile and kill it
kill "$(head -1 <kanban-dir>/.kanban-app.pid)"
```

(On Windows without a POSIX `kill`, use `taskkill //PID <pid> //F`.) The server is bound
to `127.0.0.1` only.

## What the app does

- **Config-driven columns** — the live columns come from `config.yaml`'s `statuses` list
  (ordered = column order), defaulting to `backlog → todo → doing → done` when absent;
  **Archive** is always the extra location-column at the far right, never a list entry.
  Drag a card between any live columns to move it. Landing in **todo** auto-stamps
  `start_date` (landing in **done** stamps `end_date`) with today's local date-only value
  when the field is empty — every status-changing path stamps the same way (drag, form
  edit, bulk edit, restore-into-column, creating directly into the column), pinned to the
  literal lowercase statuses like the doing gate; an existing date is never overwritten.
  Dragging a card into **doing** while it is **waiting** or **blocked** is **rejected**:
  the card snaps back with a toast naming which gate refused — "waiting on #3 (todo)" /
  "blocked: <reason>". The gate is pinned to the literal status `doing`, custom list or
  not, and is entry-only — no eviction; blocking a card already in `doing` leaves it
  there. A waiting card wears the amber left-accent plus a "Waiting on:" badge listing
  **unresolved ids only** (deps resolve against active + archived cards; a dangling id
  never shows; the badge disappears on its own when every dep lands). A blocked card
  wears a red "blocked" pill, tooltip carrying the reason; a `review` card — "finished,
  approve me", `blocked`'s sibling sticker (ADR 0009) — wears its own gold pill (tooltip
  carries the text) and does **NOT** join the doing gate: a card can enter or stay in
  `doing` while wearing `review`. Both stickers are searchable (`review:`/`blocked:`, see
  Search) and clicking either pill appends that bare term to the search box. A card whose
  on-disk status isn't in the list renders in the **first** column (the catch-all) with a
  small dashed raw-status chip; the file is **never rewritten** — promotion = the human
  adds the status to `config.yaml`, and the next poll files the card under its real
  column. **Colors:** the built-in four each have one fixed color used everywhere
  (backlog cyan, todo blue, doing green, done purple); the neutral grey belongs to
  Archive alone — no hashable palette slot is near-grey, and an unlisted on-disk
  `status: archive` **or `archived`** mutes to the archive grey instead of hashing. A
  custom status gets a deterministic color (its name hashed into a fixed 8-color palette)
  used by the column header, the map node's status dot, gantt group/bar, and the shared
  status-dot glyph (see Status dot). Orange is reserved for epics among the FIXED
  colors — no built-in status or archive ever wears it — but a custom status can still
  hash to the palette's orange slot (determinism, not uniqueness, is the hash contract).
  The form's status dropdown offers the list's values (an unlisted status on the card
  being edited is appended as "(unlisted)" so saving never silently rewrites it), and new
  cards default to the first column (a column header's **+** pre-selects its own column
  instead).
- **Collapsible columns** — every column header has a collapse/expand toggle. Collapsed =
  a narrow strip showing just the toggle icon and the card count; hovering it tooltips
  the full column name. Live columns default expanded, Archive defaults collapsed.
  Collapse state persists per column in `localStorage` (namespaced per board) and
  survives both a page reload and the 5s auto-refresh poll.
- **Equal-length columns, fixed headers** — every column (Archive included) stretches to
  match the row's tallest member, so a short column never stops short of a busy neighbor.
  The page header (title, search, view-switch/refresh/notif buttons) and every column's
  own header stay on screen while the page scrolls — both `position: sticky`, the column
  header parked just under the page header via a CSS var kept in sync with the page
  header's real rendered height by a `ResizeObserver` (a hardcoded px offset would drift
  the moment the header wraps). Board only — none of this reaches past `#board`.
- **Per-column sorting** — each (expanded) column header has a sort-field dropdown (ID /
  Priority / Due date / Last modified / Assignee) and a direction toggle. "Due date"
  sorts by the card's schedule — `due_date`, else `end_date`, else `start_date` —
  honoring time within a day (a date-only value reads as start-of-day); dateless cards
  always sort last, in either direction. Under a Due date sort the key driving a card's
  position is visible top-right on every tile (`⚑` marks a deadline; range dates show
  bare). "Last modified" sorts by the machine-maintained `updated` stamp, newest-first by
  default; unstamped cards always sort last. `updated` itself isn't shown on tiles (only
  in the card popup), so the what-you-see-is-what-sorted promise holds for Due date only.
  "Assignee" groups cards by owner, ranked by the config.yaml assignees registry's ORDER
  (not alphabetically); unregistered handles follow all registered ones alphabetically,
  and unassigned cards always sort last, in either direction. Priority defaults
  High-first; ties on any field break by id, ascending, so order doesn't reshuffle when
  you flip direction. Each column remembers its own choice independently, defaulting to
  priority-desc for live columns and id-asc for Archive — persisted in `localStorage`
  alongside collapse state, surviving reload and the poll, composing with search
  filtering. Hidden while a column is collapsed (nothing to sort there).
- **Search** — the header search box filters every view as you type; the query survives
  view switches and the poll. Space-separated terms AND together: `#42`/`id:42` is an
  exact card id; `title:` `body:` `status:` `priority:` `tags:` `file:` `assignee:` are
  case-insensitive substring scopes (`a:` is a thin alias for `assignee:`; a recognized
  scope with nothing after the colon yet — `status:` mid-keystroke — is dropped as
  not-yet-a-term rather than matching everything for one keystroke); `review:`/`blocked:`
  are sticker scopes — bare = the sticker is present, `review:PR`/`blocked:vendor` =
  case-insensitive substring on its text; unlike the field scopes, a bare sticker scope
  is a complete term, never dropped; `epic:` matches every epic-marked card — bare
  presence only, no value form (anything after the colon is ignored) and no negation;
  `tree:<id>`/`path:<id>` are dependency focus, `#` optional (`tree:74` = `tree:#74`) —
  grammar in the Dependency map section; bare text is a substring on title OR body OR any
  tag, and an unrecognized `foo:bar` prefix lands there too (searched as the literal
  string) rather than silently matching nothing on a typo'd field name. An autocomplete
  dropdown completes the last segment being typed — the bare term plus every
  field-scoped form of it; nothing is offered once the segment carries a colon, and
  `tree:`/`path:` are excluded (they take a card id, not free text).
- **Create** — "+ New card" opens a modal (title, status, priority, epic checkbox, tags,
  waiting-for ids, blocked reason, review text, AI prompt, assignee, start date, end
  date, due date, description). Dependencies and impediments are separate inputs:
  `f-waiting` ("Waiting for (ids, comma-sep)") takes the `waiting_for` dependency edges;
  `f-blocked` ("Blocked (reason)") takes the impediment sticker's reason as free text and
  wears a red border exactly while its value passes the blocked predicate, live as you
  type; `f-review` ("Review (text)") takes the `review` sticker's text — same predicate,
  same live border in gold. `f-prompt` ("AI prompt") is a third free-text field but NOT a
  sticker — see the AI prompt bullet. Every live **expanded column header also carries a
  small "+"** opening the same modal pre-aimed at that column — the hidden status field
  submits the preset even while the form is minimal, and "Show more fields" reveals the
  dropdown with it selected; Archive never shows the + (you can't create an archived
  card), collapsed strips don't either, and the global button keeps the first-column
  default. Next to the "+", same gate, sits an **AI-sparkle quick-create button** — the
  same pre-aimed modal, opened with the AI prompt row already revealed (`enableAiPrompt()`,
  the same helper the modal's own sparkle toggle uses), so "queue an AI-prompt card in
  this column" is one click. The modal opens **minimal-first**: Title (autofocused) plus
  Assignee (combobox suggestions included — column "+", type title, pick `@afk`, Enter
  queues a card to an assignee without opening "Show more fields") and a "Show more
  fields" button revealing the rest — one-way per open, nothing persisted; hidden fields
  still submit their untouched defaults, so a minimal save produces the same card a
  full-form save would. In the expanded/edit form the Assignee+dates row sits right after
  Title, so Tab visits Title then Assignee as the first two fields — Start/End/Due on the
  same row, everything else after. The date triad: start/end form the from-to **working
  range**, due is the independent **deadline**; each takes a date (`YYYY-MM-DD`) or local
  datetime (`YYYY-MM-DDTHH:MM`), never validated. Every date field has a 📅
  calendar-picker button — manual entry stays fully legal, and picking a day preserves a
  typed time tail. The popover carries a 🕒 clock toggle: ON reveals a hand-rolled HH:MM
  control and appends it to the value (default 09:00), OFF strips it back to a bare date;
  disabled until a date exists to attach a time to. Compat: a card with start + due but
  no end still ranges start→due. The server assigns the next id and writes a new
  `<0000-id>.<slug>.card.md` (id zero-padded to 4 digits, e.g. `0009.new-thing.card.md`).
- **Edit** — click a card's "Edit" to change its fields, title, and description. The body
  (incl. `## Narrative`) and any frontmatter keys the form doesn't manage are preserved
  verbatim; the form-managed fields (status, priority, epic, tags, waiting_for, blocked,
  review, prompt, assignee, start/end/due date) are re-written from the form. Clearing
  any managed field (a blank priority/assignee/date/prompt, empty tags or waiting_for, a
  blocked or review value failing the sticker predicate, an unchecked Epic) removes its
  frontmatter line entirely — no-data fields (empty string, null, empty array) are never
  written, so no `tags: []` boilerplate; id, status, and `updated` are always written,
  any real value including priority "Normal" stays, and readers default a missing
  priority to Normal. The 📅 pickers work here too. `updated` is machine-managed (see
  Last modified), never a form field.
- **AI prompt** — a hand-rolled inline-SVG sparkle button (ADR 0003 — same icon-btn
  styling as Save/Fullscreen/Close, tooltip "AI prompt") in the create/edit modal's
  header actions reveals/hides a single free-text input (`f-prompt`) writing the optional
  `prompt` frontmatter field (field contract: the kanban skill's SKILL.md) — a signal FROM a human TO whichever agent next processes
  the card, the **opposite polarity** of `blocked`/`review` (those signal from the card
  to a human) — including as a way to answer a `blocked` or `review` sticker without
  touching those fields directly. Turning the toggle ON while creating a NEW card also
  sets Assignee straight to `@afk`; flipping it on while editing leaves the card's
  assignee untouched, and the column header's AI-sparkle button lands on the same
  "prompt row open, assignee @afk" state through the same helper. That flip is the
  human's own form gesture — distinct from prompt *servicing*, which can never
  escalate a card to `@afk` (only the trusted card body may pre-authorize
  autonomous work). It is NOT a sticker:
  no presence predicate, no `doing`-gate involvement, and `eligible_cards.sh` (the
  kanban skill's pickup query) does not exclude on it. How a dispatcher discovers,
  consumes, and clears a queued prompt is out of scope — this app's job stops at the
  managed write: the lean rule (a blank clears the line), plus the value is always
  written **quoted** (the same contract `notifications.md`'s `message` field uses —
  free-form text routinely carries `:`/`#`/quotes that would corrupt an unquoted
  single-line value), an embedded newline collapsing to a space (frontmatter is one
  value per physical line). **Placement:** hidden, the row's slot sits after the
  Assignee+dates row, not gated behind "Show more fields", so it stays reachable from
  the minimal create flow. The instant it's shown — sparkle toggle or auto-reveal — the
  row physically moves to be the form's first field, ahead of Title: reaching for the
  sparkle means the prompt is the thing you're about to type. Hiding moves it back;
  Assignee stays the fixed 2nd focusable field whenever the row is hidden; CSS `order`
  is deliberately unused (Tab follows DOM order, not paint order). Opening the modal
  auto-reveals the row when the card being edited already carries a prompt — existing
  data is never hidden behind an unclicked toggle; new cards start collapsed.
  **Visibility:** nothing beyond the detail popup's frontmatter table, which renders the
  raw `prompt: "…"` line verbatim, escaped — deliberately no tile glyph, unlike every
  other flag field: the field's consumption lifecycle isn't built yet, so what
  "presence" should read as is undefined, and unbounded free-form text needs its own
  design pass for a board-scan cue. **One narrow exception:** a card with an EMPTY title
  but a prompt — e.g. dispatched by an external process before it's been given a
  title — shows the sparkle + the prompt text itself in the title's own spot, everywhere
  a title renders: board/Archive-column tiles, map node labels and the map's
  isolated-row tiles, gantt bar text / gutter label / due-marker tooltip, calendar chips
  and their "+N more" overflow tooltip, the detail popup's header title, and the
  single-card Archive/Delete `confirm()` text. Every call site reuses
  `cardTitleDisplay()` (card-title.js) — no forked title-fallback logic anywhere —
  paired with a `*-prompt-fallback` CSS modifier class (italic/muted, one per surface).
  It never appears once the card has a real title; the viewer's own reimplementation
  does not carry it. **Empty titles save** when a prompt is present: the form manages
  the title input's `required` dynamically — required UNLESS the prompt row is shown AND
  carries non-empty text, re-evaluated on every reveal/hide and every prompt keystroke.
  Server-side, `createCard` floors the title to "Untitled" only when BOTH trimmed title
  and prompt are empty (a space-only title satisfies native `required`, and a direct API
  caller bypasses the form entirely — without the floor a permanently blank tile could
  persist); a title-less card WITH a prompt saves title empty. The filename slug
  degrades with it: `<0000-id>.<slug>.card.md` collapses to the bare zero-padded id
  prefix (`0212.card.md`, no dangling `.`); past id 9999 the filename uses `card-<id>`
  to stay non-empty.
- **Epic/wayfinder** — the form's Epic checkbox (inside "Show more fields") writes the
  optional `epic: true` frontmatter field — a MANAGED boolean: unchecked (or a
  blank/false API value) removes the line entirely per the lean rule, so `epic: false`
  is never written; never validated (the reader takes any-case `true`). A hand-typed
  non-`true` value (e.g. `epic: yes`) reads as **not**-epic, so the checkbox opens
  unchecked and the next form save — however unrelated — removes that line: deliberate
  (a checkbox, unlike the free-text inputs, has no way to re-emit junk verbatim), pinned
  by a card-store test. An epic washes its whole surface in a faint EPIC_COLOR
  background (`#f0883e` at 12% alpha, `epicColorSoft()` in status-colors.js) — circles
  are reserved for STATUS alone, so the epic cue is a wash, never a dot. Board tile,
  calendar chip, and gantt gutter row share one `background` rule
  (`.card.epic`/`.cal-chip.epic`/`.gantt-label.epic`); the gantt BAR layers its wash via
  `box-shadow` (its `background` is the per-status fill's channel — the box-shadow
  composes with either the CSS-class or inline-style fill); the map node tints its SVG
  `<rect>` fill. A presence-based class doesn't compete with priority/waiting/due/status
  on any surface, so nothing needs to win or lose. Archived cards on the map keep the
  wash — in the graph proper or in the isolated row below: epic is durable identity, not
  location. The board's own Archive column renders through the same `archiveCardEl`
  builder but never opts in, so it shows no epic cue — that column isn't the map. The
  card detail popup gets the same wash on its panel (`.modal.detail-modal.epic`), driven
  by the fetched detail's `epic` boolean — the raw `epic: true` row still shows in the
  popup's frontmatter table; the wash is additive. Selection never swallows the wash:
  `.epic` and `.selected` are both 2-class selectors on the same property (`background`
  on tile/chip/gutter-label, SVG `fill` on the map node), so a 3-class override
  (`.card.epic.selected` etc.) outranks both, keeping the wash visible while selection's
  own outline/glow — properties `.epic` never touches — still show (the gantt bar needs
  no override: its wash is a `box-shadow`, a different property than
  `.gantt-bar.selected`'s `background`).
- **Status dot** — `statusBadge()` (status-colors.js) renders on every card rendering:
  board tiles (live AND archived — unlike the epic wash, the Archive column gets this
  one), the map's isolated-row tiles, calendar chips, and gantt gutter rows. A small dot
  colored via `statusColor()` off the card's RAW on-disk status, tooltipped with that
  same raw status — **the `archived` flag never touches this color**: status dots never
  mute, on any surface. The one exception is the literal on-disk status strings
  `archive`/`archived` themselves, which mute to the neutral archive grey — that IS
  `statusColor()`'s mapping for those two names, keyed off the raw string, not the
  `archived` flag. This is the HTML twin of the map SVG node's own status dot; column
  headers, gantt bar fills, and the calendar's priority/due cues are separate channels —
  one more glyph, not a recoloring.
- **Archived ball** — a second shared dot, `archivedBadge()` (status-colors.js): a fixed
  `ARCHIVE_COLOR` grey circle, tooltipped "Archived", joining `statusBadge()` on every
  surface that renders an **archived** card, and *only* those: Archive-column tiles and
  the map's isolated-row archived tiles (both through `archiveCardEl`, which calls it
  unconditionally — that builder never renders a live card), the map's own SVG nodes (a
  `map-archived-dot` circle twin, gated per node), the gantt's Archive-group gutter
  rows, and calendar chips (gated on `card.archived`, once the calendar's Archive pill
  opts archived cards in). **`cardEl` never renders it** — a live board tile is the one
  surface that structurally can't show an archived card. Glyph order, identical
  everywhere both dots land together: **status, archived** —
  `.status-dot + .archived-dot { margin-left: 4px; }` keeps the pair from fusing. On the
  map SVG the node is 58px tall, roomy for the dot column on its right edge. The gantt
  bar and the board tile's dim/grey-border cues are untouched — one more glyph on top,
  not a replacement.
- **Overdue cue** — `isOverdue()` (column-sort.js): the card's `due_date` day part is
  strictly earlier than today, and the card is neither `done` nor archived. Day-granular
  like every other date read in the app — a 09:00 deadline isn't overdue until the date
  rolls over — and keyed on `due_date` alone, never the `due`/`end`/`start` triad the
  Due date sort uses: a working range sliding past today is a schedule slip, not a missed
  deadline. An unparseable value never flags (fails safe rather than string-comparing
  free text). It recolors the deadline cue each surface ALREADY draws, in the same danger
  red as the blocked pill: the board tile's top-right schedule chip (text + weight — the
  tile's `border-left` is priority/waiting's channel, untouched), the calendar's due chip
  (border + `⚑` glyph, winning over that chip's amber), and the gantt's due diamond
  (fill). Tooltips say so in words too. Not a new glyph anywhere — nothing to lose to,
  and a card without a deadline can never show it. The Archive column's `archiveCardEl`
  renders the schedule chip but never this: archived retires the deadline by definition.
- **Assignee text color** — `assigneeBadge()` (assignee-badge.js) tints the handle text
  itself — the handle carries the color; there is no separate glyph. A config.yaml
  `assignees[].color` reservation wins; absent, the handle hashes into the same 8-color
  `STATUS_PALETTE` custom statuses use (assignee-colors.js's
  `assigneeColor`/`assigneeColorClass`). The hashed case gets an
  `.assignee-text--palette-N` CSS class — a parallel family to
  `.status-dot--palette-N`, same 8 hexes/numbering, but setting `color` not `background`
  (a hashed assignee CAN land on the same hex a hashed status does — one shared pool;
  determinism, not uniqueness, is still the contract). A RESERVED color is an open value
  space with no class to reuse, so the assignee span rides a `data-assignee-color`
  attribute instead; `paintAssigneeColors()` (app.js) paints it with one small CSSOM
  assignment after the tile's `innerHTML` lands — never a string style attribute (the
  CSP ships `style-src 'self'` without `unsafe-inline`, so inline `style` attributes are
  blocked; CSSOM assignment is the compliant path). Renders wherever `assigneeBadge()`
  reaches: board tiles (live and archived) and the map's isolated-row tiles. The
  edit/create modal tints the assignee input's own text directly (`syncAssigneeColor()`,
  always CSSOM) — synced on open and on every keystroke/combobox pick, the same
  "reflect the live typed value" pattern as the blocked input's red border. The viewer
  carries the same rule in its own reimplementation — see that skill's write-up.
- **Markdown body** — the detail popup renders the card body through `mdToHtml()`, a
  minimal dependency-free renderer (headings, bold/italic, inline code, fenced code
  blocks, links with a scheme allowlist, hr, `- [x]` task lists) that runs `escapeHtml()`
  on the raw body FIRST, before any tag synthesis — the only path from card text to
  `innerHTML`. Bulleted lists are indent-depth-aware: a sub-bullet indented under a
  parent nests into a real `<ul>` inside that parent's `<li>` rather than flattening to
  a sibling, any depth, tracked by comparing each line's indent width against the open
  levels. A wrapped line that isn't itself a `-` bullet (no blank line before it) is a
  lazy continuation of the last list item's text, appended in place, rather than closing
  the list and stranding a bare paragraph.
- **Last modified** — the detail popup shows a "Last modified" line: the card's
  `updated` frontmatter timestamp when present, else the file's on-disk mtime labeled
  `(file mtime)` as a fallback for cards written before the field existed. `updated` is
  stamped by the server on create and bumped on every content write — single edits,
  drag-driven status changes, and bulk edits alike, since all go through the same PATCH
  endpoint — and is left untouched by archive/restore (those move the file, not its
  content). ADR 0008.
- **Archive** — moves the card's file into `<kanban-dir>/archived/` (a *location*, not a
  status; status is left as-is). Archived cards live in the Archive column, right of
  Done; clicking a tile opens the same detail popup as a live card (no Edit/Archive
  actions, since those don't apply to an already-archived card), and each tile keeps
  **Restore** and **Delete** buttons. `archived/` is read **recursively** (ADR 0010), so
  a card filed in an `archived/<package>/` folder shows in the Archive column, resolves
  dependencies, and restores exactly like one at the `archived/` root — Restore always
  returns it to the board root, never to a package.
- **Archive packages** — the bulk menu's **Archive selected** opens an Archive popup
  whose one field is the package: a combobox completing against the board's existing
  `archived/<package>/` folder names (`archivePackages` on `/api/board`), suggest-never-
  validate like every other combobox here, so a name matching nothing is a NEW package
  and creates `kanban/archived/<name>/`. Left empty it archives to the `archived/` root,
  byte-identically to the package-less paths — drag-to-Archive and the tile/detail
  Archive button never ask, they always write to the root. The popup closes on Esc, its
  X, or a backdrop click (all three cancel the archive — nothing has moved yet), and it
  carries no fullscreen toggle: one field has nothing to expand. A package name must be
  one plain path component; a nested path or a `.`/`..` hop is refused with a 400.
- **Delete** — permanently removes the card file (after a confirm).

- **Multi-select** — one interaction grammar, uniform across **all four views**
  (ADR 0006), with file-manager gestures: click a card's representation to open its
  detail popup, ctrl+click (cmd on mac) to toggle it in/out of the selection,
  shift+click to ADD the whole range between the anchor (the last toggled/range-started
  card) and the target — in the active view's rendered order, additive, never
  deselecting — right-click for the bulk context menu. Applies on board tiles (live and
  archived), map nodes and the map's isolated-row tiles, calendar chips (every chip of a
  multi-day run highlights together — selection is by card id), and gantt bars **and
  their gutter labels** alike. Each view paints its own selected marker
  (board/calendar/gantt: blue outline + dark wash; map: dark wash + blue glow — the
  node's border, status dot, and epic wash are unaffected). Right-click: an unselected
  card becomes the selection in the same gesture; an already-selected one keeps the
  whole batch as the target. The menu — **Assign…**, **Set priority…**, **Edit tags…**,
  **Schedule…**, **Dependency tree**, **Dependency path**, Archive, Restore, Delete —
  acts on the selection regardless of which view opened it. **Dependency tree**/
  **Dependency path** are sugar over the `tree:<id>`/`path:<id>` search terms: clicking
  one replaces the search box's content with that term for the single selected card and
  runs the normal search — no view switch. They're the only menu items conditionally
  hidden: the other seven always render (mixed-selection handling lives inside each
  click handler), these two hide whenever the effective selection is more than one card.
  Any plain click outside the context menu / bulk popups clears the selection (empty
  calendar day cells and map/gantt whitespace included); the view-toggle buttons are
  exempt, so the selection **survives switching views**, and it survives the poll.
  Exceptions: the map's dimmed ghost stubs are click-through-to-detail only, never
  selectable — they stand for cards the active filters hid; a dangling-id stub (no such
  card) is fully inert, and a filtered-out card can't join a selection anywhere else
  either. Assign/priority open a single-choice popup with the usual combobox suggestions
  (empty assignee + Apply = bulk unassign); Edit tags is a workbench — add a tag to
  every selected card (deduped), or tick tags in the union-with-counts list and
  bulk-remove them; Schedule… edits the date triad in one popup (From/To/Due, each with
  the form's free-text input + 📅 picker): per field, a typed/picked value sets it on
  every selected card, ticking *clear* blanks it (clear wins over a typed value), and an
  untouched field leaves each card's own value alone. Bulk edits take no confirm (Apply
  is the speedbump; edits are reversible) and the selection survives, so actions chain
  on the same batch. Dragging a selected card moves the whole selection **on the board
  only** (cards the doing gate refuses — waiting or blocked — are skipped per card, with
  one summary toast naming which gate); calendar/gantt drags always move the single card
  under the pointer, selected or not.
- **Hover/focus highlight** (kanban.proj#261) — resting the pointer over, or moving
  keyboard focus onto, any piece of a card lights every piece sharing its id, the same
  card-el grammar and same "one card, several DOM elements" reach as selection: on the
  calendar a run cut at a week boundary is two chips, and the card's own deadline chip is
  a third on a different day — this is the only way to see a card's whole extent at a
  glance. A background wash (`hoveredId`, app.js, one id — never a Set, only one card is
  hovered/focused at a time), a different tone from selection's navy `#0d1b2a` so the two
  never read alike, and never an outline, so a selected card stays reading as selected
  while hovered. Applies everywhere `.selected` does (board tiles, archived tiles,
  calendar chips on the month grid AND the sub-month grids, gantt bars and their gutter
  labels, map nodes) except the gantt's due diamond, which `.selected` skips too. Every
  card-representing element carries `tabindex="0"` for this (Tab reaches the same cue the
  mouse does), plus a dashed grey `:focus-visible` ring — the wash rides one shared
  `hoveredId`, so the pointer wandering onto another card takes it off the card that still
  holds keyboard focus, and the ring is that card's own cue nothing can steal. Cards are
  deliberately NOT in the `boardControlFocused` poll guard the other rebuilt controls sit
  in: a plain click leaves a card focused indefinitely, so blocking there would quietly
  freeze the refresh; `applyBoardData` re-finds the focused card after the render instead.
  Two delegated pairs on `document`, mirroring the click/contextmenu pair
  above: `mouseover`/`mouseout` and `focusin`/`focusout`, each just keeping `hoveredId`
  current and repainting the *current* DOM directly — a full `renderBoard()` per mouse
  move would be needless work. The auto-refresh poll's own full rebuild carries the
  highlight forward on its own: every render call site reads `hoveredId` the same way it
  already reads `selectedIds`, so a poll landing under a stationary pointer doesn't lose
  the highlight the way a naive `:hover`-only or event-only approach would.
- **Speedbumps** — every destructive action confirms first, naming its object: archive,
  delete, bulk archive/delete (one confirm per batch, with the count), notification
  delete and clear-all. Restore is exempt (it's the reversible direction). Clicking the
  backdrop closes any popup; the create/edit form interposes a confirm only when it has
  unsaved changes. Archiving skips the confirm when EVERY card in the action is already
  `done` — the tile's Archive button, drag-to-Archive (single or batch), and the bulk
  menu's Archive selected share one pure rule (`archiveNeedsConfirm`, selection.js); a
  single non-done card in the batch keeps the confirm. Archive selected then asks WHERE
  in the Archive popup (packages, above), whose Archive button is the act itself —
  closing that popup cancels the whole batch.
  **Esc** closes whichever popup is open, on the very first press, regardless of
  fullscreen state — only the fullscreen toggle button changes fullscreen. The detail
  popup and the create/edit form (through the same unsaved-changes guard the X button
  uses) close directly on Esc, and so do the three bulk-edit popups (Assign/priority,
  Edit tags, Schedule…) and the Archive popup — speedbump-exempt, same as their
  backdrop-click. An open
  combobox menu gets first crack at Esc: it closes the MENU only, one level at a time,
  before the popup-level handling ever sees the key.
  **Alt+Enter** toggles fullscreen on whichever fullscreen-capable popup is open
  (detail, create/edit, and the three bulk-edit popups) — the keyboard twin of that
  popup's fullscreen toggle button, updating the same persisted per-modal-type
  preference. Works with focus anywhere inside the popup, form fields included; an open
  combobox menu exempts alt-chorded Enter, so the hotkey wins there too (plain Enter
  keeps the menu's pick grammar). No popup open = no-op; the notifications popup isn't
  fullscreen-capable.
  **Ctrl+S / Cmd+S** saves the open popup — the keyboard twin of its Save/Apply button.
  Only popups with ONE unambiguous save action participate: the create/edit form and the
  Assign/priority and Schedule… popups; Edit tags has two competing actions (add /
  remove), so Ctrl+S there stays a no-op rather than guessing. The chord is strict —
  exactly Ctrl+S or Cmd+S; Alt or Shift chords never match (save-hotkey.js).
  **Ctrl+F / Cmd+F** focuses the search box instead of the browser's find bar
  (`preventDefault`) and pre-fills `#` with the caret right after it, so typing digits
  immediately forms the `#<id>` exact-match term (erase the `#` by hand for any other
  query — cheap). A box already holding a query gets select-all instead of the `#`
  prefill — typing overwrites it, same as any focused input — so the chord can never
  silently clobber a typed query (search-hotkey.js owns this decision). Suppressed while
  any modal/popup is open — the mirror of Ctrl+S, which only fires *inside* an open
  popup: every popup's backdrop covers the whole viewport, hiding the search bar behind
  it, so this hotkey only fires *outside* one and the browser's native find stands in
  while a popup is up.
- **Comboboxes** — the form's Assignee (and Priority/Tags, incl. the bulk-edit popups'
  copies) fields suggest values from `config.yaml`'s lists (see below) while still
  accepting free text. Tab/click focuses and opens the full list; typing filters it.
  ArrowDown/ArrowUp move a wrapping highlight through the open menu (scrolled into view,
  never hidden past the menu's 180px-max-height fold), Enter picks the highlighted row,
  Esc closes the menu only (never bubbling into the popup-level Esc above). Enter
  reaches the surrounding form's native submit-on-Enter ONLY when the menu is closed —
  any other Enter is consumed by the menu itself (picks if something's highlighted, else
  just closes it) — so the keyboard flow "type title, ArrowDown+Enter to pick @afk,
  Enter to submit" takes two Enters; the mouse-pick flow (click a suggestion, then
  Enter) submits on one, since the mousedown pick already closed the menu. Hand-rolled
  menus, not `<datalist>` (ADR 0003): native datalists misrender inside VSCode's Simple
  Browser.
- **Refresh** — the app re-reads the folder on a 5-second poll, surfacing edits made by
  `/kanban`, hand edits, or another tool; the header Refresh button forces a re-read
  immediately. View mode, query, filters, selection, and collapse/sort state all survive
  the poll.
- **Deep links** — loading the app with `?card=<id>&view=<board|map|gantt|calendar>` in
  the URL switches to the named view, opens that card's detail popup, and scrolls its
  representation into view (found by `data-id` in whichever view container is now
  active, same lookup the shared card-el grammar's click handler uses) — a bookmarkable
  or shared link straight to one card. An unrecognized `view` value (or none) leaves the
  persisted/default view untouched; an id that doesn't resolve to any active or archived
  card (missing, non-numeric, or just unknown) shows a toast instead and the app loads
  normally, no view switch and no popup. This is a one-time override, consumed exactly
  once right after the very first load — it composes with, but never fights, the 5s poll
  or the `localStorage`-persisted view mode (view.mode, above): the deep link's view
  isn't written back to storage, so a later plain reload with no querystring resumes
  wherever the view toggle last left it, and the poll's own re-renders never re-read the
  URL. Pure querystring parsing lives in `deep-link.js` (dual-environment export, same
  pattern as `refresh-policy.js`/`search-hotkey.js`); switching the view, opening the
  popup, and scrolling are app.js's job.
- **Copy board path** — a small ⧉ button inside the header title copies the board
  directory's **absolute path** (the `GET /api/board` payload carries it as `boardDir`,
  `path.resolve`d server-side — a relative path is useless pasted elsewhere). Same
  clipboard ladder as the detail popup's "Copy path" button: async clipboard API first,
  textarea+execCommand fallback on rejection or absence (load-bearing in VSCode's Simple
  Browser, which doesn't grant the async API a secure context) — with a toast on BOTH
  outcomes (the glyph-sized button has no room for the detail button's label swap).
  Web-only by design — see CONTEXT.md's parity table.
- **Notifications** — the header bell surfaces entries from
  `<kanban-dir>/notifications.md` (writer contract: `/kanban`'s SKILL.md; same file
  shape, not a second contract): unread-count badge, a toast once per session when new
  unread entries arrive on the poll (toasts dismiss on click, or on their own after a
  few seconds), and a popup listing all entries newest-first with per-entry remove and
  clear-all. Opening the popup marks everything read, persisted back to the file.
  Entries render per the contract: the TLDR segment (the message text before `; more: `)
  is bold, and `level` tints the entry — `debug` dimmed, `warning` amber, `error` red,
  absent = `info`; all levels show, no filtering. Per-entry remove and clear-all
  ARCHIVE, never delete: entries move verbatim (append) to
  `<kanban-dir>/archived/notifications.md`, created if absent. Entries missing a numeric
  `id` or a non-empty `message` are skipped by the reader (never fatal); the next
  managed rewrite (mark-read / remove / clear-all) moves their raw blocks verbatim to
  the archive too — deletion never happens, malformed writes included.
- **Dependency map** — a top-bar "🕸 Map view" button swaps the board for a hand-rolled
  layered SVG graph: nodes are cards (id + title), edges are `waiting_for` (arrow from
  the depended-on card to the card waiting on it, same direction as the `kanban-cli`
  skill's Mermaid printout). Nodes come from both live and archived cards — blocking is
  location-independent.
  **Epic membership:** the epic is the SINK — it closes only when its children close, so
  under the map's down-is-later convention it lays out BELOW its children. The epic's
  color flows ALONG the chain rather than fanning from every member: a `waiting_for`
  edge whose two endpoints share the same `parent: <epic-id>` draws SOLID EPIC_COLOR
  orange (still a real, gate-enforced dependency — only tinted), while ONLY the chain's
  terminal members (no other member of the same epic waits on them; a chainless member
  counts as its own one-card chain) draw the dashed orange membership hop into the epic,
  orange arrowhead on both kinds. Terminality is computed on the full board — a search
  filter never reroutes membership. Mixed edges (one endpoint outside the epic) and
  cross-epic edges stay plain grey, and every epic shares the one EPIC_COLOR (the color
  says "epic work flowing to its sink", not which epic). Membership gets the same
  ghost-stub courtesy as `waiting_for` (hidden endpoint → dimmed stub; dangling id →
  "not found" stub; self-parent ignored), but it is NOT a dependency: it never makes a
  card waiting, the `doing` gate ignores it, and the isolated row below stays keyed off
  `waiting_for` edges only — so an epic whose only edges are membership appears in the
  graph AND the no-dependencies row, both. A dep edge between terminal and epic in
  either direction suppresses the membership hop (sequencing wins the pair:
  same-direction overlap would hide a real dependency under the orange;
  opposite-direction would fabricate a 2-cycle bow).
  **Node treatments:** the border is one neutral weight for every node — status never
  strokes it. A small dot in the node's corner carries the status color (same palette as
  the column headers), its own tooltip naming the **raw on-disk status**; status dots
  never mute for archived nodes — on any board with archived history, archived chains
  dominate the map, and muting would empty the one channel that carries status. The
  archived cues are their own channels: the node strokes a visibly lighter grey
  (`#6e7681`) than the plain neutral (`#30363d`), the SVG tooltip gains an "(archived)"
  suffix, and the grey **Archived ball** (above) joins the dot column — an archived node
  carries its true status color, a grey border, and a grey ball at once. Two more border
  exceptions, board-tile parity: a high-priority card strokes the node red (`#f85149`)
  and a **waiting** card strokes it amber (`#d29922`) — the exact colors the board tile
  (`.card.high`/`.card.waiting`), calendar chips, and gantt bars use, via the same
  precomputed flags rather than a map-only reclassification. Waiting wins over high when
  a node is both, same declaration-order convention as every other surface. Mutually
  exclusive with the archived stroke — an archived node never gets the priority/waiting
  stroke, matching how the Archive column's tiles never wear those classes either. The
  manual **blocked** sticker is no border at all: a blocked node wears a red pill (same
  `#f85149` as high priority) — the map twin of the board tile's blocked pill,
  tooltipped "blocked: <reason>" (bare "blocked" when the reason is unspecified) — shown
  on archived nodes too: a stop sign is identity, not location, and unlike the stroke it
  doesn't share a channel with the archived grey. Cycles in `waiting_for` render as a
  visibly distinct amber curved "back edge" rather than hanging the layout.
  **Status-filter row** — one toggle pill per board column (the configured statuses in
  column order + Archive, the location pseudo-column), each bordered in its column's
  color — all ON by default, and the row renders even when everything is filtered out
  (so a toggle can always be turned back on). **Pill interaction grammar, shared by
  every status-filter row in the app** (this one, the gantt's, and the calendar's):
  left-click toggles that one pill on/off; right-click SOLOs it — that pill on, every
  other pill in the row off — and right-clicking the already-soloed pill again restores
  ALL pills on. `contextmenu` is suppressed only while the pointer is over the pill row
  itself; everywhere else (map nodes, isolated tiles, calendar chips, gantt bars) keeps
  the shared right-click bulk menu untouched. A pill OFF hides that column's cards from
  the map: an unlisted on-disk status follows the FIRST column's pill (the catch-all —
  exactly where the board files the card) and archived cards follow the Archive pill
  regardless of their parked status. The choice persists per board in `localStorage`
  (`map.statusFilter`, merged defensively like collapse/sort state) and composes with
  search by **intersection** — a card stays visible only when both agree. The active
  search query filters the map exactly as it filters the board: matching cards are full
  nodes; a card hidden by either filter that's still referenced by a visible one's
  `waiting_for` (in either direction) renders as a dimmed, dashed ghost stub — never
  silently dropped — and is itself clickable through to its detail popup. A
  `waiting_for` id with no matching card at all renders as a "not found" ghost. Cards
  with no dependencies in either direction always render in a detached row below the
  graph. Real nodes + isolated-row tiles carry the full shared grammar (click for
  detail, ctrl/shift-select, right-click menu); ghost stubs stay click-through only.
  View mode, query, and status filter all persist across the poll's re-render.
  **`epic:` term + the "Epics" chip** — `epic:` matches every card with `epic: true`
  (bare-scope term, see Search). It composes with the rest of the query, bare text, and
  the status pills by the usual intersection rule, and filters board/map/gantt/calendar
  alike (a plain search term, not map-specific). The map's control row carries an
  **"Epics" chip** (map view only) that toggles it into the search box — tap sets
  `epic:`, tap again clears it — the same "write straight into the search box" pattern
  as the Dependency tree/path menu items, but a toggle rather than a replace. With
  `epic:` active, matching epics render as full nodes and their members still render as
  the usual dimmed ghost stubs; right-clicking an epic node still offers `tree:<id>` to
  expand its subtree.
  **Collapsible sections** — the layered graph and the "No dependencies" row each get
  their own collapse/expand toggle (same chevron + look as the board's per-column
  collapse), sharing one header builder. State persists per board in `localStorage`
  (`map.sections.collapsed`, merged defensively) and survives the poll; collapsing
  skips the expensive layout/SVG work entirely rather than hiding it via CSS.
  **Dependency tree / Dependency path** — a second way to populate the map's visible
  set, alongside typed search and the status pills: the `tree:<id>` and `path:<id>`
  search terms, resolved over the SAME edge set the map draws (`waiting_for` + `parent:`
  membership, with sequencing-wins-the-pair/terminal-only suppression already applied —
  see dependency-graph.js's `treeIds`/`pathIds` for the grammar, not restated here).
  `tree:` is the connected component (every card the id's dependency web touches,
  undirected); `path:` is the narrower directed cone — everything transitively upstream
  and downstream through the id, excluding sibling branches. Traversal is ALWAYS over
  live + archived cards; an archived member's on-screen visibility still follows the
  Archive pill, same as any other search hit. Composes with the rest of the query and
  the status pills by the usual intersection rule; an unknown id matches nothing (no
  error), and a card with no edges resolves to a component/cone of one — itself.
  Focusing hides everything outside the result and re-lays-out, exactly like a typed
  search — a cone edge exiting the focused set renders as the existing ghost stub, no
  new rendering path. The right-click menu offers these as sugar — see Multi-select.
  Mirrored in cli (scoped Mermaid views) and the viewer (same search terms + card-sheet
  tap actions) — see CONTEXT.md's parity table.
- **Calendar view** — a top-bar "📅 Calendar" button swaps the board for a month grid
  (weeks start Monday; prev/next/Today controls; outside-month days dimmed, today
  highlighted). Live cards by default; dated ARCHIVED cards join too, opt-in via the
  Archive pill below. The **working range** (start→end inclusive; compat: start→due when
  there's no end date) renders as ONE chip spanning its real day columns, not a chip
  per day — laid over the day cells on a packed row, so disjoint runs share a row and
  overlapping ones stack. A run crossing a week boundary is cut into one piece per week
  row (a DOM element can't span the wrap), each cut edge squared + dashed like the
  all-day band's window-clipped spans; a run reaching past the grid's own first/last
  cell is cut the same way. A one-date range is a single-column chip; a reversed range
  collapses to one chip at the range end. The **due date** renders as its own
  deadline chip (amber border + ⚑ flag, red once **overdue**) on its due day — even
  when the range already covers that day. Datetime values show their time on the
  piece holding the range's true end day.
  Weeks needing more than 4 chip rows fold the rest into a tooltip-titled "+N more" line
  for that week (each week row has its own budget). Chips carry the
  shared grammar: click opens the detail popup, ctrl-click toggles / shift-click
  range-selects (all chips of that card highlight together), right-click opens the bulk
  menu; clicking an empty day cell clears the selection. Dragging a **range chip** moves
  the range: the drop day becomes the range end and the start shifts by the same delta
  (duration + times-of-day preserved), writing the fields the range actually used — a
  compat range shifts start + due and never invents an end date. One-date ranges move
  their one field. Dragging the **due chip** moves the due date alone (time preserved) —
  on a compat card that also moves the rendered range's end, since due IS that range's
  end field. Same-day drops don't write. Composes with search exactly like the board;
  the displayed month + query survive the poll. Board/map/calendar/gantt is a four-way
  switch persisted per board in `localStorage` (unknown saved values fall back to
  board).
  **Status-filter row** — a pill row above the grid (month AND every sub-view alike),
  sharing the map's pill-row MECHANISM (one builder, comma-joined CSS) rather than a
  duplicate: one toggle per LIVE board status in column order, all ON by default, PLUS
  an Archive pseudo-pill (same id list as the gantt's row) that defaults **OFF** — the
  base calendar stays live-only until a human opts in (same merge helper as the gantt's
  row: a saved value with no `archive` key merges in OFF, never ON). Flipping Archive ON
  adds every dated ARCHIVED card (search-filtered, ungoverned by the live status
  pills — same as the gantt's Archive group) to BOTH the month grid and the time grid's
  all-day band/hour rows. An archived chip gets the shared **Archived ball** right after
  its status dot, is not draggable (native drag never starts, so unlike the gantt's
  pointer-drag there's no fake-drag animation to guard against), and shows a not-allowed
  cursor. Its priority/waiting left-accent keeps showing — a separate channel from the
  archived cue, same as the gantt bar (an archived-and-high-priority card still reads
  high). Persists per board in `localStorage` under its own key
  (`calendar.statusFilter`, same defensive-merge discipline as
  `map.statusFilter`/`gantt.statusFilter`) and composes with search by the same
  **intersection** rule the map/gantt use (the search pool itself spans live + archived
  unconditionally — harmless while the pill is off). A live-status pill OFF drops that
  status's chips from the grid outright via the gantt's visible-ids helper (not the
  map's column-bucketing one) — the calendar doesn't bucket cards into board columns any
  more than the gantt does, so an on-disk status the `statuses` list doesn't include
  stays ungoverned by any pill, same as the gantt, rather than riding an unrelated
  toggle. Renders unconditionally ("always leave a control to turn a pill back on") and
  shares the pill interaction grammar (left toggle, right solo) with the map/gantt rows.
  **Sub-views** — the calendar header carries an Outlook/Teams-style
  Month | Week | 3 days | Day switcher (persisted per board under `calendar.subview`;
  unknown saved values fall back to Month, which is exactly the grid above). Sub-month
  views show one column per day (week starts Monday; 3 days = anchor day + the next two;
  today's column highlighted): an **"all day" band** on top holds date-only cards and
  multi-day ranges (spans cover their real columns and pack into shared rows; a span cut
  by the window edge squares off + dashes on the cut side), and a scrollable **24-hour
  grid** below places datetime-carrying cards at their time — a same-day datetime
  start→end spans its real duration, a lone time-point (datetime start/end/due without a
  counterpart) gets a default 60-minute block, and overlapping blocks share the column
  side-by-side. prev/next/Today step by the active view's span; ONE anchor day drives
  all four sub-views, so the displayed window carries across switches and survives the
  poll. Chips keep the shared grammar. The all-day band and month grid keep the native
  day-granular drag (date moves, time-of-day preserved) — including date-only cards.
  Dropping a date-only all-day chip onto the hour grid still only moves its DATE — the
  drop target there is day-granular, so no time is ever invented; it lands back in the
  all-day band on the new day. Assigning a time via a drag is out of scope (no crossing
  between the all-day band and the timed grid) — add a time by editing the card.
  **Time-grid drag/resize** — the hour-grid timed blocks (week/3day/day) get
  minute-granular retiming via a custom pointer-drag (like the gantt's, but in MINUTES
  within a day — native HTML5 drag can't give continuous pixel deltas), so a timed block
  is `draggable:false` and this system owns it; the all-day/month chips keep native
  drag. **Body-drag** moves the block on BOTH axes — the column under the pointer is the
  new day, the y-position (snapped to a 15-min grid) the new start time; a real duration
  keeps its length (clamped inside the day), a one-time point moves its timed field (its
  date-only sibling follows the day so a same-day range never splits), the due block
  moves `due_date` alone. **Edge handles** (a thin strip top and bottom, `ns-resize`)
  appear ONLY on a real same-day duration block: top handle = start time, bottom = end
  time, each clamped to a 15-min minimum span and the `[00:00, 23:59]` day bounds — a
  compat range's bottom handle edits `due_date` and never invents an `end_date`, same
  fields contract as every other drag. All math is pure calendar-model.js functions,
  null on a zero-delta so an accidental twitch never spends a PATCH or `updated` bump.
  The gesture reuses the gantt's interaction grammar: `>3px` before a drag commits (an
  unmoved press is a click → detail popup), a one-shot phantom-click suppressor,
  drag-in-progress poll guards, and the archived-read-only guard (a toast, before any
  pointer capture). Deliberately out of scope: resize handles on point/due blocks (that
  would *create* a missing field, a distinct feature), dragging a timed block into the
  all-day band or vice-versa, cross-midnight/multi-day resize, and auto-scroll near the
  grid edge.
  **Click-to-create** — ADR 0006 pins a plain click on empty calendar space to clearing
  the selection, so create rides a DIFFERENT gesture: double-click. Double-clicking
  empty space in the month grid, the all-day band, or a time-grid day column opens the
  create modal pre-aimed at the click, same hidden-field-submits-while-minimal trick as
  the column "+" but for the start date alone — month/all-day gives a date-only
  `start_date`; a time-grid slot gives a `YYYY-MM-DDTHH:MM` snapped to the same 15-min
  grid the drag/resize uses. Only `start_date` is pre-filled — never `due_date`
  (ADR 0007: start is the working range's "from") — and status is left at the modal's
  own default, unlike the column "+", since a calendar cell doesn't imply one. A
  double-click landing on a chip is the chip's own affair (the shared card grammar),
  excluded before the cell/column lookup ever runs. cli has no calendar (see CONTEXT.md's
  parity table) and the viewer's own calendar has no click-to-create — a deliberate,
  unbuilt gap.
- **Gantt view** — a top-bar "📊 Gantt" button swaps the board for a day-granular
  timeline: each dated live card gets a row (dated ARCHIVED cards join too, opt-in via
  the Archive pill below) — the **working range** as a bar (start→end inclusive; compat
  start→due; one-date and reversed ranges collapse to a 1-day bar — same shapes as the
  calendar) and/or its **due date** as an amber diamond marker (red once **overdue**; a due-only card shows
  only the diamond, no bar) — grouped by status in board column order with a slim label
  row per non-empty group, ids ascending within it. A fixed left gutter lists #id +
  title per row; only the timeline half scrolls horizontally. Mondays are labeled with
  the date and a vertical "today" line marks the current day. The window spans the
  rendered bars AND diamonds, padded 3 days each side, clamped to at most 180 days
  centered on today (slid to stay inside the data's range) when a board sprawls wider.
  Bars use the map view's status palette plus the board's priority/waiting left-accent
  cues. Bars, diamonds, **and gutter labels** carry the shared grammar: click opens the
  detail popup (the label is the only click target for a bar scrolled or clipped out of
  view), ctrl-click toggles / shift-click range-selects, right-click opens the bulk
  menu — a drag is never treated as a click (>3px of movement commits the drag and
  suppresses the click). Drag the bar body to shift the range by whole days (duration +
  times-of-day preserved), writing the fields the range actually used — a compat range
  shifts start + due, never inventing an end date; drag an edge to move that range
  endpoint alone (start handle → start date, end handle → end date, EXCEPT compat
  ranges where the end handle edits the due date — the field the range used), clamped at
  a 1-day bar minimum (an end-only bar's start handle *creates* a start date; a
  start-only bar's end handle *creates* an end date); drag the diamond horizontally to
  move the due date alone — on a compat card that also moves the rendered range's end,
  since due IS that range's end field. Same-position drops don't write. Dragging a bar
  clipped by the window edge edits the card's true dates — the visible clip edge may not
  appear to move until the window re-derives. No dependency arrows — the map view owns
  the `waiting_for` graph.
  **Status-filter row** — a pill row above the timeline, sharing the map's pill-row
  MECHANISM: one toggle per LIVE board status in column order, all ON by default, PLUS
  an Archive pseudo-pill (same id list as the map's row) that defaults **OFF** —
  archived rows are opt-in, so the base gantt stays live-only. Flipping Archive ON
  appends ONE more group AFTER the live status groups — every dated ARCHIVED card,
  regardless of its own parked on-disk status (gantt-model.js) — same "location after
  live columns" placement as the board's Archive column. Archived rows split across two
  channels, deliberately: the BAR's border/fill and the group label key off the literal
  `'archive'` string, which `statusColor()` mutes to the neutral archive grey — a
  row-level archived cue like a board tile's dimming, same as the bar's not-allowed drag
  cursor — while the gutter row's own status dot does NOT follow that mute (status dots
  never mute, gantt gutter included) and colors off the card's true on-disk status
  regardless of `card.archived`. The rendered window includes archived bars/diamonds
  ONLY while the pill is on — turning it off narrows the window back to the live data,
  same re-derive-from-what's-rendered rule below. Persists per board in `localStorage`
  under its own key (`gantt.statusFilter`, same defensive-merge discipline as
  `map.statusFilter` but its own default-shape merge helper: a saved value with no
  `archive` key merges in the OFF default, never ON) and composes with search by the
  same **intersection** rule the map uses — search spans live + archived cards alike,
  though only archived ones that also survive the Archive pill (and any status pills)
  ever render. A live-status pill OFF drops that status's rows from the timeline
  outright — there's no dependency graph here for a hidden row to ghost into, so the
  window simply re-derives from whatever bars remain (may narrow); everything filtered
  out shows "No cards match the current search/status filters.", distinct from the plain
  "No dated cards" message. An on-disk status the `statuses` list doesn't include gets
  no pill of its own and is **never governed by one** — unlike the map/board's
  catch-all-first-column rule, the gantt gives an unlisted status its own separate
  labeled group row, visible regardless of every pill's state, rather than silently
  riding an unrelated toggle. The shared pill interaction grammar applies here too,
  Archive pill included: left-click toggles it; right-click SOLOs it (soloing a live
  status turns Archive off too; soloing Archive shows archived rows only);
  right-clicking the already-soloed pill again restores ALL pills on, Archive included —
  the solo rule is fully generic over its id list, so the Archive pill just joins the id
  list the gantt feeds it. View mode persists via the shared switch; the window
  re-derives from the cards on each poll while the timeline's horizontal scroll position
  is carried across re-renders.

## Board config: `config.yaml`

The canonical `config.yaml` contract — `nextId` discipline, the assignees registry and
its grab semantics, list curation — lives in `/kanban`'s SKILL.md; the role trio's one
write-up is CONTEXT.md's Role trio glossary. What follows is how *this app* reads the
file. Optional, human-edited, per board:

```yaml
name: webapp              # BOARD NAME — heading, tab title, and the qualifier in
                          # every card mention (`webapp#28 Card title`). Must precede the
                          # assignees block: those entries carry their own INDENTED
                          # `name:`, and only a top-level key is the board name.
nextId: 28                # monotonic id counter; ids stay unique even when the
                          # max card is deleted or two writers race a max+1 scan
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
```

This app is config-driven and doesn't enforce the grab semantics — it renders whatever
handle a card carries.

- **`name`** IS the app heading — the board name alone, no app label in front of it
  (the app is a kanban; a "Kanban —" prefix only buried the one token that tells
  boards apart) — and it leads the tab title (`<name> — Kanban`, the app named once
  so side-by-side tabs stay tellable apart). Absent, both fall back to
  the **folder above the board directory** — a display default, not a name. The app
  only reads it: renaming a board is a human edit to `config.yaml`, and the first AI
  to service a nameless board seeds the key (`/kanban`'s SKILL.md carries that
  seeding rule). The value also namespaces this board's `localStorage` view
  preferences, so a rename resets collapse/sort/view state once, by design.
- **`priorities`** (ordered, highest first) drives everything positional: sort rank
  (unknown values sort after all known ones, ties by id), the form's priority combobox,
  and badge emphasis (first = hot red, last of a 3+ list = muted, middle/unknown =
  neutral). Absent = built-in `[High, Normal, Low]`.
- **`tags`** feeds the form's tag suggestions. Both lists are HITL-curated — the human
  edits them; the app only reads.
- **`assignees[].color`** (OPTIONAL) reserves a fixed text color for that handle,
  mirroring `statuses`' own color rule exactly: reserved wins; absent, the handle hashes
  into the SAME 8-color `STATUS_PALETTE` custom statuses use (reusing status-colors.js's
  hash — not a forked one), so every assignee gets a stable color with zero state to
  store. See the **Assignee text color** bullet above for where it renders.
- **`statuses`** (inline or block form) IS the live column set, in order — board
  columns, drag targets, per-column sort/collapse defaults (priority-desc / expanded for
  live columns, id-asc / collapsed for Archive), the form's status dropdown, and the
  gantt's group order all follow it. Absent = the built-in four. Unlike the other lists
  it shapes layout, but it still never validates a card: an unlisted on-disk status
  parks the card in the **first** column with a raw-status chip until the human promotes
  it by adding it to the list (the file is never rewritten). Archive is not a list
  entry, and the `doing` entry gate (waiting + blocked) is pinned regardless of the
  list.
- **Absent file**: ids come from a max+1 scan, and with no `assignees` registry the
  assignee combobox suggests the `@human`/`@hitl`/`@afk` role trio (CONTEXT.md's Role
  trio glossary — `@ai` is retired). The app never creates `config.yaml` on its own.
- With a counter, new-card ids come from `max(nextId, scanMax+1)` (a stale counter
  self-heals rather than re-issuing a taken id) and the advanced counter is written back
  atomically. Agents creating cards by hand should use and advance it too.
- All three lists **suggest, never validate** (ADR 0004) — the form's comboboxes offer
  the registered values but free text still saves fine.
- Not a card — only `*.card.md` files are cards.

## Notifications file

Any agent or script can message the human by appending an entry to
`<kanban-dir>/notifications.md`; the app picks it up on its next 5-second poll and
renders it per the **Notifications** bullet above. The writer contract — entry shape,
`level` values, the TLDR-first message shape, when to write, clear = archive — is
defined once, in `/kanban`'s SKILL.md; this app reads and rewrites the same file shape,
it does not define a second contract. Not a card — only `*.card.md` files are cards.

## Boundaries

- This is the **only** skill that runs a server / is desktop-only. The plugin has
  exactly four surfaces: **kanban** (AI-driven card management), **kanban-web** (this —
  the human's live editor, desktop), **kanban-cli** (the human's conversational editor,
  works under remote control), **kanban-viewer** (generated single-file HTML board for
  phone/tablet; queued-change payload, Claude applies). Retired skills are deleted
  outright; CONTEXT.md's Surfaces and parity section carries the cross-surface parity
  rule and the deliberate gaps.
- `archive` here is a *location* (the `archived/` folder), not a status — ADR 0002's
  data model — but the column has full UI parity (ADR 0005): drag a batch onto Archive
  to archive it (one confirm, skipped when the whole batch is already `done`), drag
  archived cards onto a live column to restore them **with that column's status**
  (confirms when the batch contains archived cards; the `doing` entry gate — waiting +
  blocked — applies per card), and archived tiles join ctrl/shift-click and right-click
  selection. Mixed live+archived selections are fine — every action skips what doesn't
  apply, with one summary toast. The tile's Restore button keeps the status-untouched
  semantics (no confirm), as does the menu's Restore selected.
