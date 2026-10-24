The `config.yaml` contract in full: a sample file, each key, the starter and what `apply-starter.js` does with it, and the `epic: true` migration. What an AI may write is in SKILL.md.

## A sample

```yaml
name: webapp      # the BOARD NAME opening every card mention (`webapp#29 Card title`)
artifact: https://claude.ai/code/artifact/<id>   # the board's Board artifact URL; seeded by the first session that publishes the snapshot (see the kanban-snapshot skill)
port: 7781        # pins kanban-web's serving port; human-set (never AI-invented) — see the kanban-web skill
nextId: 29        # monotonic id counter — use max(nextId, scan-max + 1), then write the advanced counter back
idDigits: 4       # the width an id's number is padded to in a file name (default 4)
prefixes:         # a prefix for a card type: a new card of that type takes it, for life
  G: goal         # a value that names a groups folder is a folder, not a type
  O: objective
  _: .groups      # a group with no type is `_`; the groups: folder itself is the root
  I: .groups/iteration   # a group in iteration/ is I1, I2...
counters: { G: 3, O: 5, I: 2 }   # one line, one counter per prefix: the next number of each
groups: .groups   # the folder of the board's groups; absent = no groups (a human writes it)
iterations: true  # the web's iteration dropdown; needs groups; absent = off (a human writes it)
vars:             # names for the logbook:, scratchpad: and todos: paths, used as <cortex> below; a human writes it
  cortex: <repo>/.cortex
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
types:                            # suggested card types; a color and an icon are optional
  - name: objective
    color: "#a371f7"
    icon: diamond                 # circle | square | diamond | triangle | hexagon | star
  - story                         # a bare entry is a name with no color
hierarchy: [goal, strategy, objective, epic]   # the types that are the levels of the plan, top first
pills:                            # one-click search queries, in block form
  - next: 'tags:"next-up"'        # a label, then its query
  - "assignee:@human"             # a query on its own is its own label
  - "tags:*"                      # one pill per tag on the board, sorted
```

## The keys

**`name` — the board name.** The short token that opens a card mention
(`` `board#id title` ``), read by every surface for its heading, tab title, board
header and page title. One token, no whitespace, no `#`. It is the human's to
declare and to rename, and it is **never derived at read time**: a surface
reading a board with no `name:` falls back to the folder above the board
directory, and that fallback is a display default, not a name — a board without
a declared name cannot be mentioned across boards.

**`artifact` — the Board artifact URL.** It holds the board's **Board artifact** URL (GLOSSARY.md) — the one hosted page a session publishes the snapshot to, refreshed in place rather than re-minted. Three cases all write the line and file a notification: adopting an existing gallery page (no line yet, a title match found one), creating a fresh page (no line, no match), and recreating after the old page is gone (line present, a publish by that URL fails). A human may delete the line at any time to force the next session to publish a fresh page. Full procedure: `skills/snapshot/references/board-artifact.md`.

**`port` — kanban-web's serving port.** It **pins** the port (`skills/web/scripts/server.js` reads it once at startup) so a bookmarked or tunneled URL never drifts across launches; precedence and the busy-pinned-port error live in the kanban-web skill. Same top-level-only rule as `name:`: an assignee's own indented fields never collide with it. It has **no AI-autonomous seed trigger**: a port number can't be safely derived (it has to match a bookmark or VS Code tunnel URL the human already owns outside the board), so an AI never invents or auto-writes a value for it; only a human, or a session explicitly directed to set specific values, writes the line. The `kanban-snapshot` skill ignores the key entirely: it is a serving fact for kanban-web, not board content it renders.

**The starter config.** `starter-config.yaml`, next to `SKILL.md`, is the one
source of what a board begins with, and its comments say what each line is and
that every line can be changed or deleted. It holds the plan `types` `goal`,
`strategy`, `objective`, `epic`, `story`, `task` and `bug` (a colour and an
icon each, except `task`, which has an icon only, and `bug`, which is bare),
the `hierarchy` `[goal, strategy, objective, epic]`, and the `prefixes`
`G: goal`, `S: strategy`, `O: objective`, `_: .groups`, `I: .groups/iteration`,
`W: .groups/workflow` and `DW: .groups/workflow/dynamic`. A card made before a
prefix is declared keeps its plain number. It also holds the board's kit, five
lines that turn features on: `logbook: <kanban>/.logbook/<iteration>/<card>/`,
`scratchpad: <kanban>/.scratchpad/<iteration>/<card>/`,
`todos: <kanban>/.todo/<iteration>/<card>/`, `groups: .groups` and
`iterations: true`, and the `vars:` block they name, `kanban: .` (the board's
own folder), so each card or group keeps its notes, page and list in a folder
of its own, inside its iteration's folder when one applies. The starter writes
the logbook, scratchpad, todo lists, groups and iterations lines for a new
board, and the script below adds the missing ones to an existing board when a
human asks; an AI servicing a board never invents them otherwise. A board turns
one off by deleting its line, or from the web's gear sheet (This board).

