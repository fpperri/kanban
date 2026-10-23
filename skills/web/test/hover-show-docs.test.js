const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// On hover show: the search panel's six checkboxes choose which sets a hover or a keyboard focus lights, in every
// view, kept per board and per kind of Graph. The docs that said a hover lights a card's relations say what it
// lights now, and the words that stopped being true are banned.

const root = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
const webDoc = read('docs', 'web.md');
const webSkill = read('skills', 'web', 'SKILL.md');
const snapshotSkill = read('skills', 'snapshot', 'SKILL.md');
const glossary = read('GLOSSARY.md');

test('docs/web.md says what the six checkboxes are, what a hover lights in every view, and what leaving does', () => {
  assert.match(webDoc, /\*\*On hover show\*\* — in a section of its own in the search panel, six checkboxes \(`dtree`, `htree`, `dpath`, `hpath`, `dlinks` and `hlinks`, the sets of the same names\) choose which sets a hover lights/);
  assert.match(webDoc, /Hovering a card, or moving keyboard focus onto it, lights the union of the sets ticked for it, in every view/);
  assert.match(webDoc, /the Board, the Map, the Calendar and the Gantt give each card of the union the hover look, and the Graph lights the union, with the lines between its cards, and dims the rest, while the hover ring stays on the hovered card alone/);
  assert.match(webDoc, /Leaving the card clears it\. With nothing ticked only the hovered card takes the hover look and the Graph dims nothing/);
});

