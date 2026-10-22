---
name: kanban-web
description: Stand up a local web app (Node server + browser SPA) to edit a Markdown kanban board live — drag-drop cards between columns and full CRUD (create, edit, archive, delete), writing straight back to the *.card.md files. Use when the user wants an interactive, editable board in a browser (incl. VSCode's Simple Browser). Desktop/localhost only — for remote/mobile use kanban-snapshot; for AI-driven card management use kanban.
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
GLOSSARY.md. This skill documents how *this app* renders and edits against those contracts.

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
- The `kanban-snapshot` skill ignores `port:` entirely — it's a
  serving fact for this app, not board content it renders.

Then open the URL. On Windows: `start http://localhost:<port>`. Tell the user they can
also paste the URL into VSCode's **Simple Browser** (Command Palette → "Simple Browser").

Right after reading that URL line, run
`node <SCRIPTS_DIR>/launcher.js write <kanban-dir> <the same server arguments just used>`
— the exact port, `--allow-origin` and/or `--home-url` arguments (if any) just passed to `server.js`,
verbatim and in the same order, so a double-click restart binds the same port, keeps
the same tunnel origin allowlisted and the home icon in place instead of drifting back to `7777` with nothing
allowlisted — unasked, on every successful start — and tell the human the printed
launcher path (in the board folder, beside the cards) in your report; see **Double-click launcher** below. Only arguments are
replayed, never the environment: an origin given through `KANBAN_WEB_ALLOWED_ORIGINS`
goes to `launcher.js write` as `--allow-origin <origin>`. A port must be a number and each
origin is re-emitted as `--allow-origin=<its parsed origin>`; a `--home-url` is re-emitted as
`--home-url=<its parsed address>`; anything else is refused.

### Double-click launcher

`launcher.js write` (re)writes a double-clickable wrapper for restarting this same board
with no tokens spent: `kanban_web.cmd` (Windows), `kanban_web.command` (macOS, chmod +x)
or `kanban_web.sh` (Linux, chmod +x — a `.desktop` entry is optional and not set up
here), **in the board directory itself** — the same folder as the `*.card.md` files
(`.kanban/`, `kanban/`, or a declared path). A paired `kanban_web.pid` sits beside it —
pid on line 1, port on line 2. This is separate from `.kanban-app.pid` above, which
server.js itself still writes on every bind and which `launcher.js run` reads to find the
port; a `.kanban-app.pid` naming a dead pid is cleared right before a launcher start, a
live one is never touched. One board per folder, so this never collides with a sibling
board's own files; a wrapper the writer finds there naming a *different* board (e.g. the
folder was copied from another board's, wrapper file and all) is left alone and the new
one gets suffixed — `kanban_web-<board-name>.<ext>` + a matching `.pid` — the writer tells
boards apart by a marker line inside each wrapper, always reuses the wrapper a board
already owns (whatever suffix it landed on) before picking a new name, and never
overwrites a launcher naming a different board that still exists; one whose marker names a
board folder that is gone is reclaimed. Rewriting it for the *same* board (healing a stale
path) happens on every start, and unchanged bytes are left alone. **Migration:** a write
also looks for a launcher for this same board left by an older launcher.js at the *old*
location (the repository top level, or the board dir's parent when there was no
repository) and removes it together with its paired pid, lock and temporary/reclaim-ticket
siblings; a launcher there naming a different board, or one whose marker can't be read, is
never touched, and any `info/exclude` lines an older write added are left in place
(they are unanchored, so they keep matching `kanban_web.*` files anywhere in that
repository, the new ones in the board folder included). In a repository, the wrapper,
`kanban_web.pid`, `kanban_web.lock` and its temporary siblings (`kanban_web.lock.*`) are
added to `info/exclude`, never `.gitignore` — as **anchored** patterns (a leading `/` plus
the board's own path from the repository top level, e.g.
`/.cortex/planning/kanban/kanban_web.cmd`) — plus, always, the bare `kanban_web.*` names
regardless of which name this write actually chose for its own wrapper, so a leftover
wrapper that rode along when the board's folder was copied from a different board's stays
out of `git status`/`git add` too, even though it never becomes this board's own name. The
lines this version adds only ever match this board's own directory, never a same-named
file elsewhere in the tree. If git cannot report the board's path, or the path holds a
line break, the write stops before writing anything. Double-clicking the wrapper's
first step is checking whether the board is already served: a port chosen from the pid
files, the replayed port argument or the config pin answers `/api/board` as *this* board
(a pid file alone is never the proof) — if so it opens the browser and starts nothing.
Otherwise it takes `kanban_web.lock`, so two quick double-clicks start one server (the
other waits, says so once, and opens the running board; a lock older than 30 seconds is
stale), and starts the server right there, in that window.
Ctrl+C removes the paired `kanban_web.pid` (server.js's own SIGINT handler clears
`.kanban-app.pid` the same way). Closing the window (or Ctrl+Break) leaves
`kanban_web.pid` stale, and a server that dies without Ctrl+C leaves `.kanban-app.pid`
stale; the next start overwrites both. If a plugin update removes the helper script the
wrapper calls, or Node moves, the wrapper says so and tells the human to run
`/kanban:web` once to rewrite it. **The launcher is the human's
hand only** — never run it, or `launcher.js run`, yourself.

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

`--home-url <url>` (or `--home-url=<url>`) puts a small home icon before the board title
that leads to that address, giving the board a home page to link up to. Only `http://` and
`https://` addresses are accepted; anything else is a startup error with a message, like a
bad `--allow-origin`. Without the flag there is no icon. The double-click launcher replays
the flag with the port and the allowed origins.

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
  column. **Colors:** the built-in four each have one fixed hue used everywhere
  (backlog cyan, todo blue, doing green, done purple), at two lightnesses: a bright
  value on the dark theme and a deeper one on the light theme, each clearing 4.5:1 as
  text in its own theme. app.css carries them as `--st-*`, `--hash-a`…`--hash-h` and
  `--id-*` tokens in its theme blocks; the values live in status-colors.js
  (`themeColorTokens`), and anything painted from script uses `statusColorVar()` so it
  follows the theme too. The one exception is the 12% wash inside a gantt bar
  (`statusColorSoft()`), a fixed tint of the dark value that reads on either ground. The neutral grey belongs to
  Archive alone — no hashable palette slot is near-grey, and an unlisted on-disk
  `status: archive` **or `archived`** mutes to the archive grey instead of hashing. A
  custom status gets a deterministic color (its name hashed into a fixed 8-color palette)
  used by the column header, the map node's status dot, gantt group/bar, and the shared
  status-dot glyph (see Status dot). A custom status can hash to any slot of the
  palette, orange included (determinism, not uniqueness, is the hash contract).
  The form's status dropdown offers the list's values (an unlisted status on the card
  being edited is appended as "(unlisted)" so saving never silently rewrites it), and new
  cards default to the first column (a column header's **+** pre-selects its own column
  instead). In the phone layout the status tabs replace the column header below 760 px: the Board shows one
  status at a time, chosen by the tab strip, and the column header's controls below are the desktop's.
- **Left out on a phone** — the phone layout leaves out sorting (no sort dropdown), collapsing (a collapsed status shows its cards), the AI-prompt add (no sparkle button) and selection gestures (no Shift or Ctrl click, no box); they stay on the desktop layout.
- **Collapsible columns** — every column header has a collapse/expand toggle. Collapsed =
  a narrow strip showing just the toggle icon and the card count; hovering it tooltips
  the full column name. Live columns default expanded, Archive defaults collapsed.
  Collapse state persists per column in `localStorage` (namespaced per board) and
  survives both a page reload and the 5s auto-refresh poll.
- **Equal-length columns, fixed headers** — every column (Archive included) stretches to
  match the row's tallest member, so a short column never stops short of a busy neighbor.
  The page header (title, search, view-switch/refresh/notif buttons and the preferences gear) and every column's
  own header stay on screen while the page scrolls — both `position: sticky`, the column
  header parked just under the page header via a CSS var kept in sync with the page
  header's real rendered height by a `ResizeObserver` (a hardcoded px offset would drift
  the moment the header wraps). Board only — none of this reaches past `#board`.
- **Per-column sorting** — each (expanded) column header has a sort-field dropdown (ID /
  Priority / Due date / Last modified / Assignee / Outline) and a direction toggle. "Due date"
  sorts by the card's schedule — `due_date`, else `end_date`, else `start_date` —
  honoring time within a day (a date-only value reads as start-of-day); dateless cards
  always sort last, in either direction. Under a Due date sort the key driving a card's
  position is one of the rows in its date stack (kanban.proj#260) — the `⚑` due row when
  the card has one, otherwise the `⇥` end row, otherwise the `⇤` start row, exactly the
  triad fallback above. "Last modified" sorts by the machine-maintained `updated`
  stamp, newest-first by default; unstamped cards always sort last. `updated` itself isn't shown on tiles (only
  in the card popup), so the what-you-see-is-what-sorted promise holds for Due date only.
  "Assignee" groups cards by owner, ranked by the config.yaml assignees registry's ORDER
  (not alphabetically); unregistered handles follow all registered ones alphabetically,
  and unassigned cards always sort last, in either direction. "Outline" puts a parent
  before its children and siblings in `rank` order (unranked siblings after the ranked
  ones, by priority then id), computed over the whole board so a child whose parent sits
  in another column still follows the order; a card with no parent on this board is a
  root. In an Outline column, dragging a card between two tiles reorders it instead of
  moving it: an accent line shows where it will land (no line shows over a drop that would be refused), and the drop writes `rank` through
  `POST /api/cards/<id>/reorder` with `prev` and `next`, the ids of the cards above and
  below the drop in outline order (`null` for none; the answer is `{ card, renumbered }`). Room
  for a whole number between the two ranks writes that card alone; a full gap renumbers
  that parent's children in tens and writes only the cards whose rank changes, archived
  siblings included, and no card outside that parent (cards whose parent is on another
  board or missing from this one are roots in the outline but siblings only of cards with
  that same parent, so a drop among plain roots never renumbers them). Siblings the column does not show
  (another column, hidden by the search) are stepped around, and a drop where the card
  already stands writes nothing. A drag changes rank, never the parent: a drop among
  another parent's children is refused with a toast (the call answers 400, an unknown card
  404). Other columns still move the card, a bulk drag still moves the selection, and the
  Archive column is not reordered; the rule an AI writer follows is in the kanban skill.
  Priority defaults
  High-first; ties on any field break by id, ascending, so order doesn't reshuffle when
  you flip direction. Each column remembers its own choice independently, defaulting to
  priority-desc for live columns and id-asc for Archive, except that on a board where
  any card has a `rank` or a `parent` the live columns default to Outline. Only a column
  you changed is remembered (in `localStorage`, alongside collapse state, surviving
  reload and the poll), so a default never freezes into the columns you left alone, and
  a board that gains its first rank or parent switches those columns to Outline without
  a reload. Composes with search
  filtering. Hidden while a column is collapsed (nothing to sort there).
- **Parent cards: altitude badge and roll-up bar** — a card with children shows `▲n` in its
  head row (its altitude: the layers of cards below it, whatever their types) and a status
  bar of the leaves below it, meaning the cards with no children, so an objective over two
  epics over stories counts the stories and not the epics beside them. Segments run in
  column order, each in its status's color, with a `status: n` tooltip. Every bar on the page
  shares one mode, open or collapsed: collapsed is a thin line (the default), open adds a
  count line (the total, the done count, then each other status). Clicking any bar, on a
  board card or in the card detail, flips it for all of them without opening the card, and
  the preferences sheet (below) sets the same choice, so the two always agree; the
  mode is remembered per board in `localStorage`, surviving reload and the poll, and a
  browser that once saved the retired `off` reads as collapsed. Archived leaves count as
  done by default, so archiving a finished story leaves its parent's done count unchanged;
  the preferences sheet can turn that off, and then every roll-up (the board tile, the Map's
  rich row, and the card detail with its scope line) leaves archived leaves out. The card
  detail shows the roll-up right under the title and thread, above the fields, in the same
  mode: the thin bar when collapsed, the bar with its numbers and a scope line when open. The
  scope line says the roll-up counts this board only, because a parent cannot
  know about children on a board it never reads. Marking a parent done while leaves below
  are still open (a drag, a multi-card drag or the form) shows a warning and saves anyway;
  only the literal status `done` counts as finished, and an archived leaf counts as
  finished. Altitude, roll-up and the warning are worked out from the cards on every render
  and never written to a card.
- **Search** — the header search box filters every view as you type, except the Graph,
  where a typed search lights its matches and hides nothing but a `slice:` cut (see the Graph
  view entry); the
  query survives view switches and the poll. Enter in the search box goes to the first match,
  and a second Enter opens it when it is the only one: the first closes the panel (and the
  phone's field), brings the first matching card in the view's reading order to the middle
  and gives it focus, leaving the query, the selection and the pills as they were. Enter
  picks from the suggestion list only when a row of it is highlighted (arrow to one first).
  Space-separated terms AND together: `#42`/`id:42` is an
  exact card id, whole (`#G3` is the card `G3`, not card 3; a lowercase `#a371f7` is no id),
  and a pasted `webapp#42` is the same when `webapp` is this board's name (any
  case; another board's mention is searched as text and the panel says which board holds
  the card); `title:` `body:` `status:` `priority:` `tags:` `file:` `assignee:` `type:` are
  case-insensitive substring scopes (`a:` is a thin alias for `assignee:`; a recognized
  scope with nothing after the colon yet — `status:` mid-keystroke — is dropped as
  not-yet-a-term rather than matching everything for one keystroke); `review:`/`blocked:`
  are sticker scopes — bare = the sticker is present, `review:PR`/`blocked:vendor` =
  case-insensitive substring on its text; unlike the field scopes, a bare sticker scope
  is a complete term, never dropped;
  `tree:<id>`/`path:<id>` are dependency focus, `#` optional (`tree:74` = `tree:#74`) —
  grammar in the Dependency map section; bare text is a substring on title OR body OR any
  tag, and an unrecognized `foo:bar` prefix lands there too (searched as the literal
  string) rather than silently matching nothing on a typo'd field name. Five more forms,
  one example each: `|` is or and a space binds tighter, so `tags:ui status:doing | #12`
  is ui and doing, or card 12; round brackets group and can nest, so
  `tags:ui (status:doing | status:todo)` is the ui cards in doing or todo (a bracket is
  optional, and `(draft)` finds what `draft` finds); a quoted value matches the whole
  value, ignoring case, or any one element of a list, so `tags:"grill"` finds a card
  tagged grill and not one tagged grilling, a quoted `title:` or `body:` matches the
  whole field, and quoted text with no scope is a phrase in a title, body or tag, so
  `"two words"` does not find the words apart; a bare `waiting:` finds the cards
  waiting for at least one card that is not done (a dangling id never makes a card
  waiting), the way `blocked:` and `review:` find their stickers; and
  `slice:<top>..<bottom>` cuts every view to a run of slices, so `slice:objective..2`
  keeps the cards from the objective tier down to depth 2. A `|` and a
  bracket count only at a token's edge, so `a|b` and `fix(auth)` stay literal text, and so
  does `waiting:3`, while `blocked: |review:` means `blocked: | review:`. The slices are the board's tiers (the
  `hierarchy:` types, top first), then the depths of the cards with no tier (the
  parents without a tier between a card and its nearest parent with one, or its root when
  none has: a card right under an epic is 0, its child 1), and an end is a tier name in any letter case or a depth number.
  `slice:goal` is that one slice, `slice:goal..` and `slice:..objective` leave an end
  open, and a reversed pair is swapped (`slice:2..objective` is `slice:objective..2`).
  An end the board does not have is left open, and a single unknown name, `slice:..` and
  a bare `slice:` cut nothing, so half-typing a name never hides every card. A board
  with no `hierarchy:` cuts by depth, the parents above a card (`slice:1` is the depth-1 cards), and a card nested
  against the hierarchy, a goal under an objective, stays in its own tier with no
  warning. Depth is counted over the whole board, archived cards included, so a card is
  in the same slice whatever a view shows. The term combines like any other,
  `tags:ui (slice:goal | #12)`; a tier named with a space is quoted
  (`slice:"big goal..2"`). A `slice:` term at the top level of the query hides the cards
  outside the cut in every view, the Graph included. Half-typed input never throws: an
  unclosed quote or bracket reads to the end, a stray closing bracket is ignored, and an
  empty alternative is dropped, so `tags:ui |` finds what `tags:ui` finds and never
  every card.
  A click on a card's assignee, tag, blocked or review cue adds its term to every
  alternative of what the box holds (a value with spaces is written quoted). An
  autocomplete dropdown completes the token under the caret, inside brackets, inside
  quotes and after a `|` — the bare term plus every field-scoped form of it; nothing is
  offered once the token carries a colon, except after `slice:` and after `..`, and
  `tree:`/`path:` are excluded (they take a card id, not free text). After `slice:` and
  after `..` the dropdown lists the board's slices, narrowed to the names that start with
  what is typed (any letter case): the tiers of the `hierarchy:` in hierarchy order, every
  one it names, then the depth numbers from 0 to the deepest card with no tier. Picking a row writes the whole
  term (`slice:goal..objective`, the end under the caret replaced and the other end kept),
  and a tier named with a space is written quoted, the quote holding both ends
  (`slice:"big goal..2"`). The dropdown is asked with the whole board, archived cards
  included, the arguments the cut is made with, so what it lists is what the cut reads,
  and a Graph caption's tooltip shows one of these same terms. The leading `#` that Ctrl+F prefills stays while the box holds
  one id being typed, and through a query such as `#12 | #14`.
