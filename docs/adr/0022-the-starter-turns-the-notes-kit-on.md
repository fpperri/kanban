# 0022. The starter turns the notes kit on

Date: 2026-10-21 · Status: accepted

## Context

The logbook, scratchpad, todo lists, groups and iterations each switch on with
one `config.yaml` line (ADRs 0015, 0016, 0019 and 0021), and ADR 0017 has the
web write that line from the gear sheet. Until now the starter listed the five
lines as comments, so a new board began with all of them off and each board
chose its own kit. The owner wants every board to have the same kit.

## Decision

The starter writes the five lines for a new board: `logbook: .logbook`,
`scratchpad: .scratchpad`, `todos: .todos`, `groups: .groups` and
`iterations: true`. `apply-starter` adds the ones an existing board lacks when
a human asks, and never changes a value the board has. A board can still
delete the lines, or switch the features off from the gear sheet, and the web
reads a missing line as off, so a board that never gets them works as before.

An AI servicing a board still never invents these lines: they come from the
starter for a new board, from `apply-starter` when a human asks, or from the
person.

## Consequences

- ADRs 0015, 0016, 0017 and 0021 stand: a feature is off without its line.
  What changes is which lines a new board starts with.
- A board made before this change stays as it is until someone runs
  `apply-starter` on it.
