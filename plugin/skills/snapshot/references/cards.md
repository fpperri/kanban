# What the page shows for a card

Holds the status pills and the Archive pill, how card bodies render, the review and blocked stickers, assignee colours, the nested-card chips, roll-ups, thread and types, and the pending-changes tray.

## Status pills and the Archive pill

Every view carries a status-pill row (each pill a button with `aria-pressed`; a tap toggles
one, a right-click solos it and a right-click on the soloed pill turns all back on; an off
pill is struck through with a hollow dot): statuses default on,
**Archive defaults off** — toggling the Archive pill reveals archived cards
(embedded read-only, **bodies NOT stripped — re-capped at 1500 characters**,
and tappable, opening a read-only detail sheet; archive is a location, not a
status) as a muted trailing board section, a muted gantt
group, dashed map nodes, and gray calendar chips.

What travels in the file, and what that means before publishing it, is in `references/board-artifact.md`.

## Card bodies

Card bodies render as markdown through `skills/web/web/markdown.js`, the module kanban-web
draws its own bodies with, embedded in the page as the same source: headings one to six, bullet
and numbered lists (nested, mixed, with `- [ ]`/`- [x]` tasks), block quotes, fenced code
(backtick or tilde fences, any longer run closing only a run as long; a fence with a language
shows it as a label and a Copy button), pipe tables, `---` rules, and inline
`` `code` ``, `**bold**`, `*italic*`, `***both***`, `~~strike~~`, `<u>underline</u>`,
`[text](url)` and bare `https://` addresses, with a hard line break after two spaces or a
backslash. The parse is the module's; the page draws it as DOM nodes, never `innerHTML`. Collapsible
`<details>`/`<summary>` sections work. A fence in a language highlight.js knows is coloured, and a
` ```mermaid ` fence is drawn as a diagram, by libraries loaded the first time a card holds a block that
needs one (never otherwise), at the versions kanban-web vendors (highlight.js 11.12.0 from
`cdnjs.cloudflare.com`, mermaid 12.2.0 from `cdn.jsdelivr.net`), each under an SRI `integrity` hash
computed from the vendored file when the page is built. Mermaid is never run in the page, which builds
the "Apply kanban changes" payload: a diagram is drawn in an `<iframe sandbox="allow-scripts">` made
from a `srcdoc` (no same-origin), and if the artifact will not host that frame, or the network is off,
the block stays a labelled code block; a diagram that does not parse stays one too, with one line of
error under it. A code span shaped like `board#id` renders as a tappable mention
chip; one naming this board opens that card in place. Card and notification
text alike paint through the shop's own CSS custom-property palette (light,
dark, and an explicit `data-theme` override for each), not literal hex.

## Archived packages

The build walks `archived/`
**recursively** (ADR 0010), so a card filed in an `archived/<package>/`
grouping folder embeds like any other archived card; the snapshot's own
`archive` op still writes to the `archived/` root, packages being
kanban-web's to choose.

## Review and blocked stickers

A card wears a gold "review" badge (card tile head, or a "review: `<text>`"
line on the detail sheet) whenever its `review` field passes the shared
sticker predicate (ADR 0009; the predicate lives in the kanban skill's
SKILL.md) — blocked's sibling: "finished, approve me" rather than blocked's
"stuck, act so I can proceed", and unlike blocked it never gates `doing`
entry. Both stickers are set/cleared the same way, through the "All fields"
grid (live gold/red border feedback while the value passes the predicate) —
there's no dedicated form field for either.

## Assignees

