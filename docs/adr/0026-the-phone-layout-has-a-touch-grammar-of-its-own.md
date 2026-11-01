# 0026. The phone layout has a touch grammar of its own

Date: 2026-11-01 · Status: accepted

## Context

[ADR 0006](0006-one-interaction-grammar.md) gives every view one grammar for
cards: a click opens the card, or selects it where the preferences say so, and
the selection grows by Ctrl and Shift click and by the right-click menu. That
grammar was written for a mouse and a keyboard. The phone layout (under 760 px)
left the selection gestures out, so on a phone the only way to act on several
cards was the card menu, one card at a time, and a tap opened every card it
touched.

A phone has no Ctrl, no Shift and no hover. Picking five cards should be five
taps, and reading one card should stay two.

## Decision

**The phone layout has a touch grammar of its own, beside ADR 0006's.** Each
width has one grammar for every view, and the two differ only where the input
does:

- **A tap on a card toggles it.** It joins the selection (the first card is the
  anchor, later ones are additions) or, when it is already selected, leaves it.
  Where a click replaces the selection at the desk, a tap toggles on the phone,
  because there is no other way to take one card out.
- **A double tap opens the card and leaves the selection as it was.** The page
  reads it as the second click of a pair (a `click` the browser counts as 2),
  the way it reads a peek, and puts the selection and its range start back as
  they were before the first tap, through the step Esc and a double click on
  empty space use (`moveSelectionTo`), so the search box follows. A double tap
  that has no first tap on the same card to undo is a first tap. A third tap is a
  first tap again.
- **The tap choice is the phone's own.** The preferences sheet shows *A tap on a
  card*, opens or selects for the Board, Map, Gantt and Calendar, with the Graph
  fixed at selects, in place of *A plain click on a card* under the width line.
  It is kept in the board's `prefs` entry as `tap`, beside the desk's `click`,
  and defaults to selects. The two maps never read each other, and the desk's
  map, its defaults and its stored values do not change.
- **Modifiers and cues mean the same at every width.** Ctrl, Cmd and Shift click
  still toggle and range, a tap on a tag, an assignee, a blocked or a review pill
  still searches for it, and Enter on a focused card opens it where the layout's
  plain gesture selects.
- **The Graph follows the same decision.** It paints a selection in place and
  catches its own dot clicks, so its click handler asks the same function, and
  on the phone layout its `dblclick` listener leaves the second tap alone, which
  has already opened the card.

**The width line decides, not touch.** The phone layout is the width the app
already uses (`onPhoneLayout()`, under 760 px), so a narrow desktop window gets
this grammar and a tablet wider than the line keeps the desk's.

**The rule stays in one pure place.** `cardClickAction` takes the layout
(`phone`) and returns `toggle` for a tap and `restore-open` for the second tap;
`plainBehaviour` resolves the plain gesture for a view from the layout and the
two maps; `selectionBeforeTap` finds the selection a double tap goes back to.
The page asks them and carries the answer out; no code outside them tests the
width to decide a click.

ADR 0006 is not edited. Gestures that join the phone layout later add to this
record under Amendments, as 0006's did.

## Considered options

- **Detect touch (`pointer: coarse`) instead of the width line.** Rejected: the
  layout, the status tabs and the view bar already follow the width line, and a
  grammar that followed the pointer would disagree with them on a narrow window
  and on a tablet.
- **One shared click choice with a phone default.** Rejected: saving any
  preference writes `opens` for all four views, so a browser that chose nothing
  cannot be told from one that chose opens, and the new default would reach only
  browsers that had never saved. A separate `tap` key gives every browser the
  phone default and leaves the desk's stored values alone.
- **A third click value, `toggles`.** Rejected: it would change the desk's
  choices and their stored values for a difference that is only the phone's.
- **Time the two taps in the page.** Rejected: the browser already counts them,
  and the page's own timer would have to agree with the browser's tap window.

## Consequences

- A tap no longer opens a card on the phone by default. Anyone who wants the old
  behaviour sets *A tap on a card* to opens for a view; opening is otherwise two
  taps, or Enter.
- The double tap rests on the browser's click count. Chromium counts a second tap
  within about 250 ms as a click with `detail` 2; a browser that does not would
  toggle twice. The browser scenarios send the second tap straight after the
  first, with no pause a throttled page could stretch.
- A browser with `tap` unsaved reads selects, so existing browsers get the phone
  default without a migration, and saving any preference now writes `tap` too.
- The desk's double click on a view that selects stays a peek: it leaves the
  selection as the first click made it. Only the phone's double tap puts the
  selection back, because only there did the first tap toggle a card the person
  meant to open.
