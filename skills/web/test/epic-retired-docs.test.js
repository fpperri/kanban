const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const kanbanSkill = read('skills', 'kanban', 'SKILL.md');

const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `${heading} exists`);
  const next = text.slice(start + heading.length).search(/\n#{1,3} /);
  return next === -1 ? text.slice(start) : text.slice(start, start + heading.length + next);
};

test('the kanban skill has a migration section for epic: true that names the script, its flags and what it changes', () => {
  const sec = section(kanbanSkill, '### Migrating `epic: true` to `type: epic`').replace(/\s+/g, ' ');
  assert.ok(sec.includes('scripts/migrate_epic_to_type.sh'), 'names the script');
  assert.match(sec, /dry run/i, 'dry run by default');
  assert.ok(sec.includes('--apply'), 'names the apply flag');
  assert.match(sec, /`updated`/, 'says it bumps updated');
  assert.match(sec, /notification/i, 'says it files a notification');
  assert.match(sec, /already has a `type:`/i, 'says an existing type is kept');
  assert.match(sec, /ignored/i, 'says a leftover epic line is ignored');
  assert.match(sec, /own board/i, 'each board is migrated by whoever owns it');
});

const EPIC_WORD = /\bepic|Epic|EPIC/;
const outside = (text, heading) => {
  const sec = section(text, heading);
  return text.replace(sec, '');
};

test('the kanban skill no longer describes epic as a card field: it names it only in the migration section', () => {
  assert.ok(!kanbanSkill.split('\n').some((l) => l.startsWith('- `epic` ')), 'no epic bullet in the card fields');
  const stray = outside(kanbanSkill, '### Migrating `epic: true` to `type: epic`').split('\n').filter((l) => EPIC_WORD.test(l));
  assert.deepStrictEqual(stray, []);
});

test('the web skill documents the epic flag only as retired: no checkbox, search term, chip or wash', () => {
  const web = read('skills', 'web', 'SKILL.md');
  assert.doesNotMatch(web, /epic checkbox|EPIC_COLOR|epicColorSoft|--epic-wash|\.epic\b|f-epic/i);
  assert.doesNotMatch(web, /orange is reserved|Epic membership|`epic:` term/i);
  assert.match(web, /\*\*Epic flag \(retired\)\*\*/);
});

test('the snapshot skill and the human docs no longer offer an epic: search term or an Epics chip', () => {
  for (const file of [['skills', 'snapshot', 'SKILL.md'], ['docs', 'web.md'], ['docs', 'snapshot.md'], ['README.md']]) {
    const text = read(...file);
    assert.doesNotMatch(text, /"Epics" chip|Epics chip|`epic:`|orange epic|epic dot/, file.join('/'));
  }
});