The create form's assignee suggestions come from the board registry
(`config.yaml` `assignees`); with no registry it suggests the
`@human`/`@hitl`/`@afk` role trio (GLOSSARY.md's Role trio glossary).
Every place an assignee handle shows (board tile meta line, the archived
sheet's read-only pill, the editable sheet's assignee pill) has its TEXT
tinted in that assignee's color — parity with kanban-web's own assignee
text tint: an `assignees[].color` reservation in `config.yaml` wins, else
the handle hashes into the same fixed 8-color palette kanban-web uses for
statuses (same hash, same hexes), so a handle colors identically on both
surfaces. An unregistered handle just hashes, same as an unlisted status.

## Nested cards

The page embeds `skills/web/web/nesting.js` as is, so which card sits under which,
outline order, the thread and the roll-up counts are kanban-web's own rules, with
nothing to sync by hand; `test/snapshot/nesting-embed.test.js` pins the embedded source to
that file, and the build refuses a module that could close its own script element.
The build reads that file from the kanban-web skill installed beside this one, so
install the two together: a snapshot-only install exits with a message naming the
missing file.

What the page draws with those answers is its own code, and three small helpers are
written twice, each beside a twin in kanban-web: `typeColor` (the type color match;
`typeColor` in `type-badge.js`), `rollupSegs` (the order of a roll-up bar's segments;
`rollupSegments` in `rollup-bar.js`) and `rollupBlock` (the sheet's counts and scope
line; `rollupBar` and `rollupScopeLine` in `rollup-bar.js`). Change one and change
its twin; `test/snapshot/nesting-parity.test.js` fails when they stop giving the same answers.

- **Type chips.** A card with a `type` wears a chip, in the color its `config.yaml`
  `types:` entry gives it (the names match without regard to case) and neutral when
  the entry has no color or the list does not name the type at all. A type whose
  entry sets an `icon:` (circle, square, diamond, triangle, hexagon or star, in any
  case) starts its chip with that glyph, in the chip's own color, wherever the page
  draws the chip; a type with no icon, or an unknown icon name, draws the plain chip:
  its name alone. The glyphs are kanban-web's own `skills/web/web/type-icons.js`,
  embedded as is (`test/snapshot/type-icons-embed.test.js` pins it to that file), and never
  the web's type chip module, whose two-argument color function would replace the
  page's own. The page also holds the board's `pills:` entries, a label and a query
  each, in config order. The readers of `icon:` and `pills:` are written twice, here
  and in kanban-web's `config-store.js`, and `test/snapshot/nesting-config.test.js` fails when
  they stop reading the same entries alike. The list only suggests: any word is a type.
- **Types off.** With `typesOn: false` in `config.yaml` the builder embeds no `types:` and no
  `hierarchy:` and a flag the page reads (`TYPES_ON`), as kanban-web's `boardTypeView` does:
  no type chip, color or icon on a tile or a Map node, no type pill in a card's sheet and no
  `type` field in All fields (so the page queues no change to a card's `type:` line), and the
  slices are the depths. The cards and the lists stay as written, and a line absent or not
  `false` means on. `test/snapshot/types-off.test.js` pins the reading to kanban-web's.
- **Outline order.** On a board where any card has a `rank` or a `parent`, every
  status section lists its cards in outline order: parents before their children,
  siblings by rank, then by priority (the `priorities:` order), then by id. A board
  with neither keeps its card order.
- **Roll-ups.** A parent card shows its altitude badge (the layers below it, `▲n`)
  and a thin bar of the status of the leaves under it. Its sheet opens the bar with
  the counts, says the roll-up counts this board only, and counts archived leaves
  as done, as kanban-web does.
- **The thread.** A card's sheet shows its parents above it, root first, and lists
  its children below the description in rank order. Each entry is a mention chip
  that opens that card. A parent on another board is named and marked not followed,
  a parent that is not on the board is marked unresolved, an archived parent is marked
  archived like an archived child, and a loop of parents is flagged where it repeats.
- **Changing type and parent.** The sheet's type pill picks from the declared types
  (plus the card's own and none), and the All fields grid always offers `type` and
  `parent` (an id such as `7` or `G3`, or `board#id` for another board's card). Both queue as an
  `edit` op's `fm`, like any other field, and a queued change shows at once in the
  chips, the order, the roll-ups and the thread.
- **Rank is not editable here.** The grid hides `rank` even on a card that has one,
  and no other control writes it (`references/gaps.md`, "No rank editing").

## The tray and the payload

1. The human taps cards and queues changes; the tray shows every pending op with a
   remove button. Two-tap confirm on delete is the speedbump.
2. The human taps "Copy changes" and pastes the payload into chat:
   `Apply kanban changes (N ops, base <ISO>):` followed by a JSON op array. Claude
   applies it per `references/apply-protocol.md`.
