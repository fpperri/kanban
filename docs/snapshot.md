# The mobile snapshot

`kanban-snapshot` is the surface for editing the board where `kanban-web` can't
reach — a phone, a tablet, or a remote Claude session. It generates a **single,
self-contained HTML file** (no server, everything inlined) that you open and
tap through. It's read-write but **indirect**: nothing touches disk until you
paste a change payload back to Claude, who applies it under the board's write
contracts. That keeps the write path — and the `doing` gate, id allocation, and
archive rules — in one place.

## Generate it

From the repo root:

```bash
python skills/snapshot/scripts/build_editor.py examples/demo-board --out editor.html
```

(`python3` on macOS/Linux if that is the only interpreter name; on Windows `python3`
is typically the Store's install redirector, not an interpreter.)

Then open `editor.html` on the device you want to edit from (or send it to your
phone). The screenshots below are the bundled `examples/demo-board` on a phone.

Under Claude Code, this file is delivered as the board's **Board artifact** —
one hosted page per board, refreshed in place — per
`skills/snapshot/references/board-artifact.md`.

## Board

![Snapshot board](images/snapshot-board.jpg)

Status sections start **collapsed** — name and count only — so the board opens
as a compact overview; tap a section to expand it. A status-pill row filters
what's shown (Archive is off by default), the tabs switch between Board / Map /
Gantt / Calendar, and the header carries search and a notifications bell. Cards
show the same cues as the desktop board — here `#7` wears the amber **waiting**
tag.

## Nested cards

A card with a `type` wears a chip in the color `config.yaml` gives that type.
On a board where cards have a `rank` or a `parent`, each section lists its cards
in outline order — parents before their children, siblings by rank — and a parent
card shows how many layers sit below it (`▲2`) with a thin bar of how far along
the leaves under it are. The page carries kanban-web's own nesting rules, so both
surfaces agree on what sits under what and how it is counted; the drawing and the
type color match are the snapshot's own. It leaves the done-with-open-leaves warning,
the bar mode and rank editing to kanban-web.

## Getting around

![Scroll-button stack](images/snapshot-scroll-stack.jpg)

Phones swipe-dismiss an HTML preview, so the snapshot ships a fixed
**scroll-button stack** in the corner (it doubles as the context menu): jump to
top/bottom, page up/down, add a card, and a `⋯` that cycles how much of the
stack is shown. It's how you move around without the page scrolling out from
under you.

## The other views

The same three extra views as the desktop app, rendered read-only here and
laid out for a narrow screen:

![Snapshot map](images/snapshot-map.jpg)
*Map — the `waiting_for` graph with a workable / waiting / blocked / not-on-board legend.*

The Map draws kanban-web's defaults: dashed lines from a parent to its children, only
to the children where their dependency chain ends, with the parent below; one graph per
tree under a heading of its root titles, biggest first; a **No relations** row for the
cards nothing links; rows that read doing, todo, backlog, done from the left and sit
centered; and cards that carry their type chip, `▲` badge and roll-up bar. The Map
options row is kanban-web's: the snapshot always draws these defaults.

The snapshot has no Graph view; that one is kanban-web only.

![Snapshot gantt](images/snapshot-gantt.jpg)
*Gantt — working-range bars and due diamonds, grouped by status, with an undated-cards row below.*

![Snapshot calendar](images/snapshot-calendar.jpg)
*Calendar — Month / Week / 3-day / Day sub-views; the sub-month views are tap-friendly day rows with counts.*

## A card up close

![Snapshot card sheet](images/snapshot-card-detail.jpg)

Tapping a card opens its sheet in place: a status / assignee / priority / type
pill row (tap a pill to edit that field), the thread of parents above it and the
roll-up of a parent's leaves, the description, the card's children, an **All
fields** grid for everything else (type, parent, dates, tags, `waiting_for`, and
any custom frontmatter — never `rank`, which you change by dragging in the
[web editor](web.md)), and
**Dependency tree / path** buttons that narrow every view down to that card's
tree (no view switch — whatever view you're on just filters to it).

## Creating a card

![Snapshot new-card form](images/snapshot-new-card.jpg)

**+ New card** opens the same sheet in create mode — title, status, priority,
assignee, and an optional description — and nothing joins the board until you
tap **Accept**.

## The change loop

![Pending-changes tray](images/snapshot-pending-changes.jpg)

Every move, edit, create, archive, or delete you make **queues** into a
*Pending changes* tray instead of writing to disk. When you're done, tap **Copy
changes** and paste the result into the Claude chat — it looks like:

```
Apply kanban changes (3 ops, base 2026-07-14T03:16:07Z):
[{"op":"create","title":"Test","priority":"Normal","status":"todo", … }, … ]
```

Claude applies each op to the real `*.card.md` files, enforces the board
contracts, reports what it did, and can hand you a fresh editor to keep going.
The `base` timestamp is a conflict guard: if the board moved on since the editor
was generated, Claude reconciles rather than clobbering. Nothing changes on disk
until you paste.

---

For editing at a desktop, see the **[web editor](web.md)**.
