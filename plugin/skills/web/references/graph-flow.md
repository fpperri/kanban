How the Graph's Flow graph works: lanes, columns, dependency arrows, the switches, the frontier, and how the choice is kept and addressed.

**Graph Flow** — the Graph's second graph, beside **Hierarchy** (the tier fan, `plugin/skills/web/references/graph.md`). The option
toolbar at the top right (`.graph-controls`, left of the (i) and the panel's button) has a **Hierarchy | Flow** choice (`.graph-kinds` of two `.graph-kind-btn`, `aria-pressed` on the one drawn, built by `graphBuildKinds`), Hierarchy first, with the panel open or shut;
under Flow the panel holds the zoom and the **Dependencies** and **Lanes** switches, and none of Hierarchy's option row.
Flow lays the drawn cards out by their dependencies (`waiting_for`, read among the cards drawn) in **columns** from left to right, with no parent line
and no tier wash; the words are the glossary's **Flow** and **Frontier**. The **Dependencies** switch is **all**
(the default) or **frontier**. **Frontier** counts the steps until a card is ready and only the dependencies that are not done (a card that
is `done` or archived is done): the first column is `done`, faded, then `ready now`, `1 step`, `2 steps` and on,
and a card in or behind a dependency loop stands in a last `loop` column. Only the open cards are read, so a loop with a done card in it is no loop.
**All** counts the longest chain of dependencies behind a card, done ones included: `waits for nothing`, `chain 1`,
`chain 2` and on, the members of a loop sharing one column. Each column is a shaded frame with a heading that prints its card count
(`ready now · 4`); the `done` column is faded. A card with **no dependency either way** among the drawn cards sits in a **strip** below the
columns, in either mode, titled `no dependency either way` with its count (`· 18 cards`). Within a column the cards are ordered to cut the
arrows that cross (the mean place of what each waits for and what waits for it, two sweeps each way), ties by id, and a column of more than
fourteen cards wraps into side-by-side stacks. The **Lanes** switch (`.graph-option-btn[data-key=lanes]`, `off` or `on`, on by default) groups the
cards that are in a column into **lanes**: each card with a dependency is in the lane of its nearest parent with a tier, else of its root (the slice's own rule,
read among the cards drawn, so a card whose parent is hidden is a root), under a header (`.graph-flow-lane-head`, with the lane card's `data-id`) that leads with that
card's type mark in its type colour (`data-type-color`, painted by `paintTypeColors`), its tier name (none for a card with no tier), `#id title`, the lane's
card count and its ready count; a card is ready when it is open, in no loop and waits for nothing that is not done, in either mode. The columns are made of the cards in the
lanes alone and stand across them, so a column's cards share one x whichever lane they are in, and the lanes' frames (`.graph-flow-lane`) replace the columns' shaded frames.
With frontier the lanes with ready cards come first, the most ready first, then the others in outline order; with all, every lane is in outline order. With frontier a lane
folds into the strip when none of its cards with a dependency is open (every such card is done), and the strip then reads `no open dependency`; a lane whose open cards wait only on done cards
stays, since those cards are ready now. With all no lane folds. A card with no dependency is in no lane but in the strip, so a lane's card count is the cards drawn in it
(`header.count`), not every card under its lane card. A header is its card's node: a `.graph-node.card-el.graph-flow-lane-head` with the card's `data-id` and `tabindex` 0, drawn after the arrows and before the dots,
so every handler of the dots (click, Shift/Ctrl-click, double-click, Enter, Ctrl+Space, hover and focus lighting, the card menu) takes it for that card, with the same items;
`graphCur.headEls` holds the headers by card, and a header and the dot of its card are lit and selected together. It is not a second dot: the card keeps its one dot. An **arrow** runs from the card waited for to the card that waits, leaving to the right
and arriving from the left with its head at the rim; a dot keeps its status colour and its type mark, grows with the waits it is in (a parent
does not enlarge it), and is faded in frontier when done or archived. A loop, a card that waits for itself and a chain of any
length never hang the drawing (the strongly connected parts are cut first, iteratively). Search lighting, the status pills, `slice:` cuts, isolate,
selection, the card menu, double-click, Enter, Ctrl+Space and the zoom work as in Hierarchy, on the same dots (`.graph-node.card-el[data-id]`): the cards
that are not drawn are not laid out, and a card whose only dependency is hidden has no dependency drawn, so it is in the strip. A lone selected card lights the card with the cards its **dependencies** join to it, not its parent or children, and hover and focus
light what the Flow's *On hover show* ticks (`dlinks` and `hlinks` by default, so those cards and the card's parent and children), and the lit lines are the arrows. A dot
cannot be dragged in Flow; the background pans. The choice is kept per board in `localStorage` under `graph.layout` (`hierarchy` or `flow`)
and the switches under `graph.deps` and `graph.lanes` (`1` or `0`); a value this version does not offer reads as Hierarchy, all and lanes on, the defaults (`GRAPH_FLOW_DEFAULT_DEPS`, `GRAPH_FLOW_DEFAULT_LANES`). The address carries them as
`graph=hierarchy|flow`, `deps=frontier|all` and `lanes=0|1`: on a load the address wins, and a link's value is kept for that load only until a press;
every draw of the Graph writes the address too (`graphWriteAddress`, a no-op once it says the picture), so a Graph that opened from the board's memory says so and a link copied after a plain reload opens the same picture;
a press replaces the page's address (`history.replaceState`, no step in Back) and leaves every other parameter, `deps` and `lanes` going when Hierarchy is
chosen. The choice and the switches are buttons that keep the selection; a press of a switch redraws the Flow and re-frames a view the person has
not moved. On a phone the panel is the **bottom sheet**, with the switches in it; the choice stays in the toolbar. The Flow's pure layout is `web/graph-flow.js` (`graphFlowPlace`),
read by `graph-model.js`; the snapshot has no Graph view, so it embeds none of it.
