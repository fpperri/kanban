const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section and the web doc say the tier fan washes each tier band
// that holds a card in its type's colour: the hierarchy reads as coloured areas. The
// words are the glossary's: hierarchy, tier, slice, band, status pill, isolate.

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

test('the Graph section says each tier band that holds a card is washed in its type\'s colour, behind the lines, the dots and the captions', () => {
  const text = graph();
  assert.match(text, /Each tier band that holds a card is washed in its type's colour \(the `color:` of that type in the board's `types:` list\)/);
  assert.match(text, /one \*\*wash\*\* across its whole ring, behind the lines, the dots and the captions, so the hierarchy reads as coloured areas/);
});

test('the Graph section says a type with no colour gets a neutral wash, and a depth ring, the Unnested ring and the Unnested block get none, a tier with no drawn card having no band to wash', () => {
  const text = graph();
  assert.match(text, /a tier whose type has no colour gets a neutral wash/);
  assert.match(text, /a depth ring, the Unnested ring and the Unnested block get none \(a tier with no drawn card has no band, so no wash\)/);
  assert.doesNotMatch(text, /a tier nobody is in, a depth ring/);
});

test('the Graph section says a click on a wash is a click on empty space, and a slice: cut, a status pill and isolate drop only the washes of the bands they empty', () => {
  const text = graph();
  assert.match(text, /The wash takes no click: a click or a double click on it is a click on empty space/);
  assert.match(text, /A `slice:` cut, a status pill and isolate keep the washes of the bands still drawn and drop those of the bands they leave empty/);
});

test('the web doc\'s Graph section says the same in short', () => {
  const text = docGraph();
  assert.match(text, /Each tier band that holds a card is washed in its type's colour, a neutral wash when the type has none, behind the lines and the dots/);
  assert.match(text, /depth rings, the Unnested ring and the Unnested block are not washed/);
  assert.match(text, /a click on a wash is a click on empty space/);
});
