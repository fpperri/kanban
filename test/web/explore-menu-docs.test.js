const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Explore offers Path and Tree, each opening Hierarchy and Dependency, for the card that was
// right-clicked. The docs that name the menu, the four search terms and the snapshot's four buttons.

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
const webDoc = read('docs', 'web.md');
const snapshotDoc = read('docs', 'snapshot.md');
const webSkill = read('plugin', 'skills', 'web', 'SKILL.md');
const snapshotSkill = read('plugin', 'skills', 'snapshot', 'SKILL.md');
const glossary = read('GLOSSARY.md');

test('docs/web.md names Path and Tree under Explore, as a third level of Hierarchy and Dependency', () => {
  assert.match(webDoc, /\*\*Explore\*\* \(Isolate, \*\*Path\*\* and \*\*Tree\*\*\)/);
  assert.match(webDoc, /\*\*Path\*\* and \*\*Tree\*\* in Explore are rows of their own, a third level: each opens \*\*Hierarchy\*\* and \*\*Dependency\*\*/);
  assert.match(webDoc, /Right or Enter opens one, Left or Esc closes that panel alone and returns to its row, one level back; from a row whose own panel is open, Left and Esc both close that panel and keep the highlight on the row/);
});

test('docs/web.md says what the four sets are and which relation each follows', () => {
  assert.match(webDoc, /hierarchy path is the card's parents up to its root and every card nested under it, and the hierarchy tree the whole parent tree from its root down; both follow `parent` only/);
  assert.match(webDoc, /dependency path is everything the card waits for and everything waiting on it, transitively, and the dependency tree its connected set; both follow `waiting_for` only/);
});

test('docs/web.md says the four write their term for the right-clicked card, never the whole selection, into the box as typed', () => {
  assert.match(webDoc, /writes its term into the search box for the card you right-clicked \(the open card, in the card details' menu\) and never for the whole selection, even when that card is inside it/);
  assert.match(webDoc, /a right-click on a card in a lit path searches that card's set alone/);
  assert.match(webDoc, /`hpath:<id>`, `htree:<id>`, `dpath:<id>` and `dtree:<id>` \(the `#` is optional\), written as if you had typed them/);
  assert.match(webDoc, /a plain pick replaces what the box held but for its `slice:` run, so the Graph lights the set and the other views show only it/);
  assert.match(webDoc, /Shift \(a Shift-click, or Shift\+Enter on the focused item\) adds the term to what the box holds as one more alternative, `htree:40 \| dpath:185`, and each item's tooltip ends "Shift: add to the search"/);
  assert.match(webDoc, /Isolate follows the Typing isolates of the view, as typing into the box does: where it is on, a pick turns Isolate on and the term is its text, and where it is off the set is lit/);
  assert.doesNotMatch(webDoc, /Isolate stays as it was; press it/);
  assert.match(webDoc, /`tree:` and `path:`, which follow both relations, are as they were/);
});

test('no doc still says the four add a selection part, add to the selection or leave the search box alone', () => {
  const stale = [
    /add(s)? one part of the matching kind[^.]*to the selection/,
    /They do not write the search box/,
    /Each adds one part to the selection/,
    /add(s)? (the path or the tree|a dependency tree\/path|a card's tree or path) [^.]*to the selection/,
    /add the tree or path of each card in the menu's subject/,
    /Explore (adds|add)\b/,
    /Path and Tree add\b/,
    /Dependency tree\/path buttons/,
  ];
  for (const [name, text] of [['docs/web.md', webDoc], ['docs/snapshot.md', snapshotDoc], ['skills/web/SKILL.md', webSkill], ['skills/snapshot/SKILL.md', snapshotSkill], ['GLOSSARY.md', glossary]]) {
    for (const re of stale) assert.doesNotMatch(text, re, `${name}: ${re}`);
  }
});

test('the web skill lists the four terms in its grammar and keeps them out of the autocomplete', () => {
  assert.match(webSkill, /`hpath:<id>`\/`htree:<id>`\/`dpath:<id>`\/`dtree:<id>` \(`#` optional\) are the four sets Explore's Path and Tree write into the box, each by one relation alone/);
  assert.match(webSkill, /`tree:`\/`path:`, the four above and `dlinks:`\/`hlinks:` are excluded \(they take a card id, not free text\)/);
});

test('the web skill says the four entries write the term for menuSubject.clicked, plain or with Shift, and the third level answers the keys and a tap', () => {
  assert.match(webSkill, /four entries \(`ctx-hpath`, `ctx-dpath`, `ctx-htree`, `ctx-dtree`\) that write the matching term \(`hpath:<id>`, `dpath:<id>`, `htree:<id>`, `dtree:<id>`, `#` optional\) for the card that was right-clicked, `menuSubject\.clicked` \(the open card, in the card details' menu\), and never for the whole subject, even when that card is inside the selection/);
  assert.match(webSkill, /A plain pick writes the term into the search box as if it were typed \(`writeSearch\(text, 'typing'\)`/);
  assert.match(webSkill, /in place of what the box held but for its `slice:` run \(`searchSplitSlice`, `searchJoinSlice`\)/);
  assert.match(webSkill, /A Shift pick \(a Shift-click, or Shift\+Enter on the focused item\) adds the term to the box as one more alternative \(`searchAddAlt`: `htree:40 \| dpath:185`, bracketing what needs it\), still as if typed; with an empty box it is a plain pick/);
  assert.match(webSkill, /Each item's title ends "Shift: add to the search"/);
  assert.match(webSkill, /isolate follows the view's Typing isolates as typing into the box does: ticked, a pick turns isolate on and the term is its text/);
  assert.match(webSkill, /the keys work the same at the third level, where Right or Enter on Path or Tree opens its panel and Left or Esc shut that panel alone and return to its row, one level back/);
  assert.match(webSkill, /a tap opens a third-level panel in place at phone width and a second tap shuts it, Explore staying open/);
  assert.match(webSkill, /`menuNestTopGroups` are the menu's own groups, `menuNestAllGroups` the nested ones too/);
  assert.match(webSkill, /from a row whose own panel is open, Left and Esc both close that panel and keep the highlight on the row/);
});

test('the web skill says a search written by Explore is a query part of the isolate text', () => {
  assert.match(webSkill, /and a query \(a search typed or written by Explore, `dpath:185` included\) is its own text/);
});

test('the snapshot docs say the card sheet has the four buttons, writing the four terms', () => {
  assert.match(snapshotDoc, /\*\*Hierarchy path \/ tree\*\* and \*\*Dependency path \/ tree\*\* buttons that narrow every view down to that card's set/);
  assert.match(snapshotSkill, /four read-only buttons, "Hierarchy path", "Dependency path", "Hierarchy tree" and "Dependency tree"/);
  assert.match(snapshotSkill, /writes `hpath:<id>`, `htree:<id>`, `dpath:<id>` or `dtree:<id>` into the search box, in place of what it held but for its `slice:` run \(as kanban-web's Explore does\), and closes the sheet/);
  assert.match(snapshotSkill, /`hpath:<id>`\/`htree:<id>`\/`dpath:<id>`\/`dtree:<id>` \(`#`-tolerant\) are the four sets of kanban-web's Explore, each by one relation alone/);
  assert.doesNotMatch(snapshotSkill, /two read-only "Dependency tree"\/"Dependency path" buttons/);
});

test('the glossary names the Explore set and the parity table the four terms and buttons', () => {
  assert.match(glossary, /\*\*Explore set\*\* \(derived\): One of four sets of cards found from one card, each by one relation alone/);
  assert.match(glossary, /The Explore menu's Path and Tree write one into the search box for the right-clicked card/);
  assert.match(glossary, /the search terms are `hpath:`, `htree:`, `dpath:` and `dtree:`/);
  assert.match(glossary, /the four Explore sets, `hpath:`, `htree:`, `dpath:` and `dtree:`, as search terms plus "Hierarchy path", "Dependency path", "Hierarchy tree" and "Dependency tree" tap actions on the card sheet and in the right-click card menu/);
  assert.match(snapshotSkill, /then the four Explore sets as flat items, Hierarchy path, Dependency path, Hierarchy tree and Dependency tree \(the menu does not nest\), each writing its `hpath:`, `dpath:`, `htree:` or `dtree:` term as the sheet's buttons do/);
});
