const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section and the web doc describe the tier fan's option row: what
// it holds, what each value draws, that it starts folded, and where its choices are kept.
// The words are the glossary's: tier, slice, selection, status pill.

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

test('the Graph section says Tiers has an option row, folded behind an Options toggle, and only Tiers has it', () => {
  const text = graph();
  assert.match(text, /Tiers has an \*\*option row\*\* above the fan/);
  assert.match(text, /folded behind an Options toggle, like the Map's, and starts folded/);
  assert.match(text, /Force and Status have no option row/);
});

test('the Graph section says what Lines draws in each of its four values, folded the default', () => {
  const text = graph();
  assert.match(text, /\*\*Lines\*\* draws the parent lines: \*\*folded\*\* \(the default\)/);
  assert.match(text, /folded[^.]*a line to the end of each dependency chain, as the Map draws its chain ends/);
  assert.match(text, /a parent's other children on one ring share one \*\*counted line\*\* that prints their count/);
  assert.match(text, /\*\*chain\*\* gives a line to every chain end and none to the other children/);
  assert.match(text, /\*\*all\*\* gives a line to every child/);
  assert.match(text, /\*\*off\*\* draws no parent line/);
});

test('the Graph section says Dependencies and Order, and what each value does', () => {
  const text = graph();
  assert.match(text, /\*\*Dependencies\*\* are on \(the default\) or off, the dashed arrows for `waiting_for`/);
  assert.match(text, /\*\*Order\*\* sorts siblings within a sector: by \*\*status\*\* \(the default\), doing, todo, backlog, the other live statuses in column order, done, archived, as the Map orders its rows, or by \*\*rank\*\*, the outline's own order/);
});

test('the Graph section says the counted line lights with its parent, the chain ends are read on the whole board, and the options only redraw', () => {
  const text = graph();
  assert.match(text, /A counted line lights whenever its parent does/);
  assert.match(text, /chain ends are read on the whole board, so hiding a card with a status pill or a search never moves a line/);
  assert.match(text, /The lines and dependencies only redraw; the order moves siblings along their own stretch of the sector, and no card changes its band, its ring or its sector/);
});

test('the Graph section says where the choices are kept and that a press leaves the pan, the selection and the poll alone', () => {
  const text = graph();
  assert.match(text, /choices are kept per board in `localStorage` under `graph\.options`/);
  assert.match(text, /the row is always shown in the option panel, with no fold, and a `graph\.optionsFolded` value left by an older version is never read/);
  assert.match(text, /A press on the row never starts a pan, never clears the selection and never pauses the 5-second poll/);
});

test('the Graph section says a press of an option does not move the view, so Fit frames every card again', () => {
  const text = graph();
  assert.match(text, /Pressing Lines, Dependencies or Order never pans, zooms or re-fits the view, so a fan framed once keeps its place/);
  assert.match(text, /\*\*Fit\*\* frames every card again/);
  assert.match(text, /Picking a layout re-fits the view; after that a pan or zoom is kept, and an untouched view re-fits when the set of cards changes/);
});

test('the Graph section no longer says every relation is drawn in Tiers', () => {
  const text = graph();
  assert.match(text, /Relations:\*\* in Force and Status a solid line joins a parent to its child/);
  assert.match(text, /in Tiers the Lines option says which parent lines are drawn/);
});

test('the web doc says the same in short', () => {
  const text = docGraph();
  assert.match(text, /an option row in the option panel beside the fan/);
  assert.match(text, /Lines \(folded, chain, all, off\), Dependencies \(on, off\), Order \(status, rank\), Names \(relevant, all, none\) and Unnested \(outermost, off, depth 0, table\)/);
  assert.match(text, /kept per board/);
});
