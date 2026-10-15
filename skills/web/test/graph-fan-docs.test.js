const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section and the web doc say what the Tiers layout draws:
// a band per tier of the board's hierarchy, then a ring per depth for the cards
// without a tier, a sector per tree, and an Unnested block. The words are the
// glossary's: hierarchy, tier, slice, depth.

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
const webDoc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), 'utf8');

function bullet(marker) {
  const start = webSkill.indexOf(marker);
  assert.ok(start !== -1, `${marker} is in the web skill`);
  return webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
}

const graph = () => bullet('- **Graph view**');
const docGraph = () => {
  const start = webDoc.indexOf('## Graph');
  return webDoc.slice(start, webDoc.indexOf('\n## ', start + 4)).replace(/\s+/g, ' ');
};

test('the Graph section says the Tiers layout draws a band per tier, then a ring per depth for the cards without a tier', () => {
  const text = graph();
  assert.match(text, /Tiers draws the \*\*tier fan\*\*/);
  assert.match(text, /a \*\*band\*\* for each tier of the board's `hierarchy:`, tier 1 innermost, then a \*\*ring\*\* for each depth that holds a card without a tier/);
  assert.match(text, /A depth with no such card has no ring/);
});

test('the Graph section says a card is in the band of its slice, whatever is hidden, and nesting against the hierarchy is not judged', () => {
  const text = graph();
  assert.match(text, /A card is in the band of its slice, worked out from the whole board, so a hidden or archived parent never moves it/);
  assert.match(text, /a tier 1 card under the lowest tier sits in its own tier's band, with no warning/);
});

test('the Graph section says each tree takes a sector, loose cards with a tier share one, and the rest are in the Unnested block by status', () => {
  const text = graph();
  assert.match(text, /A root and the cards nested under it take a \*\*sector\*\* of the fan/);
  assert.match(text, /loose cards with a tier share a sector of their own/);
  assert.match(text, /\*\*Unnested\*\* block outside the rim, a column for each status in the board's order, archived cards last/);
});

test('the Graph section says a board without a hierarchy draws depth rings, and a card with a hidden parent keeps its band', () => {
  const text = graph();
  assert.match(text, /On a board with no hierarchy every slice is a depth, so Tiers draws a ring for each depth/);
  assert.match(text, /A card whose parent is hidden \(archived, or filtered out by a pill\) is drawn as a root, the top of its own sector, in the band of its slice/);
});

test('the Graph section no longer describes the old full-circle Tiers', () => {
  const text = graph();
  assert.doesNotMatch(text, /Tiers puts the roots at the centre/);
  assert.doesNotMatch(text, /on the outermost ring/);
});

test('the web doc\'s Graph section says the same in short', () => {
  const text = docGraph();
  assert.match(text, /\*\*Tiers\*\* draws a fan from the centre: a band for each tier of the board's `hierarchy:`, tier 1 innermost, then a ring for each depth that holds a card without a tier/);
  assert.match(text, /each tree gets its own sector, loose cards with a tier share one, and the other loose cards sit in an Unnested block outside the fan, a column for each status/);
  assert.doesNotMatch(text, /on the outer ring/);
});
