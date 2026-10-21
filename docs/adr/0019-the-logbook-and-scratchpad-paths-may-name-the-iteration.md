# 0019. The logbook and scratchpad paths may name the iteration

Date: 2026-10-21 · Status: accepted

## Context

ADR 0016 gives a board one logbook folder, and the scratchpad likewise has
one folder. People who work in iterations keep a folder per iteration, each
holding that stretch's notes and scratchpads, and today they move the files
there by hand.

## Decision

`logbook:` and `scratchpad:` may hold the placeholder `<iteration>`, for
example `.cortex/execution/sprints/<iteration>/.logbook`. It is the only
placeholder for now.

- `<iteration>` stands for a folder named as the iteration's group file is
  named, without `.md` (`<padded id>.<slug>`): the group in
  `0005.sprint-496.md` keeps its notes under `0005.sprint-496/`. A folder is matched to its
  iteration by the id at the front of its name, so renaming the group does not
  lose the folder.
- A note goes to the iteration whose dates hold the note's day. When two
  iterations hold it, the one that started first wins. A note aimed at an
  iteration itself goes to that iteration's folder, whatever its day.
- A scratchpad goes to the iteration its card or group is a member of. With
  none, it goes to the iteration that holds the day it is first written.
- When no iteration applies, the `<iteration>` segment is dropped from the
  path.
- A file that exists is read and edited where it is. Nothing ever moves a file
  between iteration folders, so a card that changes iteration keeps its
  scratchpad where it was first written.
- Reading covers every folder the path can name, so notes and scratchpads from
  past iterations still show.

A path without the placeholder reads exactly as before.

## Considered options

- **The iteration's name as written** (`Sprint496`). Rejected: two groups may
  share a name, and a rename would orphan the folder. The id does not change.
- **Date placeholders** (`<yyyy>`, `<mm>`) or **`<card>`**. Deferred: nobody
  needs them yet. They can join later without changing this rule.
- **Move a scratchpad when its card changes iteration.** Rejected: a write
  that moves files nobody asked to move. A person, or an AI they ask, can move
  it.
- **A folder per card** (several files under one card). Out of scope: the
  scratchpad stays one page per card or group.

## Consequences

- The web resolves a write's folder from the board's iterations at write time.
  A note written before its iteration existed stays where it was written.
- Folders that already exist under hand-chosen names (`sprint 496`) are not
  matched until they are renamed to the group's file name.
