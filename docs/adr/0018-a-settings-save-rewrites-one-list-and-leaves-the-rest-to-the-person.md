# 0018. A settings save rewrites one list, and what else names it is left to the person

Date: 2026-10-20 · Status: accepted

## Context

ADR 0017 let the web write `config.yaml` one line at a time. The gear now edits
a board's types, its hierarchy and its prefixes, and each of those is a list:
a reorder, an added type or a new color touches several lines. The three lists
also name each other by word: `hierarchy: [goal, ...]` and `prefixes: G: goal`
both point at an entry of `types:`.

## Decision

One save from the web may rewrite one top-level block of `config.yaml`
(`types:`, `hierarchy:` or `prefixes:`) whole, in the board's usual layout.
Every line outside that block stays byte for byte; comments inside it are not
kept. A save is refused when the file changed on disk after the page read it,
and the page reads it again.

Each edit changes only the list it was made in. Renaming or removing a type
rewrites `types:` and nothing else: the hierarchy and the prefixes still name
the old word until the person, or an AI they ask, changes them, and the cards
keep their `type:` lines. The page shows each such leftover as a warning that
says why it is there.

**Types off** (`typesOn: false`; no line means on) makes the web and the
snapshot ignore the board's types: no chips, colors, icons, tiers or type
field. It is a choice about what the views show, not about the card contract:
the lists stay as written, and AI writers keep writing `type:` and prefixed ids.

This widens ADR 0017's one-line rule to one block. Its rule on folders stands.

## Considered options

- **A rename follows the word into the hierarchy and the prefixes.** Rejected:
  the settings would start keeping the lists consistent with each other, a rule
  the kanban does not otherwise hold (ADR 0013 enforces nothing). A person who
  wants the follow-on asks an AI, which can also migrate the cards.
- **A save rewrites the cards that carry the old type.** Rejected: one click
  writing many card files is a new kind of change, and not one to undo.
- **Keep comments inside a rewritten block by matching lines.** Rejected: it
  breaks as soon as entries are reordered, which is the page's main edit.
- **Types off also stops AI writers typing cards.** Rejected: the card contract
  would then depend on a display switch, and turning types back on would find
  cards made in the gap without their types.

## Consequences

- A board's lists may disagree after an edit; the views already read a name
  that is not a listed type as an ordinary word (ADR 0004), so nothing breaks.
- A prefix edit changes only ids given from then on (ADR 0014); the page asks
  for a confirm and says to ask an AI to migrate existing cards.