test('docs/web.md says the choice is kept per board and per kind of Graph, with the defaults, and who reads which', () => {
  assert.match(webDoc, /remembered per board in your browser, for each kind of Graph: the Hierarchy starts with `dlinks` and `hlinks` ticked, which is what its hover lit before the choice existed, and the Flow the same/);
  assert.match(webDoc, /Every view that is not the Flow reads the Hierarchy's choice, the Board, the Map, the Calendar and the Gantt included, even when the Graph last showed the Flow/);
  assert.match(webDoc, /The panel shows the choice of the view that is on and says whose it is\. The snapshot has no hover, so it has no such section/);
});

test('docs/web.md\'s Flow and Graph paragraphs say hover lights what the choice ticks, and a lone card still lights its dependencies', () => {
  assert.match(webDoc, /a lone card picked by a click lights it with the cards its dependencies join to it, not its parent, and hovering a card lights what the Flow's \*On hover show\* ticks, `dlinks` and `hlinks` at first, so the cards its dependencies join to it and its parent and children/);
  assert.match(webDoc, /Hover or focus a dot to light what \*On hover show\* ticks for that card, its relations at first, and dim the rest/);
});

test('the web skill\'s On hover show bullet names the panel, the pure module, the storage, the defaults and which view reads which choice', () => {
  const start = webSkill.indexOf('- **On hover show**');
  assert.ok(start > -1);
  const bullet = webSkill.slice(start, webSkill.indexOf('- **Speedbumps**', start));
  assert.match(bullet, /a `fieldset#search-hover` of six checkboxes \(`input\[data-hover-kind\]`: `dtree`, `htree`, `dpath`, `hpath`, `dlinks`, `hlinks`\)/);
  assert.match(bullet, /`#search-hover-for`, which says whose choice the boxes show \(`Flow`, or `Hierarchy and the other views`\)/);
  assert.match(bullet, /`hover-show-ui\.js`/);
  assert.match(bullet, /`hover-show\.js`, pure, with no DOM, on the dual-environment pattern: `mergeHoverShow`, `hoverShowWith`, `hoverShowGraph`, `hoverShowIds`/);
  assert.match(bullet, /`\{ "hierarchy": \[\.\.\.\], "flow": \[\.\.\.\] \}`, kept per board in `localStorage` under `hover\.show`/);
  assert.match(bullet, /The defaults are what each view lit before the choice existed: the Hierarchy `dlinks` and `hlinks`, and the Flow the same/);
  assert.match(bullet, /the Flow's in the Graph's Flow, the Hierarchy's in the Hierarchy and in every view that is not the Graph \(the Board, the Map, the Calendar and the Gantt\), whatever layout the Graph last showed/);
});

test('the web skill\'s On hover show bullet says how the lit set reaches the renderers and the Graph', () => {
  const start = webSkill.indexOf('- **On hover show**');
  const bullet = webSkill.slice(start, webSkill.indexOf('- **Speedbumps**', start));
  assert.match(bullet, /`hoverLit` is the Set of ids the renderers read through `isHoverHighlighted`, null when nothing is hovered, and `syncHoverLit` keeps it in step with `hoveredId`, at every `setHoveredId` and every `renderBoard`, and `refreshHover` after a box is ticked/);
  assert.match(bullet, /`applyHoverHighlight` gives each card of it the wash in one pass over the cards on the page, not one query per id/);
  assert.match(bullet, /In the Graph the hover ring stays on the hovered card alone \(`hoverLit` holds that card\), and `graphSetFocus` lights the union with `graphLit`, dimming the rest, in place of the one-hop relations it lit before/);
  assert.match(bullet, /with nothing ticked the union is empty and the Graph lights what it lights when the pointer is on no card/);
  assert.match(bullet, /With the defaults the Hierarchy lights what it lit before: a card and its parent, its children and the cards it waits for or that wait for it\. The Flow lights the same, where before the choice it lit the card and the cards its dependencies join to it alone/);
});

test('the web skill\'s Hover/focus bullet, the Graph\'s Lighting and the Flow say hover lights what the choice ticks', () => {
  assert.match(webSkill, /the cards that take the wash are the Set `hoverLit`, see \*\*On hover show\*\*/);
  assert.match(webSkill, /\*\*Hover or keyboard focus\*\* on a dot lights the sets \*On hover show\* ticks for that card \(by default the card and the cards it has a relation with\), with the lines between them, until the pointer leaves/);
  assert.match(webSkill, /A lone selected card lights the card with the cards its \*\*dependencies\*\* join to it, not its parent or children, and hover and focus light what the Flow's \*On hover show\* ticks \(`dlinks` and `hlinks` by default, so those cards and the card's parent and children\)/);
});

test('the old wording, that a hover always lights one card\'s relations, is gone from the docs', () => {
  assert.doesNotMatch(webDoc, /hovering a card, or a lone card picked by a click, lights it with the cards its dependencies join to it/);
  assert.doesNotMatch(webDoc, /Hover or focus a dot to light that card and its relations and dim the rest/);
  assert.doesNotMatch(webSkill, /\*\*Hover or keyboard focus\*\* on a dot lights that card and the cards it has a relation with/);
  assert.doesNotMatch(webSkill, /Hover, focus and a lone selected card light the card with the cards its \*\*dependencies\*\*/);
});

test('the snapshot skill says it has no hover set, and the glossary names On hover show', () => {
  assert.match(snapshotSkill, /\*\*No hover set\.\*\* kanban-web's panel has an \*On hover show\* section, six checkboxes that choose which sets a hover or a keyboard focus lights on a card, per board and per kind of Graph\. This page has none: a tap hovers nothing/);
  assert.match(glossary, /\*\*On hover show\*\*: The choice, made in the search panel and in the Graph's option panel \(one choice, shown in both\), of which sets a hover or a keyboard focus on a card lights: any mix of `dtree`, `htree`, `dpath`, `hpath`, `dlinks` and `hlinks`, kept per board and per kind of Graph, the Flow's apart from the Hierarchy's, which every other view reads\./);
});

test('the search panel\'s markup has the section, the six boxes in the panel\'s order, and the note that names whose choice it is', () => {
  const html = fs.readFileSync(path.join(root, 'skills', 'web', 'web', 'app.html'), 'utf8');
  const section = html.slice(html.indexOf('<fieldset id="search-hover"'), html.indexOf('</fieldset>', html.indexOf('<fieldset id="search-hover"')));
  assert.ok(section.length > 0, 'the fieldset is there');
  assert.match(section, /<legend>For <span id="search-hover-for"[^>]*><\/span><\/legend>/);
  assert.match(html, /<section id="search-hover-section" class="search-section"[^>]*>\s*<button type="button" id="search-hover-fold" class="search-fold"[^>]*aria-controls="search-hover"[^>]*>On hover show<\/button>\s*<fieldset id="search-hover"/);
  const kinds = [...section.matchAll(/<input type="checkbox" data-hover-kind="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(kinds, ['hlinks', 'dlinks', 'hpath', 'dpath', 'htree', 'dtree'], 'two columns by three rows read across: h left, d right; links, path, tree');
  assert.match(section, /<div class="hover-kinds">/);
  assert.ok(html.indexOf('class="search-divider"') < html.indexOf('<fieldset id="search-hover"'), 'it sits under the divider');
  assert.ok(html.indexOf('<fieldset id="search-hover"') < html.indexOf('<div class="actions">'), 'and inside the panel');
  assert.match(html.slice(html.indexOf('<fieldset id="search-hover"'), html.indexOf('<fieldset id="search-hover"') + 80), /data-keeps-selection/, 'a click on it never clears a selection');
  const scripts = [...html.matchAll(/<script src="\/([a-z-]+\.js)">/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('explore-sets.js') < scripts.indexOf('hover-show.js'), 'the sets load before the module that reads them');
  assert.ok(scripts.indexOf('hover-show.js') < scripts.indexOf('hover-show-ui.js'));
  assert.ok(scripts.indexOf('hover-show-ui.js') < scripts.indexOf('app.js'));
});

test('docs/web.md says the Graph\'s option panel has the same six under On hover, as one choice with the search panel\'s boxes', () => {
  assert.match(webDoc, /The Graph's option panel, on the right of the drawing, has the same six under \*\*On hover\*\*, as toggles in the style of its other switches, in the Hierarchy and in the Flow, below Dependencies and Lanes/);
  assert.match(webDoc, /The toggles and the search panel's boxes are one choice: change it in either and the other shows it at once, and a card hovered at that moment lights again with no reload/);
  assert.match(webDoc, /The toggles show the choice of the kind of Graph the panel is for, so the Hierarchy and the Flow keep their own/);
  assert.match(webDoc, /The other views have no option panel, so the search panel is where they set it; `Space` writes the terms of whatever is ticked, wherever it was ticked/);
});

test('the web skill\'s On hover show bullet names the Graph panel\'s section, its builder, its keys and how the two places stay in step', () => {
  const start = webSkill.indexOf('- **On hover show**');
  const bullet = webSkill.slice(start, webSkill.indexOf('- **Speedbumps**', start));
  assert.match(bullet, /The Graph's option panel has the same six as an \*\*On hover\*\* section \(`graphBuildHoverRow` in `graph-view\.js`, a `div\.graph-hover-options` after the Hierarchy's option row or the Flow's switches, drawn by `graphBuildSwitch` with `\.graph-option-btn\[data-key=hover\]\[data-val=<set>\]` and `aria-pressed` on each set the choice of that kind of Graph ticks\)/);
  assert.match(bullet, /Its click handler calls `hoverShowPick` and does not redraw the Graph; `hoverShowPick` calls `syncHoverShowPanel` before `refreshHover`, and `syncHoverShowPanel` sets the boxes and the toggles from the choice that applies, so each shows a change made in the other at once and a card hovered at that moment lights again/);
});

test('the Graph\'s option panel builds the section from the pure module\'s six sets, last in the panel', () => {
  const src = fs.readFileSync(path.join(root, 'skills', 'web', 'web', 'graph-view.js'), 'utf8');
  assert.match(src, /function graphBuildHoverRow\(kind\)/);
  assert.match(src, /graphBuildSwitch\(GRAPH_HOVER_LABEL, 'hover', HOVER_SHOW_GRID, /);
  assert.match(src, /panel\.appendChild\(graphBuildHoverRow\(kind\)\)/);
});

test('docs/web.md and the web skill say both places lay the six out as two columns by three rows, and that it is only the display', () => {
  assert.match(webDoc, /Both places lay the six out as a grid of two columns and three rows, read across: `hlinks` and `dlinks`, `hpath` and `dpath`, `htree` and `dtree`, the h sets on the left and the d sets on the right\. That is only how they are shown: the choice is kept as before, and `Space` writes the terms in the order it always did/);
  const start = webSkill.indexOf('- **On hover show**');
  const bullet = webSkill.slice(start, webSkill.indexOf('- **Speedbumps**', start));
  assert.match(bullet, /Both places stand in `HOVER_SHOW_GRID` \(`hover-show\.js`\), two columns by three rows read across, the h sets left and the d sets right, links then path then tree \(`\.hover-kinds` in `app\.html` and the grid on `\.graph-option-seg` in `app\.css`\); only the display, since the stored list and the terms Space writes keep `HOVER_SHOW_KINDS`' order/);
});
