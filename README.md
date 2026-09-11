# kanban

Markdown kanban boards for AI coding agents.

A directory of `*.card.md` files **is** the board — no database, no daemon,
just plain git-friendly Markdown. Four surfaces sit on top of it, so you (or
the AI) can work the same board from a browser, a terminal, a phone, or a
Claude Code session.

## Why

Your task list already lives next to your code, versioned in the same repo,
diffable in the same PRs. Claude can create and move cards as part of its own
work; you can drag them around in a browser, chat through them at a terminal,
or tap through them on a phone. One set of files, no export/import step,
nothing to host.

## What this is (and isn't)

kanban **keeps track of your board's state — by itself it executes nothing.**
It's the file format plus surfaces to read and write it; you can use other tools
to pick up cards, dispatch agents, and run workflows based on the board state.

## What it looks like

A board is just a folder of cards — edit it from a browser, a terminal, or your
phone. A guide for each editing surface:

- **[Web editor (desktop)](docs/web.md)** — the live browser app: board,
  dependency map, gantt, calendar, and full drag-drop CRUD.
- **[CLI (conversational)](docs/cli.md)** — work the board by chatting with
  Claude; the same operations, at a terminal or under remote control.
- **[Mobile snapshot](docs/snapshot.md)** — a tap-through board for your phone that
  queues its edits back to Claude to apply.

## Install

Two paths, depending on your harness.

### Install skills (any harness)

```
npx skills add KingCrimsonFPP/kanban
```

The installer scans the repo, lists the four skills in a selection menu
(name + short description), and installs the ones you pick into your agent
harness — Claude Code, GitHub Copilot, and the other harnesses `npx skills`
supports. Skills whose menu description leads with **(Claude Only)** depend
on Claude Code built-ins and won't port cleanly elsewhere — see
[cross-harness caveats](docs/cross-harness.md).

### Plugin (Claude Code)

```
/plugin marketplace add KingCrimsonFPP/kanban
/plugin install kanban@kanban
```

Installs all four skills at once, plus the `.claude-plugin/` marketplace
wiring. Claude Code only.

## Quick start

With the skills installed, in your agent session:

1. Run `/kanban` — or `/kanban:kanban` when another plugin also ships a
   `kanban` skill — and tell it which folder you want to work on — it sets up
   the board there (or adopts an existing directory of `*.card.md` files).
2. Once your kanban is set up, ask `/kanban-web` (`/kanban:web` in
   plugin-qualified form) to create the web editor — it starts the local
   server and hands you the board URL.

Or try the bundled demo board straight from a clone of this repo:

```bash
node skills/web/scripts/server.js examples/demo-board
```

This prints `Kanban app: http://localhost:7777` (or the next free port if
7777 is busy). Open that URL in a browser, or paste it into VSCode's Simple
Browser — it's desktop/localhost-only by design (see ADR 0002). `examples/demo-board/`
is a self-contained sample board; point the same command at any directory of
`*.card.md` files to run your own.

## The four surfaces

| Surface | For | What it is |
| --- | --- | --- |
| `kanban` | the AI | AI-driven card management — every file contract (card frontmatter, `config.yaml`, `notifications.md`) and when the AI must notify the human lives here. |
| `kanban-web` | the human, desktop | A live browser editor: a localhost Node server (stdlib-only) + vanilla-JS SPA with drag-drop board, full CRUD, bulk actions, search, a notifications inbox, and four views (board, dependency map, gantt, calendar). Bound to `127.0.0.1` only. |
| `kanban-cli` | the human, anywhere | A conversational editor — Claude prints the board and drives typed actions and `AskUserQuestion`, with the same operations and rules as `kanban-web`. Works identically at a terminal or under remote control on mobile. |
| `kanban-snapshot` | the human, phone/tablet/Cowork | Generates a self-contained single-file HTML board — a tap UI (move, edit, archive, delete, create) whose edits queue in a tray, nothing touching disk until you paste its "Apply kanban changes" payload back into chat — Claude is the write path. |

