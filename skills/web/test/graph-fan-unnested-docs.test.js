const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section and the web doc describe the tier fan's Unnested option: the
// four modes, the default, what each draws, what off takes with it, and that it is Tiers' own.
// The words are the glossary's: tier, slice, selection, status pill, unnested.

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
const webDoc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8');

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

test('the Graph section says the row holds five options, and Unnested is the fifth, with four modes and outermost the default', () => {
  const text = graph();
  assert.match(text, /It holds five options, the first value of each the default/);
  assert.match(text, /\*\*Unnested\*\* says where the cards with no parent, no children and no tier are drawn: \*\*outermost\*\* \(the default\)/);
  assert.match(text, /\*\*off\*\*[^.]*\*\*depth 0\*\*[^.]*\*\*table\*\*/);
});

test('the Graph section says outermost draws one ring outside every depth ring, grouped by status, under an unnested caption', () => {
  const text = graph();
  assert.match(text, /\*\*outermost\*\* \(the default\) draws them on one ring outside every depth ring, grouped by status in the board's order, archived cards last/);
  assert.match(text, /under an `unnested` caption on the seam, level with the ring, whose tooltip counts them and names no slice/);
});

test('the Graph section says off does not draw them or any line that joins one to a drawn card, and a selection reaches only what is drawn', () => {
  const text = graph();
  assert.match(text, /\*\*off\*\* does not draw them, and neither is a line or an arrow that joins one to a card that is drawn/);
  assert.match(text, /a selection reaches only the cards the Graph draws, so they leave it with the dots and come back with them/);
});

test('the Graph section says depth 0 puts them on the depth 0 ring between the tier bands and depth 1, in a sector of their own', () => {
  const text = graph();
  assert.match(text, /\*\*depth 0\*\* draws them on the depth 0 ring, between the tier bands and depth 1, in a sector of their own/);
  assert.match(text, /the ring's caption is the depth 0 band's, `depth 0`, and its tooltip counts them/);
});

test('the Graph section says table draws the Unnested block, and that the option is Tiers\' own, kept per board, and frames an untouched view again', () => {
  const text = graph();
  assert.match(text, /\*\*table\*\* draws the Unnested block outside the rim/);
  assert.match(text, /The Unnested option is Tiers' own: the Flow draws every card/);
  assert.match(text, /Pressing Unnested, which changes what the fan draws and what Fit frames, frames an untouched view again/);
  assert.match(text, /choices are kept per board in `localStorage` under `graph\.options`/);
});

test('the Graph section says in every mode Fit and the first draw frame what is drawn and no two captions overlap', () => {
  const text = graph();
  assert.match(text, /Fit and the first draw frame the whole circle, every dot, every caption and the Unnested block, and no two captions overlap/);
  assert.match(text, /in every mode/);
});

test('the Graph section does not call the ring the outermost ring of the old layout, and the unnested cards are not always in a block', () => {
  const text = graph();
  assert.doesNotMatch(text, /on the outermost ring/);
  assert.doesNotMatch(text, /sit in the \*\*Unnested\*\* block outside the rim, a column/);
});

test('the web doc names the fourth option and the four modes in short', () => {
  const text = docGraph();
  assert.match(text, /Lines \(folded, chain, all, off\), Dependencies \(on, off\), Order \(status, rank\), Names \(relevant, all, none\) and Unnested \(outermost, off, depth 0, table\)/);
  assert.match(text, /Unnested says where the cards with no parent, no children and no tier are drawn: on one ring outside the fan by default/);
  assert.doesNotMatch(text, /on the outer ring/);
});

test('the Hierarchy button\'s title says where the unnested cards go by default and that the option row moves them', () => {
  const title = /hierarchy: '(Hierarchy: [^']*)'/.exec(view);
  assert.ok(title, 'the Hierarchy title is in graph-view.js');
  assert.match(title[1], /one ring outside the rest/);
  assert.match(title[1], /Unnested option/);
  assert.match(title[1], /off, depth 0 or the Unnested block outside the rim/);
});

test('the Unnested option\'s tooltip in the row says what each mode draws', () => {
  const hint = /unnested: \{\s*label: 'Unnested',\s*hint: '([^']*)'/.exec(view);
  assert.ok(hint, 'the hint is a plain string');
  for (const mode of ['Outermost', 'Off', 'Depth 0', 'Table']) assert.ok(hint[1].includes(`${mode}:`), `${mode} is explained`);
});
