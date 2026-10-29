How the Calendar view works: the month grid and the shorter spans, the time grid, creating and resizing by drag, the notes strip and the jump to a match.

**Calendar view** — a top-bar "Calendar" button (a line icon, then the word) swaps the board for a month grid
(weeks start Monday; prev/next/Today controls; outside-month days on the raised ground, today
highlighted). Live cards by default; dated ARCHIVED cards join too, opt-in via the
Archive pill below. The **working range** (start→end inclusive; compat: start→due when
there's no end date) renders as ONE chip spanning its real day columns, not a chip
per day — laid over the day cells on a packed row, so disjoint runs share a row and
overlapping ones stack. A run crossing a week boundary is cut into one piece per week
row (a DOM element can't span the wrap), each cut edge squared + dashed like the
all-day band's window-clipped spans; a run reaching past the grid's own first/last
cell is cut the same way. A one-date range is a single-column chip; a reversed range
collapses to one chip at the range end. The **due date** renders as its own
deadline chip (amber border + ⚑ flag, red once **overdue**) on its due day — even
when the range already covers that day. Datetime values show their time on the
piece holding the range's true end day.
Weeks needing more than 4 chip rows fold the rest into a tooltip-titled "+N more" line
for that week (each week row has its own budget). Chips carry the
shared grammar: click opens the detail popup, ctrl-click toggles / shift-click
range-selects (all chips of that card highlight together), right-click opens the bulk
menu; a click on an empty day cell leaves the selection, and a double click starts a new
card there (**Click-to-create** below). Dragging a **range chip** moves
the range: the drop day becomes the range end and the start shifts by the same delta
(duration + times-of-day preserved), writing the fields the range actually used — a
compat range shifts start + due and never invents an end date. One-date ranges move
their one field. Dragging the **due chip** moves the due date alone (time preserved) —
on a compat card that also moves the rendered range's end, since due IS that range's
end field. Same-day drops don't write. Composes with search exactly like the board;
the displayed month + query survive the poll. Board/map/calendar/gantt/graph is a five-way
switch persisted per board in `localStorage` (unknown saved values fall back to
board).
**Jump to the nearest match** — when a change to the search box leaves no shown match
inside the visible range, the Calendar jumps to the match nearest it, before or after
(`nearestMatchDay`, calendar-model.js; one pure function for the Calendar and the
Gantt). It works in the month, week, 3-day and day spans. The month counts every cell of
its grid, leading and trailing days included, and a card counts by any day of its
schedule span or by its due date. Shown means drawn: a match hidden by a status pill, or
an archived match while the Archive pill is off, is not on screen and not a target, and a
card with no schedule and no due date is never a target. A match before the range and
one after it at the same distance resolve to the earlier day. An empty box has no
matches, so clearing it moves nothing. Every write to the box makes the check (typing,
a cue click, Path or Tree from a card's menu, a `?q=` link, and any later writer, since
the jump is a listener of the one search-box writer); so does entering the Calendar,
once, so a query already in the box shows its month. A poll, a re-render, Today and
paging with previous and next never jump, so after a jump paging works as usual.
**Status-filter row** — no row sits above the grid: the status pills (month AND every sub-view alike) sit in the search panel's Statuses section, sharing the Map's pill mechanism rather than a duplicate: one toggle per LIVE board status in column order, all ON by default, PLUS
an Archive pseudo-pill (same id list as the gantt's row) that defaults **OFF** — the
base calendar stays live-only until a human opts in (same merge helper as the gantt's
row: a saved value with no `archive` key merges in OFF, never ON). Flipping Archive ON
adds every dated ARCHIVED card (search-filtered, ungoverned by the live status
pills — same as the gantt's Archive group) to BOTH the month grid and the time grid's
all-day band/hour rows. An archived chip gets the shared **Archived ball** right after
its status dot, is not draggable (native drag never starts, so unlike the gantt's
pointer-drag there's no fake-drag animation to guard against), and shows a not-allowed
cursor. Its priority/waiting left-accent keeps showing — a separate channel from the
archived cue, same as the gantt bar (an archived-and-high-priority card still reads
high). Persists per board in `localStorage` under its own key
(`calendar.statusFilter`, same defensive-merge discipline as
`map.statusFilter`/`gantt.statusFilter`) and composes with search by the same
**intersection** rule the map/gantt use (the search pool itself spans live + archived
unconditionally — harmless while the pill is off). A live-status pill OFF drops that
status's chips from the grid outright via the gantt's visible-ids helper (not the
map's column-bucketing one) — the calendar doesn't bucket cards into board columns any
more than the gantt does, so an on-disk status the `statuses` list doesn't include
stays ungoverned by any pill, same as the gantt, rather than riding an unrelated
toggle. The section is there unconditionally ("always leave a control to turn a pill back on") and shares the pill interaction grammar (left toggle, right solo) with the Map's and the Gantt's pills.
**Sub-views** — the calendar header carries an Outlook/Teams-style
Month | Week | 3 days | Day switcher (persisted per board under `calendar.subview`;
unknown saved values fall back to Month, which is exactly the grid above). Sub-month
views show one column per day (week starts Monday; 3 days = anchor day + the next two;
today's column highlighted): an **"all day" band** on top holds date-only cards and
multi-day ranges (spans cover their real columns and pack into shared rows; a span cut
by the window edge squares off + dashes on the cut side), and a scrollable **24-hour
grid** below places datetime-carrying cards at their time — a same-day datetime
start→end spans its real duration, a lone time-point (datetime start/end/due without a
counterpart) gets a default 60-minute block, and overlapping blocks share the column
side-by-side. prev/next/Today step by the active view's span; ONE anchor day drives
all four sub-views, so the displayed window carries across switches and survives the
poll. Chips keep the shared grammar. The all-day band and month grid keep the native
day-granular drag (date moves, time-of-day preserved) — including date-only cards.
Dropping a date-only all-day chip onto the hour grid still only moves its DATE — the
drop target there is day-granular, so no time is ever invented; it lands back in the
all-day band on the new day. Assigning a time via a drag is out of scope (no crossing
between the all-day band and the timed grid) — add a time by editing the card.
**Time-grid drag/resize** — the hour-grid timed blocks (week/3day/day) get
minute-granular retiming via a custom pointer-drag (like the gantt's, but in MINUTES
within a day — native HTML5 drag can't give continuous pixel deltas), so a timed block
is `draggable:false` and this system owns it; the all-day/month chips keep native
drag. **Body-drag** moves the block on BOTH axes — the column under the pointer is the
new day, the y-position (snapped to a 15-min grid) the new start time; a real duration
keeps its length (clamped inside the day), a one-time point moves its timed field (its
date-only sibling follows the day so a same-day range never splits), the due block
moves `due_date` alone. **Edge handles** (a thin strip top and bottom, `ns-resize`)
appear ONLY on a real same-day duration block: top handle = start time, bottom = end
time, each clamped to a 15-min minimum span and the `[00:00, 23:59]` day bounds — a
compat range's bottom handle edits `due_date` and never invents an `end_date`, same
fields contract as every other drag. All math is pure calendar-model.js functions,
null on a zero-delta so an accidental twitch never spends a PATCH or `updated` bump.
The gesture reuses the gantt's interaction grammar: `>3px` before a drag commits (an
unmoved press is a click → detail popup), a one-shot phantom-click suppressor,
drag-in-progress poll guards, and the archived-read-only guard (a toast, before any
pointer capture). Deliberately out of scope: resize handles on point/due blocks (that
would *create* a missing field, a distinct feature), dragging a timed block into the
all-day band or vice-versa, cross-midnight/multi-day resize, and auto-scroll near the
grid edge.
**Click-to-create** — a double click on empty calendar space creates a card, and a single
click there leaves the selection. ADR 0006's 2026-10-15 amendment clears the selection on
a double click on empty space everywhere else, and the day cells and time-grid columns keep
theirs for create, so a create never clears a selection. Double-clicking
empty space in the month grid, the all-day band, or a time-grid day column opens the
create modal pre-aimed at the click, same hidden-field-submits-while-minimal trick as
the column "+" but for the start date alone — month/all-day gives a date-only
`start_date`; a time-grid slot gives a `YYYY-MM-DDTHH:MM` snapped to the same 15-min
grid the drag/resize uses. Only `start_date` is pre-filled — never `due_date`
(ADR 0007: start is the working range's "from") — and status is left at the modal's
own default, unlike the column "+", since a calendar cell doesn't imply one. A
double-click landing on a chip is the chip's own affair (the shared card grammar),
excluded before the cell/column lookup ever runs. The snapshot's own calendar has no
click-to-create — a deliberate, unbuilt gap.
**Notes on the Calendar** — on a board with a logbook the week, 3-day and day views draw its
notes: a day with timed notes keeps a strip at the right of its column (`--cal-note-strip`),
with a chip for one note in a half hour and a count bubble for more, and the day's untimed
notes are one box in its all-day cell; the toolbar's **Notes** button switches the layer
(`calendar.notes`). A **divider** on the strip's left edge (`.cal-note-divider`, a focusable
`role="separator"`) sets the strip's width for every day column at once: a pointer drag moves
it live, without a re-render, from 44px to the column less a 24px sliver for the card blocks
(`noteStripClamp`, notes-calendar.js), and the width is saved when the pointer lets go; Left
and Right on the focused divider step it 8px; a double click goes back to the default,
`clamp(44px, 34%, 170px)`. It is kept per board in this browser as `calendar.notesWidth`
(every read and write in try/catch) and drawn as the custom property `--cal-note-width` on
the time grid, which each column's strip reads; once a width is set the 170px cap is gone and
a chip shows up to 60 words instead of 12, cut by its edge. A drag holds the poll
(`isDragging`), starts no card drag or retime, and the hour click and the double click that
makes a card both skip a target on the divider.