Web and CLI implement the same operations under the same rules (the `doing`
entry gate, bulk actions, speedbumps, notifications); a few things are
deliberately unmirrored where the medium doesn't support them (drag & drop,
`localStorage` persistence, the SVG map, and so on). See `CONTEXT.md` for the
full parity table.

## The board data model

- **Board directory** — `.kanban/` is the preferred board directory; `kanban/`
  remains supported as a fallback for existing boards. Every surface discovers
  `.kanban/` first, then falls back to `kanban/`.
- **Cards** — one file per card: `<0000-id>.<kebab-case-slug>.card.md`. The
  4-digit-padded id prefix is cosmetic (sorting/visibility only); the
  frontmatter `id` field is the actual source of truth for identity.
  Frontmatter holds fields like `status`, `priority`, `assignee`, `tags`,
  dates, and dependency links; the Markdown body (including a `## Narrative`
  section) is free text. Only `*.card.md` files are treated as cards —
  `config.yaml`, `notifications.md`, and any other `.md` file are ignored by
  board scripts.
- **Status vs. archive** — `status` is a card's column (`backlog`, `todo`,
  `doing`, `done` by default, or a custom list from `config.yaml`). Archive is
  a *location*, not a status: moving a card into the board directory's
  `archived/` folder takes it off the active board without touching its
  `status` field (almost always left as `done`). Restoring moves the file
  back.
- **Waiting vs. blocked** — these are two distinct concepts:
  - `waiting_for` is a **derived** dependency list. A card is waiting while
    any id it lists is not `done`; there's nothing to set or clear by hand —
    it disappears on its own once every dependency lands. A dangling id
    doesn't count.
  - `blocked` is a **manual** sticker: `blocked: <reason>`. It's a human stop
    sign, independent of dependencies, and it stays until a human clears it.
  - Both gate entry into the literal status `doing` — a waiting or blocked
    card can't move there — but neither evicts a card already sitting in
    `doing`.
- **The date triad** — `start_date` + `end_date` form a working range;
  `due_date` is an independent deadline that renders as its own marker even
  inside the range. As a compat fallback, a card with `start_date` and
  `due_date` but no `end_date` still reads as a `start_date` → `due_date`
  range.

## config.yaml

Optional, human-edited, one per board:

```yaml
nextId: 29 # monotonic id counter
assignees: # role-trio registry
  - handle: "@human"
    name: "Human"
    kind: human
    description: "A human can grab it. Final say on trusted and destructive calls."
  - handle: "@hitl"
    name: "AI (HITL)"
    kind: ai-hitl
    description: "AI will grab it but needs a human in the loop (review, spec, tickets, approval)."
  - handle: "@afk"
    name: "AI (AFK)"
    kind: ai-afk
    description: "The AI can execute fully autonomously."
priorities: [High, Normal, Low] # ordered highest first
tags: [skills, config, design] # curated tag vocabulary
statuses: [backlog, todo, doing, done] # official column list, in board order
```

Every list here **suggests, never validates** — free text still saves and
renders fine everywhere. An unlisted on-disk `status` renders under the list's
first column with its raw value shown, never rewritten; promotion is a human
adding it to the list.

## More docs

- [`docs/adr/`](docs/adr/) — architecture decision records (ADR 0001–0010),
  covering why the CLI is Claude-driven, why `kanban-web` gets a scoped
  local-server exception, hand-rolled widgets, tolerant vocabulary registries,
  archive-column UI parity, the shared interaction grammar, the date triad,
  the machine-managed `updated` field, review and human-attention as
  overlay stickers, not columns, and the recursive `archived/` with optional
  package folders.
- [`docs/cross-harness.md`](docs/cross-harness.md) — cross-harness caveats:
  which skills port cleanly outside Claude Code and which carry the
  (Claude Only) tag, and why.
- [`CONTEXT.md`](CONTEXT.md) — the ubiquitous-language glossary for every term
  used across the four surfaces (board, card, status, waiting, blocked, the
  role trio, and more).
- [`SECURITY.md`](SECURITY.md) — `kanban-web`'s threat model: the board files
  are the trust boundary, not HTTP auth.

## License

MIT. See [LICENSE](LICENSE).

Created by Francisco Pablo Perri.
