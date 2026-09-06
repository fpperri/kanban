---
name: kanban-cli
description: (Claude Only) Full conversational editor for a Markdown kanban board — print the board, open cards by id, and create, edit, move, archive, restore, and delete cards (single or bulk), plus a notifications inbox and Mermaid dependency view. Claude-driven (no TUI), so it works identically at the local terminal AND under remote control on mobile. Use when the user wants to work a kanban board without the web app or the filesystem. For AI-initiated card management use the kanban skill; for a desktop browser editor use kanban-web.
---

# Kanban CLI

Drive an interactive tour **and edit session** of a kanban board. This is
Claude-driven — there is no TUI. You *print* the board and use `AskUserQuestion`
for the next action, so it works the same at a local terminal and under remote
control on mobile. It is the conversational twin of **kanban-web**: same
operations, same rules, different medium.

Two rules that come from the medium:

- **Card list is unbounded → print it.** Show every card as markdown grouped by
  status. Never try to list cards as `AskUserQuestion` options.
- **`AskUserQuestion` caps at 4 options → use it only for targetless actions.**
  Targets are supplied by the user typing ids (the question's free-text "Other").
  Typing a number means "open that card"; typed commands like `archive 3,5,7`
  carry their own targets.

## Write mechanics live in /kanban

**Load the `kanban` skill before the first write.** Every file contract is defined
there and not duplicated here: id assignment (`config.yaml` `nextId` — use it and
advance it), `<0000-id>.<slug>.card.md` naming, frontmatter fields, narrative
preservation (never rewrite `## Narrative`; append to it), archive-as-location,
the waiting/blocked predicates, the `doing` entry gate, and the notifications
writer contract. This skill only defines the *interaction loop*; `/kanban`
defines what a correct write looks like.

## Locating the board

`.kanban/` is the preferred board directory; `kanban/` remains supported as a
fallback for existing boards. Default to the current working directory's
`.kanban/`, falling back to `kanban/` when only that exists. If the user
names a board, resolve its path directly (a board is any directory of
`*.card.md` files, conventionally `<project>/.kanban/` or, on an older
board, `<project>/kanban/`). If no directory containing `*.card.md` files is
found, say so and stop.

The helper scripts live with the `kanban` skill — locate them with glob
`**/kanban/scripts/list_all_cards.sh` and use that directory as `<SCRIPTS_DIR>`.

## The loop

### 1 — Show the board

**Re-read the folder from disk before every print** — other writers (the web app,
`/kanban`, another session) may have changed it since the last print; there is no
poll, freshness comes from re-reading.

```bash
bash <SCRIPTS_DIR>/view_board.sh <kanban-dir>
```

Opens with a `=== BOARD: <name> ===` header — `config.yaml`'s `name:`, the token
that qualifies every card mention, falling back to the folder above the board
directory when the board hasn't declared one. Keep that header in the formatted
output: it is what tells the human *which* board they are looking at when several
are in play. Under it, prints cards grouped by column with `[HIGH]`,
`[waiting: …]`, and `[blocked: <reason>]` flags — the waiting/blocked predicates behind the flags
are `/kanban`'s. The column set and order follow `config.yaml`'s `statuses`
list when present (the script parses the **inline** `statuses: [a, b, c]` form
only — a block-form list falls back to the default Backlog / Todo / Doing /
Done). A card whose status isn't in the list groups under the **first** column
with its raw status shown inline as `[status: <raw>]` — never rewrite it;
promotion is the human adding the status to `config.yaml`. Present the output
lightly formatted as markdown. Card ids in any prose you write around it —
summaries, refusals, confirmations, the notification inbox — follow the **Card
mention** rule (one code span, `` `board#id title` ``; CONTEXT.md); the
board print's own `#id` column lines are a table under the header, not prose. If every column is empty, say "No cards yet."
and offer **New card** / Done.

If unread notifications exist (see the inbox section), mention the count next to
the board — the conversational equivalent of the web app's bell badge.

**On-demand sort/filter:** if the user asks ("sort by due date", "only #auth",
"only High"), re-print the board that way. This is per-print; nothing persists
(no localStorage equivalent — deliberate).

### 2 — Offer board actions

Ask with `AskUserQuestion` (≤4 options, all targetless), e.g.:

- **New card** — create flow below.
- **Notifications** — inbox below (label it with the unread count).
- **Dependencies** — Mermaid view below.
- **Done** — end.

Tell the user they can also **type a card id** to open it, **"archived"** to
browse the archive, or a **command** — `move 5 to doing`, `archive 3,5,7`,
`delete 12`, `restore 25` — from anywhere in the loop.

### 3 — Open a card

On id `N`: locate the file (glob `<kanban-dir>/*.card.md` + `grep -l '^id: N$'`,
falling back to `list_all_cards.sh` for the id→file map), Read it, show it — the
markdown renders directly, with one exception (below). Check `archived/` too —
**recursively**, since archived cards may sit inside `archived/<package>/`
grouping folders (ADR 0010); an archived card shows with an `[archived]`
marker, wherever in that tree it lives. No match → "No card #N."
and back to step 2.

**Exception — format local-datetime frontmatter values:** a raw value like
`updated: 2026-07-10T09:36:31`, or a `start_date`/`end_date`/`due_date`
carrying a time component, reads badly with its literal `T` separator — show
it as `2026-07-10 | 09:36:31` instead (web-app parity, see
`formatLocalDateTime` in the kanban-web skill). Date-only values
(`due_date: 2026-07-10`, no `T`) are unaffected.

### 4 — Offer card actions

After showing a live card, ask with `AskUserQuestion` (≤4 options), picking the
most relevant for the card; the rest stay available as typed commands:

- **Edit** — edit flow below.
- **Move** — ask which column (only the valid ones).
- **Archive** / **Delete** — with speedbumps, below.
- **Waiting on** — for each id in `waiting_for`, show `#id title — STATUS`
  (live status from disk, so resolved deps read as `done` at a glance).
- **Back to board** / **Done**.

For an archived card the actions are **Restore**, **Delete**, **Back**, **Done**
(matching the web app: no Edit on archived cards). The user may also type another
id to jump to that card.

## Operations

All writes follow `/kanban` contracts. After any write, confirm what happened in
one line and re-print the affected card or board section.

- **Create** — collect title, then ask (or accept inline) status, priority, tags,
  `waiting_for`, assignee, start/end/due dates (from–to working range plus an
  independent deadline, each a date or local datetime), the epic flag,
  description. Suggest assignees, priorities, and tags from `config.yaml`'s
  lists (they suggest, never validate — free text is fine; priorities default
  to High/Normal/Low when unconfigured; with no `assignees` registry, suggest
  the `@human`/`@hitl`/`@afk` role trio — CONTEXT.md's Role trio glossary).
  Only title is required; default the rest (`status: backlog`,
  `priority: Normal`).
- **Edit** — ask which fields to change, or accept them inline ("set priority
  High, due 2026-08-01"). Frontmatter fields and title/description are editable;
  the body — including `## Narrative` and unmanaged frontmatter keys — is
  preserved verbatim, same as the web form. Blocking a card is a plain field
  edit (`blocked: <reason>`), but capture the why conversationally — if the
  user says "block 5" without a reason, ask for one before writing
  (`blocked: true` with reason unspecified is the fallback, not the default).
- **Move** — update `status`. Offer the board's `statuses` list (default four
  when unconfigured) as the valid columns. The **`doing` entry gate** — its
  waiting/blocked predicates, literal-`doing` pinning, entry-only scope, and
  no-override two-step escape hatch — is defined in `/kanban`. Here it is a
  hard reject: refuse the move and name which condition fired ("waiting on
  `webapp#34 Session store migration`" / "blocked: <reason>"), the
  conversational twin of the web app's snap-back toast.
- **Archive / Restore** — move the file into / out of `<kanban-dir>/archived/`
  (location, not status; status untouched). Archive writes to the `archived/`
  root unless the user names a package, which files the card in
  `<kanban-dir>/archived/<package>/` (created on demand — one plain path
  component, ADR 0010). Restore returns the card to the active board from
  anywhere in that tree, and leaves the emptied package folder behind.
- **Delete** — permanently remove the card file.
- **Bulk** — commands take multiple ids: `archive 3,5,7`, `delete 3,5`,
  `move 3,5 to todo`, and bulk edits: `assign 3,5 @afk` (empty assignee =
  unassign), `set priority 3,5 Low`, `tag 3,5 design` / `untag 3,5 design`
  (dedupe per card), and
  `schedule 3,5 from 2026-07-10 to 2026-07-12 due 2026-07-15` (any subset of the
  three; `clear start/end/due` removes a field — the web app's set/clear/leave
  semantics). Archive/delete take one confirm naming
  the whole batch ("Archive #3 #5 #7 — 3 cards?"); bulk edits don't (they're
  the reversible direction). Per-card skips (a gate-refused move to `doing`, a
  missing id) don't abort the batch; finish with one summary line naming what
  changed and what was skipped and why — the web app's summary-toast semantics.

### Speedbumps

Every destructive action confirms first, naming its object: archive, delete, bulk
archive/delete/move (one confirm per batch, with the count), notification remove
and clear-all (both archive to `archived/notifications.md`, never delete — still
confirmed since they empty the tray). **Restore is exempt** (it's the reversible
direction). Under remote control, confirms go through `AskUserQuestion` — never
assume a yes.

## Notifications inbox

Same file and contract as the web app's bell: `<kanban-dir>/notifications.md` —
the writer contract (entry shape, `level`, TLDR-first message, clear = archive)
is defined in `/kanban`. On "Notifications":

1. Print all entries newest-first, unread flagged, level shown (absent =
   `info`), with the TLDR segment (the text before `; more: `) **bolded**:
   `` ● notification 4 [info] 07-12 09:15 afk-run:#131 — **`webapp#131 Retry budget for the ingest worker` closed**; more: … ``.
   All levels print — no filtering; call out `warning`/`error` plainly (the
   web app tints them amber/red and dims `debug`).
2. Opening the inbox **marks everything read** — rewrite the file flipping
   `read: false → true`, preserving order and unknown fields (web-app parity).
3. Offer: **Remove an entry** (by id, confirm), **Clear all** (confirm with
   count), **Back**. Both ARCHIVE, never delete: move the entries verbatim
   (append) to `<kanban-dir>/archived/notifications.md`, creating the
   file/dir if absent — always at the `archived/` root, never inside an
   archive package folder.

Skip malformed entries (missing numeric `id` or empty `message`) when printing;
like the web app, move their raw blocks verbatim to `archived/notifications.md`
on the next rewrite — never delete them.

## Dependency view

On "Dependencies": read all cards (live **and** archived, the latter
recursively — dependency edges are location-independent, and a packaged
archived card resolves like any other) and print a Mermaid `graph LR` in a
fenced block: nodes
`#id title` styled by status (classDefs matching the board palette — the exact
hexes in the web skill's `status-colors.js`: backlog cyan, todo blue, doing
green, done purple, archived muted grey), edges from **dependency to the
waiting card** (each `waiting_for` entry points from the dep to the card that
lists it) — the same direction as the web app's map view. A `waiting_for` id
with no matching card renders as a "not found" node (dangling — display-only,
it never makes the card waiting). **Membership edges:** the epic is the sink —
it closes last. Only a TERMINAL member (no other member of the same epic
waits on it; a chainless member is its own terminal) draws a dashed Mermaid
link into its epic (`n<id> -.-> n<epicId>`) — membership, not sequencing,
mirroring the web map's dashed orange hop; a non-terminal member's work
reaches the epic through the chain, no direct link. When the terminal/epic
pair also has a `waiting_for` edge in either direction, print only the solid
dependency edge (sequencing wins the pair, same rule as the web map). The
web map additionally tints intra-epic chain edges orange — a color
affordance a Mermaid printout may skip or approximate with linkStyle. A
dangling parent id renders the same "not found" node as a dangling dep, and a
self-parent is ignored. Cards with no `waiting_for` edges in either
direction go in a short "isolated" list under the diagram instead of cluttering
it — membership edges don't count for that list, so an epic whose only edges
are membership appears in the diagram AND the list, matching the web map. If the board is filtered, apply the same filter, but keep referenced
off-filter cards as dimmed nodes rather than dropping edges silently.

**Scoped to one card — "Dependencies tree for #74" / "Dependencies path for
#74"** (mirroring web's `tree:<id>`/`path:<id>` search terms). Same edge set
as the whole-board view above (`waiting_for` sequencing + `parent:`
membership, sequencing-wins-the-pair already applied, epic as sink), read
over live **and** archived cards regardless of any active board filter —
traversal always runs over the full board; only whether an archived member
actually *renders* stays gated by the Archive filter. `#`-tolerant id
(`tree:74` and `tree:#74` are the same target), one id per request. An id
matching no card (unknown or non-numeric) matches nothing — say so, don't
error. Two variants, same machinery as web's `treeIds`/`pathIds`:

- **tree** — the undirected connected component containing the id: flood-fill
  every node reachable by following edges in **either** direction, starting
  from the card. This is "everything this card's dependency web touches."
- **path** — the directed cone through the id: everything transitively
  **upstream** (walk dependency-to-waiting edges backward — ancestors) union
  everything transitively **downstream** (walk them forward — descendants)
  union the card itself. Narrower than tree — a sibling that only shares an
  ancestor or descendant with the id, with no direct directed relation to it,
  is excluded.

Print the same Mermaid `graph LR` as the whole-board view, restricted to the
resolved id set: same node styling, same dashed membership edges, same
"not found" ghost nodes for dangling `waiting_for`/`parent` ids (dangling ids
never block the print). A card with no edges at all is a component/cone of
one — print it alone rather than falling back to the whole board. This is a
Mermaid rendering, not a new interaction: cli has no search box, so there's no
"write the term in and don't switch views" sugar to mirror — the user just
asks for the scoped view directly.

## Parity with kanban-web

Full CRUD, the `doing` entry gate (waiting + blocked), bulk actions, speedbumps,
notifications, dependency view, assignee suggestions: **same behavior, same
rules.** Web's `tree:`/`path:` dependency-focus search terms are mirrored as
the scoped "Dependencies tree/path for #id" variants above, and as
`tree:`/`path:` search terms plus card-sheet tap actions in the viewer; the
context-menu sugar has no cli equivalent to mirror — there's no search box to
write a term into. Deliberately not mirrored (medium mismatch): drag & drop
(typed commands instead), collapse state and any `localStorage` persistence (a
print is ephemeral), per-column persisted sort (on-demand re-print instead), the
SVG map (Mermaid instead), the 5s poll (re-read disk before every print),
search-as-you-type (filter on request), the header copy-board-path button (a
transcript is selectable text; print the board path on request).
