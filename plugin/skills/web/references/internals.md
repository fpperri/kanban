The page's implementation notes: the modules, functions, DOM ids, selectors, storage keys and listener wiring behind the behaviour `docs/web.md` describes.

## Config-driven columns

### Status colors
The values live in status-colors.js (`themeColorTokens`), and anything painted from script uses `statusColorVar()` so it follows the theme too.

## Search panel

### The stored choice of the switch
The choice is kept in the browser per board, in the board's own `prefs` entry, and the preferences sheet shows and sets it.

### The fold of the five sections
The same fold code serves all five (`searchFoldSection`, `search-panel.js`).

### Pill buttons
The pills are `.query-pill` buttons, never the status pills' classes.

## Markdown body

### Renderer and the page's Markdown plumbing
**Markdown body** — the detail popup renders the card body through `markdownInto()` (`markdown-ui.js`), which draws `mdToHtml()` from `markdown.js`, the one hand-rolled, dependency-free renderer that the scratchpad's Preview and the snapshot's card sheet use too (the snapshot embeds the same file and draws its parse as DOM nodes). It reads the raw text into a tree of blocks and inline tokens (`parseMarkdown`) and writes the HTML escaping every piece of text and every attribute value as it goes, so a body never holds a live tag. A fence with a language shows it as a label and a **Copy** button (one delegated listener in `markdown-ui.js`) and keeps it as `data-lang` on the `pre`; the language is cut to `[A-Za-z0-9_+#.-]`. Every scan for a closing mark remembers where one failed, and quotes, sections and inline marks nest only so deep, so a body of 60 KB of openers renders in milliseconds (a test holds a time budget); an unknown node in the tree draws as its escaped text.

