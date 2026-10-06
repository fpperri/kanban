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
