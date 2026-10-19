# 0015. Groups are files that list their cards; the folder is the type

Date: 2026-10-19 · Status: accepted

## Context

Several consumers want to treat a set of cards as one thing: an iteration of
work between two dates, a workflow handed to an agent as a piece of the graph,
a loose collection for an event. The kanban should let them group cards without
learning what any grouping means.

## Decision

A **group** is one Markdown file under the board's groups folder (`groups:` in
`config.yaml`, off without the line). Its frontmatter carries its `id` (the
truth, ADR 0014), a short `name`, optional `start_date` and `end_date`, an
optional `auto_join: true`, and `cards:`, the ids of its member cards on this
board. Other keys are kept as written. The file name is a label.

The group's type and subtype are the folders it sits in, at most two levels:
`<name>.md` (no type), `<type>/<name>.md` or `<type>/<subtype>/<name>.md`.
The frontmatter never repeats them. A group's prefix comes from the exact folder
`prefixes:` maps to it, or `_` when none does.

Cards never know their groups: membership lives only in the group's list.
It is the mirror of nesting, where the child names its parent and the parent
lists nothing.

A group with dates and `auto_join: true` is **running** between its dates, both
days included, by the creator's local date. A card created while it runs is
written into its `cards:` then, by every writer (the web and the `kanban`
skill's creation steps), so the join can be undone by removing the card.

An **iteration** is an ordinary group in the `iteration/` folder. Turning
iterations on in `config.yaml` only adds a picker to the web; nothing else
about them is special.

## Considered options

- **A `group:` field on the card.** Rejected: a card would carry one line per
  grouping, and every consumer's grouping would edit card files it does not
  own.
- **A group as a card of its own type.** Rejected: groups would crowd the views
  and need a rule to keep them out of statuses and roll-ups.
- **Type and subtype in the frontmatter.** Rejected for the reason ADR 0010
  gave for packages: a field that repeats a location drifts from it.
- **Membership worked out from dates at read time.** Rejected: a card that
  joined by mistake could not be taken out.
- **Dates alone making a group take new cards.** Rejected: a group dated for an
  event would take every unrelated card created that week; `auto_join` makes it
  a choice.
- **Sprints as a subtype of iteration.** Rejected: one `iteration/` folder is
  enough, and the word belongs to the people using the board.

## Consequences

- Deleting a card takes its id out of every group's list. Deleting a group
  offers, unticked, to delete its member cards too, skipping any that sit in
  another group.
- Groups hold this board's cards only, and never other groups.
