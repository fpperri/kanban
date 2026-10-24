const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseSearchQuery, filterCards, searchTermText } = require('../../plugin/skills/web/web/search');
const { pillList, pillRows, PILLS_SHOWN } = require('../../plugin/skills/web/web/pills');

// Where the board's own pills are written down: the kanban skill's config contract
// says how a `field:*` entry expands and how many values show, the web skill and the
// web docs describe the pills in the panel (the labels, the exact value pills, the
// "+N more" button, how a click anchors) and say that next up is a pill a board
// defines, not one the plugin has. What they promise is held to the pill list and the
// search module, so a doc cannot promise what the page does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');

const kanbanSkill = read('plugin', 'skills', 'kanban', 'SKILL.md');
const configSection = kanbanSkill.slice(kanbanSkill.indexOf('### `config.yaml`'), kanbanSkill.indexOf('### `notifications.md`'));
const pillsParagraph = flat(configSection.slice(configSection.indexOf('**`pills`'), configSection.indexOf('**`icon`')));
const skill = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const readme = read('README.md');

const boardPills = (text, from, to) => flat(text.slice(text.indexOf(from), text.indexOf(to)));
const skillPills = boardPills(skill, '- **Board pills**', '- **Preferences sheet**');
const docsPills = boardPills(docs, '**Board pills**', '**Notifications inbox**');

test('the kanban skill says how a field:* entry expands: one pill per distinct value on the board, sorted, labelled by the value', () => {
  assert.ok(pillsParagraph.length > 300, 'the pills paragraph is found');
  assert.match(pillsParagraph, /`field:\*`/);
  assert.match(pillsParagraph, /`tags:\*`/);
  assert.match(pillsParagraph, /`assignee:\*`/);
  assert.match(pillsParagraph, /one pill per distinct value/);
  assert.match(pillsParagraph, /sorted/);
  assert.match(pillsParagraph, /labelled by (its|the) value/);
  assert.match(pillsParagraph, /active cards/);
});

test('the kanban skill names the fields that expand, and says the values match exactly, so grill never catches grilling', () => {
  for (const field of ['tags', 'assignee', 'status', 'priority', 'type']) assert.ok(pillsParagraph.includes(`\`${field}\``), field);
  assert.match(pillsParagraph, /matches (its|the) value exactly/);
  assert.match(pillsParagraph, /`grill` never catches `grilling`/);
});

test('the kanban skill says how many values show and what stands for the rest', () => {
  assert.match(pillsParagraph, /first eight/);
  assert.match(pillsParagraph, /"\+N more"/);
  assert.match(pillsParagraph, /fold/i);
  assert.strictEqual(PILLS_SHOWN, 8);
});

test('the kanban skill says next up is a pill a board defines, and the plugin has none', () => {
  assert.match(pillsParagraph, /next up/i);
  assert.match(pillsParagraph, /no built-in/i);
  assert.ok(pillsParagraph.includes('`- next: \'tags:"next-up"\'`') || configSection.includes(`- next: 'tags:"next-up"'`));
});

test('the kanban skill\'s config example and the README\'s show a field:* entry', () => {
  const example = configSection.slice(configSection.indexOf('```yaml'), configSection.indexOf('```\n', configSection.indexOf('```yaml') + 7));
  assert.match(example, /^\s+- "tags:\*"/m);
  assert.match(readme, /^\s+- "tags:\*"/m);
});

test('the web skill and the web docs describe the board pills in the panel: after the built-ins, in config order, a label or the query', () => {
  for (const [where, text] of [['the web skill', skillPills], ['the web docs', docsPills]]) {
    assert.ok(text.length > 400, `${where}: the Board pills entry is found`);
    assert.match(text, /after blocked, review and waiting/, where);
    assert.match(text, /config order/, where);
    assert.match(text, /label/, where);
    assert.match(text, /its query/, where);
    assert.match(text, /count/i, where);
  }
});

test('both say a field:* entry makes one pill per value, matching the value exactly, and that eight show with a "+N more" button', () => {
  for (const [where, text] of [['the web skill', skillPills], ['the web docs', docsPills]]) {
    assert.match(text, /`tags:\*`/, where);
    assert.match(text, /one pill per (distinct )?value/, where);
    assert.match(text, /exactly/, where);
    assert.match(text, /`grill`[^.]*`grilling`/, where);
    assert.match(text, /first eight/, where);
    assert.match(text, /\+N more/, where);
    assert.match(text, /fold/, where);
  }
});

test('both say a click on a board pill works as it does on a built-in, and that next up is a pill a board defines', () => {
  for (const [where, text] of [['the web skill', skillPills], ['the web docs', docsPills]]) {
    assert.match(text, /anchor/, where);
    assert.match(text, /Shift\+click/, where);
    assert.match(text, /next up/i, where);
    assert.match(text, /a board defines|defined by the board|its own config/i, where);
    assert.doesNotMatch(text, /built-in next up|next up pill is built in/i, where);
  }
});

test('both say the pill, the more button and the values come only from the board: active cards, never archived ones', () => {
  for (const [where, text] of [['the web skill', skillPills], ['the web docs', docsPills]]) {
    assert.match(text, /active cards/, where);
    assert.match(text, /keeps? (its )?focus|focus/i, where);
  }
});

// The claims, held to the code.

test('the claims in the docs hold: eight show and the rest are behind the button, a value is matched exactly, and the labels are the values', () => {
  const card = (id, tags) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags, assignee: null, type: null, waiting_for: [], blocked: null, review: null });
  const tags = ['grill', 'grilling', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const cards = tags.map((tag, i) => card(i + 1, [tag]));
  const matchIds = (query) => new Set(filterCards(cards, parseSearchQuery(query), {}).map((c) => c.id));
  const list = pillList(cards, matchIds, { pills: [{ label: 'tags:*', query: 'tags:*' }], cards, term: searchTermText });
  const rows = pillRows(list, []);
  assert.strictEqual(rows.filter((r) => r.kind !== 'more' && r.group === 'tags').length, 8);
  assert.strictEqual(rows[rows.length - 1].label, '+2 more');
  assert.deepStrictEqual(list.filter((p) => p.label === 'grill' || p.label === 'grilling').map((p) => [p.label, p.count]), [['grill', 1], ['grilling', 1]]);
  assert.deepStrictEqual(list.slice(3).map((p) => p.label), [...tags].sort());
});
