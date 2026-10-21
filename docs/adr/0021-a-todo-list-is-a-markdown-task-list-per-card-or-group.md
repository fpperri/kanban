# 0021. A todo list is a Markdown task list, one file per card or group

Date: 2026-10-21 · Status: accepted

## Context

People and agents keep small ad hoc checklists while they work a card or a
group: steps to try, things to check before handing off. Written into the card
they dirty its body, which is the durable work spec; written into a note they
are buried in a day's timeline; written into the scratchpad they are mixed
with free text and cannot be ticked from the board.

## Decision

A board may keep **todo lists**. A `todos:` line in `config.yaml` names their
folder, and without the line nothing of this shows. Each card or group has at
most one list, in its own file named like the scratchpad's but with `todo` in
place of `scratchpad` (`0007.todo.md`). The path may hold `<iteration>` by the
rules of ADR 0019, and it may name the same folder as `scratchpad:`, since the
two kinds of file never share a name.

The file is a GitHub Markdown task list (`- [ ] text`, `- [x] text`, nested by
indent), so a person or an AI edits it by hand. An item's text renders with
the board's Markdown. A line that is not an item is kept as written and shown
as written. Finished items stay as `- [x]` until someone removes them; the web
offers no bulk clear.

A todo list means nothing to the board. It never changes a card's status,
never holds a card out of `doing`, and never adds into a parent's roll-up. The
card's own body, acceptance criteria included, stays the work spec.

## Considered options

- **Checkboxes inside the scratchpad.** Rejected: a list that can be ticked
  and reordered from the board needs a shape the web can rely on, and the
  scratchpad stays free text.
- **Todo items as notes.** Rejected: a note belongs to a day, a todo does not.
- **A Clear done button.** Rejected for now: removing finished items by hand
  keeps the list dumb and its history visible until someone decides.
- **Open todos gate `done` or roll up into a parent.** Rejected: the board
  attaches no meaning to them (it stays dumb).
- **Shown in the snapshot.** Deferred: the web only, for now.

## Consequences

- A card or group can carry a count of open items on its tile, worked out
  each time and never written.
- Deleting a card or group offers its todo list like its scratchpad.
- Tools that read the folder by hand must tell the two kinds of file apart by
  name when `todos:` and `scratchpad:` share it.
