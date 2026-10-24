const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section and the web doc say where the tier fan's names sit: a parent's
// beside its ring, every other in a row outside the rim joined to its dot by a leader, the
// Unnested block's in a list above it; that a name is upright and keeps its size at any zoom,
// keeps off dots, captions, lines and other names, and that a card with no room goes unnamed.
// They also say what the placement does not do: a leader keeps off no name, caption or line, a block column the
// list cannot reach loses its names, and rows are bounded by the fan and not by the panel. And
// when names are placed again: once a zoom settles and when what they depend on changes, never
// for a pan or a poll that brings nothing new. The words are the glossary's: tier fan, Names
// option, Unnested, leader.

const webSkill = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'SKILL.md'), 'utf8');
const webDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'web.md'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'graph-view.js'), 'utf8');

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

test('the Graph section says a name is never tilted and keeps its size on screen at any zoom', () => {
  const text = graph();
  assert.match(text, /\*\*Where names sit\.\*\* A name is never tilted and keeps its size on screen at any zoom/);
});

test('the Graph section says a parent is named beside its ring, inside the rim', () => {
  assert.match(graph(), /A parent, a card with children, which wears the outer ring, is named beside its ring, inside the rim/);
});

test('the Graph section says every other name is in a row outside the rim, a leader running from its dot to it', () => {
  const text = graph();
  assert.match(text, /Every other named card is named in a row outside the rim on its own side of the fan, the cards of a side taking the rows in the order of their rays down it/);
  assert.match(text, /a leader runs from its dot out along its own ray, round any dot in the way, along a rail just outside the rim and out to its name/);
});

test('the Graph section says the Unnested block\'s names sit in one list above the block, the column furthest right nearest it', () => {
  const text = graph();
  assert.match(text, /With the table choice, the Unnested block's named cards sit in one list above the block, the column furthest right nearest it/);
  assert.match(text, /each joined to its dot by a leader that runs up its column's left side/);
});

test('the Graph section says what a name keeps off, and that a card with no room is left unnamed and keeps its id label', () => {
  const text = graph();
  assert.match(text, /A name keeps off every dot, caption and other name, and off an id label that shows without a hover or a selection/);
  assert.match(text, /never crosses a parent line or a dependency line that is drawn, or a divider between sectors/);
  assert.match(text, /a card with no room is left unnamed, and its id label shows as it would with no name/);
});

test('the Graph section says what the placement does not do: leaders keep off no name or line, a block column can lose its names, rows ignore the panel', () => {
  const text = graph();
  assert.match(text, /A leader keeps off no name, caption or line: it can run under a parent's name or across a caption/);
  assert.match(text, /In the block's list a card whose column line would run inside or hard against the rim, or across a name or a caption, is left unnamed, so the block's left-hand columns, nearest the fan, are the first to lose their names and can lose all of them/);
  assert.match(text, /Rows are bounded by the fan, not by the panel, so a long name at the panel's edge can run past it until the view is panned/);
});

test('the Graph section says when names are placed again: a zoom that settles and a change of what they depend on, not a pan or an idle poll', () => {
  const text = graph();
  assert.match(text, /Names are placed again once a zoom settles \(zoomed out, a name takes more of the fan's own room, so fewer find a place\)/);
  assert.match(text, /and when what they depend on changes, the selection, the setting, a card's title or sticker or a line/);
  assert.match(text, /a pan moves none, and a poll that brings nothing new places nothing/);
});

test('the web doc says where names sit in short, and that a card with no room goes unnamed', () => {
  const text = docGraph();
  assert.match(text, /Names puts a card's title on the fan/);
  assert.match(text, /A parent's name sits beside its ring; every other name sits in a row outside the rim, joined to its dot by a leader, and the Unnested block's names in a list above it/);
  assert.match(text, /Names stay upright and the same size at any zoom and keep off the lines, the dots and each other, though a leader may pass under one/);
  assert.match(text, /a card with no room goes unnamed, which can leave the block's left-hand columns unnamed/);
});

test('the Names hint in the option row says where names sit, and no longer says beside the dot', () => {
  const hint = view.match(/names: \{\s*label: 'Names',\s*hint: `([^`]*)`/);
  assert.ok(hint, 'the Names entry of the option labels is in graph-view.js');
  assert.match(hint[1], /^Which cards carry their title, a parent beside its ring and the others in rows outside the rim\./);
  assert.doesNotMatch(hint[1], /beside the dot/);
});

test('the Graph code says where a name sits is graph-names.js\'s, not the stylesheet\'s', () => {
  const model = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'graph-model.js'), 'utf8');
  assert.match(model, /where one sits is graph-names\.js's business/);
  assert.doesNotMatch(model, /where one sits is the stylesheet's/);
  assert.doesNotMatch(model, /carry their title beside the dot/);
  assert.doesNotMatch(view, /carry their title beside the dot/);
});
