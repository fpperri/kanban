const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's multi-select section says how a selection grows, in the words
// of the glossary and of ADR 0006's 2026-10-14 amendment.

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');

function bullet(marker) {
  const start = webSkill.indexOf(marker);
  assert.ok(start !== -1, `${marker} is in the web skill`);
  return webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
}

test('the multi-select section says a selection grows from an anchor by additions, and what the first card picked is', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /grows from an \*\*anchor\*\*/);
  assert.match(text, /additions/);
  assert.match(text, /first card picked is the anchor and later ones are additions/);
});

test('the multi-select section says the id set is worked out again for the view shown, so it follows a view switch, a poll and what the view hides', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /worked out again on every render and poll/);
  assert.match(text, /status pill, the Archive pill or the search box hides/);
});

test('the multi-select section says what a click, Shift and Ctrl do in the Graph, and that Shift adds one card there', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /In the \*\*Graph\*\* a click makes the card the anchor of a new selection/);
  assert.match(text, /shift\+click or ctrl\/cmd\+click adds one card to the selection or takes it out/);
  assert.match(text, /no reading order to range over/);
  assert.match(text, /a click on the empty Graph leaves it; a double click on the empty Graph clears it/);
});

test('the multi-select section says taking a card out of a query, path or tree part turns that part into its other cards', () => {
  assert.match(bullet('- **Multi-select**'), /turns that part into its other cards/);
});

test('the Graph section no longer says a shift-click ranges there', () => {
  const text = bullet('- **Graph view**');
  assert.doesNotMatch(text, /shift\+click \(range\)/);
  assert.doesNotMatch(text, /outline order \(parents before children/);
  assert.match(text, /shift\+click or ctrl\/cmd\+click adds one card or takes it out/);
});

test('the multi-select section says Esc steps the selection back one stage at a time: every addition at once, then the anchor', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /\*\*Esc\*\* steps the selection back one stage at a time/);
  assert.match(text, /the first Esc drops every addition at once and leaves the anchor/);
  assert.match(text, /the next drops the anchor/);
});

test('the multi-select section says where the Esc step runs: with nothing open and nobody typing, and how it differs in the search box', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /only while nothing is open and nobody is typing/);
  assert.match(text, /with focus in the search box Esc clears the box and leaves the selection/);
  assert.match(text, /away from the box Esc no longer clears it/);
});

test('the multi-select section says bulk targets are fixed when an action starts, and that the confirmations name that count', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /takes its list of target cards once, when it starts/);
  assert.match(text, /writes, repaints and polls during the action never change the list/);
  assert.match(text, /archive and delete confirmations name the count of that list/);
});

test('the Speedbumps section sends Esc with nothing open to the selection, and the key guard paragraph names the Esc question', () => {
  const text = bullet('- **Speedbumps**');
  assert.match(text, /With nothing open, Esc steps the selection back/);
  assert.match(text, /Esc's selection step reads the same guard, with the search box as the one text field it is for/);
});

test('the multi-select section describes the right-click menu: Peek and Add to selection outside the selection, the selection untouched', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /a card outside the selection opens a menu for that card alone and leaves the selection/);
  assert.match(text, /\*\*Peek\*\* \(opens the card's details/);
  assert.match(text, /\*\*Add to selection\*\*/);
  assert.match(text, /A card inside the selection opens the menu for the whole resolved selection/);
  assert.match(text, /menu for the card shown, without Peek/);
});

test('the multi-select section says Path and Tree write the term of the right-clicked card into the search box, as typed', () => {
  const text = bullet('- **Multi-select**');
  assert.match(text, /\*\*Path\*\* and \*\*Tree\*\* are groups of their own inside Explore, a third\s+level/);
  assert.match(text, /for the card that was right-clicked, `menuSubject\.clicked`/);
  assert.match(text, /and never for the whole subject, even when that card\s+is inside the selection/);
  assert.match(text, /writes\s+the term into the search box as if it were typed/);
  assert.match(text, /They add nothing to the selection by hand/);
  assert.doesNotMatch(text, /sugar over the/);
  assert.match(text, /Archive and Delete keep their confirmation, which names the resolved count/);
});

test('the Map section says the menu offers the narrower hpath:, htree:, dpath: and dtree: sets instead of writing a term', () => {
  const text = bullet('**Dependency focus** — a second way');
  assert.match(text, /its Path and Tree write the\s+narrower `hpath:`, `htree:`, `dpath:` and `dtree:` terms into the box/);
  assert.doesNotMatch(text, /offers these as sugar/);
});

test('the docs say Path and Tree show on every card\'s menu, whatever the subject, and the canvas menu stays Isolate alone', () => {
  assert.match(webSkill.replace(/\s+/g, ' '), /Path and Tree show on every card's menu, whatever the subject/);
  assert.doesNotMatch(webSkill.replace(/\s+/g, ' '), /show only when the subject is one card/);
  assert.match(webSkill.replace(/\s+/g, ' '), /The empty Graph or Map canvas's menu is still Isolate alone/);
  const webDoc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(webDoc, /search the path or the tree of the card you right-clicked, by its hierarchy or by its dependencies \(on every card's menu, whatever the selection\)/);
});