**Bringing an existing board up to the starter.** Only when a human asks, dry run first (the two commands are in SKILL.md). `scripts/apply-starter.js` adds only what a board lacks and changes no value the board has; its header lists each case: the types (a bare entry such as `- epic` becomes a block entry that keeps its name when the starter gives it a color or icon), `hierarchy:` (a different one is reported, never changed), `prefixes:` (a prefix that means something else is reported), the five kit keys (a commented-out line is not the key; `logbook: notes` and `iterations: false` stay) and the `kanban` variable. It keeps every other byte and the file's line ending, creates `config.yaml` from the starter when a board has none, and takes several board directories in one run, one summary line each.

**`types` — the card-type list.** Entries give a `type:` word a chip color and, optionally, an icon (see `icon` below); they suggest, they never validate, and a card may carry any `type:` text. Accepted forms: a block entry `- name: objective` with an optional indented `color:` (a hex like `"#a371f7"` or a color name, kept as an opaque string), a bare entry `- story` (name only), or an inline `types: [objective, story]`. Entries keep the order written, an entry with no name is skipped, and a type the list does not name (or names without a color) shows a neutral chip. Like `tags`, the list is human-curated: never add to it on your own.

**`hierarchy` — the levels of the plan.** An ordered list of type names, top level first, in the inline form `hierarchy: [goal, strategy, objective, epic]` or as a block list. A card's `type:` word, compared without regard to case, gives it a tier: its place in this list. The hierarchy orders drawing and slicing and enforces nothing: a card of any type may sit under a card of any other type, and nothing warns when it does (ADR 0013). Names are read as written; a blank entry is skipped, a duplicate passes through for the page to drop, and a value that is not a list (`hierarchy: goal`) or an empty one means no hierarchy. A type outside the list has no tier, and the `types:` list's own order still means nothing.

**`pills` — the board's own one-click searches.** Written in block form only. Each entry is either a search query, quoted or bare, or a one-key map from a label to a query, as in `- next: 'tags:"next-up"'`. A query on its own is its own label. A map's key ends at the first colon followed by a space (or by the end of the entry), as in YAML, so `- tags: grill` is the label `tags` with the query `grill`, not the query `tags:grill`; write `- "tags:grill"` for that query. A colon with no space after it stays inside the query (`- assignee:@human`, `- "tags:*"`). An entry that is blank, only a comment, or has an empty label or an empty query is skipped, and extra keys on a map are ignored. Labels and queries are free text and are never validated here. Unindented `- item` lists are skipped, as for every list in this file.

A `field:*` entry, such as `tags:*` or `assignee:*`, expands in the web app's search panel (and the snapshot's) to one pill per distinct value the board's active cards hold in that field (`tags`, `assignee`, `status`, `priority` or `type`; `a:*` is `assignee:*`), sorted and labelled by the value, in the place the entry holds among the others. Each pill matches its value exactly, or any one element of a list field, so `grill` never catches `grilling`, and a value with a space stays one term. A label on such an entry names nothing: each pill is labelled by its value. The first eight values of a field show, and a "+N more" control reveals the rest and folds them back. A `field:*` entry on any other field, such as `title:*`, is skipped. Next up has no built-in pill: a board that wants one defines it, as in `- next: 'tags:"next-up"'`, and nothing in the plugin gives it a meaning.

**`icon` — a type's shape.** An optional line on a block entry of `types:`, one of `circle`, `square`, `diamond`, `triangle`, `hexagon` or `star`, in any case, with an optional trailing comment. A type with no icon, or an unknown name, is drawn as it is today; an unknown name is kept as written and never an error. An icon is a shape, never a color: colors stay on `color:`.

