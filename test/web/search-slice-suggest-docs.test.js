const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { searchSuggestionItems } = require('../../plugin/skills/web/web/search');

// The web skill and the web docs say what the search box suggests after slice: and after
// .., and the examples they give are held to the search module, so a doc cannot promise a
// suggestion the box does not make.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');
const dropdown = flat(skill.slice(skill.indexOf('An\n  autocomplete dropdown'), skill.indexOf('- **Create**')));
const searchDocs = flat(docs.slice(docs.indexOf('**Search**'), docs.indexOf('**Search panel**')));

const card = (id, over = {}) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], parent: null, ...over });

test('the web skill says the dropdown lists slices after slice: and after .., what they are and in what order, and what a pick writes', () => {
  assert.ok(dropdown.length > 100, 'the autocomplete sentences are found');
  assert.match(dropdown, /after `slice:` and\s+after `\.\.`/);
  assert.match(dropdown, /tiers of the `hierarchy:` in hierarchy order/);
  assert.match(dropdown, /then the depth numbers from 0 to the deepest card with no tier/);
  assert.match(dropdown, /Picking a row writes the whole\s+term \(`slice:goal\.\.objective`/);
  assert.match(dropdown, /quoted, the quote holding both ends \(`slice:"big goal\.\.2"`\)/);
  assert.match(dropdown, /Graph caption's tooltip/, 'and that a caption shows the same kind of term');
});

test('the web docs say the same in the Search paragraph', () => {
  assert.ok(searchDocs.length > 100, 'the Search paragraph is found');
  assert.match(searchDocs, /after `slice:` and after `\.\.`/);
  assert.match(searchDocs, /tiers in hierarchy order and then the depth numbers from 0 to the deepest card with no tier/);
  assert.match(searchDocs, /picking one writes the whole term \(`slice:goal\.\.objective`\)/);
  assert.match(searchDocs, /quoted, the quote holding both ends \(`slice:"big goal\.\.2"`\)/);
});

test('the skill still says nothing is offered once a token carries a colon, apart from slice:, and that tree:, path:, the four Explore terms and dlinks:/hlinks: are left out', () => {
  assert.match(dropdown, /nothing is\s+offered once the token carries a colon, except after `slice:` and after `\.\.`/);
  assert.match(dropdown, /`tree:`\/`path:`, the four above and `dlinks:`\/`hlinks:` are excluded/);
  assert.doesNotMatch(dropdown, /`path:` and the four above are excluded/);
});

test('the documented suggestions are what the search module offers', () => {
  const plain = [card(1, { type: 'goal' }), card(2, { type: 'strategy', parent: 1 }), card(3, { type: 'objective', parent: 2 }), card(4, { parent: 3 }), card(5, { parent: 4 }), card(6, { parent: 5 }), card(7, { parent: 6 })];
  const ctx = { board: 'kanban', hierarchy: ['goal', 'strategy', 'objective'] };
  const values = (text) => searchSuggestionItems(text, text.length, plain, ctx).map((i) => i.value);
  assert.ok(values('slice:goal..').includes('slice:goal..objective'), 'the whole cut the skill and the docs write');
  assert.deepStrictEqual(values('slice:').filter((v) => /^slice:\d/.test(v)), ['slice:0', 'slice:1', 'slice:2', 'slice:3'], 'the depths run from 0 to the deepest card with no tier, which is at depth 3, counted from the objective');
  assert.strictEqual(values('slice:').indexOf('slice:goal'), 0, 'the tiers come first');

  const spaced = [card(1, { type: 'big goal' }), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4, { parent: 3 })];
  const quoted = searchSuggestionItems('slice:"big goal..', undefined, spaced, { board: 'kanban', hierarchy: ['big goal'] }).map((i) => i.value);
  assert.ok(quoted.includes('slice:"big goal..2"'), 'the quoted example the skill and the docs write');
});

test('the sentence the nesting docs pin about suggest, never validate is left as it was', () => {
  assert.match(skill, /assignees, priorities, tags and types lists all \*\*suggest, never validate\*\*/);
});
