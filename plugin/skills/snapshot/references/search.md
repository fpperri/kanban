# Search box and panel

Holds how the page's search box and the panel under it behave: the query grammar, the suggestions, the pills and slices, their counts, and the web modules the page embeds for them.

A search box under the header filters every view at once — the same query grammar
as kanban-web, because the page runs kanban-web's own search module
(`skills/web/web/search.js`, with the waiting rules in `skills/web/web/waiting-blocked.js`
and the slices in `skills/web/web/slices.js`),
embedded as is, so a query finds on the phone what it finds at the desk. Terms AND together,
and these forms go further, one example each: `|` is or and a space binds tighter, so
`tags:ui status:doing | #12` is ui and doing, or card 12; round brackets group and nest
(`tags:ui (status:doing | status:todo)`); a quoted value matches whole, ignoring case, or any
one element of a list (`tags:"grill"` finds a card tagged grill and not one tagged grilling),
a quoted `title:` or `body:` matches the whole field, and quoted text with no scope is a phrase
(`"two words"`); a bare `waiting:` finds the cards waiting for a card that is not done; and
`slice:<top>..<bottom>` cuts every view to a run of slices, which are the tiers of the
`hierarchy:` in `config.yaml`, top first, and then the depths of the cards with no tier, counted from the nearest tier card above (a card right under an epic is depth 0):
`slice:objective..2` keeps the objective tier down to depth 2, `slice:goal` is that one slice,
`slice:goal..` and `slice:..objective` leave an end open, a reversed pair is swapped, an end the
board does not have is left open, and a single unknown name, `slice:..` and a half-typed name
cut nothing. A board with no hierarchy cuts by depth (`slice:1` keeps the depth-1 cards), and
`slice:` combines like any term (`tags:ui (slice:goal | #12)`). The snapshot reads `group:<id or
name>`, `group:` and `-group:` too, but it draws no groups, so a `group:` term finds no card here and
`-group:` finds every card. Slices are counted over every
card of the board, archived ones included, as the page was built: a queued edit does not move a
card to another slice until it is applied, and a card queued with + New card sits where a new card
does, a root at depth 0 or the tier its type names, so a cut that holds depth 0 shows it and one that
cuts nothing cuts it nothing. The box suggests as the web's does, from the same
module, for a `slice:` token under the caret: after `slice:` and after
`..` a list under the box shows the board's slices, the tiers in hierarchy order and then the depth numbers from 0
to the deepest card with no tier, narrowed to the names that start with what is typed; a tap on a row writes the
whole term (`slice:goal..objective`), and a tier named with a space is written quoted, the quote
holding both ends (`slice:"big goal..2"`). A bare word opens no list here, since the web's
scope list for it would cover the panel on a phone. A `|` and a bracket count
only at a token's edge, so `a|b` and `fix(auth)` stay literal text, and so does `waiting:3`, while
`blocked: |review:` means `blocked: | review:`.
`#id`/`id:` exact (`<this board's name>#id` too),
`title:`/`body:`/`status:`/`priority:`/`tags:`/`file:`/`type:` scoped substrings,
`assignee:` (`a:` is its alias) is a case-insensitive substring match on the assignee handle,
bare terms hit title+body+tags. Edits still queued in the tray count: a card a
queued edit makes match shows under the query, `waiting:` included (a queued `waiting_for`
makes a card wait, and a queued move to done frees the cards that waited for it).
`review:`/`blocked:` (ADR 0009)
are their own family: UNLIKE every scope above, a bare `review:`/`blocked:`
(no value) is itself a complete term — "the sticker is present" (the shared
predicate) — never dropped as mid-typing; `review:PR`/`blocked:vendor` is a
case-insensitive substring match on the sticker's own text.
`hpath:<id>`/`htree:<id>`/`dpath:<id>`/`dtree:<id>` (`#`-tolerant) are the four sets of kanban-web's
Explore, each by one relation alone: the hierarchy path (the card's parents up to its root and every
card nested under it) and tree (the whole parent tree from its root) follow `parent:` only, the
dependency path (everything it waits for and everything waiting on it, transitively) and tree (its
connected set) follow `waiting_for` only; the page answers them over its own cards as kanban-web does.
`dlinks:<id>`/`hlinks:<id>` (`#`-tolerant) are a card's direct neighbours, one hop: `dlinks:` the card, what
it waits for and what waits on it, `hlinks:` the card, its parent and its children. The search knows them as
kanban-web's does; the sheet and the card menu offer no item for them.
`tree:<id>`/`path:<id>`
(`#`-tolerant, e.g. `tree:#153`): tree is the card's whole dependency
component (undirected flood-fill over `waiting_for` + `parent:`
relations, the ones the Map's trees are made of); path is the narrower
directed cone through the card (everything transitively upstream +
downstream). An unknown id matches nothing; an isolated card is a component
of one; traversal always runs over the full live + archived card set
regardless of the current query or status pills (the Archive pill still
gates *display* of an archived member, never whether it counts for
connectivity), and the resolved id set intersects normally with every other
term and pill, same as any other search term.

The search box has a panel of slices and pills under it, kanban-web's panel without its Isolate
switch. The arrow at the box's right end is a switch (`aria-pressed`): with it on, the default,
focusing the box opens the panel. A click on the arrow switches it off, which closes the panel
now and stops the box opening it, and a second click switches it on and opens the panel; the
`p` key flips the same switch, except while a field has focus or a card sheet or a card menu is
up. Esc closes an open panel (a card sheet or a card menu takes Esc first),
with focus going back to the arrow, or staying in the box when Esc was pressed there, and the
box keeps its text. A press anywhere outside the search bar closes it too, leaving the switch as
it was. The panel hangs from the box and adds nothing to the header's height. The switch and the
two folds are kept for the visit only, since the page has no preferences sheet.

The **pill section** lists blocked, review and waiting, then the board's own pills, the `pills:` entries
of `config.yaml` in the order written, a label and a query each. A `field:*` entry (`tags:*`,
`assignee:*`, and also `status:*`, `priority:*` and `type:*`) stands for one pill per value among
the board's live cards, each matching its value exactly (`tags:"grill"`, which never catches
`grilling`); the first eight values of a field show and the rest sit behind a **+N more** button,
which opens them and folds them again. Pills filter, by the status pills' rules: a click turns a
pill on, its query joining the box as one more alternative (`review: | blocked:` after review and
then blocked), and a click on a pill that is on turns it off, taking only its query out of the box;
a right-click keeps only that pill, the box holding its query alone, and a right-click on the pill
that is alone turns it off. A pill is on while the box holds its query as one of its alternatives,
so typing a pill's query turns the pill on and typing anything else turns it off. A pill is a
button with `aria-pressed`, and its accessible name says its label and its count. A pill click only
writes the box: there is no selection here to take an anchor or an addition.

