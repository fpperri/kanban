The addresses the page opens and writes: `?card=`, `?q=`, `?view=` and isolate links, the card popup history, the tab icon and the Copy board path button.

**Deep links** — loading the app with `?card=<id>` (an id is a plain number or a prefix
and a number, `?card=G3`; `?card=0` opens card 0, which the page used to read as no card),
`?q=<search>` and/or
`?view=<board|map|gantt|calendar|graph>` in the URL switches to the named view, puts the
query in the box (which isolates it where the view's Typing isolates is ticked, and with `isolate=1` beside a
query always shows it as an isolate, see Isolate), opens that card's detail popup, and scrolls its representation
into view (found by `data-id` in whichever view container is now active, same lookup
the shared card-el grammar's click handler uses) — a bookmarkable or shared link
straight to one card, or to a set of them. **The three keys are independent**: `card`
points at ONE card, `q` points at a SET, `view` points at neither, so a link may carry
any combination and each is applied on its own. A querystring carrying none of them is
not a deep link at all and is ignored outright.
- **`q` is the board's own search grammar, verbatim** — whatever the Search section
  above parses is exactly what a link can carry (`?q=status%3Adoing&view=board`,
  `?q=assignee%3A%40human`, `?q=blocked%3A`). There is deliberately no second query
  language. The value is dropped straight into the search box, so the filter is
  visible, obviously the reason the board looks filtered, and one gesture clears it —
  it composes with the status-filter rows by intersection exactly as typed text does.
  An empty or whitespace-only `q` reads as absent, never as a filter matching
  everything. Because the query lands in the box rather than in a separate filter
  layer, `q` is subject to everything a typed query is — including matching archived
  cards (`kanban.proj#264`).
- **One unusable key never discards the others.** An unrecognized `view` value (or
  none) leaves the persisted/default view untouched; an id that doesn't resolve to any
  active or archived card (missing, not an id, or just unknown) shows a toast, no
  popup — but a `q` and a `view` that parsed fine are still applied. Only a link that
  actually carried a `card` key can produce that toast, so the status page's
  card-less links never fire one.
- **The address follows the box.** Whatever the search box holds is in the address as
  `q`: every write to the box (typing, the clear button, a cue click, Ctrl+F, a `?q=`
  link, and a click that selects a card) replaces `q` with the box's
  text, and an empty
  or blank box drops `q`; `card` and `view` ride along untouched. While isolate is on,
  `isolate=1` stands beside `q` (and goes with it when the box is emptied), written by the
  same listener. In a view whose Typing isolates is ticked, with the box holding a query and isolate off, `isolate=0`
  stands there instead, so a reload reopens the same picture: a link with `q` and `isolate=0` opens
  with isolate off (`parseDeepLink` reports `isolateOff`, and the page writes the box with the reason
  `link-lit`); a link with `q` and no isolate parameter, an old or hand-made one, turns isolate on where
  the view isolates what is typed; `isolate=1` opens isolated. Where the view's Typing isolates is unticked, the Graph to start with, no parameter means off, and none is
  written. The view switch brings the address in line too (`nextSearchAddress` takes whether to declare
  isolate off, `declareOff`, which is the view's Typing isolates setting and not its name). The address replaces
  the history entry the page is on and never pushes one, so typing adds no history
  entries (Back and Forward still step only between opened cards), and it replaces only
  when `q` would change. A browser may refuse a replacement when there are too many in
  a short time (Safari throws past 100 in 30 seconds): the refusal is let go, the
  address lags the box, and the next change to `q` catches it up. A reload, or a link copied from the address bar, opens with the same
  search through the deep link above, whatever the query holds. The link carries the
  box's text and not the selection, so a cut and isolate come back, but a pill shows off (its
  query is there as typed text and, outside the Graph, its matches are not selected). The
  poll never writes the address. Back and Forward never write the box: when one
  lands on an entry whose `q` differs from the box, the box keeps its text and that
  entry is replaced to carry it. Opening a card still takes one history step, which now
  carries the query too. `card-history.js` decides the new address (a pure function: the
  current address and the box's text in, the new address or nothing out); app.js applies
  it as one more listener of the search box's single writer.
- This is a one-time override, consumed exactly once right after the very first load
  — it composes with, but never fights, the 5s poll or the `localStorage`-persisted
  view mode (view.mode, above): the deep link's view isn't written back to storage, so
  a later plain reload with no querystring resumes wherever the view toggle last left
  it, with an empty box (the address carries a query only while the box holds one), and
  the poll's own re-renders never re-read the URL. Pure querystring parsing lives in `deep-link.js` (dual-environment export,
  same pattern as `refresh-policy.js`/`search-hotkey.js`); the search box, the view
  switch, the popup, and the scroll are app.js's job.

**Card popup history (Alt+Left/Alt+Right)** — opening the detail popup, from any
surface (a tile, a mention chip in a card body or the parent field, the notification
tray, or a map ghost node), and closing it are each a step in the browser's OWN
history: opening pushes a URL carrying `?card=<id>` (the other deep-link params
already on the URL — `q`, `view` — ride along untouched), closing pushes one with
`card` removed. That makes **Alt+Left/Alt+Right, the mouse back/forward buttons, and
the browser's own arrows all step between opened cards natively** — deliberately no
separate keyboard shortcut, so nothing fights the browser's own. Opening the card the
URL already names (clicking the same tile twice, or a mention of the card already
open) pushes nothing — no duplicate steps. A `popstate` (Back/Forward) reads the
landed-on URL and opens the named card or closes the popup to match; a card id that no
longer resolves — fails to fetch, not just missing from the last poll's stale snapshot —
closes quietly, no toast — routine Back/Forward traffic over a stale ref isn't a broken
link the way a hand-typed deep link's bad id is. `popstate` also does nothing at all
while any OTHER popup (the edit/new-card form, a bulk-edit popup, notifications) is
open, so Back/Forward can never yank the detail popup in underneath one and let a
follow-on Edit click silently overwrite typed changes. Reloading with a card open still
goes through the deep link above, unchanged — the URL already carries the id, so
there's nothing new to push. `openCard` pushes only once the card has actually loaded,
not before the fetch — a chip for a deleted/nonexistent card doesn't leave a phantom
step naming a card the popup isn't showing. The push/no-op decision and the
popstate-to-action read are both pure, in `card-history.js`
(dual-environment export, same pattern as `deep-link.js`); app.js's `openCard`/
`closeCard` wrappers apply it around `openDetailModal`/`closeDetailModal`, and the
`popstate` listener calls those two directly (never the wrappers), so a Back/Forward-
driven open or close never pushes a step of its own.

**Tab icon** — the plugin's official icon (canonical file `assets/icon.svg`, also shown in
the README and inlined in the snapshot page), served here as `favicon.svg` at
`/favicon.svg` and linked from `app.html`: a pink brain with four streams falling out of
it, fading into the backlog, todo, doing and done colors. `favicon.test.js` keeps this
copy identical to `assets/icon.svg` and the stream colors equal to `status-colors.js`. It is a served file rather than an inline `data:`
icon because the page's CSP loads images only from the board server.

**Copy board path** — a small ⧉ button inside the header title copies the board
directory's **absolute path** (the `GET /api/board` payload carries it as `boardDir`,
`path.resolve`d server-side — a relative path is useless pasted elsewhere). Same
clipboard ladder as the detail popup's "Copy path" button: async clipboard API first,
textarea+execCommand fallback on rejection or absence (load-bearing in VSCode's Simple
Browser, which doesn't grant the async API a secure context) — with a toast on BOTH
outcomes (the glyph-sized button has no room for the detail button's label swap).
Web-only by design — see GLOSSARY.md's parity table.
