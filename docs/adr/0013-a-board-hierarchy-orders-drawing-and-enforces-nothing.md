# 0013. A board's hierarchy orders how types are drawn and enforces nothing

Date: 2026-10-14 · Status: accepted

## Context

ADR 0012 made `type` a free word to which the plugin attaches no meaning. A
board planning in layers (goal, strategy, objective, epic) wants the Graph to
draw those layers in order and to cut a view down to some of them, while its
other types (story, task, bug) stay plain words that may mean different things
to different consumers.

## Decision

A board may declare `hierarchy:` in `config.yaml`: an ordered list of type
names, top first. A card's **tier** is its type's place in that list; a card
whose type is not listed has none. Views read tiers to order and to slice what
they draw, and nothing else: no write path, check or warning compares a card's
tier with its parent's. A goal nested under an epic is drawn in the goal's band,
its parent line running against the order, and nothing complains.

Without the key there are no tiers. The order of `types:` stays meaningless; a
board that declares types but no hierarchy is drawn by depth alone.

This narrows ADR 0012's "attaches no meaning" to "enforces nothing".

## Considered options

- **Warn when nesting runs against the hierarchy.** Rejected: a warning is a
  rule with a softer voice, and the board would start judging its own plan.
- **Refuse such a nesting.** Rejected for the same reason, more strongly.
- **Mark the hierarchy's types inside `types:`.** Rejected: one ordered list
  says the order once; marks scattered across entries would make the order of
  `types:` meaningful.
- **Fall back to the whole `types:` list when `hierarchy:` is absent.**
  Rejected: it would give the order of a suggestion list a meaning nobody
  declared.

## Consequences

- The Graph's tiers layout draws a band per tier, then the cards without a tier
  by depth; on a board with no hierarchy it draws depth rings as before.
- Rules about types (which may parent which) stay with whoever uses the board.
