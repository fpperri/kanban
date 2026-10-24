---
name: kanban
description: Manage a Markdown-based Kanban board using card files in a .kanban/ directory (kanban/ supported as a legacy fallback), including archived/ for completed cards. Use when the user asks to create, move, view, list, or manage tasks or cards on a kanban board, or when tracking work items across statuses like backlog, todo, doing, done, or archive. Defines every board file contract (cards, config.yaml board name/ids/assignees, notifications.md) and when the AI must notify the human.
---

# Kanban AI Skill

Manage a Kanban board as Markdown files in the board directory. Each file is a card. The board state is derived by reading all card files and grouping by `status`.

## Locating the board

`.kanban/` is the preferred board directory; `kanban/` remains supported as a fallback for existing boards. Discovery order: `.kanban/` first, then `kanban/`. `<kanban-dir>` throughout this file refers to whichever one resolves.

## Narrative Record (Required)

Treat cards as durable source material. Never rewrite or delete prior narrative unless asked. When updating a card, append a brief note to a `## Narrative` section at the end of the file (add the section if absent): reasons, discoveries, insights and decisions, not transactional status logs unless they matter to the story. Use ISO dates. Skip the note for a minor change (a typo) unless it carries insight. When a card moves to `done`, add enough detail that a future reader can understand its story and outcome, coherent and complete without being verbose.

Narrative entry format (scan-optimized):

```markdown
## Narrative
- 2026-02-05: **Shifted auth to WebAuthn.** Discovered the flow must support device-based MFA; `auth-plan.md` updated, unblocks `webapp#12 Device enrollment for the second factor`. (by @assistant)
```

Entry shape, in order:
- **Bold TL;DR first** — verb-first, ≤10 words, ends with a period. Readers scan, so the first words must carry "what happened." A genuinely trivial ping may skip the bold lead.
- **1–2 supporting sentences** after it — plain, objective, roughly half the words you'd naturally write.
- **Backtick every identifier** a reader must match verbatim (card ids, commit hashes, filenames, branch names); they never autolink in repo files, so the code font does real work.
- **Mention a card as one code span, `` `board#id title` ``** — the **Card mention** rule (GLOSSARY.md): qualifier, id and title verbatim in one span, so the reader sees where the title ends; a title with backticks of its own drops them (nested code does not render). Never drop the board qualifier, even on the card's own board; drop the title only on a repeat inside the same bullet (`` `board#id` ``); never paraphrase it. Nothing else takes a bare `#N`: pull requests are `PR #34 (repo)`, notifications are `notification 17`. The rule binds everything you write for a human: narrative bullets, notification `message` text, reports, digests, chat handoffs.
- **One event per bullet.** Two things happened = two bullets, even same author, same day; never fuse events into one run-on line.
- **No sub-bullets, no wrapped continuation lines** — the web renderer flattens nested bullets to siblings and a continuation line breaks the list. One flat `- ` line per entry.

The convention is forward-only: never rewrite old entries to match.

## Card Fields

Each card's frontmatter supports the following fields:

- `id` — an optional **prefix** (uppercase letters, optionally led by `_`) and a number: `656`, `G3`, `DW845`, `_12` (ADR 0014). The whole pair is the identity (`#7` and `#G7` are two cards): `waiting_for`, `parent` and every mention name all of it, and an id never changes once given. **A new card takes the prefix its type declares** in `config.yaml`'s `prefixes:` (`G: goal` makes a `goal` card `G1`, then `G2`); with no type, no prefix for its type or no `prefixes:` it takes a plain number, and changing its type later never changes its id. Each prefix has its own counter: `nextId` for plain numbers, the entry on the one `counters: { G: 3, O: 5 }` line for a prefix. To allocate, use `max(counter, scan-max + 1)`, where scan-max is the highest number among the cards with that prefix (plain numbers for `nextId`) in `<kanban-dir>` and `<kanban-dir>/archived/`, recursively (package folders count), and write the advanced counter back (it keeps ids unique across deletions and concurrent writers): replace its own line, or insert it below `nextId:`, change only that prefix's entry, and leave every other line, comment and unknown key as it was. With no counter, take scan-max + 1, starting at `1`. A `G40` never moves the plain counter, nor a plain `40` the `G` counter. Rescan in the same turn you create a card: the web app or another session may be writing concurrently. Reference cards by the whole id (`#G3`).
- `status` — the column. The official list is `config.yaml`'s `statuses` (ordered = column order); absent, the built-in `backlog`, `todo`, `doing`, `done`. Free text is legal on disk: an unlisted value renders in the list's **first** column (the catch-all) with its raw value shown and is **never rewritten**; promotion = the human adds it to the list. `archive` is a location, never a status or a list entry (the web shows it as a far-right column). The list orders every surface's columns (web, forms, gantt groups); `view_board.sh` honors it only in the inline form `statuses: [a, b]` (single-word statuses) and prints the default four for a block list.
- `priority` — one of the board's official `priorities` list in `config.yaml` (built-in default: `High`, `Normal`, `Low` — ordered highest first). Free text is allowed but sorts after all official values. Defaults to `Normal` if omitted.
- `waiting_for` — card ids this card depends on, whole ids (`[3, G7]`; zero padding is not part of the id, so `G0007` names `G7`). Replaces `blocked_by`, which no reader honors. **Derived at read time, never stored:** the card is *waiting* while any listed card is not `done`, and stops on its own when the last dependency lands; a listed id with no card (dangling) is **non-blocking**. A dependency is sequencing, not an impediment: don't call it "blocked". Omit when empty: an empty `[]` reads fine but is boilerplate the `kanban-web` app strips on its next managed write.
- `blocked` — (optional) manual impediment sticker, a human stop sign; the value is the **reason**, free text (`blocked: legal sign-off pending`). Blocked iff the trimmed value has ≥ 1 alphanumeric character; YAML `false`/`no` → not blocked, `true` → blocked, reason unspecified. Lean rule: omit the field when clear, never write `blocked: false`. **Agents never grab a blocked card, in any column**; clearing the sticker is the human's call.
- `review` — (optional) "finished — approve me" sticker, `blocked`'s sibling (ADR 0009); the value is the **text** saying what to check (`review: PR #6`). Same predicate and lean rule as `blocked` (≥ 1 alphanumeric character; `false`/`no` → absent, `true` → present, text unspecified; never write `review: false`). `blocked` is "stuck, act so I can proceed", `review` is "done, approve me": it overlays any status and does **NOT** gate `doing` entry. **Agents never grab a review-stickered card, in any column**; the human clears it on approval.
- `prompt` — (optional) a queued grooming instruction FROM a human TO the next AI that services the card: free text, always written **quoted** (the contract of `notifications.md`'s `message`; an embedded newline collapses to a space). Not a sticker: no presence predicate, no `doing`-gate role, and it never excludes the card from pickup. The card **body** stays the only work spec: servicing a prompt means formalizing or editing the card and clearing the field, never executing the prompt, and a prompt never makes a card autonomous (only the trusted body may pre-authorize `@afk`). Clear = remove the line.
- `assignee` — (optional) the owner. Prefer handles from the board's `assignees` registry (it suggests, never validates; free text is fine); its `kind` says how to treat the card (*Grab semantics* below).
- `start_date` — (optional) the working range's **from**: a date (`YYYY-MM-DD`) or local datetime (`YYYY-MM-DDTHH:MM`); alone = a 1-day range. Stamped on landing in `todo` (see Moving a Card).
- `end_date` — (optional) the range's **to**, same forms; alone = a 1-day range. Stamped on landing in `done`. Ordering is not validated: a reversed range is tolerated (date-aware views show a 1-day event at the range end). With `start_date` and `due_date` but no `end_date`, the range reads start→due.
- `due_date` — (optional) the **deadline**, same forms, independent of the range (date-aware views draw it as its own marker). Write the triad in `start_date`, `end_date`, `due_date` order.
- `tags` — (optional) List of labels.
- `updated` — (optional, machine-maintained) ISO local datetime, `YYYY-MM-DDTHH:MM:SS`, no timezone suffix (the shape of `notifications.md`'s `at`). The `kanban-web` app stamps it on creation and on every content write (edits, drag-driven status changes, bulk edits), not on archive/restore (they only move the file). When you edit frontmatter by hand, bump it too, so it stays meaningful whichever tool made the change. Read it from the clock at the moment of the write (`date '+%Y-%m-%dT%H:%M:%S'`): a stamp typed from memory drifts hours from the truth and breaks the order of the record.

Nesting is three more optional fields: `parent`, `type` and `rank`. Read `references/nesting.md` when the task sets or reads one of them or reorders sibling cards. Never write a list of children on a parent, nor a value a view works out (depth, altitude, outline order, thread, roll-up).

## Creating a Card

Create `<kanban-dir>/<0000-id>.<kebab-case-name>.card.md`: the card's `id` with its number zero-padded to the board's `idDigits` (4 unless `config.yaml` says otherwise), prefix first, so filenames sort by id (`0008.card-filename-id-prefix.card.md`, `G0003.ship-the-parser.card.md`). A number wider than `idDigits` gets no id prefix in its file name. The frontmatter `id` is the source of truth; the filename prefix is cosmetic, a file padded to another width still reads by its number, and scripts never parse identity from it. **Only `*.card.md` files are cards**; any other file (a generated `board.md` or `dashboard.html`, `README.md`, `CLAUDE.md`, `AGENTS.md`) is ignored by the board scripts, so meta files can sit alongside cards.

**Join the running groups.** When `config.yaml` has a `groups:` line, a new card joins every group running today with `auto_join: true`: right after its file exists, add its id to each such group's `cards:` line, and to no other group. The web does the same in the request that creates a card, so a hand-made card follows the same rule. Read `references/groups.md` ("Auto-join") for which groups are running and how to write the file.

If it fits, add a Job Story, "When [situation], I want to [motivation], so I can [expected outcome]." (do not force one), and share it with the requester to confirm.

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

Update the `status` field in frontmatter. Landing in `todo` stamps `start_date` and landing in `done` stamps `end_date`: today's local date (`YYYY-MM-DD`), only when the field is empty, never overwriting. The `kanban-web` app stamps on every status-changing path; stamp the same way by hand (same reason as the `updated` bump).

**Entry gate to the literal status `doing`:** before moving a card to `doing`, verify it is neither **waiting** (some `waiting_for` id names a card not `done`; dangling ids don't count) nor **blocked** (`blocked` holds a reason: ≥ 1 alphanumeric character, or YAML `true`). If either holds, refuse and name which: "waiting on `webapp#34 Session store migration`" / "blocked: <reason>". Entry only, no eviction: a card already in `doing` that gets blocked stays there. A `review` sticker does NOT gate entry (ADR 0009): a card may enter or stay in `doing` wearing one. The gate is pinned to the literal lowercase `doing`, custom `statuses` list or not (status values are case-sensitive: a column named `Doing` is just another custom column).

Cards with `status: done` may be moved into `<kanban-dir>/archived/` (create it under the board directory if absent) to keep the board tidy. That is a file move only; the card stays `status: done` unless explicitly changed. `archived/` is scanned recursively (ADR 0010): an archived card is any `*.card.md` under it. Restoring returns the card to `<kanban-dir>/`. Read `references/archive-packages.md` when you file a card into a package folder (`archived/<package>/`) or restore one from it.

## Board files that aren't cards

Besides the cards, two files in `<kanban-dir>/` are levers you are expected to use.

### `config.yaml` — board name, ids, and assignees

Read `references/config.md` when the task reads or writes a key beyond those named here: it holds a sample file, every key's contract, the starter script's cases and the `epic: true` migration.

**What an AI may write.** Never create `config.yaml` yourself and never invent a key; an absent file means the max + 1 id scan and freeform values. The exceptions:

- `name:` — the **board name**, the token that opens every card mention (one token, no whitespace, no `#`; the human's to declare and rename). The first AI to service a nameless board seeds it from the folder that holds the board's home and files a notification so the human can rename it. Write it on **line 1**, above any `assignees:` block (each assignee entry has its own indented `name:`). A `config.yaml` holding only `name:` and the starter (below) is allowed.
- `artifact:` — the Board artifact URL, written (with a notification) by the session that publishes the snapshot: `skills/snapshot/references/board-artifact.md`.
- `nextId:` and `counters:` — the id counters (see `id`).
- `port:` (pins kanban-web's serving port) is a named key too, but the human's: never invent or auto-write it; only a human, or a session told to set specific values, writes it.

Everything else (`hierarchy:`, `pills:`, `icon:`, `prefixes:`, `idDigits:`, `groups:`, `iterations:`, `logbook:`, `scratchpad:`, `todos:`, `vars:`, `typesOn:`) is a human's, or a session a human tells to; nothing that services the board invents it.

**Lists suggest, never validate.** `assignees`, `priorities`, `tags`, `types` and `statuses` are human-curated: prefer listed values when creating cards, free text stays legal, and only the human adds a value to a list. Never add to one on your own.

**A new board.** When you create a board's `config.yaml`, write `name:` on line 1 and the content of `starter-config.yaml` (next to this file) under it, as it is, comments included; the starter is a file the plugin ships, not a key you invent. Bring an existing board up to the starter only when a human asks, dry run first:

```bash
node <SCRIPTS_DIR>/apply-starter.js <kanban-dir>... --dry-run   # per board, the lines it would add; writes nothing
node <SCRIPTS_DIR>/apply-starter.js <kanban-dir>...             # adds them
```

**Grab semantics for AI writers:** an assignee handle's registered `kind` tells you how to treat the card:

- **`@human`** (`kind: human`) — a human owns it. Leave it alone: don't grab, move or close it.
- **`@hitl`** (`kind: ai-hitl`) — the AI may work it, but MUST route a human checkpoint before closing (grilling, spec review, ticket-writing, approval — whatever the card calls for). The handle exists to make the AI think twice, not to block it.
- **`@afk`** (`kind: ai-afk`) — fully autonomous; no human checkpoint required to close.

Only a handle whose registered `kind` is `human` / `ai-hitl` / `ai-afk` triggers this: `assignee` is free text, and an unrecognized handle (including handles predating the trio, which stay legal) has no special meaning. The trio is the canonical default on every board and surface (`@ai` is retired as ambiguous): with no `assignees` registry, every surface suggests exactly it (GLOSSARY.md, Role trio).

### `notifications.md` — messaging the human

Append an entry to `<kanban-dir>/notifications.md` (create if absent); the human sees it in the web app's bell and the snapshot's read-only notifications sheet. A YAML list, every field on its own single line:

```yaml
- id: 4
  at: 2026-07-12T09:15:00
  from: "agent:#131"
  level: info
  message: "`webapp#131 Retry budget for the ingest worker` closed; more: payload applied, 3 cards moved to done."
  read: false
```

- `id`: max existing + 1. `at`: local ISO datetime, no timezone, read from the clock as you write the entry (the `updated` command).
- `from`: the writer's handle (`agent:#131`, `skill:kanban-snapshot`); a machine handle, not prose, so it keeps its bare form.
- `level`: `debug` | `info` | `warning` | `error`; **absent = `info`**.
- `message`: one line; quote values containing `:` or `#`. **TLDR-first:** the text before `; more: ` is one plain sentence (no "TLDR" label) that renderers bold; the rest is detail. Without `; more: ` renderers bold only the first sentence, so write the separator. Card ids follow the **Card mention** rule (one code span, `` `board#id title` ``).
- `read`: always write `false`; the reader flips it.

**Discipline (this is a rule, not a suggestion):** every AI mutation of the board — create, move, edit, archive, delete, payload-apply — must be reconstructable from the tray. Write either **one entry per action** or **ONE grouped entry per coherent batch/turn** that enumerates what changed. Interactive sessions are not exempt: moves the user watched you make get an entry too (grouped is fine). Tie-breaker: **unsure → notify.** A spurious notification costs one click; a silent mutation costs a re-derivation.

Read `references/notifications.md` when the task reads, clears or repairs the tray: how levels render, what becomes of a malformed entry, and clearing (entries move to `archived/notifications.md`, never deleted).

### The notes kit and groups

Read `references/notes-kit.md` when the task writes a note, a scratchpad page or a todo list, or resolves the folder one lives in (the `<iteration>`, `<card>`, `<repo>` and `vars:` placeholders). Read `references/groups.md` when the task writes or edits a group file or allocates a group id.

## Scripts

Helper scripts are in the `scripts/` directory next to this SKILL.md (`<SCRIPTS_DIR>`; find it in the installed plugin, e.g. with `glob` for `**/kanban/scripts/view_board.sh`). Each takes the kanban directory first (default: the current directory): `bash <SCRIPTS_DIR>/<script> <kanban-dir> [args]`.

- `view_board.sh` — the board print: a `=== BOARD: <name> ===` header (`name:`, else the folder above the board directory), then cards by status column with priority and waiting (unresolved ids only), blocked (reason) and review (text) flags inline. The header carries the qualifier, so card lines stay `#id Title`; prose you write *about* a card follows the **Card mention** rule.
- `search_by_tag.sh <tag>` — cards with that tag (ID, status, title). `search_content.sh "<term>"` — cards matching the term, with context lines.
- `show_blocked.sh`, `show_review.sh` — cards whose `blocked` or `review` sticker passes its predicate, reason or text inline. `show_waiting.sh` — **waiting** cards (some `waiting_for` id not `done`) with the unresolved ids.
- `list_tags.sh` — all tags, most used first. `list_all_cards.sh` — all cards as `id|status|waiting_for|blocked|title`, sorted by id (plain numbers first, then each prefix by its number: `9`, `10`, `G3`, `G10`), for parsing or export.
- `eligible_cards.sh [assignee]` — what an agent can pick up now: `todo` cards (literal status) that are not waiting, blocked or review-stickered, as `id|priority|assignee|title`; `assignee` filters (`@afk` matches `assignee: "@afk"`).
- `migrate_card_names.sh [--apply]` — renames a board's card files to the prefixed `<0000-id>.<slug>.card.md` form at the board's `idDigits` width (dry run unless `--apply`). Older boards may hold unprefixed names, which every reader treats identically.

Each script's header comment gives its exact rules.

## Human surfaces

This skill is the **AI's** lever set. When the human wants to see or work the board themselves, point them to (or launch) **kanban-web** (live browser editor, desktop/localhost) or **kanban-snapshot** (single-file HTML board for phone, tablet and Cowork; read-only, its queued changes come back as an "Apply kanban changes" payload) instead of narrating files. With no browser and no way to open a file, print the board with `view_board.sh` and take the human's edits conversationally.