- **Create** — "+ New card" opens a modal (title, status, priority, parent, rank, tags,
  waiting-for ids, blocked reason, review text, AI prompt, assignee, start date, end
  date, due date, type, description). Dependencies and impediments are separate inputs:
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
  `<0000-id>.<slug>.card.md` (the id's number zero-padded to the board's `idDigits`, 4 by
  default, e.g. `0009.new-thing.card.md`). A card whose `type` has a prefix in the config's
  `prefixes:` takes that prefix and its own counter (`G0001.new-goal.card.md` is card `G1`),
  and keeps it when its type changes later; any other card takes the next plain number.
- **Edit** — click a card's "Edit" to change its fields, title, and description. The body
  (incl. `## Narrative`) and any frontmatter keys the form doesn't manage are preserved
  verbatim; the form-managed fields (status, priority, type, parent, rank, tags, waiting_for, blocked,
  review, prompt, assignee, start/end/due date) are re-written from the form. `parent`
  takes `42` or `board#42` and `rank` a number; one that reads the same as the card's own
  is left exactly as written, so a hand-written `parent: "fpp#4"` survives every save. Text
  in either that reads as nothing (not a card, not a number) is refused on its own field with a message
  instead of clearing the line; a blank is how a card loses its parent or rank. Clearing
  any managed field (a blank priority/assignee/type/parent/rank/date/prompt, empty tags or waiting_for, a
  blocked or review value failing the sticker predicate) removes its
  frontmatter line entirely — no-data fields (empty string, null, empty array) are never
  written, so no `tags: []` boilerplate; id, status, and `updated` are always written,
  any real value including priority "Normal" stays, and readers default a missing
  priority to Normal. The 📅 pickers work here too. `updated` is machine-managed (see
  Last modified), never a form field. An `epic: true` line left on a card from before the
  flag retired is an unmanaged line like any other: ignored by every view and kept through
  every edit.
