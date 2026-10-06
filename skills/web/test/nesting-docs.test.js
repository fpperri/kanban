const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const kanbanSkill = read('kanban', 'SKILL.md');
const webSkill = read('web', 'SKILL.md');

const fieldBullet = (name) => kanbanSkill.split('\n').find((l) => l.startsWith(`- \`${name}\` `));

test('the kanban skill\'s card fields list parent in both forms', () => {
  const parent = fieldBullet('parent');
  assert.ok(parent, 'a parent bullet');
  assert.match(parent, /`board#42`|`board#\d+`/, 'names the board#id form');
  assert.match(parent, /this board/i);
  assert.match(parent, /never validated/i);
  assert.match(parent, /not sequencing/i, 'nesting never makes a card waiting');
});

test('the kanban skill\'s card fields list rank: a number stepped by 10, separate from priority, unranked after ranked', () => {
  const rank = fieldBullet('rank');
  assert.ok(rank, 'a rank bullet');
  assert.match(rank, /number/i);
  assert.match(rank, /10/);
  assert.match(rank, /priority/);
  assert.match(rank, /after the ranked/i);
  assert.match(rank, /omit/i, 'the lean rule');
});

test('the kanban skill says depth, altitude, outline order, thread and roll-up are never written', () => {
  const para = kanbanSkill.split('\n').find((l) => /never written/i.test(l) && /depth/.test(l));
  assert.ok(para, 'a paragraph naming the derived values');
  for (const word of ['depth', 'altitude', 'outline order', 'thread', 'roll-up']) {
    assert.ok(para.includes(word), `${word} is named`);
  }
});

test('the web skill documents the Outline sort, its default, and the Parent and Rank form fields', () => {
  const sorting = webSkill.slice(webSkill.indexOf('**Per-column sorting**'), webSkill.indexOf('**Search**')).replace(/\s+/g, ' ');
  assert.match(sorting, /Outline/);
  assert.match(sorting, /any card has a `rank` or a `parent`/);
  assert.match(sorting, /only a column you changed is remembered/i);
  const create = webSkill.slice(webSkill.indexOf('- **Create**'), webSkill.indexOf('- **Edit**'));
  assert.match(create, /parent, rank/);
  const edit = webSkill.slice(webSkill.indexOf('- **Edit**'), webSkill.indexOf('- **Edit**') + 2500);
  assert.match(edit, /parent, rank/);
});
