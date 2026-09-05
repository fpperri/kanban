---
name: kanban
description: Manage a Markdown-based Kanban board using card files in a .kanban/ directory (kanban/ supported as a legacy fallback), including archived/ for completed cards. Use when the user asks to create, move, view, list, or manage tasks or cards on a kanban board, or when tracking work items across statuses like backlog, todo, doing, done, or archive. Defines every board file contract (cards, config.yaml board name/ids/assignees, notifications.md) and when the AI must notify the human.
---

# Kanban AI Skill

Manage a Kanban board as Markdown files in the board directory. Each file is a card. The board state is derived by reading all card files and grouping by `status`.

## Locating the board

`.kanban/` is the preferred board directory; `kanban/` remains supported as a fallback for existing boards. Discovery order: `.kanban/` first, then `kanban/`. `<kanban-dir>` throughout this file refers to whichever one resolves.

## Narrative Record (Required)

Treat cards as durable source material for future review. Do not rewrite or delete prior narrative content unless explicitly asked. When updating a card, append a brief narrative note to a `## Narrative` section at the end of the file. Focus on reasons, discoveries, insights, and decisions. Avoid transactional status-change logs unless they matter to the story. Use ISO dates.

Narrative entry format (scan-optimized):

```markdown
## Narrative
- 2026-02-05: **Shifted auth to WebAuthn.** Discovered the flow must support device-based MFA; `auth-plan.md` updated, unblocks `webapp#12 Device enrollment for the second factor`. (by @assistant)
```

Entry shape, in order:
- **Bold TL;DR first** — verb-first, ≤10 words, ends with a period. Readers scan; the first words must carry "what happened." Genuinely trivial pings may skip the bold lead.
- **1–2 supporting sentences** after it — plain, objective, roughly half the words you'd naturally write.
- **Backtick every identifier** a reader must match verbatim: card ids, commit hashes, filenames, branch names. They never autolink in repo files, so the code font is doing real work.
- **Mention a card as one code span, `` `board#id title` ``** — the **Card mention** rule (CONTEXT.md). Qualifier, id and title verbatim inside a single span, so the reader sees where the title ends and the sentence resumes; a title carrying backticks of its own drops them there (nested code does not render). The board qualifier is never dropped, even on the card's own board; the title may be dropped only on a repeat inside the same bullet, leaving `` `board#id` ``. Never paraphrase a title in place of itself. Nothing else takes a bare `#N`: pull requests are `PR #34 (repo)`, notifications are `notification 17`. The rule binds everything you write for a human — narrative bullets, notification `message` text, reports, digests, chat handoffs.
- **One event per bullet.** Two things happened = two bullets, even same author, same day. Never fuse events into one run-on line.
- **No sub-bullets, no wrapped continuation lines** — the web renderer flattens nested bullets to siblings and a continuation line breaks the list. Keep each entry a single flat `- ` line.

The convention is forward-only: never rewrite old entries to match. If the card has no `## Narrative` section, add it. If a change is minor (e.g., typo), skip the narrative note unless it carries meaningful insight.

When a card is moved to `done`, add enough narrative detail that a future reader can understand the card's story and outcome. Keep it coherent and complete without being verbose.

## Card Fields

Each card's frontmatter supports the following fields:

- `id` — Unique numeric identifier. If the board has a `config.yaml` with a `nextId` counter, use `max(nextId, scan-max + 1)` and write the advanced counter back — this keeps ids unique across deletions and concurrent writers. Otherwise scan existing `*.card.md` files in `<kanban-dir>` (including `<kanban-dir>/archived/`, recursively — package folders count) and take max + 1, starting at `1` if empty. Reference cards by this number.
- `status` — Column. The board's official column list is `config.yaml`'s `statuses` (ordered = column order); absent, the built-in four apply: `backlog`, `todo`, `doing`, `done`. Free text is legal on disk — a value not in the list renders in the list's **first** column (the catch-all) with its raw value shown, and is **never rewritten**; promotion = the human adds the value to the list. `archive` is a location, not a status. Prefer listed values when creating cards.
- `priority` — one of the board's official `priorities` list in `config.yaml` (built-in default: `High`, `Normal`, `Low` — ordered highest first). Free text is allowed but sorts after all official values. Defaults to `Normal` if omitted.
- `waiting_for` — List of card IDs this card depends on (dependency edges). Example: `[3, 7]`. Replaces `blocked_by` — hard cutover, no reader honors the old name. **Waiting is derived at read time, never stored:** the card is *waiting* while any listed card is not `done`; when every dep lands, the waiting state disappears on its own. A listed id with no matching card (dangling) is **non-blocking** — it never makes the card waiting. A dependency is sequencing, not an impediment; don't call it "blocked". Omit if empty — an empty `[]` stays legal on read, but it's no-data boilerplate the `kanban-web` app strips on its next managed write, so don't write it.
- `blocked` — (optional) Manual impediment sticker, human stop sign; the value is the **reason** as free text. Example: `blocked: legal sign-off pending`. The card is *blocked* iff the trimmed value contains ≥ 1 alphanumeric character; YAML boolean special-case: `false`/`no` → not blocked, `true` → blocked with reason unspecified. Lean rule: omit the field entirely when the card is clear — never write `blocked: false`. **No eviction:** blocking a card already in `doing` leaves it there; the gate below is entry-only. **Agents never grab a blocked card, in any column** — clearing the sticker is the human's call.
- `review` — (optional) "Finished — approve me" sticker, `blocked`'s sibling (ADR 0009): the value is the **text** describing what to check, free text. Example: `review: PR #6`. Same predicate as `blocked` (trimmed value ≥ 1 alphanumeric character; YAML `false`/`no` → not present, `true` → present, text unspecified) and the same lean rule — omit the field entirely when clear, never write `review: false`. Where `blocked` is "stuck, act so I can proceed," `review` is "done, approve me" — it overlays any status exactly like `blocked` and does **NOT** gate `doing` entry (the gate below stays `waiting` + `blocked` only). A machine-shaped value (see the AFK dispatcher's contract for the exact shape) is polled by the dispatcher each tick; free text is cleared by the human on approval. **Agents never grab a review-stickered card, in any column** — it awaits human approval; clearing the sticker is the human's (or, for a merged PR, the dispatcher's) call. See `docs/adr/0009-review-and-attention-are-stickers.md`.
- `prompt` — (optional) A queued grooming instruction FROM a human TO the next AI that services the card: free text, always written **quoted** (same quoting contract as `notifications.md`'s `message`; an embedded newline collapses to a space). Not a sticker — no presence predicate, no `doing`-gate involvement, and it never excludes the card from pickup. The card **body** stays the only work spec: servicing a prompt means formalizing or editing the card, never executing the prompt as a work instruction, and clearing the field; a prompt can never escalate a card to autonomous work — only the trusted card body may pre-authorize `@afk`. Clear = remove the line (lean rule).
- `assignee` — (optional) Owner of the card. If the board's `config.yaml` has an `assignees` registry, prefer those handles (it suggests, never validates — free text is fine).
- `start_date` — (optional) The working range's **from**: a date (`YYYY-MM-DD`) or a local datetime (`YYYY-MM-DDTHH:MM`). Pairs with `end_date` as the from–to working range; alone = a 1-day range at start. The `kanban-web` app auto-stamps it with today's local date when a card lands in the literal status `todo` and the field is empty — mirror that stamp when moving a card into `todo` by hand (see Moving a Card below); never overwrite an existing value.
- `end_date` — (optional) The working range's **to**: same date/datetime forms. Alone = a 1-day range at end. Nothing validates ordering — a reversed range (start after end) is tolerated (date-aware views treat it as a 1-day event at the range end). **Compat fallback:** when `end_date` is absent but `start_date` AND `due_date` are both present, the range is start→due, so pre-triad cards keep reading as ranges. The `kanban-web` app auto-stamps it with today's local date when a card lands in the literal status `done` and the field is empty — mirror that stamp when moving a card into `done` by hand; never overwrite an existing value.
- `due_date` — (optional) The **deadline**: same date/datetime forms. Independent of the working range (date-aware views draw it as its own marker, even inside the range) — it only stands in as the range end via the compat fallback above. Write the triad in `start_date`, `end_date`, `due_date` order so ranges read naturally.
- `tags` — (optional) List of labels.
- `parent` — (optional) Epic membership: the card id of the epic this card belongs to. Example: `parent: 146`. A single id, tolerant read (non-numeric = no membership), never validated; a dangling id renders a ghost stub on the map, a self-id is ignored. Membership is not sequencing — it never makes the card *waiting* and the `doing` gate ignores it; use `waiting_for` for ordering. The web map renders the epic as the SINK (it closes only when its children close, so it lays out BELOW them): dependency edges between two members of the same epic are tinted the epic orange (solid — still real, gate-enforced `waiting_for` edges), and only the chain's TERMINAL members (no other member waits on them; a chainless member is its own terminal) draw a dashed orange membership hop into the epic — the epic's color flows along the chain, not as a fan of direct arrows. The epic still lists in the no-dependencies row (membership isn't a dependency). Form-unmanaged: write it by hand; every managed write preserves the line verbatim.
- `epic` — (optional) `epic: true` marks the card as an **epic/wayfinder** — a marker for a stretch of work rather than a single task. Boolean with the lean rule: write exactly `epic: true` when set and **omit the line entirely** when not — never write `epic: false`. Never validated; the `kanban-web` app reads any-case `true` as set and gives epics an orange identity layered on top of the status color in every view (the status/column itself is unchanged).
- `updated` — (optional, machine-maintained) ISO local datetime, `YYYY-MM-DDTHH:MM:SS` (no timezone suffix — same shape as `notifications.md`'s `at` field). The `kanban-web` app stamps it on card creation and bumps it on every content write (single edits, drag-driven status changes, bulk edits); it does NOT change on archive/restore (those only move the file, they don't touch its content). AI writers editing a card's frontmatter by hand should bump `updated` to the current local datetime too, so the timestamp stays meaningful regardless of which tool made the change.

## Creating a Card

Create a new card file in `<kanban-dir>` named `<0000-id>.<kebab-case-name>.card.md` — the card's `id` zero-padded to 4 digits, so filenames sort by card id (e.g. `0008.card-filename-id-prefix.card.md`). The frontmatter `id` field is the source of truth; the filename prefix is cosmetic (visibility + sorting) and scripts never parse identity from it. **Only `*.card.md` files are treated as cards** — any other `.md` (a generated `board.md`, a `README.md`, `CLAUDE.md`, `AGENTS.md`, etc.) is ignored by the board scripts, so meta files can live alongside cards safely.

Older boards may still contain unprefixed `<kebab-case-name>.card.md` files — readers treat both identically (everything globs `*.card.md`); `scripts/migrate_card_names.sh` renames a board to the prefixed format in place.

If possible, include a Job Story using the structure "When [situation], I want to [motivation], so I can [expected outcome]." Do not force it; only add when it fits. If you add one, share it with the requester to confirm.

```markdown
---
id: 1
status: todo
priority: Normal
assignee: "@hitl"
due_date: 2026-02-28
tags: [auth, backend]
---

# Implement User Authentication

Set up user authentication using JWTs.

## Acceptance Criteria
- Users can register for a new account.
- Users can log in with their credentials.
- Authenticated users receive a JWT.
```

## Moving a Card

Update the `status` field in frontmatter.

Landing in the literal status `todo` stamps `start_date`; landing in `done` stamps `end_date` — today's local date (`YYYY-MM-DD`), only when the field is empty, never overwriting an existing value. The `kanban-web` app stamps this on every status-changing path; when moving a card by hand, stamp it the same way (same reason as the `updated` bump — the working range stays meaningful regardless of which tool made the move).

**Entry gate to the literal status `doing`:** before moving a card to `doing`, verify it is neither **waiting** (some `waiting_for` id names a card not `done`; dangling ids don't count) nor **blocked** (`blocked` holds a valid reason — trimmed value with ≥ 1 alphanumeric character, or YAML `true`). If either holds, refuse and name which: "waiting on `webapp#34 Session store migration`" / "blocked: <reason>". No eviction — the gate applies on entry only; a card already in `doing` that gets blocked stays there. And regardless of column, agents never grab a blocked card. **`review` (ADR 0009) does NOT gate `doing` entry** — the gate stays `waiting` + `blocked`, exactly as above; a card can be moved into (or stay in) `doing` while wearing a `review` sticker. Regardless of column, agents never grab a review-stickered card either — same "not yours to touch" stance as blocked, just for a different reason (finished, not stuck).

Cards with `status: done` may be moved into `<kanban-dir>/archived/` to keep the main board tidy. This is a file-location move only; the card should remain a normal card with `status: done` unless explicitly changed.
If `<kanban-dir>/archived/` does not exist, create it under the active board directory before moving the card.

**`kanban/archived/` is scanned recursively** (ADR 0010): an archived card is any `*.card.md` anywhere under it. Cards may sit at the `archived/` root or inside an optional **package** folder, `kanban/archived/<package>/` — free-form grouping for a batch of finished work, created on demand. A package name is kept verbatim (no slugging — an existing folder must match byte-for-byte) and must be one plain path component: never a nested path, never a `.`/`..` hop. Packages are grouping only — they mean nothing to status, ids, or dependencies, and every reader (board views, id allocation, dependency resolution, restore, delete) finds a card wherever in the tree it sits. Restoring returns the card to `kanban/`, never to a package; the emptied package folder is left in place. Archiving without a package writes to the `archived/` root, and never move a card that is already filed in a package back out to the root unless asked.

## Board files that aren't cards

Only `*.card.md` files are cards. Two other files in `<kanban-dir>/` are levers you are expected to use:

### `config.yaml` — board name, ids, and assignees

```yaml
name: webapp      # the BOARD NAME opening every card mention (`webapp#29 Card title`)
nextId: 29        # monotonic id counter — use max(nextId, scan-max + 1), then write the advanced counter back
assignees:        # registry of who can own cards; suggests handles, never validates
  - handle: "@human"
    name: "Human"
    kind: human   # suggested: human | ai-hitl | ai-afk (free string)
    description: "A human can grab it. Final say on trusted and destructive calls."
  - handle: "@hitl"
    name: "AI (HITL)"
    kind: ai-hitl
    description: "AI will grab it but needs a human in the loop (grilling, spec, tickets, approval) — it should make the AI think twice."
  - handle: "@afk"
    name: "AI (AFK)"
    kind: ai-afk
    description: "The AI can execute fully autonomously."
priorities: [High, Normal, Low]   # official list, ordered highest first
tags: [skills, config]            # curated tag vocabulary
statuses: [backlog, todo, doing, done]   # official COLUMN list, in board order
```

**`name` — the board name.** The short token that opens a card mention
(`` `board#id title` ``), read by every surface for its heading, tab title, board
header and page title. One token, no whitespace, no `#`. It is the human's to
declare and to rename, and it is **never derived at read time**: a surface
reading a board with no `name:` falls back to the folder above the board
directory, and that fallback is a display default, not a name — a board without
a declared name cannot be mentioned across boards.

**Seeding `name:` is the one exception to "never create `config.yaml`
yourself".** The first AI to service a nameless board seeds the key from the
folder that holds the board's home, then files a notification saying it did so
the human can rename it. Write `name:` on **line 1**, above any `assignees:`
block — each assignee entry has its own *indented* `name:`, so the top-level key
has to come first to stay unambiguous. Creating a `config.yaml` that holds only
`name:` is allowed; inventing any other key or list is not.

**Grab semantics for AI writers:** the registry's `kind` tells *you*, the
AI, how to treat a card based on its `assignee` handle:

- **`@human`** (`kind: human`) — a human owns this. The AI leaves it alone;
  don't grab it, don't move it, don't close it.
- **`@hitl`** (`kind: ai-hitl`) — the AI may work it, but MUST route a human
  checkpoint before closing (grilling, spec review, ticket-writing, approval
  — whatever the card calls for). The handle exists to make the AI think
  twice, not to block it outright.
- **`@afk`** (`kind: ai-afk`) — fully autonomous execution; no human
  checkpoint required to close it.

Same suggest-never-validate rule as every other registry list applies: a
card's `assignee` is free text, and only a handle whose registered `kind` is
`human` / `ai-hitl` / `ai-afk` triggers the behavior above — an unrecognized
handle (including handles predating the trio, which stay legal
on existing cards) carries no special meaning.

This `@human`/`@hitl`/`@afk` trio is the canonical default on every board
and surface (`@ai` is retired as ambiguous) — the one write-up
lives in CONTEXT.md's Role trio glossary, and when a board's `config.yaml`
has no `assignees` registry, every surface suggests exactly this trio.

Status values are **case-sensitive** — the `doing` entry gate (waiting + blocked) applies to the literal lowercase `doing` only; a column named `Doing` is just another custom column the gate ignores. Curate accordingly.

The `priorities`/`tags` lists are **HITL-curated suggestions**: prefer official values when creating cards, free text stays legal, and only the human adds new values to the lists. Absent file = fall back to the max+1 scan and freeform values; never create `config.yaml` yourself — the single exception is seeding `name:` (above). **Rescan ids in the same turn you create a card** — the web app or another session may be writing concurrently.

The `statuses` list is different in kind: it drives the **column layout** of every board surface (web columns, cli board print, form options, gantt group order), in list order — but like the other lists it never validates a card's on-disk value. A card with an unlisted status renders in the list's **first column** (the catch-all — `backlog` under the default list) with its raw value shown; the file is never rewritten. **Promotion is human-only:** only the human adds a status to the list; on the next read the card files under its real column. Archive is excluded — it stays a location-column at the far right, never a list entry. The `doing` entry gate (waiting + blocked) stays pinned to the **literal** status `doing`, custom list or not.

A root board's `config.yaml` may also carry an optional top-level `boards:` list — inline `[a, b]` or block `  - path` entries, each absolute or relative to the board dir — naming other boards to roll up. This key is read by `rollup.js` only; the kanban app itself ignores it.

### `notifications.md` — messaging the human

Append an entry to `<kanban-dir>/notifications.md` (create if absent) and the human sees it in the web app's bell and the cli's inbox. YAML list, every field on its own single line:

```yaml
- id: 4
  at: 2026-07-12T09:15:00
  from: "afk-run:#131"
  level: info
  message: "`webapp#131 Retry budget for the ingest worker` closed; more: payload applied, 3 cards moved to done."
  read: false
```

- `id`: max existing + 1. `at`: local ISO datetime, no timezone.
- `from`: the writer's handle (e.g. `afk-run:#131`, `skill:kanban-viewer`).
- `level`: one of `debug` | `info` | `warning` | `error`; **absent = `info`** (back-compat). Renderers show all levels — debug dimmed, warning amber-tinted, error red-tinted; no filtering for now.
- `message`: single line only; quote values containing `:` or `#`. **TLDR-first shape:** the text before `; more: ` is a single plain sentence (no "TLDR" label) — renderers emphasize (bold) it; everything after is detail. A message without `; more: ` is all-TLDR. Card ids in the text follow the **Card mention** rule (one code span, `` `board#id title` ``); `from` is a machine handle, not prose, and keeps its bare `afk-run:#131` form.
- `read`: always write `false` — the reader flips it (flipping to `read: true` stays an in-place edit). Entries missing a numeric `id` or non-empty `message` are skipped by readers and moved verbatim to `archived/notifications.md` on the next managed rewrite — never deleted, same rule as clearing.

**Discipline (this is a rule, not a suggestion):** every AI mutation of the board — create, move, edit, archive, delete, payload-apply — must be reconstructable from the tray. Write either **one entry per action** or **ONE grouped entry per coherent batch/turn** that enumerates what changed. Interactive sessions are not exempt — moves the user watched you make get an entry too (grouped is fine). Tie-breaker: **unsure → notify.** A spurious notification costs one click; a silent mutation costs a re-derivation.

**Clear = archive:** clearing/removing entries from the tray MOVES them verbatim (append) to `<kanban-dir>/archived/notifications.md`, creating the file/dir if absent. Deletion never happens. No rotation or cap yet. That file lives at the `archived/` **root** — it is not a card, so archive packages (above) never hold or move it.

Generated leftovers from retired skills (`board.md`, `dashboard.html`) may also sit in the folder — stale artifacts, not cards; ignore them.

## Human surfaces (routing)

This skill is the **AI's** lever set. When the human wants to see or work the board themselves, point them to (or launch) the right surface instead of narrating files:

- **kanban-web** — live browser editor, desktop/localhost.
- **kanban-cli** — conversational editor, works under remote control on mobile.
- **kanban-viewer** — generated single-file HTML board for phone/tablet/Cowork; read-only, queued changes come back as an "Apply kanban changes" payload.

## Viewing the Board

Helper scripts are bundled in the `scripts/` directory alongside this skill file. To locate them, find this skill's directory within the installed plugin (e.g., using `glob` for `**/kanban/scripts/view_board.sh`).

Run the board view script:

```bash
bash <SCRIPTS_DIR>/view_board.sh <kanban-dir>
```

Outputs a `=== BOARD: <name> ===` header — `config.yaml`'s `name:`, falling back to the folder above the board directory — then cards grouped by status column, with priority, waiting (unresolved `waiting_for` ids only), blocked (reason), and review (text) flags inline. The header carries the board qualifier for the whole print, so the card lines stay `#id Title`; any prose you write *about* a card follows the **Card mention** rule instead.

## Searching and Filtering

### Search by Tag
```bash
bash <SCRIPTS_DIR>/search_by_tag.sh <kanban-dir> <tag>
```
Output: Cards with that tag (ID, status, title)

### Search Content
```bash
bash <SCRIPTS_DIR>/search_content.sh <kanban-dir> "<search term>"
```
Output: Cards matching the search term with context lines

### Show Blocked Cards (manual sticker)
```bash
bash <SCRIPTS_DIR>/show_blocked.sh <kanban-dir>
```
Output: Cards whose `blocked` sticker passes the predicate, reason inline.

### Show Review Cards (manual/dispatcher sticker)
```bash
bash <SCRIPTS_DIR>/show_review.sh <kanban-dir>
```
Output: Cards whose `review` sticker passes the predicate (`blocked`'s sibling, ADR 0009), text inline. Does not affect the `doing` entry gate.

### Show Waiting Cards (unresolved dependencies)
```bash
bash <SCRIPTS_DIR>/show_waiting.sh <kanban-dir>
```
Output: Cards that are **waiting** — some `waiting_for` id not `done` — with the unresolved ids listed; deps all `done` = not shown.

### List All Tags
```bash
bash <SCRIPTS_DIR>/list_tags.sh <kanban-dir>
```
Output: All tags sorted by usage count (most used first)

### List All Cards
```bash
bash <SCRIPTS_DIR>/list_all_cards.sh <kanban-dir>
```
Output: All cards in pipe-delimited format (id|status|waiting_for|blocked|title), sorted by ID. Useful for parsing, debugging dependencies, or exporting board state.

### Eligible Cards (agent pickup)
```bash
bash <SCRIPTS_DIR>/eligible_cards.sh <kanban-dir> [assignee]
```
Output: `todo` cards (literal status) that are doing-gate clear — not waiting (`show_waiting.sh` semantics: dangling `waiting_for` ids and all-`done` deps don't count), not blocked (`show_blocked.sh` predicate), and not review-stickered (`show_review.sh` predicate — ADR 0009: agents skip a card awaiting human approval, same as blocked, even though `review` doesn't gate `doing`) — as `id|priority|assignee|title`, sorted by ID. The optional `assignee` arg filters the result and is quote-normalized, so `@afk` and `"@afk"` both match the on-disk `assignee: "@afk"`; omitted returns every assignee. The one-call answer to "what can an agent pick up right now" — no re-deriving the gate from raw card files.

### Multi-Board Rollup

```bash
node <SCRIPTS_DIR>/rollup.js <root-board-dir> [--boards p1,p2,...] [--write] [--since <ISO>]
```
Reads the root board's `boards:` registry (or `--boards`) and prints a three-section digest: `PORTFOLIO` (per-board doing/todo/review/blocked/human counts), `DECIDE` (every card across all boards needing a human — `@human` assignee, review or blocked sticker, a `Decide` title, or a `## Decision needed` section — sorted by priority), and `NEW SINCE <ISO>` (notifications posted after the cutoff, newest first). Read-only by default; `--write` appends exactly one summary notification to the root board's `notifications.md` and touches nothing else.

**Note:** `<SCRIPTS_DIR>` refers to the `scripts/` directory next to this SKILL.md file. All scripts take the kanban directory as the first argument. If omitted, they default to the current directory.
