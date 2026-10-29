How the Gantt view works: the day-granular bars, groups, labels, the today line, drag and resize, and the jump to a match.

**Gantt view** — a top-bar "Gantt" button (a line icon, then the word) swaps the board for a day-granular
timeline: each dated live card gets a row (dated ARCHIVED cards join too, opt-in via
the Archive pill below) — the **working range** as a bar (start→end inclusive; compat
start→due; one-date and reversed ranges collapse to a 1-day bar — same shapes as the
calendar) and/or its **due date** as an amber diamond marker (red once **overdue**; a due-only card shows
only the diamond, no bar) — grouped by status in board column order with a slim label
row per non-empty group, ids ascending within it. A fixed left gutter lists #id +
title per row; only the timeline half scrolls horizontally. Mondays are labeled with
the date and a vertical "today" line marks the current day.
**Sub-views** — the gantt header carries the calendar's own
Outlook/Teams-style switch, built the same way and reusing its exact classes
(`.cal-controls`/`.cal-nav`/`.cal-title`/`.cal-subview-switch`), with a leading **All**
entry ahead of Month | Week | 3 days | Day, persisted per board under
`gantt.subview` (unknown saved values fall back to All). **All** is the DEFAULT and is
the ORIGINAL fit-everything window unchanged: it spans the rendered bars AND diamonds,
padded 3 days each side, clamped to at most 180 days centered on today (slid to stay
inside the data's range) when a board sprawls wider — re-derived from the cards on
every render, same as before this sub-view switch existed. A SIZED sub-view
(Month/Week/3 days/Day) instead pages a fixed-span window around one anchor day
(`ganttSubviewWindow`, gantt-model.js; week starts Monday, 3 days = anchor + the next
two, month = that calendar month's own days with no leading/trailing padding — a linear
timeline has no week rows to square off) — prev/next/Today step it by the active
sub-view's span, reusing the calendar's own `shiftAnchorDay`/`subviewTitle`
(calendar-model.js) verbatim, since that math has nothing calendar-specific in it. The
arrows and Today are disabled while All is active (no anchor day to page from). Once a
sized sub-view makes days wide enough, the axis names every day (`dayMarkLabel`: day
numbers for a month, weekday and number for a week or less) instead of Mondays only. A bar
or diamond entirely outside whichever window is active draws nothing (its gutter label
still lists it); one that starts or ends outside is clipped on the cut side, exactly as
before — the window never drops a bar, only clips or hides its drawing. The day-column
width (`ganttDayPx`, gantt-model.js) is GANTT_DAY_PX (24px, horizontally scrollable)
for All, unchanged; a sized sub-view instead fills the scroller's measured width so its
whole window shows with no horizontal scroll — the SAME value then drives the drag math
(a live module var, set every render) so a drag still moves a bar by whole days in
every sub-view, keeping layout and drag math in one place exactly as GANTT_DAY_PX did.
Bars use the map view's status palette plus the board's priority/waiting left-accent
cues. Bars, diamonds, **and gutter labels** carry the shared grammar: click opens the
detail popup (the label is the only click target for a bar scrolled or clipped out of
view), ctrl-click toggles / shift-click range-selects, right-click opens the bulk
menu — a drag is never treated as a click (>3px of movement commits the drag and
suppresses the click). Drag the bar body to shift the range by whole days (duration +
times-of-day preserved), writing the fields the range actually used — a compat range
shifts start + due, never inventing an end date; drag an edge to move that range
endpoint alone (start handle → start date, end handle → end date, EXCEPT compat
ranges where the end handle edits the due date — the field the range used), clamped at
a 1-day bar minimum (an end-only bar's start handle *creates* a start date; a
start-only bar's end handle *creates* an end date); drag the diamond horizontally to
move the due date alone — on a compat card that also moves the rendered range's end,
since due IS that range's end field. Same-position drops don't write. Dragging a bar
clipped by the window edge edits the card's true dates — the visible clip edge may not
appear to move until the window re-derives. A CUT side (`.clip-start`/`.clip-end`)
offers no resize handle at all — that handle would sit on the window edge, not the
card's true date, and `barResizeChanges` always resizes the true edge, so a handle
drawn there would preview one date and write a different one; a press on that end of
the bar falls through to an ordinary body drag (shift) instead. No dependency arrows —
the map view owns the `waiting_for` graph.
**Jump to the nearest match** — the Calendar's jump (`plugin/skills/web/references/calendar.md`), by the same function, in the
Month, Week, 3 days and Day sub-views: when a change to the search box leaves no shown
match inside the window the sub-view draws, the anchor moves to the nearest match. A
Month is the month's own days, with no leading or trailing days, because the Gantt draws
none. **All** never jumps, since it already fits every dated card. Entering the Gantt
makes the check once; a poll, a re-render and paging never do.
**Status-filter row** — no row sits above the timeline: the status pills sit in the search panel's Statuses section, sharing the Map's pill mechanism: one toggle per LIVE board status in column order, all ON by default, PLUS
an Archive pseudo-pill (same id list as the map's row) that defaults **OFF** —
archived rows are opt-in, so the base gantt stays live-only. Flipping Archive ON
appends ONE more group AFTER the live status groups — every dated ARCHIVED card,
regardless of its own parked on-disk status (gantt-model.js) — same "location after
live columns" placement as the board's Archive column. Archived rows split across two
channels, deliberately: the BAR's border/fill and the group label key off the literal
`'archive'` string, which `statusColor()` mutes to the neutral archive grey — a
row-level archived cue, same as the bar's not-allowed drag
cursor — while the gutter row's own status dot does NOT follow that mute (status dots
never mute, gantt gutter included) and colors off the card's true on-disk status
regardless of `card.archived`. The rendered window includes archived bars/diamonds
ONLY while the pill is on — turning it off narrows the window back to the live data,
same re-derive-from-what's-rendered rule below. Persists per board in `localStorage`
under its own key (`gantt.statusFilter`, same defensive-merge discipline as
`map.statusFilter` but its own default-shape merge helper: a saved value with no
`archive` key merges in the OFF default, never ON) and composes with search by the
same **intersection** rule the map uses — search spans live + archived cards alike,
though only archived ones that also survive the Archive pill (and any status pills)
ever render. A live-status pill OFF drops that status's rows from the timeline
outright — there's no dependency graph here for a hidden row to ghost into, so the
window simply re-derives from whatever bars remain (may narrow); everything filtered
out shows "No cards match the current search/status filters.", distinct from the plain
"No dated cards" message. An on-disk status the `statuses` list doesn't include gets
no pill of its own and is **never governed by one** — unlike the map/board's
catch-all-first-column rule, the gantt gives an unlisted status its own separate
labeled group row, visible regardless of every pill's state, rather than silently
riding an unrelated toggle. The shared pill interaction grammar applies here too,
Archive pill included: left-click toggles it; right-click SOLOs it (soloing a live
status turns Archive off too; soloing Archive shows archived rows only);
right-clicking the already-soloed pill again restores ALL pills on, Archive included —
the solo rule is fully generic over its id list, so the Archive pill just joins the id
list the gantt feeds it. View mode persists via the shared switch; the All window
re-derives from the cards on each poll (a sized sub-view's window instead re-derives
from its own anchor day + span, not from the cards) while the timeline's horizontal
scroll position is carried across re-renders.
