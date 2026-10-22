# 0024. The starter keeps a folder per card, through `<kanban>`

Date: 2026-10-21 · Status: accepted · Amends: 0022

## Context

ADR 0022 has the starter write `logbook: .logbook`, `scratchpad: .scratchpad`
and `todos: .todos`: one folder per feature for the whole board. ADR 0023 then
let these paths hold `<card>`, `<iteration>` and the names of a `vars:` block,
so a host that ships the kanban inside its own layout can point them at its
own folders. The owner wants one shape on every board, whether a host made it
or not, with each card's files kept together.

## Decision

The starter writes a `vars:` block with one variable, `kanban: .`, the board's
own folder, and the three paths through it:

- `logbook: <kanban>/.logbook/<iteration>/<card>/`
- `scratchpad: <kanban>/.scratchpad/<iteration>/<card>/`
- `todos: <kanban>/.todo/<iteration>/<card>/`

Each card or group gets a folder of its own under each kit folder, inside its
iteration's folder when one applies; with no iteration that segment is left
out, and a note about nothing goes to the kit folder itself. A host keeps the
same shape and changes where it points: a cortex, for one, writes
`<cortex>/execution/work/<iteration>/<card>/.logbook` with `cortex:` set to its
own folder. `apply-starter` adds `kanban: .` when a kit line it adds names it
and the board has no such variable, and never changes a value the board has.

The paths are written with `/`, which every system the plugin runs on reads as
a separator.

## Considered options

- **`.logbook/<iteration>/<card>/` with no variable.** Rejected: the same
  layout, but a host's paths would differ from a plain board's in more than one
  word, and moving every kit folder at once would mean editing three lines.
- **`<kanban>` as a built-in word, like `<repo>`.** Rejected: a built-in cannot
  be pointed elsewhere, and a variable needs no code; the one line in `vars:`
  shows where the folders are.
- **Keep the todo lists in the scratchpad's folder.** Rejected for the plain
  board: `.todo` beside `.logbook` and `.scratchpad` keeps one folder per
  feature. A host may still share them.

## Consequences

- A board made from this starter puts `<iteration>` and `<card>` side by side,
  so a card's folder can be named two ways; it is read once, as the kind its id
  says.
- A board made before this change keeps its paths until someone changes them;
  `apply-starter` never rewrites a line a board has.
- The gear sheet shows the paths as written and, like any path with a variable,
  cannot save a change that keeps `<kanban>` or `<card>` until it learns those
  words.
