const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseSearchQuery, filterCards } = require('../../web/web/search');

// What the snapshot skill promises about its search box, pinned so the skill
// keeps saying what the page does: it runs the web's own search module. The
// documented examples are held to that module, so the skill cannot promise a
// cut the box does not make. The retired-word tests ban `.epic` and a backticked
// `epic:` in the skill docs, so the examples cut by goal, strategy and objective.

const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const section = /\nA search box under the header[\s\S]*?\n\n/.exec(skill);

test('the skill\'s search section names the assignee scope and its a: alias', () => {
  assert.ok(section, 'a search section');
  assert.match(section[0], /`assignee:`[^.]*`a:`/, 'assignee: and its a: alias are named together');
  assert.match(section[0], /case-insensitive substring[^.]*assignee handle/, 'and the scope says what it matches');
});

test('the skill\'s search section says the page runs the web\'s own search module', () => {
  assert.ok(section, 'a search section');
  assert.match(section[0], /skills\/web\/web\/search\.js/);
});

test('the cross-harness note says the generator needs the search module, the slices module and the waiting rules beside it too', () => {
  const note = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'cross-harness.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(note, /skills\/web\/web\/search\.js/);
  assert.match(note, /skills\/web\/web\/slices\.js/);
  assert.match(note, /skills\/web\/web\/waiting-blocked\.js/);
});

test('the skill keeps type: among the scoped substrings the nesting docs pin', () => {
  assert.match(skill, /`file:`\/`type:` scoped substrings/);
});

const EXAMPLES = {
  or: 'tags:ui status:doing | #12',
  bracket: 'tags:ui (status:doing | status:todo)',
  quote: 'tags:"grill"',
  phrase: '"two words"',
  waiting: 'waiting:',
  run: 'slice:objective..2',
  one: 'slice:goal',
  openBottom: 'slice:goal..',
  openTop: 'slice:..objective',
  depth: 'slice:1',
  combined: 'tags:ui (slice:goal | #12)',
};

const flat = section && section[0].replace(/\s+/g, ' ');

test('the skill describes |, brackets, quotes, phrases, waiting: and slice:, with an example each', () => {
  assert.ok(flat, 'a search section');
  for (const [form, example] of Object.entries(EXAMPLES)) {
    assert.ok(flat.includes(`\`${example}\``), `${form}: ${example}`);
  }
});

test('the skill says the literal forms stay text: a|b, fix(auth) and waiting:3', () => {
  for (const literal of ['a|b', 'fix(auth)', 'waiting:3']) assert.ok(flat.includes(`\`${literal}\``), literal);
});

test('the skill says what a quoted title: or body: matches, and what the slices are', () => {
  assert.match(flat, /quoted `title:` or `body:` matches the whole field/);
  assert.match(flat, /`hierarchy:`/, 'the tiers come from the hierarchy in config.yaml');
  assert.match(flat, /depth/, 'cards with no tier are cut by depth');
  assert.match(flat, /swapped/, 'a reversed pair');
  assert.match(flat, /left open/, 'an end the board does not have');
  assert.match(flat, /cut nothing/, 'the forms that cut nothing');
  assert.match(flat, /archived/, 'archived cards count toward the depths');
});

test('the documented examples cut as the skill says', () => {
  const card = (id, over = {}) => ({ id: String(id), title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], parent: null, ...over });
  const cards = [
    card(1, { type: 'goal', tags: ['ui'], status: 'doing' }),
    card(2, { type: 'strategy', parent: '1' }),
    card(3, { type: 'objective', parent: '2' }),
    card(4, { parent: '3' }),
    card(5, { parent: '4' }),
    card(6, { parent: '5', title: 'two words', tags: ['grill'] }),
    card(7),
    card(8, { parent: '7' }),
    card(12, { tags: ['ui'] }),
    card(13, { tags: ['grilling'] }),
  ];
  const ctx = { board: 'kanban', hierarchy: ['goal', 'strategy', 'objective'] };
  const ids = (q) => filterCards(cards, parseSearchQuery(q, 'kanban'), ctx).map((c) => Number(c.id));
  assert.deepStrictEqual(ids(EXAMPLES.or), [1, 12]);
  assert.deepStrictEqual(ids(EXAMPLES.bracket), [1, 12]);
  assert.deepStrictEqual(ids(EXAMPLES.quote), [6]);
  assert.deepStrictEqual(ids(EXAMPLES.phrase), [6]);
  assert.deepStrictEqual(ids(EXAMPLES.waiting), []);
  assert.deepStrictEqual(ids(EXAMPLES.run), [3, 7, 8, 12, 13]);
  assert.deepStrictEqual(ids(EXAMPLES.one), [1]);
  assert.deepStrictEqual(ids(EXAMPLES.openBottom), [1, 2, 3, 4, 5, 6, 7, 8, 12, 13]);
  assert.deepStrictEqual(ids(EXAMPLES.openTop), [1, 2, 3]);
  assert.deepStrictEqual(ids(EXAMPLES.depth), [8]);
  assert.deepStrictEqual(ids(EXAMPLES.combined), [1, 12]);
});
