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
The short name that qualifies a card mention: the `name:` value in the board's `config.yaml`, one token with no whitespace and no `#`. Declared by the human once, never derived at read time, and shown identically on every surface (web heading and tab, snapshot title, kanban-afk's `<board>` in prose and in the `(board #id)` commit tag). A board without a name cannot be mentioned across boards; the first AI to service it seeds one from the folder that holds the board's home and notifies the human, who may rename it.
_Avoid_: project name, repo name, parent folder (they usually coincide; the rule is the declared value).

**Card**:
One work item, stored as a single `<0000-id>.<slug>.card.md` file (frontmatter + Markdown body; the padded id prefix (the number padded to `idDigits`, 4 by default) makes files sort by card id — the frontmatter `id` stays the source of truth, and unprefixed legacy names still work). The card file is the unit of identity, source of truth, and persistence.
_Avoid_: task, ticket, item, issue.

**Card mention**:
How a card is referred to in prose written for a human: one code span holding the board qualifier, the id (its prefix included, `board#G3`) and the card's title verbatim — `` `board#id title` `` — every time. A group is mentioned the same way, with its name in place of a title. The span draws the boundary: a reader sees where the title ends and the sentence resumes. Inside the span the title drops any backticks of its own (nested code does not render); its words never change. The title may be dropped only on a repeat within the same paragraph or bullet, leaving `` `board#id` ``; the board qualifier is never dropped, even on the card's own board. Nothing else is written as a bare `#N`: pull requests are `PR #34 (repo)`, notifications are `notification 17`. The title is never paraphrased in place of itself.
_Avoid_: the title outside the span (`` `board#id` `` Title), bare `#N`, a paraphrase where the title belongs, `#N` for anything that is not a card.

**Title**:
The card's H1, the only stored name, and what a mention carries. It must identify the card out of context: a noun phrase of roughly seventy characters or fewer; an `area:` prefix is allowed but the remainder must stand alone. An AI that services a card may retitle it to meet this bar; done and archived cards keep their titles. The filename slug never follows a retitle.
_Avoid_: a prompt as a title, a verb-only fragment ("fix", "follow-up"), a second short-title or identifier field.

**Narrative Entry Shape**:
The scan-optimized format for every bullet in a card's `## Narrative` section: a **bold, verb-first TL;DR** (≤10 words, ends with a period), 1–2 plain supporting sentences, every identifier backticked (card ids, commits, filenames, branches), one event per bullet, and no sub-bullets or wrapped continuation lines. Card ids inside a bullet follow the **Card mention** rule. It exists because readers scan rather than read, and the web renderer flattens nested bullets to siblings and breaks on continuation lines — the shape is a rendering constraint, not just a style preference. Entries are forward-only: never rewritten to match. Full rules in `skills/kanban/SKILL.md`'s "Narrative Record" section.
_Avoid_: fusing multiple events into one bullet, sub-bullets or nested lists, rewriting old entries to the new shape.

