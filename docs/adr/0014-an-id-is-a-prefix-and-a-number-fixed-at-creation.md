# 0014. An id is a prefix and a number, fixed at creation

Date: 2026-10-19 · Status: accepted

## Context

Card ids are plain numbers, and every reader treats them that way. Two things
want more: a board planning in layers would like to call a goal `G3` and an
objective `O5`, and groups (ADR 0015) need ids of their own that no reader can
mistake for a card's. Both want short ids that read well out loud and in a
file name.

## Decision

An id is an optional **prefix** followed by a number: `656`, `G3`, `DW845`,
`_12`. A prefix is `_` and uppercase letters only, and each prefix keeps its own
counter. In prose an id opens with `#`, optionally after a board name
(`fpp#G3`); on disk it is written bare and padded (`G0003`, `_0012`).

The id is the whole pair. Equality, lookups and keys use `G7`, never the number
alone, so `#7` and `#G7` are different cards. Ids sort by prefix, then by
number, so plain ids come first and `#9` stays before `#10`.

A prefix is fixed when the thing is created: a card takes the prefix its type
declares, a group the one its folder declares (ADR 0015), and the id never
changes afterwards. A story that later becomes a goal stays `#656`.

Prefixes are suggested, never enforced. A board declares them in one
`prefixes:` block and keeps their counters on one `counters:` line; without
either, every id is a plain number as before.

## Considered options

- **One shared counter, with the prefix only shown.** Rejected: a goal would
  read `G656`, and the prefix would mean nothing a reader could use.
- **The prefix worked out from the current type.** Rejected: changing a type
  would change the id and break every `waiting_for`, `parent`, mention and
  logbook file name pointing at it.
- **A second sign for groups beside `#`.** Rejected: bare ids sit in file names
  and frontmatter, where a sign cannot go (`&` is a YAML anchor and a bash
  operator, and the other candidates mean something in Markdown), so every bare
  id would need a second marker anyway. Declared prefixes keep a bare id
  unambiguous on its own.
- **Lowercase or other symbols in a prefix.** Rejected: `.` splits logbook file
  names, `-` splits card file names, several symbols are illegal in Windows file
  names, and lowercase would read a hex colour such as `#a371f7` as an id.
  Uppercase hex colours are the one clash left: six or eight uppercase hex
  characters after a `#` (`#FF0000`, `#ABC123`, `#FF000080`) are not a mention,
  so an id written in that shape (`#AB1234`) is the price.

## Consequences

- One id module owns parsing, comparing, formatting and the mention pattern;
  the snapshot carries a copy that runs the same test cases. Readers that turn
  an id into a number fail silently (a dropped card, a scrambled sort), so the
  change is proved on a fixture board that mixes plain, prefixed and group ids.
- The number of digits ids are padded to is the board's `idDigits` (default 4).
  Readers parse the number, so changing it orphans no file.
- A board that adopts prefixes for existing cards plans its own renames; the
  convention is the contract.