The **slice section**, folded to start, lists the tiers of `hierarchy:` that some card of the board
is in (live or archived), each with the icon its type has in `types:`, and then every depth. The
entries in the run are pressed. A click on an entry outside the run grows it, a click on an end
drops that end, a click on a run of one removes the cut, and a click inside the run that is not an
end changes nothing; a right-click, the context-menu key and Shift+F10 on a focused entry keep only
that slice. The run is the `slice:` term the box holds, written as the web writes it, so a run
that reaches an end of the list leaves that end open (`slice:strategy..`). `[` and `]` move the
bottom of the run up and down and `{` and `}` move its top, with the panel open or closed, except
while a field has focus or a card sheet or a card menu is up (queued edits do not stop them); a chord is not them,
and AltGr, which types the brackets on a layout with none of its own, is not a chord. A slice
entry's accessible name says its label, its count and whether it is in the run. The right-click
on a pill or a slice entry, and the context-menu key and Shift+F10 on a pill, run only where the
pointer is fine and hovers, the gate the card menu keeps: on a phone a long-press neither keeps a
pill alone nor keeps only a slice, and the browser's own menu shows. There a tap on a pill turns it
on or off, and a tap on a slice entry grows the run, drops an end or removes the cut, so one slice
is reached by dropping the ends. The context-menu key and Shift+F10 on a slice entry are keys the
page handles itself, and keep only that slice with any pointer.

Every count is taken over the cards left after the status pills and the Archive pill, before the box
and the cut, and a queued edit counts as it does under the box; so turning a pill on or setting a
cut leaves every other count as it was, hiding Done takes the done cards out of them, and a run
never zeroes the entries needed to grow it again. A count changes in the button it is in, so a
button that has focus keeps it. With the panel closed, a chip in the box counts the pills that are
on and a run that cuts, and its accessible name says which (`2 on: review, slice goal..strategy`);
with nothing on there is no chip. Tab reaches the arrow, both fold controls, every slice entry and
every pill, and Enter and Space act as a click. The pill list and the run of slices are kanban-web's
own `skills/web/web/pills.js` and `skills/web/web/slice-run.js`, embedded as they are
(`test/snapshot/pills-embed.test.js` and `test/snapshot/slice-run-embed.test.js` pin them to those files), and so are the
key guard's check for a field with focus (`skills/web/web/key-guard.js`), the rule for a chord (in
`slice-run.js`) and the suggestion list's step (`skills/web/web/combobox.js`); the drawing
and the gestures are the page's own, and `test/snapshot/panel-pills.test.js` and `test/snapshot/panel-slices.test.js`
hold its counts and its terms to the web's. The hint texts on the pills, the slice entries and the
panel's arrow are strings of kanban-web's page scripts, which need a DOM and are not embedded, so
`test/snapshot/panel-copies.test.js` holds the page's copy of each to the web's source.
