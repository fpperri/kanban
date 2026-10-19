# 0017. The web writes config.yaml one line at a time, and never a folder outside the board

Date: 2026-10-19 · Status: accepted

## Context

Until now the web wrote one line of `config.yaml`, `nextId`, by replacing that
line alone so the human's comments and unknown keys survive. The logbook,
scratchpad and groups (ADRs 0015, 0016) are switched on and pointed at folders
by config lines, and prefixed ids keep counters there (ADR 0014). A board may
also keep these folders outside itself, beside a working folder of its own.

## Decision

The web's settings write `config.yaml` the way `nextId` is written: one line
replaced, inserted or removed, every other byte left as it was.

A folder the server reads and writes may sit outside the board, but only a
person editing `config.yaml` by hand can put it there. The web accepts a folder
inside the board only, and a value already outside it shows locked, with the
reason, rather than editable. The server builds every file name itself from a
day and an id, never from text in a request.

Changing a folder from the web changes the line only; the files stay where they
are, for the person to move.

## Considered options

- **Settings read-only, every change a hand edit.** Rejected: switching a
  feature on would mean finding and typing a config key.
- **Rewrite the whole file from a parsed model.** Rejected: it would drop the
  human's comments and any key the parser does not know.
- **Let the web set any folder.** Rejected: a request could then point the
  server's writes anywhere on disk.
- **Move the files when the folder changes.** Rejected: two ways of moving the
  same files, one of them able to fail half done.
