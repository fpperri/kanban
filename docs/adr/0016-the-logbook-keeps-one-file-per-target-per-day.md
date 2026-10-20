# 0016. The logbook keeps one file per target per day, named by date and id

Date: 2026-10-19 · Status: accepted

## Context

People and agents want to jot short, timed notes as they work, against a card,
a group or nothing, and see them on the Calendar. The card's narrative is the
durable record and should not fill up with them, so the notes need a home of
their own, one a person can open and edit by hand.

## Decision

Notes live in the board's logbook folder (`logbook:` in `config.yaml`, off
without the line), one file per target per day. The name carries the day and
the target and nothing else carries them: `2026.10.16.logbook.md` for notes on
nothing, `2026.10.16.0007.logbook.md` for a card, `2026.10.16.W0234.logbook.md`
for a group. The notes are a list in the frontmatter, each with an optional
`at` time (none makes it an untimed note), the `note` text and its author in
`by`, an assignee handle whose `kind` says human or AI. Other keys and the body
below are kept as written.

This inverts the card rule on purpose: a card's name is a label and its `id:`
line the truth, while a logbook file's name is its identity. Renaming the file
moves its notes to another day or target, and a view finds a day's or a
target's notes by name alone.

A **scratchpad** is the disposable counterpart: one file per card or group in
the scratchpad folder, `0007.scratchpad.md`, free Markdown that may point at
notes, files and folders. The kanban never deletes one on its own.

## Considered options

- **One file per note, its target and time in frontmatter like a card.**
  Rejected for now: a person reading or editing a day's notes would face a
  folder of tiny files. It remains the fallback if day files prove hard to
  write safely.
- **Notes in the card's body.** Rejected: the card would grow long, and a note
  on a group or on nothing would have no home.
- **A group's name in the file name.** Rejected: names change and may hold
  dots; groups have ids instead (ADR 0014).

## Consequences

- The web and an agent can write the same day file. The web checks that the
  file has not changed since it read it, re-reads and retries once, and reports
  a conflict only after that; agents re-read before appending.
- Moving one note to another target rewrites two files; a whole day moves by
  renaming one.
- Deleting a card or a group offers, unticked, to delete its logbook files and
  scratchpad; left alone they read as dangling.
