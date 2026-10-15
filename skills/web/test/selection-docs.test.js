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
  assert.match(text, /a click on the empty Graph clears it/);
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