### Code blocks loader, libraries and the diagram frame
After the text is written, `markdownInto()` hands the element to the code blocks loader (`code-blocks.js`, `createCodeBlocks(config)`, shared with the snapshot; the page hands it its vendored addresses, each with its version in a `?v=` query), which asks `kanbanCodeLibs` (`code-libs.js`: the highlight.js language names and aliases, the pinned versions) what each typed block needs and loads only that, on the first block that does: **highlight.js** (`web/vendor/highlight.js`, the common-languages build with its light and dark GitHub themes, one on at a time as the page's theme says) colours a fence in a language it knows, setting `language-<name>` on the `code` and calling `hljs.highlightElement`. A ```mermaid fence makes a sandboxed `<iframe sandbox="allow-scripts" src="/mermaid-frame.html">` beside the block: mermaid writes inline styles that the page's CSP refuses, so it draws in the frame (`mermaid-frame.html` and `mermaid-frame.js`, served by exact name with a policy of their own: `sandbox allow-scripts`, scripts from the frame's own file and the vendored mermaid only, inline styles allowed) and speaks to the page by `postMessage` (`ready`, `render`, `rendered`, `size`, `error`; the page ignores a message from anything but a frame it made). The snapshot embeds `code-libs.js` and `code-blocks.js` and hands the loader cdnjs (highlight.js) and jsDelivr (mermaid) addresses with SRI `integrity` hashes computed from the vendored files at build time; its diagrams are drawn in a sandboxed `srcdoc` frame made from `mermaid-frame.html` and `mermaid-frame.js`, never in its page (docs/adr/0020).

## Multi-select

### Explore's Path and Tree
**Path** and **Tree** are groups of their own inside Explore, a third level (see references/internals.md, **The groups**): each opens **Hierarchy** and **Dependency**, four entries (`ctx-hpath`, `ctx-dpath`, `ctx-htree`, `ctx-dtree`) that write the matching term (`hpath:<id>`, `dpath:<id>`, `htree:<id>`, `dtree:<id>`, `#` optional) for the card that was right-clicked, `menuSubject.clicked` (the open card, in the card details' menu), and never for the whole subject, even when that card is inside the selection. A plain pick writes the term into the search box as if it were typed (`writeSearch(text, 'typing')`, so the address follows and, in the Graph, the box is the typed anchor of the selection and the set is lit; in the other views only the set is shown while the view's Typing isolates is ticked, and lit while it is not), in place of what the box held but for its `slice:` run (`searchSplitSlice`, `searchJoinSlice`).

### Add child…
**Add child…** opens the New card form (`openModal(null, newCardStatus(), undefined, parentId)`) exactly as New card does, with Parent preset to the card and the heading "New card under #<id>".

### The nested card menu
**The groups** (`menu-nest.js` for the rules, `menu-nest-ui.js` for the page; built by hand, ADR 0003): `#context-menu` holds plain entries, `<hr class="ctx-sep">` separators and three `.ctx-sub` groups, each a `.ctx-parent` row (`aria-haspopup="menu"`, `aria-expanded`, a ▸ the stylesheet draws) and a `.ctx-sub-panel` of entries; every entry keeps its own `ctx-*` id and click handler. `showContextMenu` decides which entries show as before and then calls `menuNestSync`, which hides a group whose entries are all hidden (`menuSubShown`) and a separator not between two things that show (`menuSeparators`); `hideContextMenu` calls `menuNestClose`. The menu takes the focus when it opens (`tabindex="-1"`, `menuNestFocus`) and gives it back when it closes (`menuNestRelease`), and its keys are read in the capture phase only while focus is inside it, so they reach nothing behind it and nothing in a field outside it; Esc at the top level is the page's, which closes the menu. The empty Graph or Map canvas's menu is still Isolate alone: its group's panel stands in the menu with no row (`canvas-menu`).

### Click, selection and poll plumbing
The page reads a double click as the second click of a pair (the click's count, 2), never as a `dblclick` event, because the first click's repaint can replace the element under the pointer. The 5s refresh skips while a control wearing `data-holds-poll` has focus. Every write to the selection goes through one function (`setSelection`), every bulk action reads its target cards through one reader (`bulkTargets`), and a bulk popup acts on the cards it held when it opened.

### Esc and the box
The stage is decided in the selection module (`escapeStage`: isolate, selection, box) and carried out by `stepSelectionBack`. The write carries the reason `mirror` (`mirrorSelectionInBox`, with the text built by `searchMirrorBox` in the search module): it turns isolate on for no one and never makes the box a typed search, so the next click still sees the card parts.

## Slice section

### Writing the run
The term is written through the search module's `searchSetSlice`: a run set on a query that holds `|` brackets the query, so `tags:ui | #12` becomes `(tags:ui | #12) slice:goal..objective` and the run cuts all of it, not only the last group.

### The run's module
The list and the arithmetic of the run are worked out in `slice-run.js`, which needs no other module but the id module (`ids.js`, embedded ahead of it) so that the snapshot can embed it.

## Board pills

### The pills a `field:*` entry makes
Each matches its value exactly, through the search module's term writer, so the `grill` pill never catches `grilling` and a value with a space stays one term.
Each value pill is keyed by its field and value and each other pill by its query, and the buttons are updated where they stand, so a pill that has focus keeps its focus across the poll and its count changes under it.

## Isolate

### The switch and the menu entry
**Isolate** — the top bar holds the **Isolate** switch, just right of the search box and outside the search panel (`#isolate-switch`, in `.search-bar` after `.search-box`, kept whole by `flex: 0 0 auto` while the box gives way, so it shows with the panel shut; a button with `role="switch"` whose `aria-checked` says on or off; Tab reaches it, and Enter and Space act as a click), and the `i` key flips it. **The menus offer it.** A right-click on a card inside the selection offers **Isolate** in the menu that acts on the selection (`cardMenuFor`, `isolate`), which does what the switch does, and the menu of a card outside the selection and the card details' own menu do not offer it.

### What the box hides and lights
While isolate is on, **every view shows only the matches**: the Board, the Map, the Gantt and the Calendar hide what the box does not match, and the Graph, where a search typed with isolate off only lights, hides what the box does not match (the Graph's one pure decision about a query, `graphQueryEffect`, takes `isolated`; the renderer is untouched). Where the box hides is worked out once per repaint (`boxHidingTerms`, `boxLightsMatches`, `computeSearchMatch`): `ids` is what it hides by, `matched` what the whole query matches, which the jump to the nearest match and Enter read, and `lit` what it lights.

### Who builds the text and who carries it out
The text is built in the search module (`searchIsolateText`, `searchIsolateBox` and `searchIsolateRestore`), the stages in the selection module (`selectionAfterEscape`, `isolateAfterWrite`), and the page carries it out in `isolate.js`, which writes the box only through `writeSearch` with the reason `isolate` and never writes the selection.

### Typing isolates
**Typing isolates.** A query the person makes turns isolate on by itself where the view's **Typing isolates** checkbox is ticked: typing in the box, a pill, a cue on a card and a `?q=` link (the writes with the reasons `typing`, `pill`, `cue` and `link`, decided at `writeSearch` by `typingTurnsIsolateOn`). The panel's Typing isolates section (`#search-typing-section`, folded to start) holds one checkbox for each view (`#search-typing`, an input with `data-typing-view` for Board, Calendar, Gantt, Map and Graph), kept per board in the browser under a key of their own, `typing.isolates`, as **On hover show** keeps `hover.show` (`typing-isolates.js`, the views listed by `VIEW_MODES`): ticked in every view but the Graph, so typing narrows the Board and lights in the Graph as it always did.

## Preferences sheet

### Stored preferences
**Typing isolates section starts folded** and **On hover show section starts folded** are on by default (`typingFolded` and `hoverFolded`): they say how those two sections of the panel start, and each fold control still unfolds its section for the visit.

### The Hotkeys list
The list is `hotkeys.js`, the one list, and a unit test reads the page's own key handlers and fails when a handler reads a key the list lacks, or the list names a key no handler reads.

### The pages of This board
A queued prefix save finds its row by the prefix it names in the settings as they stand when its turn comes, not by where the row was drawn.
Another page of This board is added with `settingsAddBoardPage` in `settings-ui.js`.

## Notes (logbook)

The palette then draws above the details; Esc clears the card chip first, the next closes the palette (`notesEscape`), the one after closes the details; the card menu's **Add note…** opens it on one card. Timeline is the same notes as one flat list (`noteTimeline`, notes.js): days newest first, inside a day the timed notes in time order and then the untimed ones, each row naming its card with the link a group heading has (`no card` for none). Today and Now are worked out from the clock when Enter is pressed (`noteWritePlan` reads `o.today` and `o.now`; the page's one clock is `kanbanDays.now`, days.js), so a palette left open writes the day and time of that moment. A mention at the start of the note wins over the picker, and so does a card id typed in the picker (`22`, `#22`) on Enter or on leaving the field (`notesCommitPick`; free text stays legal, ADR 0003). The menu is `attachCombobox`'s, which tells the palette of a choice through its `onPick` option, and it is moved to the page and fixed under the field (`.np-pick-menu`) so the palette's `overflow: hidden` never clips it. The **range** is `{ mode, anchor }` over the Calendar's own sub-view names (`noteRangeBounds`, `noteRangeStep` and `noteRangeLabel` over calendar-model.js, weeks from Monday). **Alt+1** to **Alt+4** switch the open palette to its first to fourth tab in the order the tab row shows them (`notesTabs()`, `notesSetTab`). The note box starts one line high and grows with its text, typed and wrapped lines both, up to 12 lines or 40% of the window, whichever is less (`noteBoxSize`, notes.js), and scrolls inside past that; the box a listed note is edited in grows the same way and is sized to the note when it opens.

## Text boxes

**Text boxes** — the notes palette's note box and a listed note's edit box, the Scratchpad's box, the Todos tab's Edit box and the card form's description (`#f-body`) each call `textEditAttach(box)` (text-edit-ui.js) once; single-line fields are never attached.
An edit is one replacement (`{ from, to, insert, start, end }`), made with `document.execCommand('insertText')` (`delete` for an empty insert) so Undo takes it back in one step; where the command is refused the text is replaced with `setRangeText` and the input event fired by hand.

## Coloured Markdown boxes

**Coloured Markdown boxes** — the card form's description (`#f-body`), the Scratchpad's Edit box and the Todos tab's Edit box (both `.sp-text`) call `mdEditAttach(box)` (markdown-edit-ui.js) once, after `textEditAttach`; the notes palette's boxes and the single-line fields are never attached. The box is wrapped in a `.md-edit` element holding the textarea and a `<pre class="md-edit-back" aria-hidden>` that draws the spans as `<span class="md-edit-<kind>">`; the textarea's own text is transparent over it (its caret, selection and spellcheck stay), and the copy takes the textarea's font, padding, border widths, wrapping and a scrollbar's width from `getComputedStyle` so each word sits where the textarea has it (font, kerning, variant, alignment, tab size, spacing and the padding and border widths). It is redrawn at most once a frame (`requestAnimationFrame`, before the paint, so the transparent text is never seen without its copy): every `input` and every script set of `value` (the box's own accessor is wrapped, no prototype is touched) in a frame share that one redraw. The computed style is read on attach, on a resize and when the switch goes on, never on an input; the only per-frame reads are the box's rect, to give up the width of a scrollbar (measured from the rect, so a fractional zoom costs no pixel), and its scroll, which the copy follows. One `ResizeObserver` serves every box (it grows with its text, a drag, full screen, the phone layout); it is called in the frame and redraws at once, taking the frame an input asked for with it, and a box the page dropped (the Scratchpad panel is rebuilt each time its tab opens) is unobserved the next time a box is attached or the switch is flipped. The wrapper is `display: contents` when the switch is off, and `.md-edit.on` otherwise; `mdEditSetOn(on)` is the switch (app.js keeps it for the whole browser under `kanban.md-colour`, `setMdColour`, applied when the page starts), and a box attached while it is off starts plain. The colours are tokens, declared on `:root` and in both dark blocks: `--md-edit-heading`, `--md-edit-heading-six`, `--md-edit-bold`, `--md-edit-italic`, `--md-edit-strike`, `--md-edit-code`, `--md-edit-link`, `--md-edit-marker`, `--md-edit-tag`, `--md-edit-mention` on `--md-edit-mention-bg`, the box's own selection wash `--md-edit-selection` (its own alpha, so selected text stays readable), `--md-preview-heading`, the colour of headings in the rendered preview and the card details, and `--md-preview-bold`, the colour of bold there (its weight is unchanged).

## Todos

An item's text is drawn by `markdownInto(el, text, { inline: true })`, the one renderer's inline marks with no block; a line of the file that is not an item shows muted and read only. A **List | Edit | Preview** switch sits over the tab, the Scratchpad's switch with List first (its `.sp-mode`, `.sp-text`, `.sp-preview` and `.sp-bar`): **List**, the default, is the list; **Edit** is the list's whole file as text in a box that takes the editing keys and the colours (`textEditAttach`, `mdEditAttach`), and **Ctrl+Enter** or **Save** writes it with `PUT`, naming the version the text was read at.

## On hover show

### The panel and the choice
The panel is `hover-show-ui.js` (`syncHoverShowPanel` on every repaint, one delegated `change` that calls `hoverShowPick`) and the choice and the union are `hover-show.js`, pure, with no DOM, on the dual-environment pattern: `mergeHoverShow`, `hoverShowWith`, `hoverShowGraph`, `hoverShowIds` (the union of the sets for a card, through the Explore sets of `explore-sets.js`, so `dlinks` and `hlinks` too) and `hoverShowTiles`. `hoverShowGraph` names the kind a view reads: the Flow's in the Graph's Flow, the Hierarchy's in the Hierarchy and in every view that is not the Graph (the Board, the Map, the Calendar and the Gantt), whatever layout the Graph last showed.

### Painting the hover
`hoverLit` is the Set of ids the renderers read through `isHoverHighlighted`, null when nothing is hovered, and `syncHoverLit` keeps it in step with `hoveredId`, at every `setHoveredId` and every `renderBoard`, and `refreshHover` after a box is ticked. Outside the Graph it is the hovered card and the union (`hoverShowTiles`), and `applyHoverHighlight` gives each card of it the wash in one pass over the cards on the page, not one query per id. In the Graph the hover ring stays on the hovered card alone (`hoverLit` holds that card), and `graphSetFocus` lights the union with `graphLit`, dimming the rest, in place of the one-hop relations it lit before.

### The Graph's option panel
The Graph's option panel has the same six as an **On hover** section (`graphBuildHoverRow` in `graph-view.js`, a `div.graph-hover-options` after the Hierarchy's option row or the Flow's switches, drawn by `graphBuildSwitch` with `.graph-option-btn[data-key=hover][data-val=<set>]` and `aria-pressed` on each set the choice of that kind of Graph ticks). Both places stand in `HOVER_SHOW_GRID` (`hover-show.js`), two columns by three rows read across, the h sets left and the d sets right, links then path then tree (`.hover-kinds` in `app.html` and the grid on `.graph-option-seg` in `app.css`); only the display, since the stored list and the terms Space writes keep `HOVER_SHOW_KINDS`' order. Its click handler calls `hoverShowPick` and does not redraw the Graph; `hoverShowPick` calls `syncHoverShowPanel` before `refreshHover`, and `syncHoverShowPanel` sets the boxes and the toggles from the choice that applies, so each shows a change made in the other at once and a card hovered at that moment lights again.

### Space
The card is `hoveredId`, else the one with the focus (`hoverSpaceSubject`); the text is `hoverShowTerms` (`hover-show.js`: one `kind:id` per ticked set, in `HOVER_SHOW_KINDS`' order, not the grid's, joined by ` | `) put in the box by `searchWithTerms` (`search.js`, which Explore's Path and Tree use too): it replaces what the box held but for its run of slices, or with Shift joins it as more alternatives (`searchAddAlt`), and an empty box takes it either way. With no such card, the line the pointer is on in the Graph supplies the text instead (`graphHoverLineTerms`, `graph-view.js`): the cards it lights as card terms joined by ` | ` (`#176 | #50`), the parent or the card waited for first, a bracket's children in the order it draws them, whatever sets are ticked. The write is `writeSearch(text, 'hover')`. In the Graph `Ctrl+Space` (or Cmd) on a focused dot is the selection (`wireGraphView`'s `keydown`, which reads `hotkeySpace`), what Space was before.

## Speedbumps

### Key guard (`key-guard.js`)
The single-key shortcuts added later reuse this guard unchanged.

## Board config

### Type icons
An icon name is only looked up in the closed table of six in `type-icons.js`; it is never markup, a class name or part of a path, and a name the table does not hold draws as no icon. Labels, queries and icon names are human text: a reader escapes them and never uses one as raw markup or a class name.

### What the page holds from the payload
The page holds `hierarchy` and `pills` on `state` after every load and poll: the slice section and the Graph's tier fan read the hierarchy, and the search panel draws the pills.

## Boundaries

### Files the server serves
A new module takes one entry, its `<script>` tag in `app.html` in load order; nothing in `server.js` changes. A test fails when the page names a file `web/` lacks, or `web/` holds a script the page never loads.
