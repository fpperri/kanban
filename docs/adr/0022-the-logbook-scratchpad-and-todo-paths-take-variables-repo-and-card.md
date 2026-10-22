# 0022. The logbook, scratchpad and todo paths take variables, `<repo>` and `<card>`

Date: 2026-10-21 · Status: accepted · Amends: 0019

## Context

ADR 0019 let `logbook:` and `scratchpad:` (and, by ADR 0021, `todos:`) hold
`<iteration>`, and left `<card>` for later. A host, a tool that ships the
kanban inside its own folder layout, now needs to set these paths itself. It
knows where its folders are, but not where the board's folder sits in the
tree, and every path it writes repeats the same prefix. It also wants a folder
per card, not only per iteration.

## Decision

Three additions to the paths; everything ADR 0019 says for `<iteration>`
stays.

- **Variables.** A `vars:` block of `name: value` lines in `config.yaml`. A
  `<name>` in `logbook:`, `scratchpad:` or `todos:` that names a variable is
  replaced by its value, so `vars:` / `cortex: <repo>/.cortex` lets
  `logbook: <cortex>/execution/<iteration>/.logbook` stand for a long path. A
  name is letters, digits, `-` and `_`. A value is a path relative to the
  board or absolute; a relative value at the start of a path resolves against
  the board, as a relative path does. A value may use the built-in words but
  not other variables: a `<name>` that names a variable inside a value is left
  as written. A variable named like a built-in word (`iteration`, `repo`,
  `card`) is ignored. Nothing here is fatal: the server names each of these on
  stderr at startup and starts.
- **`<repo>`.** The git root that holds the board: the nearest folder at or
  above the board's folder that has a `.git` entry, a folder, or a file as in
  a git worktree. When there is none, a path that uses `<repo>`, directly or
  through a variable, is named on stderr at startup and that feature, the
  logbook, the scratchpad or the todo lists, reads as off, as if its line were
  absent, rather than writing somewhere unintended.
- **`<card>`.** The target's file name without its extension: `0007.fix-login`
  for the card file `0007.fix-login.card.md`, `I0002.zephyr-2` for the group
  file `I0002.zephyr-2.md`. A folder is matched to its target by the id at the
  front of its name, exactly as `<iteration>` matches a group's folder, so
  renaming the card keeps its folder, and an existing folder whose id matches
  is used before a new name is built. For a note about nothing, the board-wide
  day file, the segment is dropped, as `<iteration>` is when no iteration
  applies. A note assigned to another target goes to that target's folder. A
  card with no file of its own (a note about a card that is gone) takes its
  padded id as the name.

A placeholder is a whole path segment only. Any other `<word>`, one that is
neither a built-in word nor a variable, stays an ordinary folder name, as ADR
0019 has it, and is named on stderr at startup as a likely typo. A path with
no placeholder reads exactly as before. Existing files are read and edited
where they are and never moved, and reading covers every folder the path can
name, under `<card>` as under `<iteration>`.

The web's gear keeps its switches and never writes `vars:`; it keeps the block
byte for byte through every write it does. The mobile snapshot reads none of
these paths and is unchanged.

## Considered options

- **Environment variables.** Rejected: the board would read differently
  depending on who starts the server, and a path would no longer be in the
  file.
- **Variables inside variables.** Rejected: an order of expansion and a cycle
  to guard, for a host that can write the longer value once.
- **A fatal error for a bad variable or `<repo>` with no git root.** Rejected:
  a board with a typo in a path should still open and show its cards. The
  feature is off and the stderr line says why.
- **`<repo>` as a path computed by the host.** Rejected: the host then has to
  know where the board is. The board knows.

## Consequences

- The three paths in `config.yaml` stay what the gear shows and writes; the
  server fills in the variables and `<repo>` when it reads them.
- A board checked out outside a git repository, or moved out of one, shows no
  logbook, scratchpad or todo lists for the paths that use `<repo>`, and says
  so at startup.
- A folder per card means a card's files sit together; the scratchpad and the
  todo list are still one file per target, and a file in a folder that does
  not match its target's id is read like any other.
