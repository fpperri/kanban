const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The glossary, the web doc and the web skill describe the Graph's Flow: the Hierarchy | Flow choice,
// the two settings of the Dependencies switch and the columns each gives, the strip, the arrows, what
// lights, and where the choice is kept. The words are the glossary's: Flow, Frontier, dependency, slice,
// selection, status pill.

const root = path.join(__dirname, '..', '..', '..');
const flat = (text) => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
const glossary = flat(fs.readFileSync(path.join(root, 'GLOSSARY.md'), 'utf8'));
const webDoc = flat(fs.readFileSync(path.join(root, 'docs', 'web.md'), 'utf8'));
const webSkill = flat(fs.readFileSync(path.join(root, 'skills', 'web', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n'));

const entry = (term) => {
  const start = glossary.indexOf(`**${term}** (web only):`);
  assert.ok(start !== -1, `${term} is in the glossary`);
  const rest = glossary.slice(start + 4);
  const next = rest.search(/\*\*[A-Z][^*]*\*\*[^:]{0,40}:/);
  return glossary.slice(start, next === -1 ? undefined : start + 4 + next);
};
const skillBullet = (marker) => {
  const start = webSkill.indexOf(marker);
  assert.ok(start !== -1, `${marker} is in the web skill`);
  const ends = [' - **', ' ## '].map((m) => webSkill.indexOf(m, start + 4)).filter((i) => i !== -1);
  return webSkill.slice(start, ends.length ? Math.min(...ends) : undefined);
};
const docFlow = () => {
  const start = webDoc.indexOf('**Flow** lays the board out');
  assert.ok(start !== -1, 'the web doc has the Flow paragraph');
  return webDoc.slice(start, webDoc.indexOf('A dot takes its status colour', start));
};

test('the glossary\'s Graph view names its two graphs, and says the Hierarchy is the tier fan alone', () => {
  const text = entry('Graph view');
  assert.match(text, /one of two graphs chosen at the top of its option panel: the \*\*Hierarchy\*\*/);
  assert.match(text, /and the \*\*Flow\*\*, the cards laid out by their dependencies/);
  assert.match(text, /The Hierarchy is the tier fan, its one layout \(tiers\): it goes all the way round its centre/);
  assert.doesNotMatch(text, /force|status layout|layouts: /i);
});

test('the glossary has Flow: columns by dependencies, the Dependencies switch, the strip, the loop, and what it avoids', () => {
  const text = entry('Flow');
  assert.match(text, /the board laid out by its dependencies in columns, left to right, one column for each step of a plan/);
  assert.match(text, /an arrow from each card waited for to the card that waits, and no parent line/);
  assert.match(text, /Dependencies switch is \*\*frontier\*\* \(the default\) or all/);
  assert.match(text, /A card with no dependency either way sits in a strip below the columns, with a count/);
  assert.match(text, /A dependency loop never hangs it: the loop has a column of its own under frontier/);
  assert.match(text, /_Avoid_: workflow, pipeline, timeline \(that is the Gantt\)/);
});

test('the glossary has Frontier: the steps until a card is ready, only the dependencies not done, and the columns', () => {
  const text = entry('Frontier');
  assert.match(text, /the steps until a card is ready, counting only the dependencies that are not done/);
  assert.match(text, /The first column holds the done cards, faded; then `ready now` \(what can be picked up now\), `1 step`, `2 steps`/);
  assert.match(text, /a card in or behind a dependency loop stands in a last `loop` column/);
  assert.match(text, /all, counts the longest chain of dependencies behind a card instead, done ones included: `waits for nothing`, `chain 1`, `chain 2`/);
});

test('the web doc says the Graph is one of two graphs, Hierarchy opening first', () => {
  assert.match(webDoc, /in one of two graphs, \*\*Hierarchy\*\* or \*\*Flow\*\*, chosen at the top of its option panel \(Hierarchy opens first; see \*\*Flow\*\* below\)/);
});

test('the web doc says what each setting of the switch puts in its columns', () => {
  const text = docFlow();
  assert.match(text, /A \*\*Dependencies\*\* switch under the choice, \*\*frontier\*\* by default or \*\*all\*\*/);
  assert.match(text, /Frontier counts the steps until a card is ready, and only the dependencies that are not done: the first column is `done`, faded, then `ready now`/);
  assert.match(text, /the first column with work in it is what you can pick up now/);
  assert.match(text, /`1 step`, `2 steps`, and a card in or behind a dependency loop stands in a last `loop` column/);
  assert.match(text, /All counts the longest chain of dependencies behind a card, done ones included: `waits for nothing`, `chain 1`, `chain 2`, a loop sharing one column/);
  assert.match(text, /Each column heading carries its card count/);
});

test('the web doc says where the strip, the order and the arrows go, and what a dot keeps', () => {
  const text = docFlow();
  assert.match(text, /Cards with no dependency either way sit in a strip below the columns, titled `no dependency either way` with its count/);
  assert.match(text, /ordered to cut the arrows that cross, ties by id, and a tall column wraps into side-by-side stacks/);
  assert.match(text, /with an arrow from each card waited for to the card that waits, and no parent line/);
  assert.match(text, /A dot keeps its status colour and its type mark, and grows with the dependencies it is in; in frontier the done ones are faded/);
});

test('the web doc says what works as in Hierarchy, what lights, and that a dot cannot be dragged', () => {
  const text = docFlow();
  assert.match(text, /Search lighting, the status pills, `slice:` cuts, isolate, selection, the card menu, double-click and Enter and the zoom work as in Hierarchy/);
  assert.match(text, /hovering a card, or a lone card picked by a click, lights it with the cards its dependencies join to it, not its parent/);
  assert.match(text, /A dot cannot be dragged/);
});

test('the web doc says the choice and the switch are remembered, in the address, and in the phone\'s sheet', () => {
  const text = docFlow();
  assert.match(text, /remembered per board in your browser and written in the address as `graph=hierarchy\|flow` and `deps=frontier\|all`/);
  assert.match(text, /a link's values win on that load, and a press replaces the page's address without adding a step to Back/);
  assert.match(text, /In the phone's bottom sheet the choice and the switch are its first rows/);
});

test('the web skill\'s Graph view says the Graph is one of two graphs, and points at Graph Flow', () => {
  const text = skillBullet('- **Graph view**');
  assert.match(text, /The Graph draws one of two graphs, chosen at the top of the option panel: \*\*Hierarchy\*\*, which is all of the above, and \*\*Flow\*\* \(see \*\*Graph Flow\*\*\)/);
});

test('the web skill\'s Graph Flow says the choice, the panel and what the switch is', () => {
  const text = skillBullet('- **Graph Flow**');
  assert.match(text, /The option panel opens with a \*\*Hierarchy \| Flow\*\* choice \(`\.graph-kind-btn`, `aria-pressed` on the one drawn\), Hierarchy first/);
  assert.match(text, /under Flow the panel holds the zoom and the \*\*Dependencies\*\* switch, and none of Hierarchy's option row/);
  assert.match(text, /the words are the glossary's \*\*Flow\*\* and \*\*Frontier\*\*/);
  assert.match(text, /The \*\*Dependencies\*\* switch is \*\*frontier\*\* \(the default\) or \*\*all\*\*/);
});

test('the web skill\'s Graph Flow says both settings, the done and loop columns, and the loop with a done card in it', () => {
  const text = skillBullet('- **Graph Flow**');
  assert.match(text, /\*\*Frontier\*\* counts the steps until a card is ready and only the dependencies that are not done \(a card that is `done` or archived is done\)/);
  assert.match(text, /the first column is `done`, faded, then `ready now`, `1 step`, `2 steps` and on, and a card in or behind a dependency loop stands in a last `loop` column/);
  assert.match(text, /a loop with a done card in it is no loop/);
  assert.match(text, /\*\*All\*\* counts the longest chain of dependencies behind a card, done ones included: `waits for nothing`, `chain 1`, `chain 2` and on, the members of a loop sharing one column/);
});

test('the web skill\'s Graph Flow says the strip, the order, the arrows and the dots', () => {
  const text = skillBullet('- **Graph Flow**');
  assert.match(text, /Each column is a shaded frame with a heading that prints its card count \(`ready now · 4`\); the `done` column is faded/);
  assert.match(text, /no dependency either way\*\* among the drawn cards sits in a \*\*strip\*\* below the columns, in either mode, titled `no dependency either way` with its count/);
  assert.match(text, /ordered to cut the arrows that cross \(the mean place of what each waits for and what waits for it, two sweeps each way\), ties by id, and a column of more than fourteen cards wraps into side-by-side stacks/);
  assert.match(text, /An \*\*arrow\*\* runs from the card waited for to the card that waits, leaving to the right and arriving from the left with its head at the rim/);
  assert.match(text, /a dot keeps its status colour and its type mark, grows with the waits it is in \(a parent does not enlarge it\), and is faded in frontier when done or archived/);
  assert.match(text, /A loop, a card that waits for itself and a chain of any length never hang the drawing/);
});

test('the web skill\'s Graph Flow says what works as in Hierarchy, what lights, and that a dot is not dragged', () => {
  const text = skillBullet('- **Graph Flow**');
  assert.match(text, /Search lighting, the status pills, `slice:` cuts, isolate, selection, the card menu, double-click, Enter, Space and the zoom work as in Hierarchy, on the same dots/);
  assert.match(text, /a card whose only dependency is hidden has no dependency drawn, so it is in the strip/);
  assert.match(text, /Hover, focus and a lone selected card light the card with the cards its \*\*dependencies\*\* join to it, not its parent or children, and the lit lines are the arrows/);
  assert.match(text, /A dot cannot be dragged in Flow; the background pans/);
});

test('the web skill\'s Graph Flow says where the choice is kept, how the address carries it, and the sheet', () => {
  const text = skillBullet('- **Graph Flow**');
  assert.match(text, /kept per board in `localStorage` under `graph\.layout` \(`flow` or `tiers`\) and the switch under `graph\.deps`/);
  assert.match(text, /a value this version does not offer, a layout an older version kept included, reads as Tiers and frontier/);
  assert.match(text, /`graph=hierarchy\|flow` and `deps=frontier\|all`: on a load the address wins, and a link's value is kept for that load only until a press/);
  assert.match(text, /a press replaces the page's address \(`history\.replaceState`, no step in Back\) and leaves every other parameter, `deps` going when Hierarchy is chosen/);
  assert.match(text, /On a phone the panel is the \*\*bottom sheet\*\*, with the choice and the switch in it/);
  assert.match(text, /the snapshot has no Graph view, so it embeds none of it/);
});

test('what the docs say of the keys and the options is what the page keeps', () => {
  const view = fs.readFileSync(path.join(root, 'skills', 'web', 'web', 'graph-view.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(view.includes("storageKey(state.projectName, 'graph.deps')"));
  assert.ok(view.includes("storageKey(state.projectName, 'graph.layout')"));
  const flow = require('../web/graph-flow');
  assert.deepStrictEqual(flow.GRAPH_FLOW_DEPS, ['frontier', 'all']);
  assert.deepStrictEqual(flow.GRAPH_FLOW_GRAPHS, ['hierarchy', 'flow']);
  assert.strictEqual(flow.GRAPH_FLOW_GEO.ROWS, 14, 'a column wraps past fourteen cards');
});