**Status** (a.k.a. **Column**):
A card's place in the workflow. The four built-ins — `backlog`, `todo`, `doing`, `done` — are the **default** live columns; a board may configure its own list via `config.yaml`'s `statuses` (ordered = column order), and that list then IS the live column set everywhere (web columns and drag targets, the `kanban` skill's board print (view_board.sh honors the inline `[a, b]` form only; a block-form list falls back to the default four there), form options, gantt group order). "Status" is the frontmatter field; "column" is how that status renders on the board. A status value not in the list stays legal on disk — it renders in the list's **first** column with its raw value shown, and is never rewritten; promotion = the human adds it to the list. The `doing` entry gate (waiting + blocked) is pinned to the literal status `doing` regardless of the list. `archive` is **not** a status and never a list entry. The four built-ins carry distinct intents: `backlog` = shelved for later / someday (far queue); `todo` = ready, or paused for soon-ish resumption (near queue); `doing` = actively owned — a live AFK worker, or a human working or holding it; `done` = truly finished and approved (not merely PR-opened). `review` and `blocked` are **stickers, not columns** (below): a card keeps its real status and wears them as overlays, so "in `doing` and awaiting your review" is expressible.
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
A card is waiting while any card listed in its `waiting_for` is not `done`. Derived at read time, never stored; a listed id with no matching card (dangling) does not count. A waiting card cannot enter the literal status `doing` — enforced, not advisory ("waiting on #34") — and stops reading as waiting the moment its last dep lands. A dependency is sequencing, not an impediment. Surfaced by the bare `waiting:` search term and the built-in pill of the same name.
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

**Snapshot** (skill `kanban-snapshot`):
The human's tap surface — a generated single-file HTML board that works where web can't reach (phone, tablet, Cowork). Changes don't touch disk: they queue in a tray and come back as an "Apply kanban changes" payload that Claude applies under the `kanban` skill's write contracts.
_Avoid_: remote, editor (it renders and queues; Claude writes).

**Board artifact** (delivery of the **Snapshot**):
The Snapshot published as a hosted page at one stable URL: exactly one per board, refreshed in place by whichever session next builds the Snapshot, never a new page per session or per request. Each refresh is stamped with its own base moment; earlier refreshes stay in the page's version history. It is board-keyed, not session-keyed: the URL is recorded on the board itself (`config.yaml`), seeded by the session that first publishes and announced by notification, the same way a board name is seeded. Not a surface: it is the Snapshot, delivered where the harness can host a page.
_Avoid_: "the artifact" unqualified, snapshot artifact, session artifact, a page per session.

**Base**:
The moment a Snapshot build embeds: the base timestamp shown in the page header and carried in every change payload, so Claude can tell whether the board moved after the human looked at it. A Board artifact refresh replaces one base with a newer one; earlier bases remain as the page history.
_Avoid_: version (that is the page history), snapshot (that is the surface, not the moment), timestamp unqualified.

## Nesting

**Parent** (via **parent**):
The one card a card sits under, on the same board or on another board (named as `board#id`). Any card may be a parent, whatever its type; being a parent is only the fact that other cards point up at it. Nesting is not sequencing: a parent never makes its children waiting.
_Avoid_: epic membership, container, group.

**Child**:
A card whose `parent` names another card. A card's children are found by reading who points up at it; a parent never lists its children.
_Avoid_: member, subtask (as a field or kind).

**Root**:
A card with no parent. A loose card and the top of a tall tree are both roots.
_Avoid_: top-level card, orphan.

**Card type** (via **type**):
What a card is (goal, strategy, objective, epic, story, ...), usually a word from the board's own suggested list, though any word reads. The kanban renders the word and, if the board's config gives them, its color and icon; beyond the board's **hierarchy**, which only orders how types are drawn, it attaches no meaning to it. Rules about types belong to whoever uses the board.
_Avoid_: category, class, kind; tier (a type's place in the hierarchy); epic flag (retired).

**Hierarchy** (via **hierarchy:**):
The types a board declares as the levels of its plan, top first (goal, strategy, objective, epic). Other types stay ordinary types. The kanban draws and slices by it and enforces nothing: any card may sit under any parent, whatever the two types.
_Avoid_: ladder, cascade, type order (the `types:` list has none).

**Tier**:
A card's place in the hierarchy, read from its type: the first type listed is tier 1. A card whose type is not in the hierarchy, or that has no type, has no tier. Never stored, never checked against nesting.
_Avoid_: level, rung, band (how the Graph draws a tier), altitude (that counts layers below).

**Slice** (derived):
One place on a board's single top-to-bottom axis: each tier of the hierarchy in order, then each depth for the cards without a tier. Every card is in exactly one slice, so an epic and a plain card at depth 0 are in different slices once epic is in the hierarchy. On a board with no hierarchy the slices are the depths. A view can be cut to a run of slices.
_Avoid_: rung, layer, band, cut.

**Rank** (via **rank**):
Where a card sits among its siblings, as a number stepped by 10 so a card can be slotted between two others without renumbering. Separate from priority: priority is how much a card matters, rank is where it sits in the list.
_Avoid_: order (as a field), position, sort key, priority.

**Depth** (derived):
How many parents sit above a card: a root is 0. Worked out at read time, never stored.
_Avoid_: level number, nesting number (as a stored field).

**Altitude** (derived):
How many layers of cards sit below a card: a card with no children is 0. Blind to type, so a story with sub-steps and an epic with stories both stand at 1. Worked out at read time, never stored.
_Avoid_: tier (a type's place in the hierarchy), height, weight, nesting number.

**Leaf**:
A card with no children: the actual work under a parent.
_Avoid_: task (as a kind), bottom card.

**Roll-up** (derived):
The status count of the leaves below a card, archived leaves counting as done, over the boards it could read, which it names. It informs; it never sets the parent's status, which stays the human's call.
_Avoid_: progress (as a stored value), completion, percent done.

**Thread** (derived):
The chain of parents from a card up to its root, crossing boards where a parent is named as `board#id`.
_Avoid_: breadcrumb, lineage, dependency chain (that follows waiting_for).

**Board set** (via **boards:**):
The boards a board declares it can see, always including itself. Threads and roll-ups follow each board's own set one hop at a time, so a board three levels down is reached through the boards between.
_Avoid_: multi (retired proposal), linked boards, federation.

**Private board** (via **private: true**):
A board that declares itself private in its own config. Its cards never leave the desk: a published surface leaves them out of every roll-up and thread and never names the board.
_Avoid_: hidden board, secret board.

**Outline order** (derived):
Cards sorted by their chain of ranks from the root down, so a parent comes before its children and siblings follow their rank; unranked siblings come after ranked ones, by priority then id.
_Avoid_: absolute order (as a stored number), decimal order, sort index.

**Dependency** (via **waiting_for**):
One `waiting_for` edge: this card waits for that one. Separate from nesting.
_Avoid_: depends_on (as a field), blocker, link.

**Dependency chain**:
A run of dependencies, each card waiting for the next. Cards whose dependencies branch and rejoin are one chain too.
_Avoid_: critical path (unless it is the longest chain), thread (that is the parent chain), web.

**Relation**:
A dependency or a parent link between two cards, the two things the Map joins. A card with no dependency, no parent and no children has no relation.
_Avoid_: edge, connection.

**Tree** (derived):
Every card that a chain of relations joins, whichever way each points and whether or not a line is drawn for it. The Map draws one graph per tree; the `tree:` search term finds nearly the same set but can differ at the edges (siblings joined only through their parent or through a parent on another board). Wider than a parent's children, and not a thread.
_Avoid_: component, cluster, web.

**Chain end** (derived):
Of one parent's children, a child where a chain of its siblings meets the parent: with the parent below, a child no sibling waits for; with the parent above, a child that waits for no sibling. A child with no dependency to or from a sibling is a chain of one and an end both ways. The Map draws a line to the chain ends by default.
_Avoid_: terminal, leaf (that is a card with no children).

**Graph view** (web only):
The view that draws every card at once as a dot, joined by its relations, in one of three layouts: tiers (the default), force or status. The tiers layout, the tier fan, goes all the way round its centre and gives each tier its own band, tier 1 innermost, then rings the cards without a tier by depth; the unnested cards with no tier sit on a ring of their own outside the rest, unless the layout's option row puts them on the depth 0 ring or in a block, or leaves them out. Not the Map's "graph": the Map draws one graph per tree, under a heading, while the Graph view puts every card on one canvas. A card with no parent and no children is **unnested**.
_Avoid_: network, node-link diagram, the Map (that is a different view).

**Unnested**:
A card with no parent and no children. It may still wait for a card or be waited for.
_Avoid_: orphan, isolated (that is what an isolate does to a view).

## Ids, groups and the logbook

**Id**:
What a card or a group is called: an optional prefix and a number, `656`, `G3`, `_12`. The whole pair is the identity, so `#7` and `#G7` are two things, and it never changes once given. Written `#G3` in prose, `fpp#G3` with its board.
_Avoid_: number (alone), key, ticket number.

**Prefix** (via **prefixes:**):
The letters before an id's number, each with a counter of its own, declared by the board for a card type or a group folder and taken when the card or group is created. `_` is the prefix of a group whose folder declares none. Suggested, never required.
_Avoid_: code, tag, type letter (a prefix does not follow a later type change).

**Group**:
A named set of cards kept in a file of its own, which lists its members; its type and subtype are the folders it sits in, and it may have neither. The cards never know their groups.
_Avoid_: package (an archive folder), parent (nesting), collection, set, sprint.

**Member**:
A card a group lists. A card may be a member of any number of groups, and only cards are members.
_Avoid_: child (that is nesting), item.

**Running** (derived):
A group with dates is running from its start to its end, both days included.
_Avoid_: active, current, open.

**Auto-join** (via **auto_join**):
A group's choice to take every card created while it is running. The join is written into the group when the card is made, so it can be taken back.
_Avoid_: auto-membership, default group.

**Iteration**:
A group in the board's iteration folder: a stretch of work between two dates, usually auto-joining. The only group the web gives a picker; otherwise an ordinary group.
_Avoid_: sprint, cycle, timebox.

**Logbook** (via **logbook:**):
The board's folder of notes, kept as one file per target per day, so a day's or a target's notes are found by file name alone.
_Avoid_: journal, log, diary.

**Note**:
One entry in the logbook: a line of text written at a moment of a day (or untimed), about a card, a group or nothing, signed by its author, human or AI. Kept out of the card, unlike a narrative entry.
_Avoid_: log entry, logbook entry, comment, narrative entry (that lives in the card), notification (that is addressed to the human).

**Target**:
What a note or a scratchpad is about: one card, one group, or nothing.
_Avoid_: subject, owner, link.

**Scratchpad** (via **scratchpad:**):
A disposable working page for one card or group, free text that may point at notes, files and folders. The kanban never throws it away on its own.
_Avoid_: scratchbook, notes, draft.

## Selecting and isolating

**Selection**:
The cards picked right now, the same set in every view: lit in the Graph, marked elsewhere. It grows from an anchor by additions, survives view switches, and is what bulk edits act on.
_Avoid_: highlight, lit set, focus.

**Anchor**:
What a selection grows from: one card, or one query (a pill or the search box). Stepping back drops the additions first, then the anchor.
_Avoid_: primary, focus card.

**Pill** (via **pills:**):
A search query offered as one click: blocked, review and waiting are built in, and a board adds its own in `pills:`. A pill follows the status pills' rules: a click turns one on or off, a right-click keeps only that one, and the first one on is the anchor of the selection while later ones are additions.
_Avoid_: light pill, filter button, chip.

**Phone layout**:
The Web's layout below 760 px wide, one width line shared by every width-gated rule: a one-row header, the view bar at the bottom, status tabs on the Board, full-screen cards and forms. From 760 px it is the desktop layout; crossing the line either way switches with no reload.
_Avoid_: mobile site, responsive mode.

**Status tabs**:
The strip across the top of the phone Board, one tab per status (Archive last) with its colour and count; the Board shows the one status chosen, and a tap or a sideways swipe changes it. They replace the column headers on a phone.
_Avoid_: column tabs, swimlanes.

**View bar**:
The bottom bar of the phone layout listing Board, Calendar, Gantt, Map and Graph; a tap goes straight to that view. It stands in for the header's view buttons.
_Avoid_: tab bar, nav bar.

**Bottom sheet**:
The Graph's and the Map's option panel on a phone, a bottom sheet: it opens over the lower part of the view, no taller than about half of it, with no dimming behind it.
_Avoid_: drawer, modal.

**Span cycle button**:
The one button that stands in for the Calendar's and the Gantt's span switch on a phone: it shows the current span, and each tap moves to the next and wraps.
_Avoid_: span dropdown.

**Header date**:
The date range of the Calendar or the Gantt, shown in the phone header beside the board's name.
_Avoid_: title date.

**Status pill**:
One status's switch, in the search panel's Statuses section (the **Statuses section**, at every width): on shows that status's cards, off hides them, and soloing keeps that status alone. No view holds a row of them. It still belongs to its view (each view keeps its own set) and never touches the selection.
_Avoid_: pill (alone), filter chip.

**Isolate**:
Showing only the selection, in every view, kept as a query in the search box that names each part by its criterion, so the address carries it.
_Avoid_: solo (a view's status pills), focus, filter.

**Peek**:
Opening a card's details without changing the selection.
_Avoid_: preview, open (a plain open may replace the selection).

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

Three skills, one board:

| Surface | For | Medium |
| --- | --- | --- |
| `kanban` | the AI | file contracts + scripts; also defines `config.yaml` and `notifications.md` and when the AI must notify |
| `kanban-web` | the human, desktop | live browser editor |
| `kanban-snapshot` | the human, phone/tablet/Cowork | generated single-file HTML, edits queue as a change payload |

**Parity rule:** every surface writes under the *same board contracts* — the
hard `doing` entry gate (waiting + blocked), archive-as-location, id
allocation, `config.yaml`'s suggest-never-validate lists — defined once, in
the `kanban` skill. Web carries the full operation set (CRUD, multi-select
bulk actions with per-card skips, speedbumps on every destructive action,
notifications inbox, dependency/gantt/calendar/graph views); the snapshot carries
the same board contracts through a tap UI whose changes Claude applies, and
names its own deliberate gaps in `skills/snapshot/SKILL.md`'s "What the
editor deliberately does not do". A feature added to one editor lands in the
other (or gets a line in that surface's own skill doc saying why not).
Retired skills are deleted outright.
The Graph view is web-only: the snapshot does not draw it.
The selection, Isolate and Peek are web-only too, since the snapshot has no selection to
isolate; the search grammar, the slices and the pills are shared, the snapshot running the
web's own search module and drawing the same panel, where a pill filters.
Web's `tree:<id>`/`path:<id>` dependency-focus search terms are mirrored in
the snapshot as `tree:`/`path:` search terms plus card-sheet "Dependency
tree"/"Dependency path" tap actions.
