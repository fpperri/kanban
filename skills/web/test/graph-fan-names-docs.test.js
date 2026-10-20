const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section and the web doc describe the tier fan's Names option and the n
// key: the three values and the default, what relevant names and in what order, the small fan,
// that a name is the title as text in place of the id, that the layout never reads the setting,
// the key and the guard it reads, and where the choice is kept. Where a name sits is the other
// docs test's (graph-fan-name-rows-docs.test.js). The words are the glossary's: altitude,
// selection, pill, tier.

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

test('the Graph section says the row holds five options, and Names is the fourth', () => {
  const text = graph();
  assert.match(text, /It holds five options, the first value of each the default/);
  assert.match(text, /\*\*Names\*\* says which cards carry their title: \*\*relevant\*\* \(the default\)/);
});

test('the Graph section says what each Names value names, relevant the default', () => {
  const text = graph();
  assert.match(text, /\*\*relevant\*\* \(the default\) names the selection and the cards it lights/);
  assert.match(text, /a lone card's one-hop relations and a pill's matches among them/);
  assert.match(text, /then the parents from the highest altitude down while fewer than 24 cards are named/);
  assert.match(text, /on a fan of 24 cards or fewer every card/);
  assert.match(text, /\*\*all\*\* names every card; \*\*none\*\* names no card/);
  assert.match(text, /Altitude is the glossary's: the layers of cards below a card on the board, drawn or not, blind to type, as the badge on its tile counts them/);
});

test('the Graph section says a name is the title as plain text in place of the id, painted in place, and the layout never reads it', () => {
  const text = graph();
  assert.match(text, /A name is the card's id and title as plain text \(`#12 The title`\), cut to 38 characters, and shorter, with an ellipsis, when its place has less room, the id never cut; a named card that finds room shows it in place of its id label/);
  assert.match(text, /a click on a card names it and what it lights in place, with no redraw/);
  assert.match(text, /Names never run the layout again/);
  assert.match(text, /a card the Tiers fan names and finds room for shows its title instead, beside its ring or in a row outside the rim/);
});

test('the Graph section says the n key steps the setting through the shared key guard, in Tiers only', () => {
  const text = graph();
  assert.match(text, /\*\*n\*\* steps the setting relevant, all, none and round to relevant while the Graph shows Tiers, whether the panel is open or not/);
  assert.match(text, /it reads the shared key guard, so it does nothing while a field has focus \(the search box types an n\) or while a card menu, a dialog, the notifications panel or the preferences sheet is open, and it works with the search panel open/);
  assert.match(text, /The footer line under the Graph shows the setting \(`n steps the names: relevant`\)/);
  assert.match(text, /Force and Status have no names/);
});

test('the web doc says the same in short', () => {
  const text = docGraph();
  assert.match(text, /Names \(relevant, all, none\)/);
  assert.match(text, /Names puts a card's title on the fan/);
  assert.match(text, /the n key steps through them/);
});
