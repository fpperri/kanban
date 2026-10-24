const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseSearchQuery, filterCards } = require('../../plugin/skills/web/web/search');

// The web skill and the web docs describe the search grammar beyond plain
// terms: `|` for or, round brackets, quotes and `waiting:`. Each form has one
// example in both, and the examples are held to the search module so a doc
// cannot promise what the box does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const searchBullet = skill.slice(skill.indexOf('- **Search**'), skill.indexOf('- **Create**')).replace(/\s+/g, ' ');
const searchDocs = docs.slice(docs.indexOf('**Search**'), docs.indexOf('**Notifications inbox**')).replace(/\s+/g, ' ');

const EXAMPLES = {
  or: 'tags:ui status:doing | #12',
  bracket: 'tags:ui (status:doing | status:todo)',
  quote: 'tags:"grill"',
  phrase: '"two words"',
  waiting: 'waiting:',
};

test('the web skill describes | , brackets, quotes and waiting:, with one example each', () => {
  assert.ok(searchBullet.length > 100, 'the Search bullet is found');
  for (const [form, example] of Object.entries(EXAMPLES)) {
    assert.ok(searchBullet.includes(`\`${example}\``), `${form}: ${example}`);
  }
});

test('the web docs describe | , brackets, quotes and waiting:, with one example each', () => {
  assert.ok(searchDocs.length > 100, 'the Search paragraph is found');
  for (const [form, example] of Object.entries(EXAMPLES)) {
    assert.ok(searchDocs.includes(`\`${example}\``), `${form}: ${example}`);
  }
});

test('both say the literal forms: a|b, fix(auth) and waiting:3 stay text', () => {
  for (const [where, text] of [['skill', searchBullet], ['docs', searchDocs]]) {
    for (const literal of ['a|b', 'fix(auth)', 'waiting:3']) assert.ok(text.includes(`\`${literal}\``), `${where}: ${literal}`);
  }
});

test('the documented examples parse as the docs say', () => {
  const cards = [
    { id: 1, title: 'a', body: '', status: 'doing', priority: 'Normal', tags: ['ui', 'grill'] },
    { id: 2, title: 'b', body: '', status: 'todo', priority: 'Normal', tags: ['ui', 'grilling'] },
    { id: 12, title: 'c', body: '', status: 'backlog', priority: 'Normal', tags: [] },
    { id: 3, title: 'd', body: 'two words', status: 'backlog', priority: 'Normal', tags: [], waiting_for: [1] },
  ];
  const ids = (q) => filterCards(cards, parseSearchQuery(q)).map((c) => c.id);
  assert.deepStrictEqual(ids(EXAMPLES.or), [1, 12]);
  assert.deepStrictEqual(ids(EXAMPLES.bracket), [1, 2]);
  assert.deepStrictEqual(ids(EXAMPLES.quote), [1]);
  assert.deepStrictEqual(ids(EXAMPLES.phrase), [3]);
  assert.deepStrictEqual(ids(EXAMPLES.waiting), [3]);
});
