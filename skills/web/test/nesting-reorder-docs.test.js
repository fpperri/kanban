const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const kanbanSkill = read('skills', 'kanban', 'SKILL.md');
const webSkill = read('skills', 'web', 'SKILL.md');
const webDoc = read('docs', 'web.md');

const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${heading} found`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next < 0 ? undefined : next).replace(/\s+/g, ' ');
};

test('the kanban skill tells an AI writer how to pick a rank between two siblings', () => {
  const s = section(kanbanSkill, '## Ordering a Card Among Its Siblings');
  assert.match(s, /floor\(\(a \+ b\) \/ 2\)/);
  assert.match(s, /between `10` and `20` write `15`/);
  assert.match(s, /write only that card/i);
});

test('the kanban skill says when to renumber, and that only that parent\'s children are touched', () => {
  const s = section(kanbanSkill, '## Ordering a Card Among Its Siblings');
  assert.match(s, /no whole number/i);
  assert.match(s, /`10`, `20`, `30`/);
  assert.match(s, /only the cards whose rank changes/i);
  assert.match(s, /no card outside that parent/i);
  assert.match(s, /archived siblings count/i);
});

test('the kanban skill gives the ends of the list and the unranked case', () => {
  const s = section(kanbanSkill, '## Ordering a Card Among Its Siblings');
  assert.match(s, /`last \+ 10`/);
  assert.match(s, /`first - 10`/);
  assert.match(s, /unranked siblings come after the ranked/i);
  assert.match(s, /rank all of that parent's children/i);
});

test('the kanban skill says this is the drag\'s rule, rank only, with updated bumped', () => {
  const s = section(kanbanSkill, '## Ordering a Card Among Its Siblings');
  assert.match(s, /drag/i);
  assert.match(s, /never `parent`/);
  assert.match(s, /bump `updated`/i);
});

test('the rank field points at that rule', () => {
  const rank = kanbanSkill.split('\n').find((l) => l.startsWith('- `rank` '));
  assert.match(rank, /Ordering a Card Among Its Siblings/);
});

test('the web skill documents the drag, the reorder call and what it refuses', () => {
  const sorting = webSkill.slice(webSkill.indexOf('**Per-column sorting**'), webSkill.indexOf('**Search**')).replace(/\s+/g, ' ');
  assert.match(sorting, /dragging a card between two tiles/i);
  assert.match(sorting, /`POST \/api\/cards\/<id>\/reorder`/);
  assert.match(sorting, /`prev`/);
  assert.match(sorting, /`next`/);
  assert.match(sorting, /renumbers that parent's children in tens/i);
  assert.match(sorting, /never the parent/i);
  assert.match(sorting, /bulk drag/i);
});

test('the human web doc mentions the drag', () => {
  assert.match(webDoc.replace(/\s+/g, ' '), /dragging a card between two siblings writes its `rank`/i);
});

test('the kanban skill states the ranked/unranked boundary as the module does, and does not call a drag the same rule', () => {
  const s = section(kanbanSkill, '## Ordering a Card Among Its Siblings');
  assert.match(s, /`last \+ 10` also lands a card ahead of any unranked sibling/);
  assert.match(s, /between two unranked siblings, or before the first sibling when none is ranked, rank all of that parent's children/);
  assert.match(s, /hidden and archived cards are siblings too/);
  assert.doesNotMatch(s, /follows this same rule/);
  assert.match(s, /reads the tiles around the drop as siblings/);
});