- **AI prompt** — a hand-rolled inline-SVG sparkle button (ADR 0003 — same icon-btn
  styling as Save/Fullscreen/Close, tooltip "AI prompt") in the create/edit modal's
  header actions reveals/hides a single free-text input (`f-prompt`) writing the optional
  `prompt` frontmatter field (field contract: the kanban skill's SKILL.md) — a signal FROM a human TO whichever agent next processes
  the card, the **opposite polarity** of `blocked`/`review` (those signal from the card
  to a human) — including as a way to answer a `blocked` or `review` sticker without
  touching those fields directly. Turning the toggle ON while creating a NEW card also
  sets Assignee straight to `@afk`; flipping it on while editing leaves the card's
  assignee untouched, and the column header's AI-sparkle button lands on the same
  "prompt row open, assignee `@afk`" state through the same helper. That flip is the
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
  No relations tiles, gantt bar text / gutter label / due-marker tooltip, calendar chips
  and their "+N more" overflow tooltip, the detail popup's header title, and the
  single-card Archive/Delete `confirm()` text. Every call site reuses
  `cardTitleDisplay()` (card-title.js) — no forked title-fallback logic anywhere —
  paired with a `*-prompt-fallback` CSS modifier class (italic/muted, one per surface).
  It never appears once the card has a real title; the snapshot's own reimplementation
  does not carry it. **Empty titles save** when a prompt is present: the form manages
  the title input's `required` dynamically — required UNLESS the prompt row is shown AND
  carries non-empty text, re-evaluated on every reveal/hide and every prompt keystroke.
  Server-side, `createCard` floors the title to "Untitled" only when BOTH trimmed title
  and prompt are empty (a space-only title satisfies native `required`, and a direct API
  caller bypasses the form entirely — without the floor a permanently blank tile could
  persist); a title-less card WITH a prompt saves title empty. The filename slug
  degrades with it: `<0000-id>.<slug>.card.md` collapses to the bare zero-padded id
  prefix (`0212.card.md`, no dangling `.`); a number wider than `idDigits` (past 9999 by
  default) gets no id prefix and the filename uses `card-<id>` to stay non-empty.
- **Epic flag (retired)** — the app no longer reads or writes `epic`: no form checkbox,
  no `epic:` search term, no "Epics" chip on the map, no fixed orange and no wash on any
  surface. An epic is a card typed `epic`, which shows the Type chip like any other type:
  in the color the board's `types:` list gives `epic`, or neutral when the list gives none.
  A leftover `epic: true` line is an unknown frontmatter line (the detail popup's table
  still lists it) until the kanban skill's `migrate_epic_to_type.sh` rewrites it.
- **Status dot** — `statusBadge()` (status-colors.js) renders on every card rendering:
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
- **Archived ball** — a second shared dot, `archivedBadge()` (status-colors.js): a fixed
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
- **Board tile date stack** (kanban.proj#260) — `scheduleRows()` (column-sort.js) reads
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
  through the shared `scheduleBlockHtml()` helper. `scheduleLabel()` (the old single-line
  `⚑ MM-DD`-or-bare label) still exists and is still unit-tested but has no production
  caller left.
- **Overdue cue** — `isOverdue()` (column-sort.js): the card's `due_date` day part is
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
- **Card type chip** — a card's optional `type:` frontmatter line (free text) shows as a
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
  **Icons:** a listed type may also carry an `icon:` (see the `icon` bullet under the
  config keys). A type with an icon starts its chip with that glyph, in the chip's own
  colour (the glyph is plain text inside the chip, so it takes the colour the chip is
  painted), wherever a chip is drawn: Board and Archive tiles, the Map's rich rows and the
  card details. Calendar and Gantt draw no chip, so they show none. A type with no icon, or
  an unknown icon name, draws the plain chip: its name alone. The six glyphs live in their own
  module, `type-icons.js`, which has no dependencies and loads before the type chip and the
  Graph.
- **Header icons** — the header's New card, Calendar, Gantt, Map view, Graph and Refresh
  buttons each hold an icon slot and a label span; the active view's button reads
  "Board view" and wears the Board icon. The line icons (a 24 px box, stroked with the
  current colour, so they read in light and dark) live in `view-icons.js`, which loads right
  after `type-icons.js`. A views table in `app.js`, beside `VIEW_CONTAINERS`, lists each
  view's id, label and icon and drives the painter, which writes a label or `aria-pressed`
  only when it changes and puts `aria-pressed` on every element marked `data-view`.
- **Assignee text color** — `assigneeBadge()` (assignee-badge.js) tints the handle text
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
- **Markdown body** — the detail popup renders the card body through `markdownInto()`
  (`markdown-ui.js`), which draws `mdToHtml()` from `markdown.js`, the one hand-rolled,
  dependency-free renderer that the scratchpad's Preview and the snapshot's card sheet use too
  (the snapshot embeds the same file and draws its parse as DOM nodes). It reads the raw text
  into a tree of blocks and inline tokens (`parseMarkdown`) and writes the HTML escaping every
  piece of text and every attribute value as it goes, so a body never holds a live tag; the
  only tags let through are `<u>…</u>` as a pair on one line and `<details>`, `<details open>`,
  `<summary>…</summary>` and `</details>` each on a line of its own (an unclosed section, an
  attribute other than a bare `open` or any other tag shows as typed, and a section never
  swallows the rest of the body). Blocks: headings `#` to `######`, bullet (`-`, `*`, `+`) and
  numbered lists that nest by indent depth and mix (items split by a blank line make one loose
  list, their text in `<p>`), `- [x]` tasks (the tick in its own span, green when done and muted
  when open), lazy continuation lines, `>` quotes (nested, holding lists and code, continuing over
  an unquoted line after a paragraph line), pipe tables (alignment by class, the CSP having no
  inline styles; a delimiter cell is one or more dashes), rules (`---`, `***`, `___`, spaced out
  too) and fenced code (``` or `~~~`, closed by a run at least as long). A fence with a language shows it
  as a label and a **Copy** button (one delegated listener in `markdown-ui.js`) and keeps it as
  `data-lang` on the `pre`; the language is cut to `[A-Za-z0-9_+#.-]`. Inline: bold, italic,
  both, `_em_`/`__strong__` that leave snake_case alone, strike, links with a scheme allowlist,
  bare `https://` addresses, code spans, hard line breaks. A blank line ends a list unless an item
  of it follows, and a block quote, heading, rule or fence closes every open list level. Every scan
  for a closing mark remembers where one failed, and quotes, sections and inline marks nest only so
  deep, so a body of 60 KB of openers renders in milliseconds (a test holds a time budget); an
  unknown node in the tree draws as its escaped text. A code span holding a
  card mention (`board#id title`, the Card mention rule in GLOSSARY.md) renders as an accent chip
  instead of code; a mention of a card on this board opens that card when clicked.
  After the text is written, `markdownInto()` hands the element to the code blocks loader
  (`code-blocks.js`, `createCodeBlocks(config)`, shared with the snapshot; the page hands it its
  vendored addresses, each with its version in a `?v=` query), which asks `kanbanCodeLibs`
  (`code-libs.js`: the highlight.js language names and aliases, the pinned versions) what each
  typed block needs and loads only that, on the first block that does: **highlight.js** (`web/vendor/highlight.js`, the common-languages build with
  its light and dark GitHub themes, one on at a time as the page's theme says) colours a fence in a
  language it knows, setting `language-<name>` on the `code` and calling `hljs.highlightElement`;
  an unknown language or an untyped fence is left plain. A ```mermaid fence makes a sandboxed
  `<iframe sandbox="allow-scripts" src="/mermaid-frame.html">` beside the block: mermaid writes inline
  styles that the page's CSP refuses, so it draws in the frame (`mermaid-frame.html` and
  `mermaid-frame.js`, served by exact name with a policy of their own: `sandbox allow-scripts`,
  scripts from the frame's own file only, inline styles allowed) and speaks to the page by
  `postMessage` (`ready`, `render`, `rendered`, `size`, `error`; the page ignores a message from
  anything but a frame it made). A drawn diagram replaces the block at the height the frame reports;
  one that does not parse, or a frame that does not answer in 20 seconds, leaves the labelled block with
  `Diagram error: <first line>` under it. A diagram waits for layout (mermaid measures what it draws), so
  one written into a popup that is not yet shown, or inside a closed `<details>`, is drawn when the
  browser gives it a box (a `ResizeObserver` on the block). Both libraries follow the page's theme (`data-theme` on
  the root, else the system's) and redraw when it changes. The server serves `/vendor/<library>/<file>`
  for the four files it names (`VENDORED` in `server.js`, the licences beside them are not served)
  and the two frame files, and answers a request with the origin `null` (a sandboxed frame's) for those
  only. A vendored file is served with `Cache-Control: public, max-age=31536000, immutable` (the
  version is in the address); everything else stays `no-store`. The snapshot embeds `code-libs.js` and
  `code-blocks.js` and hands the loader cdnjs (highlight.js) and jsDelivr (mermaid) addresses with
  SRI `integrity` hashes computed from the vendored files at build time; its diagrams are drawn in a
  sandboxed `srcdoc` frame made from `mermaid-frame.html` and `mermaid-frame.js`, never in its page
  (docs/adr/0020).
- **Frontmatter marks** — the detail popup's frontmatter table prints every field as
  written, except the few the board itself understands: `status` gets its status dot and
  colour, `priority: High` the high-priority red, `assignee` its chip, `parent` a
  mention chip that opens the parent card, `review` and `blocked` their sticker grounds, and
  `tags` tag chips. The card path shows its folders muted and the file name in full ink.
- **Thread and children** — the detail popup shows the card's thread above its
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
- **Reading layer** — card bodies and notifications use four tokens of their own:
  `--prose` for body text, `--code-ink` for code on a borderless `--raised` ground, and
  `--line-strong` for table-header and evidence rules. Headings and bold take
  `--ink-strong`, so a body has separate lightness steps for headings, prose, code and
  muted text. Prose, tables and code blocks all run the full width of the modal,
  full screen included, and a table's first column carries the heading
  ink so a reader can scan down it. A list nested under a task item (the step's proof and evidence lines) reads one step
  quieter behind a thin rail; that is structure only, and no text is recognised.
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
- **Delete** — permanently removes the card file, after the **delete popup** (the tile's and
  the detail's Delete…, and the right-click menu's Delete on one card or on a selection: one
  popup for the whole selection, so it asks once). The popup says what goes, and says which
  groups lose the card: its id always leaves every group's list, so no group points at a gone
  card. Its extras are boxes, each **unticked**: **Its logbook** (with the count of its notes)
  deletes the card's day files; left unticked they stay and read as dangling. **Its scratchpad**
  (only when the board keeps scratchpads and the card has a page, or **Their scratchpads** with
  the count over a selection) deletes its page, and unticked the page stays: the kanban never
  deletes one otherwise. **Its todo list** (only when the board keeps todo lists and the card has one, or
  **Their todo lists** over a selection) is the third, the same way. A group's popup
  (the Group tab's **Delete group…**) deletes the group file and offers the same logbook, scratchpad and todo list boxes,
  plus **Its member cards**: the list shows each member it would delete and names the members
  another group holds as skipped, with the groups that hold them, and only the others are
  deleted. Ticking it offers, each unticked, **Their logbooks**, **Their scratchpads** and **Their todo lists**, counted
  over the members it would delete; unticked, those files stay. The server's `DELETE /api/cards/<id>` and
  `DELETE /api/groups/<id>` take `{ logbook, scratchpad, todos, members, memberLogbook, memberScratchpad, memberTodos }` in the body,
  each only when `true` (the member boxes count only with `members`), and answer what went (`groups`, `deleted`,
  `kept`, `swept`, `membersSwept`). Archiving never opens it and
  gets none of its questions.

- **Multi-select** — one interaction grammar, uniform across **all five views**
  (ADR 0006), with file-manager gestures: click a card's representation to open its
  detail popup (in a view the preferences sheet sets to selects, a plain click selects the
  card alone instead, and a double click, or Enter on a focused card, opens it),
  ctrl+click (cmd on mac) to toggle it in/out of the selection,
  shift+click to ADD the whole range between the range start (the last toggled/range-started
  card) and the target — in the active view's rendered order, additive, never
  deselecting — right-click for the bulk context menu. A selection grows from an
  **anchor** (one card, or one query) by **additions** (cards; the same model holds paths,
  trees and queries), kept in the order they were added: the first card picked is the anchor
  and later ones are additions, ctrl/cmd+click on a picked card takes it out (the first
  addition becomes the anchor when the anchor goes), and taking one card out of a query, path
  or tree part turns that part into its other cards. The ids the views paint and the bulk
  edits read are worked out again on every render and poll, for the view being shown, so the
  selection survives a view switch and a poll, and a card a status pill, the Archive pill or
  the search box hides is not in it (it is back when the view shows it again). In the
  **Graph** a click makes the card the anchor of a new selection, and shift+click or
  ctrl/cmd+click adds one card to the selection or takes it out — the layout has no reading
  order to range over, so Shift does not add a range there; a double click (or Enter) opens
  the card, a pan keeps the selection, and a click on the empty Graph leaves it; a double
  click on the empty Graph clears it. A search
  typed in the Graph is the anchor of the selection: its matches are the selected cards, and
  it stops being the anchor when the Graph is left (see the Graph view entry). Applies on
  board tiles (live and archived), map nodes and the map's No relations tiles, graph nodes, calendar chips (every chip of a
  multi-day run highlights together — selection is by card id), and gantt bars **and
  their gutter labels** alike. Each view paints its own selected marker
  (board/calendar/gantt: blue outline + dark wash; map: dark wash + blue glow — the
  node's border and status dot are unaffected; graph: an accent outline on the dot plus
  a glow). Right-click: a card outside the selection opens a menu for that card alone and leaves
  the selection, and its range start, exactly as it was; the menu leads with **Peek** (opens the
  card's details through the same path a plain open takes, so card history takes its step, and
  does not touch the selection) and **Add to selection** (the card joins as an addition, or becomes
  the anchor of an empty selection). A card inside the selection opens the menu for the whole
  resolved selection, the cards a path, a tree or a pill added included, and the menu has neither
  Peek nor Add to selection but offers **Isolate** (see Isolate). Right-clicking inside an open card detail opens the same
  menu for the card shown, without Peek, and once an action has run the popup is read again so it shows
  the change (or closes if the card is gone); with text selected, or on anything that
  already handles the right-click itself, the browser's own menu shows instead. The card details
  keep the selection when they close, so a peek costs nothing. The menu — **Peek**, **Add note…**, **Add child…**, then the groups **Edit**
  (**Assign…**, **Set priority…**, **Edit tags…**, **Schedule…**), **Group** (**Add to group…**,
  **Make a group from them…**) and **Explore** (**Isolate**, **Dependency tree**, **Dependency
  path**), then **Scratchpad…**, **Todos…**, **Add to selection**, and Archive, Restore, Delete (never in a
  group) — acts on the menu's subject, the right-clicked card alone outside the selection and the resolved
  selection inside it, regardless of which view opened it. The subject is fixed when the menu
  opens, and a popup the menu opens acts on the cards it captured, never on the selection as it
  is when Apply is pressed. **Dependency tree**/
  **Dependency path** add the card's tree or path to the selection as one part: the cards it
  reaches among the cards the view shows are marked (lit in the Graph) and are bulk targets
  with the rest (the Gantt and the Calendar show only the cards with a range or a due date, so a
  card with neither is no target there, and no pill counts it). They no longer write the search box, which is left as it was; a typed
  `tree:<id>`/`path:<id>` term still works. Archive and Delete keep their confirmation, which
  names the resolved count (Delete's is the delete popup, once for the whole selection). **Add child…** opens the New card form (`openModal(null, undefined, undefined, parentId)`) exactly
  as New card does, with Parent preset to the card and the heading "New card under #<id>"; it shows
  only when the subject is one live card (not an archived one, not a batch, not the canvas), in the
  card details' own menu too, and writes nothing until the form is saved, then only the new card
  (a parent never lists its children; clearing Parent saves a root card). **The groups** (`menu-nest.js` for the rules, `menu-nest-ui.js` for the page; built by hand, ADR
  0003): `#context-menu` holds plain entries, `<hr class="ctx-sep">` separators and three
  `.ctx-sub` groups, each a `.ctx-parent` row (`aria-haspopup="menu"`, `aria-expanded`, a ▸ the
  stylesheet draws) and a `.ctx-sub-panel` of entries; every entry keeps its own `ctx-*` id and
  click handler. `showContextMenu` decides which entries show as before and then calls
  `menuNestSync`, which hides a group whose entries are all hidden (`menuSubShown`) and a separator
  not between two things that show (`menuSeparators`); `hideContextMenu` calls `menuNestClose`.
  A panel opens when its row is hovered for 120ms (300ms when another panel is open, so the pointer
  crossing the rows on its way to the open one does not swap it), when the row is clicked, and on
  Right, Enter or Space on it; it opens beside the row, with the class `flip` on the left when
  the right has no room and lifted by what it would run off the bottom (`menuSubPlacement`), and at
  phone width (`isPhoneWidth`, phone-width.js; the stylesheet's own `max-width: 759.98px` query)
  it is drawn in the flow under its row, a second tap on the row shutting it. Up and Down move the
  highlight among the entries that show (wrapping), Right or Enter on a row open its panel and
  highlight its first entry, Left or Esc shut it and return to the row, Home and End go to the first and
  last entry of the level; the menu takes the focus when it opens (`tabindex="-1"`,
  `menuNestFocus`) and gives it back when it closes (`menuNestRelease`), and its keys are read in the
  capture phase only while focus is inside it, so they reach nothing behind it and nothing in a field
  outside it; Esc at the top level is the page's, which closes the menu. The group rows carry
  `aria-controls`, and the glyphs and hints the stylesheet draws (`content: "▸" / ""`) have empty
  alternative text, so they are not in an accessible name. **Add note…** shows its key as `data-hint="n"` drawn by the stylesheet, so the entry's text
  is its name; no other entry shows a key. The empty Graph or Map canvas's menu is still Isolate
  alone: its group's panel stands in the menu with no row (`canvas-menu`). The conditionally-hidden items: Peek and Add to selection show only
  outside the selection (Peek is also left out of the card details' own menu), Tree and Path
  show only when the subject is one card, and Isolate shows only inside the selection and never
  in the card details' own menu; the others always render (mixed-selection handling
  lives inside each click handler). A right-click on the **empty Graph or Map canvas** (the
  Graph's or the Map's canvas, where no card, Graph dot, Map node, link or control is) opens the
  same menu with every entry but Isolate out of it (`canvas-menu` in the stylesheet), in place of
  the browser's own menu, and leaves the selection as it is; on any other view, or outside the
  canvas (a toolbar, a section header), the browser's menu shows. The entry reads **Isolate**, and
  **Turn isolate off** while isolate is on; with nothing selected, choosing it says so and leaves
  isolate off, as the switch does.
  A click on empty space leaves the selection, its anchor, the pills and the search box as
  they were, since it can be an accident. A **double click** on empty space clears them: the
  additions, the anchor, and the anchor's text in the box (a pill's query, a search typed in
  the Graph), so its chip goes off. The page reads a double click as the second click of a
  pair (the click's count, 2), never as a `dblclick` event, because the first click's
  repaint can replace the element under the pointer. Empty space is anywhere but a card or a
  Graph dot, a caption of the tier fan, a button, link, text field or select, a popup or the card menu, or a control
  wearing the `data-keeps-selection` marker (the menu, the popups, the view toggles, the
  status pills and fold toggles, the roll-up bars and the Graph's controls do). The
  selection survives switching views and it survives the poll. A double click held with
  Shift, Ctrl or Cmd builds a selection and never clears one. Where a double click on empty
  space already means something, that meaning stands and the selection stays: the Calendar's
  day cells and time-grid columns start a new card (see **Click-to-create**). Esc stays the
  step-by-step way back, as below. The 5s refresh skips while a control wearing
  `data-holds-poll` has focus. Every write to the selection goes through one function
  (`setSelection`), every bulk
  action reads its target cards through one reader (`bulkTargets`), and a bulk popup acts on
  the cards it held when it opened. **Esc** steps the selection back one stage at a time:
  the first Esc drops every addition at once and leaves the anchor, the next drops the
  anchor. With isolate on, a stage comes before those: Esc turns isolate off and gives the box
  its text back (see **Isolate**), so the steps are isolate off, then every addition, then the
  anchor. The step runs only while nothing is open and nobody is typing (an open menu,
  popup, dialog, the notifications panel or the preferences sheet takes Esc first and
  closes, as before); with focus in the search box Esc clears the box and leaves the
  selection (in the Graph, where a typed search is the anchor, clearing the box takes the anchor
  and the additions with it), and away from the box Esc no longer clears it (while isolated, Esc in the box turns
  isolate off instead of clearing it). An open search panel takes
  Esc before the step and closes (a suggestion list closes before the panel), and a pill
  the step drops, the added ones first and then the anchor's, goes out of the box with it,
  so a box grown to `review: | blocked:` is back at `review:` after the first Esc and
  empty after the next; any other text in the box stays, and clearing the box with Esc
  in it turns off the pills it held. A plain click that selects a card (the Graph's, or a view
  the preferences sheet sets to selects) does the same to the pills the selection held: it replaces the selection,
  so the pills go off and their queries out of the box (not while isolated, when the box holds the
  isolate text). A click that opens a card changes no filter: every pill that is on stays on, the
  box keeps its text, and the view behind the card details shows the same cards; the click drops
  only the selection's other parts, and closing the details leaves the pills and the box as they
  were. Enter on a focused card, a mention and Peek never touched them. A double click is two
  clicks and an open: where a plain click selects (the Graph, or a view set to selects) its first
  click selects the card and takes the pills out, as any selecting click does, and the open that
  follows changes nothing. A Ctrl-click that takes out a card a pill lit turns the pill into its
  other cards and leaves the box, so the view does not widen under the click. Bulk targets are
  fixed when an
  action starts: every bulk action (assign, priority, tags, schedule, archive, restore,
  delete and drag) takes its list of target cards once, when it starts, from the selection
  as it resolves then, so writes, repaints and polls during the action never change the
  list. An assign on a selection holding an `assignee:@afk` query part reaches every card
  that matched at the start, though each write takes a card off the query, and the archive
  and delete confirmations name the count of that list.
  Exceptions: the map's muted, dashed ghost stubs are click-through-to-detail only, never
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
- **Search panel** — the search box has a border and an arrow at its right end (a caret)
  that is the switch of a panel under the box. With the switch on, the default, focusing
  the box (a click, Tab, `/` or Ctrl+F) opens the panel. A click on the arrow switches it
  off: the panel closes now and focusing the box no longer opens it; a second click
  switches it on and opens the panel now. The `p` key flips the same switch. It reads the
  shared key guard, so it does nothing while a text field has focus or a card menu, a
  dialog, the notifications panel or the preferences sheet is up; the panel is no popup, so
  `p` works with the panel open, and a chord (Ctrl, Cmd, Alt), Shift or a held key is not
  it. The arrow announces the switch with `aria-pressed` (and whether the panel is open
  with `aria-expanded`), and is struck through while the switch is off. The choice is kept
  in the browser per board, in the board's own `prefs` entry, and the preferences sheet
  shows and sets it. An open panel adds nothing to the header's height, and a press
  anywhere outside the search bar closes it, leaving the switch as it was. The panel has
  five regions, drawn on their own: the **Statuses section** first, then the **slice section**
  (next entry) with its fold control, the **pill section** with its fold control, a divider, and a
  foot that holds the **Isolate** switch (see Isolate). The Statuses section shows the current
  view's own status pills with their state, for the Map, the Gantt, the Calendar and the Graph,
  at every width: it is open to start and folds like the others, a tap on a pill switches that
  status in the view and a right-click solos it, as the view's own pills do. It is hidden on the
  Board, still shows when the view's filter hides every card, and never touches the selection.
  **Status section starts folded** makes it start folded. The search chip counts the statuses
  switched off in the view, named "hidden" (Archive only when it is off against the view's
  default), so a hidden status shows with the panel closed. On a phone its pills are 44 px tall
  and the panel scrolls inside a maximum height.
  The pill section lists the built-in pills, blocked, review and waiting, in that order,
  each with a count of the cards its query matches, done cards included. The counts are
  taken over the cards the view shows after its status pills and the Archive pill and
  before the search box and any cut, so turning one pill on leaves the others' counts as
  they were, and a status pill that is off takes its cards out of them. The pills
  follow the status pills' rules, with every pill off to start. A click on a pill
  (Shift+click is a plain click) turns that one pill on or off and leaves the others as
  they were. On, its query joins the box as one more alternative (`review:`, then
  `review: | blocked:`) and its matches join the selection: outside the Graph they are
  the selection and so the bulk targets, and the box shows them; in the Graph they light
  and nothing is hidden, and the box grows there too, so a switch to another view keeps
  the added cards shown and selected. Off, its query leaves the box and its matches leave
  the selection; the only pill that is on turns off and clears the box. A right-click
  solos a pill: it alone is on and the box holds its query alone, whatever else was on or
  in the box; a right-click on the soloed pill turns every pill off, the pills' default
  (the status pills' default is all on, so theirs turns all back on). The first pill on
  is the **anchor** of the selection and later ones are additions, so Esc takes the later
  pills out first and then the anchor. When the anchor is a card, path or tree you picked and
  the box is empty, a click on a pill leaves the box empty, since an empty box hides nothing:
  the pill is on and its matches are selected, but its query is not in the box or the address,
  and typing in the box drops it. The `m` key steps through the pills: each press
  turns on the next pill alone, as a right-click does, so the box holds its query alone, in
  the panel's order: off, blocked, review, waiting, then the board's own pills, then off
  again (that last step is the right-click on the soloed pill, every pill off). Shift+m
  steps backwards; with none on or several on it starts from the first pill (Shift+m, from
  the last), and a pill that holds a query an earlier pill holds is the same step. It
  works in every view, the panel open or closed, and a value pill behind a **+N more**
  button is shown when the step reaches it. It reads the shared key guard, so it does
  nothing while a text field has focus or a card menu, a dialog, the notifications panel or
  the preferences sheet is up; a chord (Ctrl, Cmd, Alt) or a held key is not it. A pill is
  on while its query is the anchor or an
  addition, and is announced as pressed (`aria-pressed`); typing in the box, or clearing
  it, turns off every pill whose query the box no longer holds (in the Graph the typed
  text becomes the anchor). A query typed by hand is never a pill, even one that reads as a
  pill's query: type `review:` and the review pill stays off. A pill's anchor is not a typed search, so it
  stays the anchor when the Graph is left. With the panel closed, a chip inside the box
  counts what is on and its accessible name says what (`1 on: review`), and the chip's
  hover text says it too; with nothing on there is no chip. The chip is a button: Tab
  reaches the chip while it is shown, between the box and the clear button, and it is no tab
  stop when it is hidden (the panel open, or nothing on); Enter and Space on it open the
  panel, and so does a click with the mouse, with focus on the arrow either way, and it
  shows the focus ring the arrow shows and the pointer hand the other header buttons show.
  A held Enter acts once: the arrow ignores the repeats of a held key, so Enter held on the
  chip opens the panel and does not flip the switch. A reload, or a link, carries the
  box's text and not the selection, so a cut and isolate come back but a pill shows off, with
  its query in the box as typed text. The pill section folds with its fold control for the visit, and the
  preferences sheet's **Pill section starts folded** (off by default) says how it starts.
  The arrow, the fold control and every pill are buttons, so Tab reaches them and Enter
  and Space act as a click. **Esc** closes the suggestion list first, then the panel (focus
  goes back to the arrow, and stays in the box when Esc was pressed there), and only then
  clears the box, with focus in it, or steps the selection back. Esc leaves the switch on,
  so the box, focused again, opens the panel again. The box keeps its text
  through the first two, because the browser's own Esc, which clears a search field, is
  stopped for them. The panel is no popup: the 5s poll runs while it is open and updates the
  pills and their counts where they stand, so a pill that has focus keeps its focus; a
  click on any control in it never clears a selection (each wears `data-keeps-selection`,
  and none wears `data-holds-poll`, which a button left focused by a click would hold for
  good); and the single-key shortcuts keep working. The pills are `.query-pill` buttons,
  never the status pills' classes. The list and its counts are worked out in `pills.js`,
  which needs no other module so that the snapshot can embed it, and the box grows through
  the search module's `searchAddAlt` and shrinks through `searchRemoveGrownAlt`, which takes
  out the pill's alternative and any alternative a click on a cue has grown it into (`review:`
  with a cue term added is `review: assignee:@human`, still the pill's), and leaves the text
  typed beside it.
- **Slice section** — the first region of the search panel lists the board's slices, top to
  bottom: first the tiers some card of the board is in (live or archived; a tier no card is in
  is left out), each with the icon its type has in the config's `types:` list, then every
  depth (`depth 0`, `depth 1`, ...). Each entry shows its count, taken over the cards the view
  shows after its status pills and the Archive pill and before the search box and the run, so
  setting a run or turning a pill on leaves every count as it was and a run never zeroes the
  entries needed to grow it again. The entries in the **run** are pressed (`aria-pressed`), and
  each entry's accessible name states its label, its count and whether it is in the run, such
  as `epic, 3 cards, in the run`. The run is the `slice:` term at the top level of the query in
  the box, so a term edited by hand updates the entries at once; a run that covers every slice
  writes no term, and a single unknown name, which cuts nothing, shows every entry as pressed.
  A click on an entry outside the run grows the run to it; a click on an end of the run drops
  that end; a click on a run of one brings every slice back; a click inside the run that is
  not an end changes nothing. A right-click keeps only that slice, and so do the context-menu
  key and Shift+F10 on a focused entry. The term is written through the search module's
  `searchSetSlice`: a run set on a query that holds `|` brackets the query, so
  `tags:ui | #12` becomes `(tags:ui | #12) slice:goal..objective` and the run cuts all of it, not
  only the last group; a run set again replaces the one there, and a run that reaches an end
  of the list leaves that end open (`slice:epic..`). A run is not an alternative of the box, so
  turning a pill on or off, or soloing it, leaves the run where it stands. In the Graph the
  run's term hides the cards outside it while the rest of the query lights (see the Graph view
  entry), and a typed search stays the anchor, following the box. **Keys:** `[` moves the
  bottom of the run up and `]` moves it down, `{` moves its top up and `}` moves it down, in
  every view and with the search panel open or closed. Each stops at the ends of the axis, and
  the top never passes the bottom. They read the shared key guard, so they do nothing while a
  text field (the search box too) has focus or while a card menu, a dialog, the notifications
  panel or the preferences sheet is up, and a chord (Ctrl, Cmd, Alt) is not them (AltGr, which
  types the brackets on a layout with none of its own, is not a chord). With the panel
  closed, the chip counts a run that cuts and its name says so (`1 on: slice goal..objective`). The
  section folds with its fold control for the visit, and the preferences sheet's **Slice
  section starts folded** (on by default) says how it starts. The entries are `.slice-entry`
  buttons, never the pills' classes, built once and updated in place by every render (the
  poll's included), so an entry that has focus keeps it; Tab reaches the fold control and
  every entry, and Enter and Space act as a click. The list and the arithmetic of the run are
  worked out in `slice-run.js`, which needs no other module so that the snapshot can embed it.
- **Board pills** — the pill section also lists the board's own pills, after blocked, review
  and waiting, in config order. Each `pills:` entry of `config.yaml` is a query, shown as its
  query, or a label and a query, shown as its label (the board answer carries them as
  `pills: [{label, query}]`; an entry that is malformed is skipped, never an error). A board
  pill shows a count like the built-ins, over the same cards, and clicks as they do: a click
  turns it on or off, Shift+click is a plain click, a right-click solos it and `m` steps to
  it after the built-ins, so the first pill on is the anchor and a later one is an addition
  (see Search panel). A pill whose own query is a `slice:` term writes a cut, which stands
  at the top level of the box and cuts every view, and the cut goes with the pill when it goes
  off; a run of slices the box held before it is not the pill's and stays, also when it is the very
  cut the pill holds: the box then holds that cut twice while the pill is on, and the pill takes
  out its copy only (Esc's step back does the same). A `field:*` entry, such as `tags:*` or `assignee:*` (also `status:*`,
  `priority:*` and `type:*`), makes one pill per distinct value the board's active cards hold
  in that field, in the place the entry holds, sorted and labelled by the value. Each matches
  its value exactly, through the search module's term writer, so the `grill` pill never
  catches `grilling` and a value with a space stays one term. The first eight values of a
  field show, and a **+N more** button, which is no pill, reveals the rest and folds them
  back (it reads *fewer* while they show, and keeps its place); an open field stays open for
  the visit. Each value pill is keyed by its field and value and each other pill by its
  query, and the buttons are updated where they stand, so a pill that has focus keeps its
  focus across the poll and its count changes under it. The chip counts a pill that is on
  even while the button hides it. Next up is not built in: it is a pill a board defines, such
  as `- next: 'tags:"next-up"'`, and the plugin gives it no meaning.
- **Isolate** — the foot of the search panel holds the **Isolate** switch (`#isolate-switch`, a
  button with `role="switch"` whose `aria-checked` says on or off; Tab reaches it, and Enter and
  Space act as a click), and the `i` key flips it. The key reads the shared key guard, so it does
  nothing while a text field has focus or a card menu, a dialog, the notifications panel or the
  preferences sheet is up; the panel is no popup, so `i` works with it open, and a chord (Ctrl,
  Cmd, Alt), Shift or a held key is not it. A click on the switch never clears a selection.
  Turning isolate on writes the selection into the search box as `part | part | ...`, each part
  by its criterion rather than as a frozen list of cards, so a card that comes to match a query
  part joins on the next poll: a card is `#12`, a path `path:40`, a tree `tree:40`, and a query
  is its own text, in brackets when it holds `|` or spaces (`(tags:ui status:doing)`). A card,
  the path through card 40 and the `grill` tag make `#12 | path:40 | tags:grill`; a query part
  with a card taken out of it is already its other cards (see Multi-select), so it is written as
  them. The text the box held is kept, and so is a run of slices in it, applied to the whole of
  the isolated text, because the selection only covers the cards the view shows. Outside the
  Graph, where the box hides what it does not match, a path, a tree or a card the box was
  hiding is not in the selection, so when the parts alone would bring such cards back the
  box's own text stays beside them, ANDed on (`(#4 | path:40) tags:ui`). With nothing to
  write (nothing selected, or only a half-typed term) the switch stays off and a toast says
  nothing is selected. While isolate is on, **every view shows only the matches**: the Board,
  the Map, the Gantt and the Calendar filter by the box as they always do, and the Graph, where
  a typed search only lights, hides what the box does not match (the Graph's one pure decision
  about a query, `graphQueryEffect`, takes `isolated`; the renderer is untouched). The Calendar
  and the Gantt jump to the nearest match when none is on screen, through the box writer's own
  listener, never on a poll. **Clicks move the anchor only**: a click on a card sets the anchor
  and leaves the box text and the shown set as they are (in the Graph a plain click clears the
  box, but for its cut, when nothing is isolated, and not now), a click on the empty Graph clears nothing, and so
  does a double click on empty space, in every view, not the Graph alone. A pill or a slice written while isolated edits the query
  like a hand edit does: isolate stays on while the box holds a query, and ends when the box is
  left holding none (the clear button, an emptied box), when the text it kept is not given back.
  A keystroke typed after isolating keeps the text's leading `#`. With the panel closed the chip
  says **isolated**, and its name lists what else is on (`2 on: review, isolated`). Turning it
  off, with the switch, `i` or Esc, gives the box back the text it held, with the run of slices
  as the box holds it now. **Esc** steps back in three stages: isolate off, then every addition,
  then the anchor. With the search panel open the first Esc closes the panel and the second turns
  isolate off; with focus in the box Esc turns isolate off rather than clearing the box, and the
  browser's own Esc, which clears a search field, is stopped for it. The text is built in the
  search module (`searchIsolateText`, `searchIsolateBox` and `searchIsolateRestore`), the stages
  in the selection module (`selectionAfterEscape`, `boxAfterGraphClick`, `isolateAfterWrite`),
  and the page carries it out in `isolate.js`, which writes the box only through `writeSearch`
  with the reason `isolate` and never writes the selection.
  **The menus offer it.** A right-click on a card inside the selection offers **Isolate** in
  the menu that acts on the selection (`cardMenuFor`, `isolate`), which does what the switch
  does, and the menu of a card outside the selection and the card details' own menu do not offer
  it. A right-click on the empty Graph or Map canvas opens a menu of that one entry (see
  Multi-select). The entry mirrors the switch: it reads **Isolate**, and **Turn isolate off**
  while isolate is on, and with nothing selected it says so and changes nothing.
  **The link carries it.** While isolate is on the address holds a second parameter beside `q`,
  `isolate=1`, so the address is `?q=%2312+%7C+%235&isolate=1` for the box `#12 | #5`. It is written
  by the box's own address listener (see Deep links), as the box changes and never as a history
  entry; it is dropped when isolate is off and when the box holds no query, since an isolate with
  no query is nothing. A reload keeps isolate on: the link opens with the switch on, the box
  text, the address and the chip that says isolated, and so does a link opened in another
  browser, where the Graph, with no dot dimmed, and every other view show only the isolated set.
  The text the box held before isolating is kept in the browser per board (`localStorage`, the
  board's `isolate.kept` entry, beside its other remembered choices), with the isolate text it
  goes with, and given back when isolate is turned off after the reload; where it is unknown (no
  record, storage that is blocked, or a record kept for another isolate) the box ends up empty.
  The page works without browser storage. Opening a card while isolated keeps the parameter,
  and Back and Forward bring the entry they land on in line with the box, isolate included.
  A link with `isolate=1` and no usable `q` opens with isolate off and loses the parameter from the
  address on load, and any value but `1` is no request.
- **Preferences sheet** — the gear at the right end of the header opens a full-height sheet
  from the right with two sections. **This browser** holds the settings which rarely change
  (the Preferences and Hotkeys pages, below) and **This board** holds the pages that write
  `config.yaml` (the last item of this bullet). A sheet 760 px wide or more shows the menu and
  one page side by side; a narrower one shows the menu, then the page with a back button, and
  Esc steps back to the menu before it closes the sheet. Each setting of This browser is kept in the browser per
  board (`localStorage`, in the board's own `prefs` entry beside its other remembered
  choices), never written to the board, and applies the moment it is chosen. **A plain click
  on a card** opens it or selects it, chosen separately for the Board, the Map, the Gantt and
  the Calendar (the default is opens, as before); the Graph is shown fixed at selects. In a
  view set to selects a plain click selects the card alone, and a double click, or Enter on a
  focused card, opens it; ctrl/cmd+click and shift+click build the selection in every view as
  they always did. Opening a card that way is a peek: the selection stays as it was. A double
  click on a Calendar card opens it and never starts a new card.
  **Roll-up bar** is open or collapsed, the one choice a click on any bar flips. **Count
  archived leaves as done** is on by default and feeds every roll-up: the board tile, the
  Map's rich row and the card detail, whose scope line says "Archived leaves count as done."
  or "Archived leaves are left out." A value an earlier visit saved under the retired
  `rollup.archived` key is not read, so a browser that kept `false` there counts archived
  leaves again and the sheet shows the toggle on. **Slice section starts folded** is on by
  default: it says how the search panel's slice section starts, and the section's own fold
  control still folds it for the visit. **Pill section starts folded** is off by
  default: it says how the search panel's pill section starts, and the section's own fold
  control still folds it for the visit. **Status section starts folded** is off by default:
  it says how the Statuses section starts, and its own fold control still folds it for the
  visit. **Panel opens when the search box is focused** is
  on by default: it is the arrow's switch, the same choice the arrow and the `p` key flip,
  so each shows what the others did; turning it off closes the panel, and turning it on
  from the sheet leaves the panel closed until the box is focused. Switching it off moves focus to
  the arrow only when a control of the panel had it, and leaves it where it was otherwise (the box,
  the sheet, the board). **Colour Markdown while editing** is on by default and is one choice for the
  whole browser, not per board: it is kept under the single key `kanban.md-colour` (`'false'` or `'true'`;
  prefs.js `loadMdColour` and `saveMdColour`), not in a board's prefs entry, and turns the coloured
  Markdown boxes off and on at once (see Coloured Markdown boxes). **Hotkeys** lists every key
  the page answers, each with what it does, and shows the state it is in for the keys that have
  one: `names: relevant` (the tier fan's names option), `slice: all` or the cut the box holds,
  `pill: off` or the pills that are on, `isolate: off` and `panel on focus: on`. The keys are
  `/`, `Ctrl/Cmd+F`, `Esc`, `Enter`, `Space`, `Ctrl/Cmd+S`, `Alt+Enter`, `n`, `e`, `a` and `d d`, `t`, `Space` `e` `c` `d d` `Alt+Up` `Alt+Down` `Tab` `Shift+Tab` on a todo item, `Alt+1` `Alt+2` `Alt+3` `Alt+4`, `Tab` and `Shift+Tab`, `Ctrl+M`, `Ctrl+B` `Ctrl+I` `Ctrl+U` `Alt+S` `Ctrl+E` `Ctrl+K`, `Ctrl+Shift+7` `Ctrl+Shift+8` `Ctrl+Shift+.`, `Ctrl+Shift+D`, `Ctrl/Cmd+Shift+V`, `l`, `[` `]` `{` `}`,
  `Menu` and `Shift+F10` on a focused slice entry, `m` and `Shift+m`, `i`, `p` and `?`. The
  list is `hotkeys.js`, the one list, and a unit test reads the page's own key handlers and
  fails when a handler reads a key the list lacks, or the list names a key no handler reads.
  The state is read each time the sheet opens, so a key pressed since shows its new state, and
  the `panel on focus` row follows the checkbox at once. `?` opens the sheet at this section
  (it is Shift with the slash key on a US keyboard), with the section brought to the top of
  the sheet. It reads the shared key guard unchanged: it is typed, not read, while a field has
  focus, and does nothing while a card menu, a dialog, the notifications panel or the
  preferences sheet itself is up; the search panel is no popup, so `?` works with it open, and
  a chord (Ctrl, Cmd, Alt) or a held key is not it. The list is to read, not to change.
  The sheet closes on Esc, on a click outside it or with its close button, and focus goes
  back to the gear; like the other popups it
  traps no Tab, so Tab from its last control leaves it. While it is open the 5s refresh does
  not rebuild the board under it, `/`, `p` and Ctrl+F do nothing (the shared key guard names
  the sheet), and a click inside it never clears a selection. `?` opens the sheet on its Hotkeys page.
  **This board** has the pages Logbook, Scratchpad, Todos, Groups, Types, Prefixes and Counters, each written to
  `config.yaml` one top-level line at a time (or one block, below; the line replaced, inserted or removed, every
  other byte kept: comments, unknown keys, the file's line ending) by `POST /api/config` with
  `{ key, value }`, which answers `{ settings }` as the file now reads. **Logbook**,
  **Scratchpad**, **Todos** and **Groups** each have an on/off switch (off removes the line, on writes the folder) and a
  folder field (saving a folder turns the feature on). The page takes a folder inside the
  board only, saved relative to it, and the server refuses a folder that leaves the board,
  the board itself, or a name that would need quoting in the file (400); a folder written by
  hand outside the board still works for reading and writing notes and groups, shows
  **locked** with the reason, and every change to it is refused (409). Changing a folder
  changes the line only: the files stay where they are. **Groups** adds the **Iterations**
  switch (`iterations: true`): turning groups off removes only the `groups:` line (`iterations:` stays and is ignored
  without groups), and turning iterations on without groups is refused (409). It also lists the groups found, by type path,
  each opening its group in the palette, and **New group…**. **Types** (ADR 0018) is the
  Types switch (`typesOn`, display only, with the hint saying so), then the **Hierarchy** area (the `hierarchy:`
  list in order) above **Other types** (the rest of `types:`), each a list of rows. A row has an editable
  name, a color (a row of swatches, the starter's colors and the status palette, with one that clears it,
  and a hex field; no native color popup, ADR 0003), an icon (none, or one of the six, drawn as the
  board draws them), its prefix shown read only with a link to the Prefixes page, and the buttons Up,
  Down, To Hierarchy or To Other types, and Remove. A color already in the file may be a name and an
  icon one this build does not draw (ADR 0004): the field shows the name as written, the swatch beside
  it is drawn when the browser can, and a row saves untouched unless the person edits that value.
  Names that differ only in capitals are separate rows, each acted on by its own spelling. A row also
  drags by its handle within and between the
  areas; the buttons do the same from the keyboard, and focus stays on the button used. A move
  rewrites `hierarchy:` only (emptying the area removes the line); Other types keep the `types:` order.
  **Add type** appends a name; **Found on cards** lists the words cards carry in `type:` that the list does
  not have, with counts, each with **Add**. Removing a type some card carries asks first. Every change
  saves at once through the block route with the version the page read; saves go one after the other,
  each worked out from the settings the one before left. The page checks only what the person just
  typed: a new or renamed type's name must not match another listed type (with or without capitals) and
  the hex field takes a hex color or nothing. Text typed into a name, hex or prefix field and not yet
  saved survives a redraw. A value the server refuses (400) shows under its
  row; a save refused for a changed `config.yaml` (409) makes the page read again and shows one bullet
  saying nothing was saved and why. Each edit changes only its own list, so what else names the old word
  stays and shows as a warning, one bullet saying what and why: a hierarchy name no type has (also a
  warning chip in the Hierarchy area, with a Remove from the hierarchy button), after a rename "N cards
  still say `old`", and a prefix naming a type no longer listed. **Prefixes** is editable: each row is a
  prefix and its card type or groups folder, with Remove, and an Add row; every change asks first and
  saves the `prefixes:` block, and the page says in one bullet that a prefix change changes only the ids
  given from then on, cards already made keep their ids, and an AI can migrate the board to rename them.
  A queued prefix save finds its row by the prefix it names in the settings as they stand when its turn
  comes, not by where the row was drawn. A prefix that two lines of `prefixes:` name for different
  targets shows a bullet saying the board reads the first, and that saving the page rewrites the block
  without the other line. The page also edits `idDigits:` (a whole number from 1 to 15), which changes
  only the names of new card files. **Counters** shows `nextId:` and the `counters:` line, read only.
  Every page of This
  board shows the absolute path it reads (`config.yaml` for Types, Prefixes and Counters; the folder for
  Logbook, Scratchpad, Todos and Groups; nothing when the feature is off) with a **Copy** button that says
  Copied.
  **One line or one whole block per save.** A save changes one top-level line of `config.yaml`, or
  rewrites one whole top-level block, `types:`, `hierarchy:` or `prefixes:`, from `{ block, value }`:
  `types` a list of names or of
  `{ name, color?, icon? }` (an entry with neither is written bare, as the starter writes `- bug`),
  `hierarchy` a list of names (written inline, or as a block when a name will not sit in a flow
  list), `prefixes` a map from each prefix to a card type or a groups folder (or a list of
  `{ prefix, target }`). An empty or absent value removes the block. The block is written clean in
  the starter's layout; every byte outside it stays, the file's line ending included, and the
  comments inside the old block are dropped, with no warning. A line or a block that is not in the
  file yet is inserted below
  the nearest key before it in the config's own order (`KEY_ORDER` in `config-store.js`), else at the
  top. A value from the file is kept as written (ADR 0004), so the server refuses (400) only what would
  corrupt the file: a name that is empty, any value that is not one line of plain text, and a prefix
  that is not `_` and capitals. A color is any text (a hex, a name) and an icon any word, and two names
  that differ only in capitals are both kept, in `types:` and in `hierarchy:`; a name that would not
  read back bare is quoted. Each edit changes
  only its own block: the server never rewrites `hierarchy:` or `prefixes:` because `types:`
  changed, and never writes a card; renaming or removing a type leaves the hierarchy, the prefixes and
  every card's `type:` naming the old word until a human, or a session a human tells to, changes them.
  **Types off** is `{ key: "typesOn", value }`: `false` writes
  `typesOn: false`, `true` removes the line (no line means on); it is display only and writes
  no list and no card. Every save from the gear sends the `version` the settings answered, a line save
  as much as a block: when `config.yaml` has changed on disk since, the save is
  refused with 409 and writes nothing, and the page reads again and says so. The version leaves out the
  `nextId:` and `counters:` lines, which the board moves itself with every card made, so a card made
  while a page is open does not turn its save into a conflict. A 409 that is not a stale version (a
  folder locked outside the board) shows its own message under its control. A save that sends no version
  is not checked. The
  `/api/board` payload carries `settings`: `logbook`, `scratchpad`, `todos` and `groups` as `{ on, folder, locked,
  reason }`, `idDigits`, `nextId`, `prefixes` (and `prefixClashes`, the prefixes two lines name for
  different targets) and `counters`, and for the Types page `types`,
  `hierarchy`, `typesOn`, `typeUse` (how many cards, on the board and archived, carry each `type:` word
  as written), `version`, and `paths` (the absolute path of `config.yaml` and of the logbook,
  scratchpad, todos and groups folders, resolved whether or not the folder exists, `null` when off) for
  each page's copy button (the Iterations switch shows the
  payload's own top-level `iterations`). Another page of
  This board is added with `settingsAddBoardPage` in `settings-ui.js`.
- **Notes (logbook)** — with a `logbook:` line in `config.yaml` (the folder of the board's
  day files, see the kanban skill's logbook section) the page keeps a **notes palette**, the
  one surface for notes. Without the line nothing of it shows: no count, no menu entry, and
  `n` only says the logbook is off. A card with notes wears a small count on its tile (live
  and archived); a click on it opens the card's notes. `n` opens the palette on the card whose
  details are open, else on the hovered card, else on the one selected card, else on nothing: on
  the Calendar (`loadViewMode() === 'calendar'`) with the Calendar's own sub-view and anchor as the
  range, or with the pointer over a day cell or column (`calendarHoverDay`, tracked by a
  `mouseover` on `#calendar-view`, kept nowhere) as the range (Day), the note still going to today;
  elsewhere on Day, today (`notesCalendarOpening`). The Calendar has no way to select a day or a range
  of days, and none was added. The card details are the one popup `n` works
  over (`keyGuardOff(document, '#detail-modal')`): any other popup, a menu, or a field with
  focus still turns it off. The palette then draws above the details; Esc clears the card chip first,
  the next closes the palette (`notesEscape`), the one after closes the details; the card menu's **Add note…** opens it on one card. Its rows, top down: the
  subject row (a chip that says what the palette is about, a **date** field with the date picker's
  grid (`wireDatePickButton`, `data-date-only`), a time field, an *untimed* tick and a **card picker**,
  the form's `attachCombobox` over *no card* and the live cards in id order), the note box, the preview line that says exactly what Enter will write (`Note at
  10:30 on #7 Port the zephyr schema`), the filter row (a filter field of its own, with an
  All, Human and AI switch beside it, and a **Grouped | Timeline** switch, kept per board in
  this browser as `notes.layout`), the **range** row (All, Month, Week, 3 days, Day, the ‹ and ›
  buttons and the label) and the list of notes, grouped by day and card, newest day
  first, each with its time and its author, the human's included. Timeline is the same notes as
  one flat list (`noteTimeline`, notes.js): days newest first, inside a day the timed notes in
  time order and then the untimed ones, each row naming its card with the link a group heading
  has (`no card` for none); a day line shows where the grouped list shows one, and so whenever more
  than one day is listed. **Enter** writes the
  note to the day in the date field (today, or the day of the hour or all-day box the palette was
  opened from; a day that is not a date is said in the preview and written nowhere) at the time
  field's time (now, to start with) and keeps the palette open for the next; the fields then go
  back to those defaults (`notesRefreshTime`) unless a date or a time was typed or picked into
  them, which stay. The untimed tick drops the time and keeps the day, a leading `10:30` sets the
  time alone, and the preview names the day when it is not today (`noteWritePlan`, notes.js). The
  **card picker** shows the note's target (`noteSubjectTarget`: the card or group, `N cards` for
  several, `no card`, else the card Enter would write on) and a choice from its menu, which
  arrives as an input event the browser did not make, aims the palette at that card as a bare
  mention and Enter does, keeping the note box's text; choosing *no card* (`noteSubjectNoCard`)
  makes the note about nothing whatever card was last noted, and on several cards choosing one
  makes it the single target. A mention at the start of the note wins over the picker, and so does a card id typed in the
  picker (`22`, `#22`) on Enter or on leaving the field (`notesCommitPick`; free text stays legal,
  ADR 0003). The menu is `attachCombobox`'s, which tells the palette of a choice through its
  `onPick` option, and it is moved to the page and fixed under the field (`.np-pick-menu`) so the
  palette's `overflow: hidden` never clips it. The
  **range** is `{ mode, anchor }` over the Calendar's own sub-view names (`noteRangeBounds`,
  `noteRangeStep` and `noteRangeLabel` over calendar-model.js, weeks from Monday); the ‹ and ›
  buttons step one unit and are off on All, a click on the label goes back to the range that
  holds today, and `noteListNotes` lists the subject's notes in it. It is set at every opening
  (`noteRangeFor`) and kept nowhere: All for a card, a group or several cards, Day of the hour or
  all-day box's day for those (the hour or the untimed box alone until the range is changed, then
  the rest of the range), the Calendar's range or the day under the pointer for `n` there, and
  Day, today otherwise; aiming the palette (the picker, a bare mention) opens it again for the new
  subject. It never changes the day a note is written to, and a note written outside it stays
  listed;
  **Alt+1** to **Alt+4** switch the open palette to its first to fourth tab
  in the order the tab row shows them (`notesTabs()`, `notesSetTab`); a number past the last tab
  does nothing, each tab shows its key, and they work from the note box (`noteTabKey`, notes.js;
  Alt+Left and Alt+Right stay the browser's). **Shift+Enter** starts a new line. The note box starts one line high and grows with its text,
  typed and wrapped lines both, up to 12 lines or 40% of the window, whichever is less
  (`noteBoxSize`, notes.js), and scrolls inside past that; the box a listed note is edited in
  grows the same way and is sized to the note when it opens. Neither has a resize grip.
  A leading `10:30` in the line sets that one note's time,
  a leading `-` or `untimed` (or the tick) makes it untimed, and a leading mention of a card
  (`#22`, `plan#22`) aims that one note at it and is cut from the text; a mention anywhere
  later is only text. A line that is only a mention, then Enter, moves the palette to that
  card and writes nothing; **Backspace** on an empty box clears the chip. The filter field
  narrows the list by every word typed (in the text or the card's name) and never touches the
  note box; `by:@afk` in it keeps one author's notes. The switch keeps the notes of human
  authors (the assignee registry's kind `human`, or no author at all) or of every other
  author, a handle the registry does not list included. A note written in the palette stays listed whatever the filter and the
  switch say. **↓** moves into the list: **e** edits a note's text and time, **a** assigns it
  to another card or to no card (the note moves to that target's file for the same day, and
  a file left empty is removed), **d** twice deletes it. **Esc** clears the chip while the palette is
  aimed at a card, a group or several cards on its Notes tab (`notesChipClearable`: exactly what the
  backspace does, the range going back to the opening rule with no card), and closes the palette
  otherwise, from the filter field at once; the footer's Esc hint reads *clear the chip* or *close*; a
  press outside the palette closes it too. Every key typed in the palette stays in it, so none reaches the
  board's own shortcuts. The palette is no modal: the board keeps refreshing behind it, and
  each refresh repaints the list unless a note is being edited. The notes are written by
  `POST`, `PATCH` and `DELETE /api/notes` and `POST /api/notes/assign`, which build the day
  file's name from a day and an id and never from request text; a write re-reads the file
  and retries once when it changed meanwhile, then answers 409; unknown keys and the body of
  a day file survive every write. A note's `by` is kept as written (one trimmed line, any
  text; a blank one is `@human`), never refused for not being a handle. The Graph's names step moved to `l` to free `n`.
- **Text boxes** — the notes palette's note box and a listed note's edit box, the Scratchpad's box,
  the Todos tab's Edit box and the card form's description (`#f-body`) each call `textEditAttach(box)` (text-edit-ui.js)
  once; single-line fields are never attached. The rules are `textEditKey(text, start, end, event)`
  (text-edit.js, pure): **Tab** indents two spaces at the cursor or on every selected line (a
  selection inside one line is replaced, a blank line stays blank, a selection ending at the start
  of a line leaves that line), **Shift+Tab** takes up to two spaces or a tab off; **Ctrl+B**
  (`**`), **Ctrl+I** (`*`), **Ctrl+U** (`<u>…</u>`), **Alt+S** (`~~`) and **Ctrl+E** (`` ` ``) wrap
  the selection and unwrap it when the markers are inside it or just outside it (a run of stars is
  italic when odd and bold from two, so italic on bold adds one star); with no selection the pair
  goes in with the cursor between and a cursor in an empty pair takes it away; **Ctrl+K** makes
  `[selection](url)` with `url` selected (`[](url)` with the cursor in the brackets when nothing is
  selected); **Ctrl+Shift+7**, **Ctrl+Shift+8** and **Ctrl+Shift+.** number, bullet or quote each
  line the selection spans (blank lines left alone, a line of the other list kind converted) or take
  it off when every line has it; **Ctrl+Shift+D** wraps the lines the selection spans in
  `<details>`, `<summary>[...]</summary>`, a blank line, the lines, a blank line and `</details>`
  and selects `[...]` (nothing selected: the same block on lines of its own, with an empty line for
  the body), and with the cursor inside a section of that shape it takes the wrapper off and selects
  the lines it kept. Cmd does what Ctrl does, and the digits and the period are read by
  key or by key position. An edit is one replacement (`{ from, to, insert, start, end }`), made with
  `document.execCommand('insertText')` (`delete` for an empty insert) so Undo takes it back in one
  step; where the command is refused the text is replaced with `setRangeText` and the input event
  fired by hand. The browser's own action for a handled key is stopped, only while the box has focus
  (Ctrl+U view source, Ctrl+K and Ctrl+E the address bar). **Ctrl+M** switches Tab to moving focus
  (VS Code's); `#text-edit-hint` shows while an attached box has focus and says which Tab it is now and
  what Ctrl+M changes (WCAG 2.1.2: Tab is never a trap); the mode is a module
  variable, kept nowhere. Enter, Shift+Enter, Ctrl+Enter and Ctrl+S are not read by these boxes'
  keys, so each keeps its own meaning (Enter writes a note, Ctrl+Enter saves a scratchpad or a todo list's text, Ctrl+S
  saves the form); none of the new keys clashes with an existing hotkey.
- **Coloured Markdown boxes** — the card form's description (`#f-body`), the Scratchpad's Edit box
  and the Todos tab's Edit box (both `.sp-text`) call `mdEditAttach(box)` (markdown-edit-ui.js) once, after `textEditAttach`; the notes
  palette's boxes and the single-line fields are never attached. `markdownEditSpans(text)`
  (markdown-edit.js, pure, tested in Node) returns the sorted, non-overlapping `{ from, to, kind }` spans
  to colour, reading the text a line at a time as markdown.js does: `heading` (the whole `#` line, the
  marks inside it keeping their own kind), `heading-six` (the same for a sixth-level one, which the preview
  keeps muted: h4 to h6 share a size, so colour is all that sets h6 apart), `bold`, `italic`, `strike`, `code` (inline code, and a fenced
  block as one span from its opening line to its closing one, or to the end of the text), `link` (`[text](address)`,
  an image, a bare address; drawn with a dotted line under it, `border-bottom: 1px dotted`, the preview's cue, which
  is no height on an inline box), `marker` (a list bullet, number or task box, a quote `>`, a rule, a table's
  pipes and its delimiter row, which needs the pipes of the row above it), `tag` (`<u>`, `<details>`,
  `<summary>`, opening and closing) and `mention` (a code span naming a card, and a bare `#12`,
  `board#12` or `#G3`, by the mention pattern in ids.js). It is bounded: each scan for a closing mark
  remembers where one failed, only the first 4000 characters of a line are read for marks (the rest keeps
  its block colour), and a text over 400000 characters has no spans. The box is wrapped in a
  `.md-edit` element holding the textarea and a `<pre class="md-edit-back" aria-hidden>` that
  draws the spans as `<span class="md-edit-<kind>">`; the textarea's own text is transparent over it
  (its caret, selection and spellcheck stay), and the copy takes the textarea's font, padding, border
  widths, wrapping and a scrollbar's width from `getComputedStyle` so each word sits where the textarea
  has it (font, kerning, variant, alignment, tab size, spacing and the padding and border widths). It is
  redrawn at most once a frame (`requestAnimationFrame`, before the paint, so the transparent text is never
  seen without its copy): every `input` and every script set of `value` (the box's own accessor is wrapped,
  no prototype is touched) in a frame share that one redraw. The computed style is read on attach, on a
  resize and when the switch goes on, never on an input; the only per-frame reads are the box's rect, to
  give up the width of a scrollbar (measured from the rect, so a fractional zoom costs no pixel), and its
  scroll, which the copy follows. One `ResizeObserver` serves every box (it grows with its text, a drag, full
  screen, the phone layout); it is called in the frame and redraws at once, taking the frame an input asked for
  with it, and a box the page dropped (the Scratchpad panel is rebuilt each time its tab opens) is
  unobserved the next time a box is attached or the switch is flipped.
  Only colours, a line-through and the link's dotted line are ever applied, never a weight, style or size, so a
  line cannot wrap differently. The wrapper is `display: contents` when the switch is off, and
  `.md-edit.on` otherwise; `mdEditSetOn(on)` is the switch (app.js keeps it for the whole browser under
  `kanban.md-colour`, `setMdColour`, applied when the page starts), and a box attached while it is off starts
  plain. Under `forced-colors` the copy is hidden and the textarea is given `CanvasText` on `Canvas` by
  name, not left to the browser to override `transparent`. The colours
  are tokens, declared on `:root` and in both dark blocks: `--md-edit-heading`, `--md-edit-heading-six`, `--md-edit-bold`,
  `--md-edit-italic`, `--md-edit-strike`, `--md-edit-code`, `--md-edit-link`, `--md-edit-marker`,
  `--md-edit-tag`, `--md-edit-mention` on `--md-edit-mention-bg`, the box's own selection wash
  `--md-edit-selection` (its own alpha, so selected text stays readable), `--md-preview-heading`,
  the colour of headings in the rendered preview and the card details, and `--md-preview-bold`, the
  colour of bold there (its weight is unchanged). Bold and italic in the copy are blue-greys and the
  edit mention is a muted terracotta on a pale ground, none of them the accent. A card mention in the
  rendered body, notifications, notes, the scratchpad refs and the todos is `--mention` on
  `--mention-bg` (the accent wash); a same-board one keeps its dotted line and focus ring in
  `--mention`. Each pair clears 4.5:1 in both themes (theme-contrast.test.js).
- **Scratchpad** — with a `scratchpad:` line in `config.yaml` (the folder of the board's
  pages, see the kanban skill's scratchpad section) a card or a group has a disposable page,
  `<padded id>.scratchpad.md`, with optional `refs:` in its frontmatter and a free body.
  Without the line nothing of it shows. The notes palette gains a **Scratchpad** tab, after
  Notes (and after a group's Group tab); a card opens on it alone when the logbook is off, and
  opens on it from the card menu's **Scratchpad…** (one card) or the Group tab's
  **Scratchpad** button. The tab shows the page's file (`(not written yet)` until the first
  save), its refs (a mention among them is a chip that opens the card) and a multi-line box with
  an **Edit | Preview** switch over it (Edit, the default, is the box; Preview draws the box's text,
  saved or not, through `markdownInto()`, and is off until the page has loaded; **Ctrl+Shift+V** flips
  the switch from the box or anywhere in the palette on that tab (Cmd+Shift+V works too, and both buttons show
  the key for the platform);
  **Ctrl+Enter** or **Save** writes the body, and the frontmatter stays as written. The page is
  read when the tab opens, so a refresh does not redraw it under the person's hands, and text
  not yet saved is kept in the page until it is reloaded. The server's
  `GET /api/scratchpad/<id>` answers `{ pad: { target, exists, file, refs, body } }` and
  `PUT /api/scratchpad/<id>` with `{ body }` writes the body (404 with the scratchpad off, 400 for
  an id or a body that is wrong, 413 for a page over 300000 characters); there is no delete
  route, only the delete popup's **Its scratchpad** takes a page. The `/api/board` payload
  carries `scratchpad: { folder, targets }`, the ids that have a page, or `null`.
  Either path may hold `<iteration>` as a whole segment (docs/adr/0019, `iteration-folders.js`):
  a note joins the day file for its day and target that already exists in any folder, else goes to
  the iteration it is aimed at or whose dates hold its day; a page goes to the iteration its card
  or group is in, else the segment is dropped. A file that exists stays where it is (an assign
  keeps a note in its folder, unless the new target is an iteration), and a read covers every
  folder the path can name. A write to a path with another `<word>` answers 400, and the gear
  refuses a folder that starts with `<iteration>`. A note's `file` then reads
  `<iteration folder>/<day file>` (just the day file for the dropped-segment folder, and the ref
  an edit or delete sends names the file it means), and a page carries `folder`, the path with
  the segment filled in, only for such a path. The settings' `paths.logbook` and `paths.scratchpad`
  stay the path as written, with `logbookNow` and `scratchpadNow` the folder a new write goes to
  today (`null` for a path without the placeholder); the gear's path bar shows both and the
  folder field accepts a `<iteration>` segment, as in `0005.sprint-496`.
  The three paths also take a `vars:` block and two more words (docs/adr/0023). A `<name>` that
  names a variable is replaced by its value, a path relative to the board or absolute; a value
  may use the built-in words but not another variable. `<repo>` is the git root that holds the
  board (the nearest folder at or above it with a `.git` entry, a file in a git worktree); with
  none, a path that uses it reads as off, like an absent line. `<card>` is the target's file name
  without its extension (`0007.fix-login`, `I0002.zephyr-2`), matched to its folder by the id at
  its front, and dropped for a note about nothing; an assign puts a note in the new target's
  folder. A note's `file` and a page's `folder` carry every name filled in. The server names a
  bad variable, a variable named like a built-in word, a `<word>` that is neither, and a `<repo>`
  with no git root on stderr at startup. The gear never writes `vars:` and keeps it as it is, and
  its `paths` give the folder with the variables and `<repo>` filled in.
- **Todos** — with a `todos:` line in `config.yaml` (the folder of the board's todo lists, see the
  kanban skill's todo section) a card or a group has a todo list, `<padded id>.todo.md`: a GitHub
  Markdown task list (`- [ ] open`, `- [x] done`, children indented two or more spaces or a tab)
  that a person or an AI edits by hand. `todos:` may name the scratchpad's folder, since the two
  kinds of file never share a name, and each store reads only its own. Without the line nothing of it
  shows. The notes palette gains a **Todos** tab, last (after Scratchpad); a card opens on it alone
  when the logbook and the scratchpad are off. It opens from `t` (the card whose details are open,
  else the hovered card, else the one selected card; the key guard of `n`, the details being the one
  popup it works over), the card menu's **Todos…** (one card), or the small count on a card tile and on a
  group badge (`2/5`: open over all, shown when the list has an item, worked out on each board read
  and never written). The tab is a box where **Enter** adds an item at the end and the list under it:
  **Up** and **Down** move between the box and the rows; on a row **Space** ticks it, **e** or **Enter** edits its
  text in place (Enter saves, Esc puts it back), **c** aims the box under it (a chip says so; Esc
  clears it) so Enter adds a child, **d d** deletes it with its children and the lines indented under it, **Alt+Up** and **Alt+Down**
  move it among its siblings (each row also has these as buttons), **Tab** indents it (the last child of the item above, its children along; with no item above, nothing) and **Shift+Tab** outdents it (just after its parent, its children along, the siblings after it staying under the parent; at the top level, nothing). On a row Tab never moves focus; in the box and the other fields it is the browser's. A ticked item stays in place,
  struck and muted, and nothing clears finished items in bulk. A held key acts once, and a change is ignored while another is on its way. An item's text is drawn by
  `markdownInto(el, text, { inline: true })`, the one renderer's inline marks with no block; a line
  of the file that is not an item shows muted and read only. The list is read when the tab opens and
  read again, redrawn only if it changed, whenever the board refreshes (not while an item is being
  edited or a write is on its way). A **List | Edit | Preview** switch sits over the tab, the
  Scratchpad's switch with List first (its `.sp-mode`, `.sp-text`, `.sp-preview` and `.sp-bar`):
  **List**, the default, is the list; **Edit** is the list's whole file as text in a box that takes the
  editing keys and the colours (`textEditAttach`, `mdEditAttach`), and **Ctrl+Enter** or **Save** writes
  it with `PUT`, naming the version the text was read at. Refused (409, 413), the reason is said and the
  text stays in the box; after a 409 the list is read again and the text names it, so a second save
  writes it over that list, and the `.sp-status` line says so: "The list changed on disk. Save again to
  replace it with this text; List shows it as it is now." **Preview** draws the box's text, saved or not, through `markdownInto()`,
  read only; **Ctrl+Shift+V** (`todosPreviewKey`, the Scratchpad's chord) turns it on and off, back to
  List or Edit, and the palette's foot names each mode's keys. Text not yet saved is kept in the page's
  memory per target, with the version it was read at, until the page is reloaded, and the tab opens on
  Edit while there is some; with none, the box follows the list (a change from List, a hand edit at a
  refresh). The server's `GET /api/todos/<id>` answers
  `{ todos: { target, exists, file, folder?, version, text, lines } }` (`text` the whole file with plain
  new lines and no byte order mark), each line `{ index, item: true,
  depth, done, text }` or `{ index, item: false, text }` (a blank line is left out, `index` is the
  line number in the file); `POST /api/todos/<id>` with `{ text, parent?, version }` adds an item
  (201; `parent` is the line of the item it goes under), `PATCH` with `{ index, done?, text?, version }`
  ticks or edits, `DELETE` with `{ index, version }` removes an item with its children and the lines indented under it, and
  `POST /api/todos/<id>/move` with `{ index, by: -1 | 1, version }` moves it among its siblings, and `POST /api/todos/<id>/indent` and `/outdent` with `{ index, version }` change its level (a child's indent follows the file's own style, spaces or a tab), and
  `PUT /api/todos/<id>` with `{ text, version }` writes the whole text (the file then holds exactly that
  text, every line ending the file's own, its first or else a new line, and a byte order mark kept; a
  list not written yet is made in its folder); each
  answers `{ todos }` as the file now reads, with `at`, the line of the item added or moved. Every
  write names the `version` it read and is refused with 409 when the file has changed since, and with
  400 when it names none (an item write changes the one line it is about and keeps every other byte,
  line endings included). 404 with todo lists off or for an item that is not on that line, 400 for
  an id or text that is wrong, 413 for a list over 300000 characters or an item over 2000 (an item
  write may still change a file already over the limit; a whole text over it is refused). There is no
  delete route for a list: only the delete popup's **Its todo list** takes
  a file. The `/api/board` payload carries `todos: { folder, targets, counts }`, the ids that have a
  file and `{ id: { open, total } }` for those with an item, or `null`. A todo list means nothing to
  the board: it never changes a card's status, never holds a card out of `doing`, and adds into no
  roll-up. The path may hold `<iteration>`, `<card>`, `<repo>` and variables by the rules above, a list
  going to the iteration its card or group is in. The mobile snapshot has none.
- **Groups** — with a `groups:` line in `config.yaml` (the folder of the board's group
  files, see the kanban skill's groups section) a card shows **badges** below its title: up to
  two small buttons (`#I2 zephyr-2`) and `+N` for the rest, the dates and the type path (the
  folders the group sits in; `(no type)` at the root) in the tooltip. Without the line nothing
  of it shows. A badge opens the **notes palette** on that group, on its **Group tab** (the
  palette then has a tab row, Notes and Group; with the logbook off a group still opens, on
  its Group tab alone). The Group tab edits the group's name, dates, `auto_join` (on offer only
  with both dates) and one-line extra keys (a cleared field keeps the key with an empty value;
  a separate x takes the key out; a key whose value is a list or several lines is shown as
  written, read only, and never rewritten), with a Save button, lists its members each with an x that
  takes it out (the card is never touched), and has **+ Note** (back to the Notes tab, on the
  group) and **Show this group's cards**, which fills the search box with `group:<id>` and
  closes the palette. A note written on a group lands in `<day>.<padded group id>.logbook.md`,
  and a group lists its own notes and its members'; a mention of a group's id (`#I2 mid check`)
  aims a note at it. The card menu has **Add to group…** (a dialog of the board's groups by
  type path; a click adds the menu's cards) and, on two or more cards, **Make a group from
  them…**, which opens the group form (short name, a folder from the board's folders, optional
  start and end dates, `auto_join`, the cards) and creates it. **Add note…** on several cards
  asks which group all of them share (the groups that list every one), or offers **Make a
  group from them…** (then note on it) and **Add the note to each card** (the palette's chip
  reads `each of N cards` and Enter writes one note on every card). The server's
  `POST /api/groups` makes a group (`name`, `folder` of at most two plain names, optional
  dates, `auto_join` kept only with both, `cards` that must be cards of the board; the id is
  allocated from the folder's prefix and its counter, and a refused group burns no id),
  `PATCH /api/groups/<id>` changes the name, dates, `auto_join` and `extra` keys (null takes one
  out, an empty string empties its value; a key holding a list or several lines is refused, 409), and `POST /api/groups/<id>/members` takes `add` and `remove` lists of card
  ids; each rewrites only the lines it changes, keeping every other line, comment and the
  body, and a group is found by the id in its frontmatter, never by file name or request
  text. A group file that cannot be read (no id, a repeated id, no frontmatter) or that sits
  more than two folders deep is skipped, named with its reason in the payload and a server
  warning, and never fatal. `group:<id or name>` (any letter case; a quoted name may hold a
  space), a bare `group:` (every card in a group) and `-group:` or `-group:<id or name>` (the
  cards in none, or not in that group) are search terms. A group with both dates and
  `auto_join: true` is running from its start to its end, both days included, by the local
  date of the board's server; a card made in the New card form (`POST /api/cards`) is written
  into the `cards:` of every running auto-join group in that same request, and no other, and
  the reply carries `joined` (`[{id, name}]`) so the page's flash can say `Joined #I2
  zephyr-2.` A dated group without `auto_join` never takes a new card, a card edited later
  joins nothing, and a card the doing-gate refuses joins nothing. The Group tab's **Delete group…**
  and the card's Delete share one **delete popup** (below).
- **Iterations** — with `iterations: true` in `config.yaml` over a `groups:` line, the header
  beside the board name has a dropdown of the groups in the `iteration/` folder (no
  subtype): **All cards**, the iterations newest first, each with its id, name, dates and
  `running` when it is, and **New iteration…**. It opens on the running iteration (the
  newest one whose dates include today, both days), or on All cards when none runs. A pick
  narrows the Board, Calendar, Gantt, Map and Graph to the iteration's cards on top of the
  search box: both must say yes, the pick never writes the box, and it never changes a group
  or its membership. The pick is kept in this browser only (`localStorage`, not the board),
  with the iteration that was running when it was made; a kept pick, All cards included,
  beats the running iteration until that one has ended, and one whose iteration is gone
  falls back to the running one. The Calendar shades the picked iteration's days (an
  iteration with both dates) and moves to its first day when the person picks it, never on
  page load. **New iteration…** opens the
  group form in the `iteration` folder with the newest iteration's name bumped (`zephyr-2`
  becomes `zephyr-3`; a name with no trailing number is left blank), the dates continuing the
  day after its end at the same length, and `auto_join` on; the pick stays where it was. The
  server adds `iterations` (true only with the key and a groups folder) to the board payload.
- **Hover/focus highlight** (kanban.proj#261) — resting the pointer over, or moving
  keyboard focus onto, any piece of a card lights every piece sharing its id, the same
  card-el grammar and same "one card, several DOM elements" reach as selection: on the
  calendar a run cut at a week boundary is two chips, and the card's own deadline chip is
  a third on a different day — this is the only way to see a card's whole extent at a
  glance. A background wash (`hoveredId`, app.js, one id — never a Set, only one card is
  hovered/focused at a time), a different tone from selection's own wash (`--accent-soft`) so the two
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
  Two delegated pairs on `document`, mirroring the click/contextmenu pair
  above: `mouseover`/`mouseout` and `focusin`/`focusout`, each just keeping `hoveredId`
  current and repainting the *current* DOM directly — a full `renderBoard()` per mouse
  move would be needless work. The auto-refresh poll's own full rebuild carries the
  highlight forward on its own: every render call site reads `hoveredId` the same way it
  already reads `selectedIds`, so a poll landing under a stationary pointer doesn't lose
  the highlight the way a naive `:hover`-only or event-only approach would.
- **Speedbumps** — every destructive action confirms first, naming its object: archive,
  delete, bulk archive/delete (one confirm per batch, with the count), notification
  delete and clear-all; Delete's confirmation is the delete popup, which also says what goes
  with the card. Restore is exempt (it's the reversible direction). Clicking the
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
  uses) close directly on Esc (a form opened from a card's details returns to those details,
  as it does when saved or left by its X), and so do the three bulk-edit popups (Assign/priority,
  Edit tags, Schedule…) and the Archive popup — speedbump-exempt, same as their
  backdrop-click. An open
  combobox menu gets first crack at Esc: it closes the MENU only, one level at a time,
  before the popup-level handling ever sees the key. An open search panel is next: it
  closes on Esc, with focus back on its toggle (it stays in the box when Esc was pressed
  there), ahead of the selection step. With nothing
  open, Esc steps the selection back (see Multi-select).
  **Alt+Enter** toggles fullscreen on whichever fullscreen-capable popup is open
  (detail, create/edit, the three bulk-edit popups and the notes palette) — the keyboard twin of that
  popup's fullscreen toggle button, updating the same persisted per-modal-type
  preference. Works with focus anywhere inside the popup, form fields included; an open
  combobox menu exempts alt-chorded Enter, so the hotkey wins there too (plain Enter
  keeps the menu's pick grammar). With the notes palette up over the card details, the
  palette is the popup it toggles; the palette's header carries the same button. No popup
  open = no-op; the notifications popup isn't fullscreen-capable.
  **Ctrl+S / Cmd+S** saves the open popup — the keyboard twin of its Save/Apply button.
  Only popups with ONE unambiguous save action participate: the create/edit form and the
  Assign/priority and Schedule… popups; Edit tags has two competing actions (add /
  remove), so Ctrl+S there stays a no-op rather than guessing. The chord is strict —
  exactly Ctrl+S or Cmd+S; Alt or Shift chords never match (save-hotkey.js).
  **Ctrl+F / Cmd+F** focuses the search box instead of the browser's find bar
  (`preventDefault`) and pre-fills `#` with the caret right after it, so typing an id
  immediately forms the `#<id>` exact-match term, digits (`#42`) or a prefix and digits
  (`#G3`; the `#` stays while the box holds a prefix such as `G`, and goes the moment
  anything else is typed — erase it by hand for any other query — cheap). A box already holding a query gets select-all instead of the `#`
  prefill — typing overwrites it, same as any focused input — so the chord can never
  silently clobber a typed query (search-hotkey.js owns this decision). Suppressed while
  a popup is up — the mirror of Ctrl+S, which only fires *inside* an open popup: every
  popup's backdrop covers the whole viewport, hiding the search bar behind it, so this
  hotkey only fires *outside* one and the browser's native find stands in while a popup
  is up. It still works from inside a text field, because it types nothing.
  **`/`** also focuses the search box. It does insert a character, so it is off while a
  field has focus as well as while a popup is up.
  Both read one **key guard** (`key-guard.js`): a typing check (a text field, a text area,
  a select or an editable element has focus) and a surface check (an open card menu, an
  open dialog, the notifications panel or the preferences sheet). `/` reads both, and so
  does `p`, which flips the search panel's switch (see Search panel), and `?`, which opens the Hotkeys list (see Preferences sheet), and `m`, which
  steps through the pills, and `i`, which flips Isolate (see Isolate), and so do `[`, `]`, `{` and `}`, which move the run of slices
  (see Slice section), and `l`, which steps the names of the tier fan (see Options), and `n`, which opens the notes palette (see Logbook); Ctrl+F
  reads only the surface check. Esc's selection step reads the same guard, with the search
  box as the one text field it is for: it asks `keyGuardEscape`, which answers clear the
  box, step back, or leave Esc alone. The search panel is deliberately not a surface, so the
  keys that come with it work while it is open. The single-key shortcuts added later
  reuse this guard unchanged.
- **Comboboxes** — the form's Assignee (and Priority/Tags/Type, incl. the bulk-edit popups'
  copies of the first two) fields suggest values from `config.yaml`'s lists (see below) while still
  accepting free text. Tab/click focuses and opens the full list; typing filters it.
  ArrowDown/ArrowUp move a wrapping highlight through the open menu (scrolled into view,
  never hidden past the menu's 180px-max-height fold), Enter picks the highlighted row,
  Esc closes the menu only (never bubbling into the popup-level Esc above). Enter
  reaches the surrounding form's native submit-on-Enter ONLY when the menu is closed —
  any other Enter is consumed by the menu itself (picks if something's highlighted, else
  just closes it) — so the keyboard flow "type title, ArrowDown+Enter to pick `@afk`,
  Enter to submit" takes two Enters; the mouse-pick flow (click a suggestion, then
  Enter) submits on one, since the mousedown pick already closed the menu. Hand-rolled
  menus, not `<datalist>` (ADR 0003): native datalists misrender inside VSCode's Simple
  Browser.
- **Refresh** — the app re-reads the folder on a 5-second poll, surfacing edits made by
  `/kanban`, hand edits, or another tool; the header Refresh button forces a re-read
  immediately. View mode, query, filters, selection, and collapse/sort state all survive
  the poll.
- **Deep links** — loading the app with `?card=<id>` (an id is a plain number or a prefix
  and a number, `?card=G3`; `?card=0` opens card 0, which the page used to read as no card),
  `?q=<search>` and/or
  `?view=<board|map|gantt|calendar|graph>` in the URL switches to the named view, filters the
  board by the query (and, with `isolate=1` beside a query, shows it as an isolate, see
  Isolate), opens that card's detail popup, and scrolls its representation
  into view (found by `data-id` in whichever view container is now active, same lookup
  the shared card-el grammar's click handler uses) — a bookmarkable or shared link
  straight to one card, or to a set of them. **The three keys are independent**: `card`
  points at ONE card, `q` points at a SET, `view` points at neither, so a link may carry
  any combination and each is applied on its own. A querystring carrying none of them is
  not a deep link at all and is ignored outright.
  - **`q` is the board's own search grammar, verbatim** — whatever the Search section
    above parses is exactly what a link can carry (`?q=status%3Adoing&view=board`,
    `?q=assignee%3A%40human`, `?q=blocked%3A`). There is deliberately no second query
    language. The value is dropped straight into the search box, so the filter is
    visible, obviously the reason the board looks filtered, and one gesture clears it —
    it composes with the status-filter rows by intersection exactly as typed text does.
    An empty or whitespace-only `q` reads as absent, never as a filter matching
    everything. Because the query lands in the box rather than in a separate filter
    layer, `q` is subject to everything a typed query is — including matching archived
    cards (`kanban.proj#264`).
  - **One unusable key never discards the others.** An unrecognized `view` value (or
    none) leaves the persisted/default view untouched; an id that doesn't resolve to any
    active or archived card (missing, not an id, or just unknown) shows a toast, no
    popup — but a `q` and a `view` that parsed fine are still applied. Only a link that
    actually carried a `card` key can produce that toast, so the status page's
    card-less links never fire one.
  - **The address follows the box.** Whatever the search box holds is in the address as
    `q`: every write to the box (typing, the clear button, a cue click, Ctrl+F, a `?q=`
    link, and a click in the Graph that drops a typed search) replaces `q` with the box's
    text, and an empty
    or blank box drops `q`; `card` and `view` ride along untouched. While isolate is on,
    `isolate=1` stands beside `q` (and goes with it when the box is emptied), written by the
    same listener. The address replaces
    the history entry the page is on and never pushes one, so typing adds no history
    entries (Back and Forward still step only between opened cards), and it replaces only
    when `q` would change. A browser may refuse a replacement when there are too many in
    a short time (Safari throws past 100 in 30 seconds): the refusal is let go, the
    address lags the box, and the next change to `q` catches it up. A reload, or a link copied from the address bar, opens with the same
    search through the deep link above, whatever the query holds. The link carries the
    box's text and not the selection, so a cut and isolate come back, but a pill shows off (its
    query is there as typed text and, outside the Graph, its matches are not selected). The
    poll never writes the address. Back and Forward never write the box: when one
    lands on an entry whose `q` differs from the box, the box keeps its text and that
    entry is replaced to carry it. Opening a card still takes one history step, which now
    carries the query too. `card-history.js` decides the new address (a pure function: the
    current address and the box's text in, the new address or nothing out); app.js applies
    it as one more listener of the search box's single writer.
  - This is a one-time override, consumed exactly once right after the very first load
    — it composes with, but never fights, the 5s poll or the `localStorage`-persisted
    view mode (view.mode, above): the deep link's view isn't written back to storage, so
    a later plain reload with no querystring resumes wherever the view toggle last left
    it, with an empty box (the address carries a query only while the box holds one), and
    the poll's own re-renders never re-read the URL. Pure querystring parsing lives in `deep-link.js` (dual-environment export,
    same pattern as `refresh-policy.js`/`search-hotkey.js`); the search box, the view
    switch, the popup, and the scroll are app.js's job.
- **Card popup history (Alt+Left/Alt+Right)** — opening the detail popup, from any
  surface (a tile, a mention chip in a card body or the parent field, the notification
  tray, or a map ghost node), and closing it are each a step in the browser's OWN
  history: opening pushes a URL carrying `?card=<id>` (the other deep-link params
  already on the URL — `q`, `view` — ride along untouched), closing pushes one with
  `card` removed. That makes **Alt+Left/Alt+Right, the mouse back/forward buttons, and
  the browser's own arrows all step between opened cards natively** — deliberately no
  separate keyboard shortcut, so nothing fights the browser's own. Opening the card the
  URL already names (clicking the same tile twice, or a mention of the card already
  open) pushes nothing — no duplicate steps. A `popstate` (Back/Forward) reads the
  landed-on URL and opens the named card or closes the popup to match; a card id that no
  longer resolves — fails to fetch, not just missing from the last poll's stale snapshot —
  closes quietly, no toast — routine Back/Forward traffic over a stale ref isn't a broken
  link the way a hand-typed deep link's bad id is. `popstate` also does nothing at all
  while any OTHER popup (the edit/new-card form, a bulk-edit popup, notifications) is
  open, so Back/Forward can never yank the detail popup in underneath one and let a
  follow-on Edit click silently overwrite typed changes. Reloading with a card open still
  goes through the deep link above, unchanged — the URL already carries the id, so
  there's nothing new to push. `openCard` pushes only once the card has actually loaded,
  not before the fetch — a chip for a deleted/nonexistent card doesn't leave a phantom
  step naming a card the popup isn't showing. The push/no-op decision and the
  popstate-to-action read are both pure, in `card-history.js`
  (dual-environment export, same pattern as `deep-link.js`); app.js's `openCard`/
  `closeCard` wrappers apply it around `openDetailModal`/`closeDetailModal`, and the
  `popstate` listener calls those two directly (never the wrappers), so a Back/Forward-
  driven open or close never pushes a step of its own.
- **Tab icon** — the plugin's official icon (canonical file `assets/icon.svg`, also shown in
  the README and inlined in the snapshot page), served here as `favicon.svg` at
  `/favicon.svg` and linked from `app.html`: a pink brain with four streams falling out of
  it, fading into the backlog, todo, doing and done colors. `favicon.test.js` keeps this
  copy identical to `assets/icon.svg` and the stream colors equal to `status-colors.js`. It is a served file rather than an inline `data:`
  icon because the page's CSP loads images only from the board server.
- **Copy board path** — a small ⧉ button inside the header title copies the board
  directory's **absolute path** (the `GET /api/board` payload carries it as `boardDir`,
  `path.resolve`d server-side — a relative path is useless pasted elsewhere). Same
  clipboard ladder as the detail popup's "Copy path" button: async clipboard API first,
  textarea+execCommand fallback on rejection or absence (load-bearing in VSCode's Simple
  Browser, which doesn't grant the async API a secure context) — with a toast on BOTH
  outcomes (the glyph-sized button has no room for the detail button's label swap).
  Web-only by design — see GLOSSARY.md's parity table.
- **Notifications** — the header bell surfaces entries from
  `<kanban-dir>/notifications.md` (writer contract: `/kanban`'s SKILL.md; same file
  shape, not a second contract): unread-count badge, a toast once per session when new
  unread entries arrive on the poll (toasts dismiss on click, or on their own after a
  few seconds), and a popup listing all entries newest-first with per-entry remove and
  clear-all. Opening the popup marks everything read, persisted back to the file.
  Entries render per the contract: the TLDR segment (the message text before `; more: `)
  sits bold on its own line, and the rest follows under a small More label, broken into
  a list at its top-level `; ` clauses when there is more than one. A message without the
  separator bolds only its first sentence rather than the whole message. Code spans,
  card-mention chips (a mention of this board's card opens it) and `**bold**` render as
  DOM nodes, never HTML. The meta line shows the writer and the time as
  `YYYY-MM-DD | HH:MM:SS`, plus the level when it isn't `info`, and `level` tints the
  entry — `debug` muted with a dashed edge, `warning` amber, `error` red, absent = `info`; all levels show,
  no filtering. Per-entry remove and clear-all
  ARCHIVE, never delete: entries move verbatim (append) to
  `<kanban-dir>/archived/notifications.md`, created if absent. Entries missing a numeric
  `id` or a non-empty `message` are skipped by the reader (never fatal); the next
  managed rewrite (mark-read / remove / clear-all) moves their raw blocks verbatim to
  the archive too — deletion never happens, malformed writes included.
- **Dependency map** — a top-bar "Map view" button (a line icon, then the words) swaps the board for a hand-rolled
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
  with no toggle of its own; an `options` value left in `map.sections.collapsed` by an older
  version is dropped when that entry is read.
  **Node treatments:** the border is one neutral weight for every node — status never
  strokes it. A small dot in the node's corner carries the status color (same palette as
  the column headers), its own tooltip naming the **raw on-disk status**; status dots
  never mute for archived nodes — on any board with archived history, archived chains
  dominate the map, and muting would empty the one channel that carries status. The
  archived cues are their own channels: the node strokes a visibly lighter grey
  (`--st-archive`) than the plain neutral border tone (`--line`), the SVG tooltip gains an "(archived)"
  suffix, and the grey **Archived ball** (above) joins the dot column — an archived node
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
  hide cards, and they are not the search panel's pills, which are queries (see Search panel).
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
  **Option panel** — the Map's zoom toolbar and options row, and the Graph's layout buttons, zoom
  buttons and option row (Tiers), stand in an `<aside class="view-panel">` on the right of the view, built
  by `buildViewPanel` in app.js, which `graphBuildPanel` and `buildMapPanel` fill. One icon button
  (`.view-panel-toggle`, a rectangle with a bar on its right, `aria-label="Options panel"`, `aria-expanded`)
  opens and closes it, at the top right, the side the panel comes out of: it floats in the top-right corner of the Map (`.view-bar`, which holds only that button, and stays put while `.map-main` scrolls) and of the Graph (`.graph-controls`, beside the (i) button). The Graph's card count and key sit behind that (i) button (`.graph-info-toggle`, `aria-pressed`, off by default, remembered per board); they stay in the DOM, hidden by a class while it is off. The Graph's status pills are in the search panel's Statuses section. The
  Map's graphs scroll in `.map-main` beside the panel, and the pan, the zoom and Fit read and move that
  element (`mapMain`). Closed, the panel is not built at all, so the view has its width back and no
  control of it can take focus; the Graph then frames an untouched view again in the new width
  (`graphRefitNext`), and a view the person moved stays where it is. view-panel.js keeps whether it is open:
  per board in `localStorage` under `viewpanel` as `{ map, graph }` (a boolean for a view the person has
  chosen for, null for one they have not, validated on every read like prefs.js), else the screen decides:
  open from 760 px wide, closed below, and a window that crosses the line draws the view again. Under
  760 px the panel is a sheet over the view (`position: absolute` against `.map-view` / `.graph-view`, so it adds
  no width and no sideways scroll), with a `.view-panel-close` button that hands focus back to the icon button.
  The panel and both buttons wear `data-keeps-selection`; the icon and close buttons are in `REFOCUS_SELECTOR`,
  so a poll's redraw gives them focus back. Every control keeps its class, label, title, data attributes and hotkey
  (the `l` key still steps the Graph's names with the panel closed).
  **Dependency tree / Dependency path** — a second way to populate the map's visible
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
  new rendering path. The right-click menu adds a card's tree or path to the selection
  instead of writing a term — see Multi-select.
  Mirrored in the snapshot (same search terms + card-sheet tap actions) — see
  GLOSSARY.md's parity table.
  **Pan & zoom** — press-and-drag anywhere in the graph (background or a node) scrolls
  the `.map-view` panel with the pointer, grab/grabbing cursor, primary button only. A
  drag starting on a node still pans once the pointer clears a small threshold; that
  gesture's click is suppressed so the card doesn't also open, but a plain click under
  the threshold opens it as always. Pointer capture (drag-vs-click threshold shape shared
  with the gantt's bar drag, see Gantt view below) is claimed on `#map-view` itself — a
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
- **Calendar view** — a top-bar "Calendar" button (a line icon, then the word) swaps the board for a month grid
  (weeks start Monday; prev/next/Today controls; outside-month days on the raised ground, today
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
  menu; a click on an empty day cell leaves the selection, and a double click starts a new
  card there (**Click-to-create** below). Dragging a **range chip** moves
  the range: the drop day becomes the range end and the start shifts by the same delta
  (duration + times-of-day preserved), writing the fields the range actually used — a
  compat range shifts start + due and never invents an end date. One-date ranges move
  their one field. Dragging the **due chip** moves the due date alone (time preserved) —
  on a compat card that also moves the rendered range's end, since due IS that range's
  end field. Same-day drops don't write. Composes with search exactly like the board;
  the displayed month + query survive the poll. Board/map/calendar/gantt/graph is a five-way
  switch persisted per board in `localStorage` (unknown saved values fall back to
  board).
  **Jump to the nearest match** — when a change to the search box leaves no shown match
  inside the visible range, the Calendar jumps to the match nearest it, before or after
  (`nearestMatchDay`, calendar-model.js; one pure function for the Calendar and the
  Gantt). It works in the month, week, 3-day and day spans. The month counts every cell of
  its grid, leading and trailing days included, and a card counts by any day of its
  schedule span or by its due date. Shown means drawn: a match hidden by a status pill, or
  an archived match while the Archive pill is off, is not on screen and not a target, and a
  card with no schedule and no due date is never a target. A match before the range and
  one after it at the same distance resolve to the earlier day. An empty box has no
  matches, so clearing it moves nothing. Every write to the box makes the check (typing,
  a cue click, Path or Tree from a card's menu, a `?q=` link, and any later writer, since
  the jump is a listener of the one search-box writer); so does entering the Calendar,
  once, so a query already in the box shows its month. A poll, a re-render, Today and
  paging with previous and next never jump, so after a jump paging works as usual.
  **Status-filter row** — no row sits above the grid: the status pills (month AND every sub-view alike) sit in the search panel's Statuses section, sharing the Map's pill mechanism rather than a duplicate: one toggle per LIVE board status in column order, all ON by default, PLUS
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
  toggle. The section is there unconditionally ("always leave a control to turn a pill back on") and shares the pill interaction grammar (left toggle, right solo) with the Map's and the Gantt's pills.
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
  **Click-to-create** — a double click on empty calendar space creates a card, and a single
  click there leaves the selection. ADR 0006's 2026-10-15 amendment clears the selection on
  a double click on empty space everywhere else, and the day cells and time-grid columns keep
  theirs for create, so a create never clears a selection. Double-clicking
  empty space in the month grid, the all-day band, or a time-grid day column opens the
  create modal pre-aimed at the click, same hidden-field-submits-while-minimal trick as
  the column "+" but for the start date alone — month/all-day gives a date-only
  `start_date`; a time-grid slot gives a `YYYY-MM-DDTHH:MM` snapped to the same 15-min
  grid the drag/resize uses. Only `start_date` is pre-filled — never `due_date`
  (ADR 0007: start is the working range's "from") — and status is left at the modal's
  own default, unlike the column "+", since a calendar cell doesn't imply one. A
  double-click landing on a chip is the chip's own affair (the shared card grammar),
  excluded before the cell/column lookup ever runs. The snapshot's own calendar has no
  click-to-create — a deliberate, unbuilt gap.
  **Notes on the Calendar** — on a board with a logbook the week, 3-day and day views draw its
  notes: a day with timed notes keeps a strip at the right of its column (`--cal-note-strip`),
  with a chip for one note in a half hour and a count bubble for more, and the day's untimed
  notes are one box in its all-day cell; the toolbar's **Notes** button switches the layer
  (`calendar.notes`). A **divider** on the strip's left edge (`.cal-note-divider`, a focusable
  `role="separator"`) sets the strip's width for every day column at once: a pointer drag moves
  it live, without a re-render, from 44px to the column less a 24px sliver for the card blocks
  (`noteStripClamp`, notes-calendar.js), and the width is saved when the pointer lets go; Left
  and Right on the focused divider step it 8px; a double click goes back to the default,
  `clamp(44px, 34%, 170px)`. It is kept per board in this browser as `calendar.notesWidth`
  (every read and write in try/catch) and drawn as the custom property `--cal-note-width` on
  the time grid, which each column's strip reads; once a width is set the 170px cap is gone and
  a chip shows up to 60 words instead of 12, cut by its edge. A drag holds the poll
  (`isDragging`), starts no card drag or retime, and the hour click and the double click that
  makes a card both skip a target on the divider.
- **Gantt view** — a top-bar "Gantt" button (a line icon, then the word) swaps the board for a day-granular
  timeline: each dated live card gets a row (dated ARCHIVED cards join too, opt-in via
  the Archive pill below) — the **working range** as a bar (start→end inclusive; compat
  start→due; one-date and reversed ranges collapse to a 1-day bar — same shapes as the
  calendar) and/or its **due date** as an amber diamond marker (red once **overdue**; a due-only card shows
  only the diamond, no bar) — grouped by status in board column order with a slim label
  row per non-empty group, ids ascending within it. A fixed left gutter lists #id +
  title per row; only the timeline half scrolls horizontally. Mondays are labeled with
  the date and a vertical "today" line marks the current day.
  **Sub-views** — the gantt header carries the calendar's own
  Outlook/Teams-style switch, built the same way and reusing its exact classes
  (`.cal-controls`/`.cal-nav`/`.cal-title`/`.cal-subview-switch`), with a leading **All**
  entry ahead of Month | Week | 3 days | Day, persisted per board under
  `gantt.subview` (unknown saved values fall back to All). **All** is the DEFAULT and is
  the ORIGINAL fit-everything window unchanged: it spans the rendered bars AND diamonds,
  padded 3 days each side, clamped to at most 180 days centered on today (slid to stay
  inside the data's range) when a board sprawls wider — re-derived from the cards on
  every render, same as before this sub-view switch existed. A SIZED sub-view
  (Month/Week/3 days/Day) instead pages a fixed-span window around one anchor day
  (`ganttSubviewWindow`, gantt-model.js; week starts Monday, 3 days = anchor + the next
  two, month = that calendar month's own days with no leading/trailing padding — a linear
  timeline has no week rows to square off) — prev/next/Today step it by the active
  sub-view's span, reusing the calendar's own `shiftAnchorDay`/`subviewTitle`
  (calendar-model.js) verbatim, since that math has nothing calendar-specific in it. The
  arrows and Today are disabled while All is active (no anchor day to page from). Once a
  sized sub-view makes days wide enough, the axis names every day (`dayMarkLabel`: day
  numbers for a month, weekday and number for a week or less) instead of Mondays only. A bar
  or diamond entirely outside whichever window is active draws nothing (its gutter label
  still lists it); one that starts or ends outside is clipped on the cut side, exactly as
  before — the window never drops a bar, only clips or hides its drawing. The day-column
  width (`ganttDayPx`, gantt-model.js) is GANTT_DAY_PX (24px, horizontally scrollable)
  for All, unchanged; a sized sub-view instead fills the scroller's measured width so its
  whole window shows with no horizontal scroll — the SAME value then drives the drag math
  (a live module var, set every render) so a drag still moves a bar by whole days in
  every sub-view, keeping layout and drag math in one place exactly as GANTT_DAY_PX did.
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
  appear to move until the window re-derives. A CUT side (`.clip-start`/`.clip-end`)
  offers no resize handle at all — that handle would sit on the window edge, not the
  card's true date, and `barResizeChanges` always resizes the true edge, so a handle
  drawn there would preview one date and write a different one; a press on that end of
  the bar falls through to an ordinary body drag (shift) instead. No dependency arrows —
  the map view owns the `waiting_for` graph.
  **Jump to the nearest match** — the Calendar's jump (above), by the same function, in the
  Month, Week, 3 days and Day sub-views: when a change to the search box leaves no shown
  match inside the window the sub-view draws, the anchor moves to the nearest match. A
  Month is the month's own days, with no leading or trailing days, because the Gantt draws
  none. **All** never jumps, since it already fits every dated card. Entering the Gantt
  makes the check once; a poll, a re-render and paging never do.
  **Status-filter row** — no row sits above the timeline: the status pills sit in the search panel's Statuses section, sharing the Map's pill mechanism: one toggle per LIVE board status in column order, all ON by default, PLUS
  an Archive pseudo-pill (same id list as the map's row) that defaults **OFF** —
  archived rows are opt-in, so the base gantt stays live-only. Flipping Archive ON
  appends ONE more group AFTER the live status groups — every dated ARCHIVED card,
  regardless of its own parked on-disk status (gantt-model.js) — same "location after
  live columns" placement as the board's Archive column. Archived rows split across two
  channels, deliberately: the BAR's border/fill and the group label key off the literal
  `'archive'` string, which `statusColor()` mutes to the neutral archive grey — a
  row-level archived cue, same as the bar's not-allowed drag
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
  list the gantt feeds it. View mode persists via the shared switch; the All window
  re-derives from the cards on each poll (a sized sub-view's window instead re-derives
  from its own anchor day + span, not from the cards) while the timeline's horizontal
  scroll position is carried across re-renders.
- **Graph view** — a top-bar "Graph" button (a line icon, then the word; `aria-pressed`; it reads "Board view" with the Board icon
  while the graph is up) swaps the board for the **Graph**: every card at once as a dot,
  joined by its relations. The Hierarchy draws the **tier fan**, which this entry calls
  **Tiers** where an option or a key names it; it opens first and is the default for any
  unknown saved value. The centre is the apex and the fan goes all the way round the centre but for a narrow **seam**
  straight up, a **band** for each tier of the
  board's `hierarchy:`, tier 1 innermost, then a **ring** for each depth that holds a card
  without a tier (a card whose type is not in the hierarchy, or that has none), counted
  from the nearest tier card above, so the first ring is the cards right under a tier card.
  A depth with no such card has no ring, and a tier nobody is in keeps a thin band. A card is in
  the band of its slice, worked out from the whole board, so a hidden or archived parent
  never moves it, and a tier 1 card under the lowest tier sits in its own tier's band,
  with no warning. Each band and each ring has a faint **guide arc** and a **caption** on
  the seam with its name (a tier by its name, a depth as
  `depth N`), standing one above another up the seam with neighbours on opposite
  sides of the seam so they never touch; a tier nobody
  is in keeps a thin band and a muted caption when it has room for one, and a
  depth with no card draws nothing; a tier whose cards nest in one another gets a lighter
  arc through each further row. Each tier band that holds a card is washed in its type's
  colour (the `color:` of that type in the board's `types:` list), one **wash** across its
  whole ring, behind the lines, the dots and the captions, so the hierarchy reads as coloured
  areas; a tier whose type has no colour gets a neutral wash, and a tier nobody is in, a depth
  ring, the Unnested ring and the Unnested block get none. The wash takes no click: a click or
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
  **Options.** Tiers has an **option row** above the fan, folded behind an Options toggle, like the Map's, and starts
  folded. It holds five options, the first value of each the
  default. **Lines** draws the parent lines: **folded** (the default) gives a line to the end of each
  dependency chain, as the Map draws its chain ends, and a parent's other children on one ring share one
  **counted line** that prints their count; **chain** gives a line to every chain end and none to the
  other children; **all** gives a line to every child; **off** draws no parent line. **Dependencies** are
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
  block outside the rim. The Unnested option is Tiers' own: the Flow draws every card. A counted line
  lights whenever its parent does. The chain ends are read on the whole board, so hiding a card with a status pill or a search
  never moves a line. The lines and dependencies only redraw; the order moves siblings along their own stretch of the
  sector, and no card changes its band, its ring or its sector; the Unnested option moves the cards with no relative and no tier to
  another ring, a sector or out of the Graph. The choices are kept per board in `localStorage` under
  `graph.options`; the row is always shown in the option panel, with no fold, and a `graph.optionsFolded` value left by an
  older version is never read. A press on the row never starts a pan,
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
  focus** on a dot lights that card and the cards it has a relation with, with the lines
  between them, until the pointer leaves. **Click** a dot to select it (painted in place,
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
  a plain click on a card sets a new card anchor and clears the box but for its cut, so the Graph
  keeps drawing what the box says;
  shift+click or ctrl/cmd+click on an unlit card adds it and keeps the query, and on a card
  the query lit takes it out and turns the query into its other cards, which clears the
  box but for its cut, since it no longer names the anchor. The status pills still decide which cards are
  drawn, so with the Done pill off a done match is not drawn, whatever the query. A typed
  search stops being the anchor when you leave the Graph: the Board, Map, Gantt and
  Calendar keep hiding what does not match, nothing is selected by it there, and a bulk
  action has no cards to act on. Back in the Graph with the box unchanged and nothing
  selected, its matches light again; a selection carried in from another view stays, and
  the box has no effect in the Graph until it is edited. **Double-click** (or **Enter** on
  a focused dot; **Space** selects) opens the card. The Graph is a deliberate exception to
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
  Graph view. The Graph draws one of two graphs, chosen at the top of the option panel:
  **Hierarchy**, which is all of the above, and **Flow** (see **Graph Flow**).
- **Graph Flow** — the Graph's second graph, beside **Hierarchy** (the tier fan, above). The option
  panel opens with a **Hierarchy | Flow** choice (`.graph-kind-btn`, `aria-pressed` on the one drawn), Hierarchy first;
  under Flow the panel holds the zoom and the **Dependencies** and **Lanes** switches, and none of Hierarchy's option row.
  Flow lays the drawn cards out by their dependencies (`waiting_for`, read among the cards drawn) in **columns** from left to right, with no parent line
  and no tier wash; the words are the glossary's **Flow** and **Frontier**. The **Dependencies** switch is **frontier**
  (the default) or **all**. **Frontier** counts the steps until a card is ready and only the dependencies that are not done (a card that
  is `done` or archived is done): the first column is `done`, faded, then `ready now`, `1 step`, `2 steps` and on,
  and a card in or behind a dependency loop stands in a last `loop` column. Only the open cards are read, so a loop with a done card in it is no loop.
  **All** counts the longest chain of dependencies behind a card, done ones included: `waits for nothing`, `chain 1`,
  `chain 2` and on, the members of a loop sharing one column. Each column is a shaded frame with a heading that prints its card count
  (`ready now · 4`); the `done` column is faded. A card with **no dependency either way** among the drawn cards sits in a **strip** below the
  columns, in either mode, titled `no dependency either way` with its count (`· 18 cards`). Within a column the cards are ordered to cut the
  arrows that cross (the mean place of what each waits for and what waits for it, two sweeps each way), ties by id, and a column of more than
  fourteen cards wraps into side-by-side stacks. The **Lanes** switch (`.graph-option-btn[data-key=lanes]`, `off` or `on`, off by default) groups the
  cards that are in a column into **lanes**: each card with a dependency is in the lane of its nearest parent with a tier, else of its root (the slice's own rule,
  read among the cards drawn, so a card whose parent is hidden is a root), under a header (`.graph-flow-lane-head`, with the lane card's `data-id`) that leads with that
  card's type mark in its type colour (`data-type-color`, painted by `paintTypeColors`), its tier name (none for a card with no tier), `#id title`, the lane's
  card count and its ready count; a card is ready when it is open, in no loop and waits for nothing that is not done, in either mode. The columns are made of the cards in the
  lanes alone and stand across them, so a column's cards share one x whichever lane they are in, and the lanes' frames (`.graph-flow-lane`) replace the columns' shaded frames.
  With frontier the lanes with ready cards come first, the most ready first, then the others in outline order; with all, every lane is in outline order. With frontier a lane
  folds into the strip when none of its cards with a dependency is open (every such card is done), and the strip then reads `no open dependency`; a lane whose open cards wait only on done cards
  stays, since those cards are ready now. With all no lane folds. A card with no dependency is in no lane but in the strip, so a lane's card count is the cards drawn in it
  (`header.count`), not every card under its lane card. A header is its card's node: a `.graph-node.card-el.graph-flow-lane-head` with the card's `data-id` and `tabindex` 0, drawn after the arrows and before the dots,
  so every handler of the dots (click, Shift/Ctrl-click, double-click, Enter, Space, hover and focus lighting, the card menu) takes it for that card, with the same items;
  `graphCur.headEls` holds the headers by card, and a header and the dot of its card are lit and selected together. It is not a second dot: the card keeps its one dot. An **arrow** runs from the card waited for to the card that waits, leaving to the right
  and arriving from the left with its head at the rim; a dot keeps its status colour and its type mark, grows with the waits it is in (a parent
  does not enlarge it), and is faded in frontier when done or archived. A loop, a card that waits for itself and a chain of any
  length never hang the drawing (the strongly connected parts are cut first, iteratively). Search lighting, the status pills, `slice:` cuts, isolate,
  selection, the card menu, double-click, Enter, Space and the zoom work as in Hierarchy, on the same dots (`.graph-node.card-el[data-id]`): the cards
  that are not drawn are not laid out, and a card whose only dependency is hidden has no dependency drawn, so it is in the strip. Hover, focus and a
  lone selected card light the card with the cards its **dependencies** join to it, not its parent or children, and the lit lines are the arrows. A dot
  cannot be dragged in Flow; the background pans. The choice is kept per board in `localStorage` under `graph.layout` (`hierarchy` or `flow`)
  and the switches under `graph.deps` and `graph.lanes` (`1` or `0`); a value this version does not offer, `tiers` (what an older version called the Hierarchy) and a layout an older version kept included, reads as Hierarchy, frontier and lanes off. The address carries them as
  `graph=hierarchy|flow`, `deps=frontier|all` and `lanes=0|1`: on a load the address wins, and a link's value is kept for that load only until a press;
  every draw of the Graph writes the address too (`graphWriteAddress`, a no-op once it says the picture), so a Graph that opened from the board's memory says so and a link copied after a plain reload opens the same picture;
  a press replaces the page's address (`history.replaceState`, no step in Back) and leaves every other parameter, `deps` and `lanes` going when Hierarchy is
  chosen. The choice and the switches are buttons that keep the selection; a press of a switch redraws the Flow and re-frames a view the person has
  not moved. On a phone the panel is the **bottom sheet**, with the choice and the switches in it. The Flow's pure layout is `web/graph-flow.js` (`graphFlowPlace`),
  read by `graph-model.js`; the snapshot has no Graph view, so it embeds none of it.

## Board config: `config.yaml`

The canonical `config.yaml` contract — `nextId` discipline, the assignees registry and
its grab semantics, list curation — lives in `/kanban`'s SKILL.md; the role trio's one
write-up is GLOSSARY.md's Role trio glossary. What follows is how *this app* reads the
file. Optional, human-edited, per board:

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

This app is config-driven and doesn't enforce the grab semantics — it renders whatever
handle a card carries.

- **`name`** IS the app heading — the board name alone, no app label in front of it
  (the app is a kanban; a "Kanban —" prefix only buried the one token that tells
  boards apart) — and it IS the tab title too (the bare name, no "Kanban" suffix,
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
- **`types`** (block, bare-entry or inline `[a, b]` form; order kept) names the card
  types the board suggests, each with an OPTIONAL `color` kept as an opaque string
  (hex, name, anything CSS reads). It feeds the form's Type field (suggested in the order
  listed) and the type chip's color only: a card's `type:` may be any text, and a type
  outside the list still reads as a neutral chip.
  `GET /api/board` carries it as `types: [{name, color}]` (`color` is `''` when absent;
  `[]` when the key or file is), and an entry that sets an `icon:` also carries `icon` (the
  name lowercased with a trailing comment stripped, an unknown name passed through as
  written; no `icon` key at all when none is set). Human-curated like `tags`; the app only reads.
- **`icon`** (on a `types:` block entry) is one of `circle`, `square`, `diamond`,
  `triangle`, `hexagon` or `star`. The page draws it as the type chip glyph and the Graph
  dot's outline (see the **Card type chip** and **Graph view** bullets). An icon name is
  only looked up in the closed table of six in `type-icons.js`; it is never markup, a class
  name or part of a path, and a name the table does not hold draws as no icon.
  Labels, queries and icon names are human text: a reader escapes them and never uses one
  as raw markup or a class name.
- **`hierarchy`** (inline or block form) lists the type names that are the levels of the
  plan, top first. `GET /api/board` carries it as `hierarchy: [name, ...]`, the names in
  order as written: blank entries are dropped, duplicates and case differences pass
  through for the page to normalise, and a scalar value or an empty list answers `[]`
  (as does an absent key, even on a board that declares `types:`). It orders drawing and
  slicing and **enforces nothing**: saving a card nested against it (a goal under an
  epic) succeeds and the answer carries no warning (ADR 0013).
- **`typesOn`** (`typesOn: false`; absent or any other value = on) is types off (ADR 0018).
  `GET /api/board` carries it as `typesOn`, and `types` and `hierarchy` stay as written. The
  page reads the two lists through one gate (`boardTypeView` in `type-badge.js`): with types
  off it holds no types and no hierarchy, so there is no type chip, color or icon on a tile,
  the Map, the Graph's dots and tints or the detail, the slices are the depths and the Graph's
  tier fan falls back to depth as on a board with no hierarchy, and
  the edit form's Type field is hidden. The form then sends no `type`, so a save leaves a
  card's `type:` line as written. Turning types back on shows everything again; nothing in
  the cards or the lists changed.
- **`pills`** (block form only) lists the board's own one-click search queries, each a
  query or a one-key map from a label to a query. `GET /api/board` carries them as
  `pills: [{label, query}]` in config order; a query on its own is its own label,
  `- tags: grill` is the label `tags` with the query `grill` (a colon followed by a space
  ends the key), and an entry that is blank, only a comment, or has an empty label or
  query is skipped without an error. The page holds `hierarchy` and `pills` on `state`
  after every load and poll: the slice section and the Graph's tier fan read the hierarchy,
  and the search panel draws the pills.
- **`assignees[].color`** (OPTIONAL) reserves a fixed text color for that handle,
  mirroring `statuses`' own color rule exactly: reserved wins; absent, the handle hashes
  into the SAME 8-color `STATUS_PALETTE` custom statuses use (reusing status-colors.js's
  hash — not a forked one), so every assignee gets a stable color with zero state to
  store. A hashed color follows the theme like a status does; a reserved color paints
  exactly as written in both themes, so pick one that reads on light and dark grounds. See the **Assignee text color** bullet above for where it renders.
- **`statuses`** (inline or block form) IS the live column set, in order — board
  columns, drag targets, per-column sort/collapse defaults (priority-desc, or Outline on a
  board that nests, / expanded for live columns, id-asc / collapsed for Archive), the form's status dropdown, and the
  gantt's group order all follow it. Absent = the built-in four. Unlike the other lists
  it shapes layout, but it still never validates a card: an unlisted on-disk status
  parks the card in the **first** column with a raw-status chip until the human promotes
  it by adding it to the list (the file is never rewritten). Archive is not a list
  entry, and the `doing` entry gate (waiting + blocked) is pinned regardless of the
  list.
- **Absent file**: ids come from a max+1 scan, and with no `assignees` registry the
  assignee combobox suggests the `@human`/`@hitl`/`@afk` role trio (GLOSSARY.md's Role
  trio glossary — `@ai` is retired). The app never creates `config.yaml` on its own.
- With a counter, new-card ids come from `max(nextId, scanMax+1)` (a stale counter
  self-heals rather than re-issuing a taken id) and the advanced counter is written back
  atomically. Agents creating cards by hand should use and advance it too.
- **Prefixes** (ADR 0014): a card takes, when it is created, the prefix `prefixes:` gives its
  `type` (compared without regard to case), and its number comes from that prefix's entry on
  the one `counters:` line, `max(counter, highest number with that prefix + 1)`, written back
  by replacing that line alone (inserted below `nextId:` when absent). A plain card never
  moves a prefix's counter and a prefix never moves `nextId`. The id never changes
  afterwards, so changing a card's type leaves it. `idDigits` (a whole number from 1 to 15,
  else 4) only sets the width of the number in a file name; cards are read by the number in
  their `id:` line, so a file padded to another width is still found. `prefixes:` and
  `idDigits:` are human-written; the page reads and the server writes only the counter lines.
- **`groups`** (a folder, relative to the board; absolute when written by hand) turns groups
  on: the board payload then carries `groups: { folder, list, skipped, folders, prefixes }`,
  every group file under it (see the Groups bullet) and the files it skipped and why. Absent,
  the payload carries `groups: null` and nothing of it shows. A `prefixes:` value names a
  groups folder when it is that `groups:` folder itself (the root, `_: .groups`, which has no
  slash) or a path under it (`I: .groups/iteration`), or any path with a slash read relative
  to the groups folder (`W: workflow/`); a bare word is a card type. A group in exactly the
  folder a prefix names takes it, else `_`. The web never writes this key.
- **`todos`** (a folder, relative to the board; absolute when written by hand) turns todo lists on:
  the board payload then carries `todos: { folder, targets, counts }` and the page shows the
  palette's Todos tab. Absent, the payload carries `todos: null` and nothing of it shows. The gear's
  Todos page writes this one line; a folder outside the board works for reading and writing.
- **`scratchpad`** (a folder, relative to the board; absolute when written by hand) turns
  scratchpads on: the board payload then carries `scratchpad: { folder, targets }` and the
  page shows the palette's Scratchpad tab. Absent, the payload carries `scratchpad: null` and
  nothing of it shows. The gear's Scratchpad page writes this one line; a folder outside the
  board works for reading and writing.
- **`logbook`** (a folder, relative to the board; absolute when written by hand) turns the
  logbook on: the board payload then carries `logbook: { folder, notes }`, every note of the
  day files in it, and the page shows the notes palette. Absent, the payload carries
  `logbook: null` and nothing of it shows. The web never writes this key; a folder outside the
  board works for reading and writing.
- The assignees, priorities, tags and types lists all **suggest, never validate** (ADR 0004) — the
  form's comboboxes offer the registered values but free text still saves fine.
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
  exactly three surfaces: **kanban** (AI-driven card management), **kanban-web** (this —
  the human's live editor, desktop), **kanban-snapshot** (generated single-file HTML board
  for phone/tablet; queued-change payload, Claude applies). Retired skills are deleted
  outright; GLOSSARY.md's Surfaces and parity section carries the cross-surface parity
  rule, while each surface names its own deliberate gaps in its own skill doc.
- **The page names the files the server serves.** The server serves `/` (`web/app.html`)
  and the files that page loads by a plain top-level name: its `<script src>` tags, the
  stylesheet and the tab icon. Anything else in `web/` is a 404. A new module takes one
  entry, its `<script>` tag in `app.html` in load order; nothing in `server.js` changes.
  A test fails when the page names a file `web/` lacks, or `web/` holds a script the page
  never loads.
- **Running the tests.** `docs/testing.md` says which npm script runs what, how a server test
  and a browser scenario are added, and how the docs are held to the code.
- `archive` here is a *location* (the `archived/` folder), not a status — ADR 0002's
  data model — but the column has full UI parity (ADR 0005): drag a batch onto Archive
  to archive it (one confirm, skipped when the whole batch is already `done`), drag
  archived cards onto a live column to restore them **with that column's status**
  (confirms when the batch contains archived cards; the `doing` entry gate — waiting +
  blocked — applies per card), and archived tiles join ctrl/shift-click and right-click
  selection. Mixed live+archived selections are fine — every action skips what doesn't
  apply, with one summary toast. The tile's Restore button keeps the status-untouched
  semantics (no confirm), as does the menu's Restore selected.
