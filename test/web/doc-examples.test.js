const { test } = require('node:test');
const assert = require('node:assert');
const { read } = require('./helpers/doc-text');
const { parseSearchQuery, filterCards, searchSuggestionItems } = require('../../plugin/skills/web/web/search');
const { nextSearchAddress } = require('../../plugin/skills/web/web/card-history');
const { parseDeepLink } = require('../../plugin/skills/web/web/deep-link');
const { iterationNextDraft } = require('../../plugin/skills/web/web/iterations');

// A person copies a search term or an address out of a doc and pastes it into the page. Each example
// below is a term or an address the docs show; the docs that show it must still show it, and the real
// search module must do with it what the docs say. The expectation is the module's answer on a board
// this file builds, not a sentence of the docs.

const webDocs = read('docs', 'web.md');
const snapshotSkill = read('plugin', 'skills', 'snapshot', 'references', 'search.md');

const card = (id, over = {}) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], parent: null, waiting_for: [], ...over });
const CARDS = [
  card(1, { type: 'goal', tags: ['ui', 'grill'], status: 'doing' }),
  card(2, { type: 'strategy', parent: 1, tags: ['ui', 'grilling'] }),
  card(3, { type: 'objective', parent: 2, status: 'backlog', body: 'two words', waiting_for: [1] }),
  card(4, { parent: 3 }),
  card(5, { parent: 4 }),
  card(6, { parent: 5 }),
  card(7),
  card(8, { parent: 7 }),
  card(12, { tags: ['ui'], status: 'backlog' }),
];
const CTX = { board: 'kanban', hierarchy: ['goal', 'strategy', 'objective'] };
const ids = (term, cards = CARDS, ctx = CTX) => filterCards(cards, parseSearchQuery(term, 'kanban'), ctx).map((c) => c.id);

const WEB = [['docs/web.md', webDocs]];
const ALL = [...WEB, ['the snapshot skill', snapshotSkill]];

const GRAMMAR = [
  ['tags:ui status:doing | #12', [1, 12], ALL],
  ['tags:ui (status:doing | status:todo)', [1, 2], ALL],
  ['tags:"grill"', [1], ALL],
  ['"two words"', [3], ALL],
  ['waiting:', [3], ALL],
  ['slice:objective..2', [3, 4, 5, 6, 7, 8, 12], ALL],
  ['slice:goal', [1], ALL],
  ['slice:goal..', [1, 2, 3, 4, 5, 6, 7, 8, 12], ALL],
  ['slice:..objective', [1, 2, 3], ALL],
  ['tags:ui (slice:goal | #12)', [1, 12], ALL],
  ['slice:1', [5, 8], [['the snapshot skill', snapshotSkill]]],
];

test('every search term the docs show is shown by the docs that list it', () => {
  for (const [term, , where] of GRAMMAR) {
    for (const [name, text] of where) assert.ok(text.includes(`\`${term}\``), `${name} shows \`${term}\``);
  }
});

test('every search term the docs show does what the docs say on a board with tiers, tags, a phrase and a waiting card', () => {
  for (const [term, expected] of GRAMMAR) assert.deepStrictEqual(ids(term), expected, term);
});

test('a|b, fix(auth) and waiting:3 stay text: the docs say so, and the module reads them as text', () => {
  const literal = [card(20, { title: 'a|b' }), card(21, { title: 'fix(auth) now' }), card(22, { body: 'waiting:3 here' }), card(23, { title: 'a' }), card(24, { title: 'fix' }), card(25, { waiting_for: [1] })];
  const cards = [...CARDS, ...literal];
  for (const [term, expected] of [['a|b', [20]], ['fix(auth)', [21]], ['waiting:3', [22]]]) {
    for (const [name, text] of ALL) assert.ok(text.includes(`\`${term}\``), `${name} shows \`${term}\``);
    assert.deepStrictEqual(ids(term, cards), expected, term);
  }
});

test('the slice terms the search box suggests after slice: and after .. are the ones the docs write', () => {
  const plain = [card(1, { type: 'goal' }), card(2, { type: 'strategy', parent: 1 }), card(3, { type: 'objective', parent: 2 }), card(4, { parent: 3 }), card(5, { parent: 4 }), card(6, { parent: 5 }), card(7, { parent: 6 })];
  const values = (text, cards = plain, ctx = CTX) => searchSuggestionItems(text, text.length, cards, ctx).map((i) => i.value);
  const whole = 'slice:goal..objective';
  const quoted = 'slice:"big goal..2"';
  for (const [name, text] of ALL) {
    assert.ok(text.includes(`\`${whole}\``), `${name} shows \`${whole}\``);
    assert.ok(text.includes(`\`${quoted}\``), `${name} shows \`${quoted}\``);
  }
  assert.ok(values('slice:goal..').includes(whole));
  assert.deepStrictEqual(values('slice:').filter((v) => /^slice:\d/.test(v)), ['slice:0', 'slice:1', 'slice:2', 'slice:3']);
  assert.strictEqual(values('slice:').indexOf('slice:goal'), 0);
  const spaced = [card(1, { type: 'big goal' }), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4, { parent: 3 })];
  assert.ok(searchSuggestionItems('slice:"big goal..', undefined, spaced, { board: 'kanban', hierarchy: ['big goal'] }).map((i) => i.value).includes(quoted));
});

test('the address docs/web.md gives for an isolated search is the one the page writes, and the deep-link reader reads it back', () => {
  const [, address] = /`(\?q=[^`]*&isolate=1)`/.exec(webDocs) || [];
  assert.ok(address, 'docs/web.md shows an address that carries isolate');
  const q = new URLSearchParams(address).get('q');
  assert.strictEqual(nextSearchAddress('', q, true), address);
  const read = parseDeepLink(address);
  assert.strictEqual(read.isolate, true);
  assert.strictEqual(read.q, q);
});

test('the group terms the web docs show find the group\'s cards by id, by name, by any group and by none', () => {
  const cards = ['3', '7', '15', '22'].map((id) => card(id));
  const ctx = { groups: [{ id: 'I2', name: 'zephyr-2', cards: ['3', '7'] }] };
  const idsOf = (term) => filterCards(cards, parseSearchQuery(term), ctx).map((c) => c.id);
  for (const [term, expected] of [['group:I2', ['3', '7']], ['group:zephyr-2', ['3', '7']], ['group:', ['3', '7']], ['-group:', ['15', '22']]]) {
    assert.ok(webDocs.includes(`\`${term}\``) || term === 'group:', `docs/web.md shows \`${term}\``);
    assert.deepStrictEqual(idsOf(term), expected, term);
  }
});

test('the iteration docs/web.md follows through, zephyr-2 then zephyr-3, is the draft the dropdown offers', () => {
  assert.ok(webDocs.includes('zephyr-2') && webDocs.includes('zephyr-3'));
  const groups = [{ id: 'I2', name: 'zephyr-2', folder: 'iteration', start_date: '2026-10-12', end_date: '2026-10-23', auto_join: true, cards: [] }];
  assert.strictEqual(iterationNextDraft(groups, '2026-10-15').name, 'zephyr-3');
});

test('the search box\'s own tooltip shows a term from the table above', () => {
  const html = read('plugin', 'skills', 'web', 'web', 'app.html');
  const tip = /<input[^>]*id="search-input"[^>]*>/.exec(html)[0].replace(/\s+/g, ' ');
  const shown = GRAMMAR.map(([term]) => term).filter((term) => tip.includes(term));
  assert.ok(shown.length > 0, 'the tooltip carries an example that is in the table');
});
