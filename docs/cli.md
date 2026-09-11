# The CLI (conversational)

`kanban-cli` is the web editor's **conversational twin** — the same operations
under the same rules, driven by chat instead of a browser. There's no TUI and
no server: Claude *prints* the board as Markdown and you steer with typed ids
and commands. Because it's just conversation, it works where `kanban-web` can't
— a bare terminal, or Claude under remote control on your phone.

## Using it

With the plugin installed, ask Claude to work the board — "show my kanban
board", "open the board in `examples/demo-board`". Claude re-reads the folder
from disk (no polling — freshness comes from re-reading), prints it grouped by
column, and drives an edit loop: pick a targetless action, or type a card id to
open it, or type a command from anywhere.

A print looks like this (the bundled `examples/demo-board`):

```text
## Doing
#1 [HIGH] Launch Tallybird v1.0          @human
#6 Settlement calculation engine         @hitl
#11 Auto-generate weekly analytics digest @afk

## Todo
#3 Draft App Store & Play Store listings  @hitl · due 2026-07-25
#7 [waiting: #6] Settlement UI screen     @hitl
#9 Host public launch demo webinar        @hitl

## Backlog
#8 [HIGH] [blocked: legal sign-off pending] Set up payment provider  @human
…
(3 unread notifications)
```

```text
you › move 6 to doing
     › #6 → doing. Gate ok — its only dep, #5, is done.

you › move 7 to doing
     › Can't: #7 is waiting on #6 (doing). Land #6 first, or edit #7's waiting_for.

you › archive 3,5,7
     › Archive #3 #5 #7 — 3 cards?  [yes / no]
```

The unresolved-`waiting_for` flag (`[waiting: #6]`), the manual
`[blocked: <reason>]` sticker, and `[HIGH]` are the text equivalents of the web
tile's badges.

## Operations

Everything the web editor does, as a typed command or a guided prompt:

- **Create** — title (required), then status, priority, tags, `waiting_for`,
  assignee, the date triad, epic flag, and description; the rest default.
  Assignee / priority / tag suggestions come from `config.yaml` (they suggest,
  never validate).
- **Edit** — change fields inline ("set priority High, due 2026-08-01"). The
  body — including `## Narrative` and any frontmatter the form doesn't manage —
  is preserved verbatim, exactly like the web form.
- **Move** — with the **`doing` entry gate**: a card can't enter `doing` while
  it's **waiting** (a `waiting_for` id isn't `done`) or **blocked** (a manual
  sticker) — the CLI refuses and names which, the same hard rule as the web
  app's snap-back.
- **Archive / Restore** — move the file into / out of the board directory's
  `archived/` folder (a location, not a status).
- **Delete** — permanent removal.
- **Bulk** — commands take id lists: `archive 3,5,7`, `move 3,5 to todo`,
  `assign 3,5 @afk`, `set priority 3,5 Low`, `tag 3,5 design`,
  `schedule 3,5 from 2026-07-10 to 2026-07-12 due 2026-07-15`. Per-card skips
  (a gate-refused move, a missing id) don't abort the batch — you get one
  summary line of what changed and what was skipped.

Every destructive action confirms first, naming its object (archive, delete,
bulk archive/delete/move); under remote control that confirm goes through a
prompt — never an assumed yes. **Restore is exempt** (it's the reversible
direction).

## Notifications inbox

The same `notifications.md` file and contract as the web app's bell. Asking for
**Notifications** prints every entry newest-first — unread flagged, level shown,
the TLDR segment bolded — and **marks them read**. Removing an entry or clearing
all **archives** them (moved to `archived/notifications.md`), never deletes.

## Dependency view

Asking for **Dependencies** prints a Mermaid `graph LR` of the `waiting_for`
graph (nodes colored by status, arrows from a dependency to the card waiting on
it, epics as the sink with dashed membership edges) — the Mermaid equivalent of
the web **Map view**. Scope it to one card with **"Dependencies tree for #7"**
(the whole connected component) or **"Dependencies path for #7"** (just the
directed upstream+downstream cone) — the same `tree:`/`path:` grammar the web
map and snapshot expose.

## Parity with the web editor

The shared rules and the full parity table live in
[`CONTEXT.md`](../CONTEXT.md). What this medium can't carry is swapped, not
dropped: drag & drop → typed commands, the SVG map → Mermaid, the 5-second
poll → re-reading disk before every print, search-as-you-type → filter on
request, and the `localStorage`-backed collapse/sort state → on-demand
re-prints (a transcript is ephemeral).

---

For a desktop browser, see the **[web editor](web.md)**; for a phone, the
**[mobile snapshot](snapshot.md)**.
