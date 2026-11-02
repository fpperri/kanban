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
width has one grammar for every view, and the two differ where the input does (a
finger has no Ctrl, no Shift and no hover) and in one order of events: while the
card menu is open, a tap outside it only closes it on the phone layout, and the
desk keeps its order (the click works and the menu closes):

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
- **A long press lights a card and opens its menu when the finger lifts.** The
  page runs its own hold on a card (500 ms, 10 px of slop; `card-press.js`)
  rather than wait for the browser's `contextmenu`: iOS fires none for a long
  press, and Android fires one while the finger is still down. The browser's
  `contextmenu` and the click the lifted finger makes are held back while a press
  is on and for 800 ms after it (the echo), so the menu opens once. The hold lights
  the card and the sets *On hover show* ticks; the menu opens at the lift, not
  when the hold fires, so that a hold can still turn into a drag. A tap outside
  the open menu only closes it, since it would otherwise close the menu and act on
  whatever lay under it. The menu offers **Select lit (N)**, which adds the lit
  cards the view shows to the selection.
- **The light is a state of its own, apart from the hover.** Opening the menu moves
  the focus, which ends the hover, so the light a long press makes is pinned
  (`pinnedLitId`): it wins over the hover while it lasts, and ends on the next tap,
  on the move that turns the hold into a drag, on Back and on Esc. It is a look at
  relations and not the selection: a lit card is not picked until Select lit adds it.
- **A hold and then a drag selects on the Board.** After the hold, a finger that
  moves adds every tile it passes over, in place, with one draw when it lifts, and no
  menu opens. The browser decides at the touchstart whether the moves after it can be
  cancelled, so the Board's non-passive `touchmove` is bound once with the page and
  cancels the scroll from the hold on. The Calendar's and the Gantt's drags keep
  moving dates, as they did.
- **The selection bar acts on what is picked.** A bar at the bottom of the phone
  layout, above the view bar, reads "N selected" with Clear, Archive, Status and
  More, and acts through the menu subject and the bulk entries the card menu already
  has. Because it takes the page's room, it follows a tap on a card only once the
  double-tap window has passed with no finger down (`DOUBLE_CLICK_MS`), so a double
  tap on a card at the foot of a list lands twice on the same card; every other write
  to the selection moves it at once.
- **Android Back steps back as Esc does, through an entry of the page's own.** A
  phone has no Esc. While a card menu, an in-page question, a light or a selection
  stands, the page keeps one history entry of its own, marked in its history state
  (`back-steps.js`); the Back that pops it runs one step of Esc, in Esc's order, and
  the page goes forward to the entry again while something is left. With nothing
  lit or selected there is no entry and Back is the browser's. The page makes its
  entry from a tap, and never from a Back: Chromium's history manipulation
  intervention makes the Back button skip every entry of a document that added one
  without a user activation, and a back or forward ends the activation, so an entry
  pushed to answer a Back would be skipped by the next press and the page left with the
  selection standing. Going forward to the entry adds none. The entry waits out the
  double-tap window before it is kept, so a double tap leaves none, and every state the
  page pushes carries a rising number, so that a Forward is told from the Back that
  pops the entry. An entry nothing wants any more is taken off by the page itself, a
  traversal inside the page's own entries that a sandboxed frame (the Board artifact in
  its viewer) may make. A card opened from a link is the first entry of the page's
  history, with nothing of the page's below it: there a Back cannot step what stands
  behind the details (a known limit).

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
  and a timer of the page's own would have to agree with the browser's tap window.
  The double tap itself rests on the click count; the page keeps timers only for what
  must wait out that window (the selection bar's, the Back entry's), and they are
  tied to it and do not count taps.
- **Open the card menu when the hold fires.** Rejected: a hold could then never turn
  into a drag.
- **No entry for Back: leave it as the browser's.** Rejected: Back would leave the
  page with the selection standing, and a phone has no other way to undo it.
- **Make the entry when a Back asks for it.** Rejected: the browser's Back button
  skips an entry made without a tap, so the next press would leave the page.

## Consequences

- A tap no longer opens a card on the phone by default. Anyone who wants the old
  behaviour sets *A tap on a card* to opens for a view; opening is otherwise two
  taps, or Enter.
- The double tap rests on the browser's click count (`detail` 2); a browser that
  does not count would toggle twice. The window is Android's 300 ms. Desktop Chrome
  counts a second tap up to about 400 ms, in a narrow window and in the browser
  scenarios (touch emulation, mobile metrics), and a mouse double click the
  system's time (500 ms on Windows). The scenarios send both a straight double tap
  (the second finger down a few milliseconds after the first lifts, which no hand
  does, and which once hid a bug) and a paced one (a real gap of 200 ms).
- The page's timers that wait out the window are tied to it. The selection bar's
  wait is 300 ms, Android's window, the one the Calendar's empty hour waits out; the
  Back entry's settle is 400 ms, the longer window desktop Chrome counts, so a double
  tap leaves no entry. A slower desktop double tap in a narrow window, or a mouse
  double click, can still meet the bar: the bar follows the first tap before the
  second lands.
- A browser with `tap` unsaved reads selects, so existing browsers get the phone
  default without a migration, and saving any preference now writes `tap` too.
- The desk's double click on a view that selects stays a peek: it leaves the
  selection as the first click made it. Only the phone's double tap puts the
  selection back, because only there did the first tap toggle a card the person
  meant to open.
