# kanban

A plugin for managing a kanban board stored as Markdown files. The board has no
database: a directory of `*.card.md` files **is** the board, and the file on disk
is the single source of truth. This glossary fixes the language every skill in the
plugin must use.

## Language

**Board**:
The whole kanban — every `*.card.md` file in a board directory (`.kanban/`, the preferred convention; `kanban/` is a supported legacy fallback — discovery order: `.kanban/` first, then `kanban/`), grouped by status. There is no board file; the board is derived by reading the cards.
_Avoid_: project, list.

**Board name**:
The short name that qualifies a card mention: the `name:` value in the board's `config.yaml`, one token with no whitespace and no `#`. Declared by the human once, never derived at read time, and shown identically on every surface (web heading and tab, cli board header, viewer title, kanban-afk's `<board>` in prose and in the `(board #id)` commit tag). A board without a name cannot be mentioned across boards; the first AI to service it seeds one from the folder that holds the board's home and notifies the human, who may rename it.
_Avoid_: project name, repo name, parent folder (they usually coincide; the rule is the declared value).

**Card**:
One work item, stored as a single `<0000-id>.<slug>.card.md` file (frontmatter + Markdown body; the 4-digit-padded id prefix makes files sort by card id — the frontmatter `id` stays the source of truth, and unprefixed legacy names still work). The card file is the unit of identity, source of truth, and persistence.
_Avoid_: task, ticket, item, issue.

**Card mention**:
How a card is referred to in prose written for a human: `` `board#id` `` followed by the card's title verbatim, every time. The title may be dropped only on a repeat within the same paragraph or bullet; the board qualifier is never dropped, even on the card's own board. Nothing else is written as a bare `#N`: pull requests are `PR #34 (repo)`, notifications are `notification 17`. The title is never paraphrased in place of itself.
_Avoid_: bare `#N`, a paraphrase where the title belongs, `#N` for anything that is not a card.

**Title**:
The card's H1, the only stored name, and what a mention carries. It must identify the card out of context: a noun phrase of roughly seventy characters or fewer; an `area:` prefix is allowed but the remainder must stand alone. An AI that services a card may retitle it to meet this bar; done and archived cards keep their titles. The filename slug never follows a retitle.
_Avoid_: a prompt as a title, a verb-only fragment ("fix", "follow-up"), a second short-title or identifier field.

**Narrative Entry Shape**:
The scan-optimized format for every bullet in a card's `## Narrative` section: a **bold, verb-first TL;DR** (≤10 words, ends with a period), 1–2 plain supporting sentences, every identifier backticked (card ids, commits, filenames, branches), one event per bullet, and no sub-bullets or wrapped continuation lines. Card ids inside a bullet follow the **Card mention** rule. It exists because readers scan rather than read, and the web renderer flattens nested bullets to siblings and breaks on continuation lines — the shape is a rendering constraint, not just a style preference. Entries are forward-only: never rewritten to match. Full rules in `skills/kanban/SKILL.md`'s "Narrative Record" section.
_Avoid_: fusing multiple events into one bullet, sub-bullets or nested lists, rewriting old entries to the new shape.

**Status** (a.k.a. **Column**):
A card's place in the workflow. The four built-ins — `backlog`, `todo`, `doing`, `done` — are the **default** live columns; a board may configure its own list via `config.yaml`'s `statuses` (ordered = column order), and that list then IS the live column set everywhere (web columns and drag targets, cli board print (view_board.sh honors the inline `[a, b]` form only; a block-form list falls back to the default four there), form options, gantt group order). "Status" is the frontmatter field; "column" is how that status renders on the board. A status value not in the list stays legal on disk — it renders in the list's **first** column with its raw value shown, and is never rewritten; promotion = the human adds it to the list. The `doing` entry gate (waiting + blocked) is pinned to the literal status `doing` regardless of the list. `archive` is **not** a status and never a list entry. The four built-ins carry distinct intents: `backlog` = shelved for later / someday (far queue); `todo` = ready, or paused for soon-ish resumption (near queue); `doing` = actively owned — a live AFK worker, or a human working or holding it; `done` = truly finished and approved (not merely PR-opened). `review` and `blocked` are **stickers, not columns** (below): a card keeps its real status and wears them as overlays, so "in `doing` and awaiting your review" is expressible.
_Avoid_: stage, state, lane, swimlane.

**Archive**:
A *location*, not a status — the board directory's `archived/` folder, read **recursively**. Archiving a card moves its file there, out of the active board, leaving its `status` untouched (almost always `done`). Restoring moves the file back. The web app's Archive *column* has full UI parity (drag in/out, selection) — presentation only; on disk archive is still the folder, never a status value.
_Avoid_: using "archive" as a status/column value; close, trash.

**Package** (archive package):
An optional `kanban/archived/<package>/` folder grouping a batch of archived cards — a second axis of the archive *location*, never a status, a tag, or a board of its own. The name is free text kept verbatim, one plain path component. A card inside one is archived exactly like one at the `archived/` root: same views, same id allocation, same dependency resolution, and Restore returns it to `kanban/`, not to the package. `archived/notifications.md` is never packaged.
_Avoid_: folder-as-status, sub-board, bucket, category.

**Delete**:
Permanent removal of a card's file. Distinct from Archive, which is recoverable. Delete is the only destructive, non-recoverable operation.
_Avoid_: remove, archive (for the destructive sense).

