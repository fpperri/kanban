# 0012. Cards nest; type and rank replace the epic flag; everything else is worked out

Date: 2026-10-06 · Status: accepted

## Context

The plugin knew one kind of grouping: a card marked `epic: true`, with other
cards joining it through `parent`. A roadmap tree (strategy, objectives, epics,
stories) cannot be told apart that way, since every level above a story would
be an epic. The plugin also had no way to order cards within a group, and no way
to follow work across boards: a story on a department board serving an objective
on the root board.

## Decision

A card stores three small fields; everything else is worked out when a view
loads, never written to a card.

- **`type`** replaces `epic: true`. It is a word from the board's own suggested
  list (`types:` in `config.yaml`, each with an optional color); free text reads
  too, as with assignees (ADR 0004). The plugin ships no type names and attaches
  no meaning to any of them. Existing `epic: true` cards are rewritten once to
  `type: epic`, and the plugin then stops reading the old flag.
- **`rank`** orders a card among its siblings, stepped by 10 so a card can be
  slotted between two others. It is separate from `priority`. Unranked siblings
  sort after ranked ones, by priority then id. Dragging a card in kanban-web
  writes its rank; when a gap runs out, only that parent's children are
  renumbered.
- **`parent`** means the card above this one, on the same board (`id`) or on
  another board (`board#id`). Any card may be a parent, whatever its type.
  Nesting is not sequencing: `waiting_for` stays the only dependency.

Worked out, never stored: **depth** (parents above), **altitude** (layers
below), **outline order** (the chain of ranks from the root), the **thread**
(parents up to the root) and the **roll-up** (status count of the leaves below,
archived leaves counting as done). Storing any of them means rewriting every
card under a moved parent, and a parent never lists its children, because two
copies of one link drift. Reading every card of the boards in scope and grouping
by `parent` builds the downward index in memory; 422 cards across five boards
took about 25 ms on 2026-10-05.

Cross-board threads and roll-ups follow the **board set** (`boards:` in
`config.yaml`, defined by kanban-afk ADR 0008), hop by hop: each board's own set
resolves the next step, with a guard against loops. ADR 0008's no-merge rule
stays as it is for AFK sweeps, whose scope must be declared rather than
emergent; a thread or roll-up is a read-only view, so following each board's set
is safe there. A roll-up always names the boards it counted, because a parent
cannot know about children on a board it did not read.

A board declares itself private with `private: true` in its own `config.yaml`.
kanban-web may include private boards (a toggle, on by default, at the desk);
a published surface never includes their cards and never names them.

A parent's status stays the human's call: marking a parent done while leaves
below are open shows a warning, never a gate. A missing parent ends a thread
with an "unresolved" marker; a loop stops at the repeating card and is flagged.
A board rename rewrites `parent:` lines and mentions across the board set in one
announced step.

## Considered options

- **Store a nesting number or an absolute order.** Rejected: both go stale on
  every move. Decimal orders (1.1, 1.01) also break at the tenth child, where
  1.10 sorts before 1.2.
- **Keep `epic: true` and add `type` beside it.** Rejected: two ways to say one
  thing, and the plugin would keep an opinion about epics.
- **Reuse `priority` as the order.** Rejected: importance and position differ; a
  High card can sit third.
- **Rename `waiting_for` to `depends_on`.** Rejected: a second hard cutover
  across 90 cards and the AFK dispatcher, and the field would no longer match
  the derived state it drives ("waiting").
- **Count direct children, or all cards below, in the roll-up.** Rejected:
  direct children only see a parent's hand-set status, and all cards below count
  each epic beside its own stories. Leaves are the work.
- **Find related boards from the shop registry, or a `multi:` list.** Rejected:
  the registry belongs to cortex-herd and would teach the plugin what a shop is;
  `multi:` was an older proposal that `boards:` already replaced.
- **Make a parent wait on its children.** Rejected: it would quietly turn
  nesting into a dependency.

## Consequences

- The map, the snapshot and the kanban skill all lose their epic special cases;
  an epic's color now comes from the board's `types:` list.
- Work ships single-board first; cross-board threads and roll-ups arrive with
  the board-set reader.
- cortex-herd keeps its own private flag until it reads the boards' `private:`.
