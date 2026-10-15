const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseSearchQuery, filterCards } = require('../web/search');

// The web skill and the web docs describe the slice: term, with examples. The
// examples are held to the search module, so a doc cannot promise a cut the box
// does not make. The retired-word tests ban `.epic` and a backticked `epic:` in
// these files, so the examples cut by goal, strategy and objective.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const searchBullet = skill.slice(skill.indexOf('- **Search**'), skill.indexOf('- **Create**')).replace(/\s+/g, ' ');
const searchDocs = docs.slice(docs.indexOf('**Search**'), docs.indexOf('**Notifications inbox**')).replace(/\s+/g, ' ');

const EXAMPLES = {
  run: 'slice:objective..2',
  one: 'slice:goal',
  openBottom: 'slice:goal..',
  openTop: 'slice:..objective',
  combined: 'tags:ui (slice:goal | #12)',
};

test('the web skill describes slice:, with one example for a run, one slice, an open end each way, and a combined query', () => {
  assert.ok(searchBullet.length > 100, 'the Search bullet is found');
  for (const [form, example] of Object.entries(EXAMPLES)) {
    assert.ok(searchBullet.includes(`\`${example}\``), `${form}: ${example}`);
  }
});

test('the web docs describe slice:, with the same examples', () => {
  assert.ok(searchDocs.length > 100, 'the Search paragraph is found');
  for (const [form, example] of Object.entries(EXAMPLES)) {
    assert.ok(searchDocs.includes(`\`${example}\``), `${form}: ${example}`);
  }
});

test('both say what the axis is, that a reversed pair is swapped, and that an end the board lacks is left open', () => {
  for (const [where, text] of [['skill', searchBullet], ['docs', searchDocs]]) {
    assert.match(text, /hierarchy/, `${where}: the tiers come from the hierarchy`);
    assert.match(text, /depth/, `${where}: cards with no tier are cut by depth`);
    assert.match(text, /swapped/, `${where}: a reversed pair`);
    assert.match(text, /left open/, `${where}: an end the board does not have`);
  }
  assert.match(searchBullet, /cut nothing/, 'the skill says which forms cut nothing');
});

test('the documented examples cut as the docs say', () => {
  const card = (id, over = {}) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], parent: null, ...over });
  const cards = [
    card(1, { type: 'goal', tags: ['ui'] }),
    card(2, { type: 'strategy', parent: 1 }),
    card(3, { type: 'objective', parent: 2 }),
    card(4, { parent: 3 }),
    card(5, { parent: 4 }),
    card(6, { parent: 5 }),
    card(7),
    card(12, { tags: ['ui'] }),
  ];
  const ctx = { board: 'kanban', hierarchy: ['goal', 'strategy', 'objective'] };
  const ids = (q) => filterCards(cards, parseSearchQuery(q, 'kanban'), ctx).map((c) => c.id);
  assert.deepStrictEqual(ids(EXAMPLES.run), [3, 7, 12], 'the objective tier, then depths 0 to 2, where depths 1 and 2 hold no card');
  assert.deepStrictEqual(ids(EXAMPLES.one), [1]);
  assert.deepStrictEqual(ids(EXAMPLES.openBottom), [1, 2, 3, 4, 5, 6, 7, 12]);
  assert.deepStrictEqual(ids(EXAMPLES.openTop), [1, 2, 3]);
  assert.deepStrictEqual(ids(EXAMPLES.combined), [1, 12]);
});

test('the skill and the docs count the same extra forms, one bullet each in the docs, and the skill lists slice: among them', () => {
  const numbers = { three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const said = (text) => numbers[new RegExp(`\\b(${Object.keys(numbers).join('|')})\\b(?: more)? forms`, 'i').exec(text)[1].toLowerCase()];
  const bullets = docs.slice(docs.indexOf('**Search**'), docs.indexOf('**Notifications inbox**')).split('\n').filter((l) => l.startsWith('- ')).length;
  assert.strictEqual(said(searchDocs), bullets, 'the docs count the forms they list');
  assert.strictEqual(said(searchBullet), said(searchDocs), 'the skill counts the same forms');
  const stop = searchBullet.indexOf('A `|` counts only');
  assert.ok(stop > 0, 'the skill has its sentence on literal text, which ends the list of forms');
  const list = searchBullet.slice(0, stop);
  assert.ok(list.includes(`\`${EXAMPLES.run}\``), 'the skill gives slice: its example in the list of forms, before the rules for the odd cases');
});

test('the search box tooltip names slice: with an example', () => {
  const html = read('skills', 'web', 'web', 'app.html');
  const tip = /<input[^>]*id="search-input"[^>]*>/.exec(html)[0].replace(/\s+/g, ' ');
  assert.ok(tip.includes('slice:objective..2'), 'the tooltip carries the example');
});