**Waiting** (derived, via **waiting_for**):
A card is waiting while any card listed in its `waiting_for` is not `done`. Derived at read time, never stored; a listed id with no matching card (dangling) does not count. A waiting card cannot enter the literal status `doing` — enforced, not advisory ("waiting on #34") — and stops reading as waiting the moment its last dep lands. A dependency is sequencing, not an impediment.
_Avoid_: blocked (that's the sticker below), blocked_by (retired field name), gated.

**Blocked** (manual, via **blocked**):
A human-placed impediment sticker whose value is the reason: `blocked: <text>`. A card is blocked iff the trimmed value contains ≥ 1 alphanumeric character; YAML boolean special-case: `false`/`no` → not blocked, `true` → blocked with reason unspecified. Omit the field entirely when clear (lean rule). A blocked card cannot enter `doing` ("blocked: <reason>"), and agents never grab it in any column; blocking a card already in `doing` does not evict it. The impediment may be a human decision, not only an external one: `blocked: waiting on your call about the schema` is the "stuck until you act" counterpart to `review`'s "finished, approve me" — the AFK dispatcher sets it when a card needs your input to proceed. External impediment and awaited decision mean the same thing: your action is needed before work resumes.
_Avoid_: waiting, dependency, blocked_by, review (that's "done, approve me"; blocked is "stuck, act so I can proceed").

**Review** (manual or dispatcher, via **review**):
A "finished — approve me" sticker: `review: <text>`, the text saying what to check. Overlays any status exactly like `blocked` — a sticker, never a column. Present iff the trimmed value contains ≥ 1 alphanumeric character (same predicate as `blocked`). A PR-shaped value (`review: PR #6`) is polled by the AFK dispatcher each tick (merged → clear it + card `done`; changes-requested → re-work); free text (`review: read the design doc`) is cleared by the human on approval. Agents skip a review card, and the corpse-sweep reads it as a human hold, not a dead worker. Surfaced by `review:` search (present) / `review:PR` (substring) and click-to-filter on the pill.
_Avoid_: column, lane (it is a sticker, not a status); approved, done (a review card is not done yet).

**Web** (skill `kanban-web`):
The human's live editor — localhost Node server + browser SPA, desktop only. "App" and "dashboard" in older writing both refer to this skill (the static `kanban-dashboard` skill is deleted).
_Avoid_: app, dashboard (in new writing).

**CLI** (skill `kanban-cli`):
The human's conversational editor — Claude-driven printed board + typed actions, works under remote control on mobile. Full CRUD; write contracts are defined once, in the `kanban` skill.
_Avoid_: browse, TUI.

**Viewer** (skill `kanban-viewer`):
The human's tap surface — a generated single-file HTML board that works where web can't reach (phone, tablet, Cowork). Changes don't touch disk: they queue in a tray and come back as an "Apply kanban changes" payload that Claude applies under the `kanban` skill's write contracts.
_Avoid_: remote, editor (it renders and queues; Claude writes).

## Role trio

The canonical assignee tiers on every board and surface — this is the ONE
write-up in this repo; every skill points here:

- **`@human`** (`kind: human`): human-owned; AI never grabs, moves, or closes it.
- **`@hitl`** (`kind: ai-hitl`): AI may work it, but a human checkpoint gates the close (grilling/spec/approval).
- **`@afk`** (`kind: ai-afk`): AI executes fully autonomously; completion announced via notifications.

`@ai` is retired as ambiguous. Registries suggest, never validate — free text
stays legal. When a board's `config.yaml` has NO `assignees` registry, every
surface suggests exactly this trio as its default.

## Surfaces and parity

Four skills, one board:

| Surface | For | Medium |
| --- | --- | --- |
| `kanban` | the AI | file contracts + scripts; also defines `config.yaml` and `notifications.md` and when the AI must notify |
| `kanban-web` | the human, desktop | live browser editor |
| `kanban-cli` | the human, anywhere | printed board + `AskUserQuestion` |
| `kanban-viewer` | the human, phone/tablet/Cowork | generated single-file HTML, edits queue as a change payload |

**Parity rule:** web and cli implement the *same operations under the same rules*
(CRUD, hard `doing` entry gate (waiting + blocked), bulk actions with per-card skips, speedbumps on every
destructive action, notifications inbox, dependency view, assignee/priority/tag
suggestions from `config.yaml`'s official lists).
Deliberately unmirrored in cli (medium mismatch): the calendar, gantt, and map
views (a printed board has no continuous surfaces; ask cli for dated-card lists
instead), the date-picker popover (cli input is already free text), drag & drop, collapse state,
`localStorage` persistence, per-column persisted sort, the SVG map, the 5s poll,
search-as-you-type, the header copy-board-path button (a browser needs a
clipboard affordance; a terminal transcript is already selectable text, and cli
prints the board path on request), popup fullscreen and its Alt+Enter hotkey
(a printed board has no popups or keyboard chords), the Ctrl+S/Cmd+S
save-the-open-popup hotkey (same no-popups-no-chords reasoning), and the
Ctrl+F/Cmd+F search-focus hotkey (a printed board has no search box for a
chord to focus). A feature added to one editor lands in the other (or gets a
line in this table saying why not). Retired skills are deleted outright.
Web's `tree:<id>`/`path:<id>` dependency-focus search terms are mirrored in
cli as scoped "Dependencies tree/path for #id" Mermaid views and in the viewer
as `tree:`/`path:` search terms plus card-sheet "Dependency tree"/"Dependency
path" tap actions; the context-menu sugar has no cli equivalent (no search box
to write a term into).