**`prefixes`, `counters` and `idDigits` — how ids are made.** `prefixes:` is a block of `PREFIX: type` lines (a prefix is `_` and uppercase letters only; the type is compared without regard to case; a value that names a groups folder, a path such as `.groups/iteration` or `workflow/`, or the `groups:` folder itself (`_: .groups`, the root, which has no slash), is a folder, not a type, and no card takes it: a group in exactly that folder takes the prefix, see `references/groups.md`). A prefix is declared once, for a card type or for a groups folder, never both: when a prefix appears twice with different values the first stands, and the web names the ignored one on stderr at startup, never fatal. A card takes the prefix its type declares when it is created and keeps it; prefixes are suggested, never enforced, so a card of any type may still be given any id by hand. `counters:` is one flow-map line, `counters: { G: 3, O: 5 }`: the next number of each prefix, and each is self-healing, `max(its counter, the highest number with that prefix + 1)`, exactly like `nextId`. The block form of `counters:` is not read. `idDigits:` is a whole number from 1 to 15 (anything else reads as 4) and only sets the width a file name pads to; the readers parse the number, so changing it orphans no file, and `scripts/migrate_card_names.sh` renames a board to the new width. Without `prefixes:` every id is a plain number, as before.

**The keys that turn the kit on.** `groups`, `iterations`, `logbook`, `scratchpad` and `todos` are written by the starter for a new board, and a human may switch each off or on in the web's gear sheet (This board), which writes that one line; otherwise nothing that services the board invents any of them. A path key is relative to the board, or absolute when written by hand.

**`groups` — the folder of the board's groups.** `groups: .groups` turns groups on; without the line the board keeps none and you write none. The gear sheet (This board, Groups) never writes a folder outside the board. See `references/groups.md`.

**`iterations` — the web's iteration dropdown.** `iterations: true` adds a dropdown to the web header over the groups in the `iteration/` folder (a group sitting in exactly that folder, no subtype). It needs the `groups:` line and does nothing without it; it only adds a picker to the web, and an iteration is otherwise an ordinary group. The gear sheet (This board, Groups, Iterations) writes that one line (turning groups off leaves it, ignored, until groups are back).

**`logbook` — the folder of the board's notes.** `logbook: .logbook` turns the logbook on; without the line the board keeps none and you write none. The gear sheet (This board, Logbook) never writes a folder outside the board. See *The logbook: notes in day files* in `references/notes-kit.md`.

**`scratchpad` — the folder of the board's scratchpads.** `scratchpad: .scratchpad` turns scratchpads on; without the line the board keeps none and you write none. The gear sheet (This board, Scratchpad) never writes a folder outside the board. See *The scratchpad: a disposable page per card or group* in `references/notes-kit.md`.

**`todos` — the folder of the board's todo lists.** `todos: .todos` turns todo lists on; without the line the board keeps none and you write none. The gear sheet (This board, Todos) writes that one line. See *The todo list: a task list per card or group* in `references/notes-kit.md`.

**`vars` — names for the kit's paths.** A human writes the block; the web's gear never writes it. See *The placeholders in the logbook, scratchpad and todo paths* in `references/notes-kit.md`.

**`typesOn` — Types off.** `typesOn: false` makes the web and the snapshot show no types (display only), so keep writing `type:` and prefixed ids as ever. A human writes the line, or switches it in the web's gear sheet; nothing that services the board invents it.

**Who writes what.** Only a human, or a session a human tells to, writes `hierarchy:`, `pills:` and `icon:`; nothing that services the board invents them. The starter config (above) is the one source that writes `hierarchy:`, `prefixes:` and `icon:` for a new board, and `apply-starter.js` copies it to an existing one when a human asks. They are not exceptions to "never invent a config key" and have no seed trigger. `prefixes:` and `idDigits:` follow the same rule: only a human writes them (the web's gear sheet writes `idDigits:` for the human, one line, and `prefixes:` one block, and shows `counters:` read only). The `assignees`, `priorities`, `tags` and `statuses` lists are the ones SKILL.md describes.

## Migrating `epic: true` to `type: epic`

The epic flag is retired: the app no longer reads or writes `epic`, and an epic is a card with `type: epic` like any other type. A board written before that still holds `epic: true` lines, which are now ignored (an unknown field, kept through every edit) and show nothing. `scripts/migrate_epic_to_type.sh` rewrites them once (its header lists the cases):

```bash
bash <SCRIPTS_DIR>/migrate_epic_to_type.sh <kanban-dir>            # dry run: lists the cards that would change
bash <SCRIPTS_DIR>/migrate_epic_to_type.sh <kanban-dir> --apply    # rewrites them
```

It covers the live cards and everything under `archived/` (packages included), rewrites each `epic: true` line to `type: epic` (a card that already has a `type:` with a value keeps it and only loses the `epic:` line), bumps `updated`, and files **one** notification in `notifications.md` listing the migrated cards as card mentions. Run it once on your own board, after the app you use understands `type`; it never touches another board, so each board is migrated by whoever owns it. An epic keeps its color only if the board's `types:` list gives `epic` one.
