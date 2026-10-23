const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill's Graph section says what the Graph lights: the pointer, a lone
// card with its relations, a selection, and a search typed there, which is the
// anchor of the selection and stays in the Graph. The words are the glossary's.

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
const webDoc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), 'utf8');

function bullet(marker) {
  const start = webSkill.indexOf(marker);
  assert.ok(start !== -1, `${marker} is in the web skill`);
  return webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
}

const graph = () => bullet('- **Graph view**');

test('the Graph section describes lighting: everything dims but what is lit, and the pointer, a lone card, a selection and a typed search share it', () => {
  const text = graph();
  assert.match(text, /\*\*Lighting\.\*\* The Graph dims everything but what is lit/);
  assert.match(text, /one dimming serves the pointer, a lone card, a selection and a search typed in the box/);
});

test('the Graph section says a lone card picked by a click stays lit with its one-hop relations, which light without being selected', () => {
  const text = graph();
  assert.match(text, /a \*\*lone card\*\* picked by a click stays lit with its one-hop relations/);
  assert.match(text, /the relations light without being selected/);
});

test('the Graph section says a selection of several cards lights exactly those cards, and a query that matches one card lights it alone', () => {
  const text = graph();
  assert.match(text, /A selection of several cards lights exactly those cards and the lines between them, not their relations/);
  assert.match(text, /a query that matches one card lights that card alone, without its relations/);
});

test('the Graph section says a search typed in the Graph is the anchor, hides nothing and does not run the layout again', () => {
  const text = graph();
  assert.match(text, /A \*\*search typed in the Graph\*\* is the anchor of the selection instead of a filter: nothing hides/);
  assert.match(text, /typing does not run the layout again/);
  assert.match(text, /matches light, done cards included/);
});

test('the Graph section says only a slice: term on its own hides, and the rest of the query lights inside the cut', () => {
  const text = graph();
  assert.match(text, /The one thing it hides is the cards outside the cut of a `slice:` term that stands on its own in the query, as in every other view/);
  assert.match(text, /the rest of the query lights inside the cut/);
  assert.match(text, /a `slice:` term under `\|` or in a bracket of alternatives is only a term to match, so it lights and hides nothing/);
});

test('the Graph section says what drops the typed anchor and what a click does to it', () => {
  const text = graph();
  assert.match(text, /Emptying the box, \*\*Esc\*\* and a double click on the empty Graph drop the anchor and the dimming/);
  assert.match(text, /a plain click on a card sets a new card anchor and the box shows that card in place of the search/);
  assert.match(text, /shift\+click or ctrl\/cmd\+click on an unlit card adds it and writes it beside the query/);
  assert.match(text, /turns the query into its other cards, which the box then names/);
});

test('the Graph section says a typed search stays in the Graph: the other views isolate it or light its matches by their Typing isolates, nothing is selected there, and it lights again on the way back', () => {
  const text = graph();
  assert.match(text, /stops being the anchor when you leave the Graph/);
  assert.match(text, /each view follows its own Typing isolates: where it is ticked \(the Board, Map, Gantt and Calendar to start\) the typed search isolates there on the switch and shows its matches alone, and where it is unticked the view lights its matches with the selected look and hides nothing; nothing is selected by it/);
  assert.match(text, /Back in the Graph with the box unchanged and nothing selected, isolate ends and its matches light again/);
  assert.match(text, /a selection carried in from another view stays, and the box has no effect in the Graph until it is edited/);
});

test('the Graph section no longer says the search box filters the Graph or composes with its pills by intersection', () => {
  const text = graph();
  assert.doesNotMatch(text, /filtered out by a pill or the search/);
  assert.doesNotMatch(text, /composes with the pills by \*\*intersection\*\*/);
});

test('the Search section and the multi-select section name the Graph as the exception', () => {
  assert.match(bullet('- **Search**'), /says \*what\* and Isolate says \*hide or light\*, in every view/);
  assert.match(bullet('- **Search**'), /the Graph lights as it always did/);
  assert.match(bullet('- **Search**'), /hides nothing but a top-level `slice:` cut/);
  assert.match(bullet('- **Multi-select**'), /A search typed in the Graph is the anchor of the selection: its matches are the selected cards/);
});

test('the web doc\'s Graph section says the same in short: a typed search lights, hides nothing and stays in the Graph', () => {
  const start = webDoc.indexOf('## Graph');
  const section = webDoc.slice(start, webDoc.indexOf('\n## ', start + 4)).replace(/\s+/g, ' ');
  assert.match(section, /A search typed in the Graph hides nothing: its matches light, done cards included, and the rest dims/);
  assert.match(section, /Only a `slice:` term on its own in the query cuts the Graph, as it cuts every view; under `\|` it lights/);
  assert.match(section, /the box lights its matches there and hides nothing, while nothing is selected by it/);
  assert.doesNotMatch(section, /or the search\)/);
});
