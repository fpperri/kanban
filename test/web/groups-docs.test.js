const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseConfig, groupFolderOf, prefixForGroupFolder } = require('../../plugin/skills/web/scripts/config-store');
const { parseSearchQuery, filterCards } = require('../../plugin/skills/web/web/search');

// The kanban skill documents the group file and the web skill and docs describe what the page
// does with groups. The examples they give are held to the code, so a doc cannot promise what
// the board does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const kanban = read('plugin', 'skills', 'kanban', 'SKILL.md');
const web = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const snapshot = read('plugin', 'skills', 'snapshot', 'SKILL.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const groupsSection = flat(kanban.slice(kanban.indexOf('### Groups: files that list their cards'), kanban.indexOf('### Migrating `epic: true`')));
const webBullet = flat(web.slice(web.indexOf('- **Groups** —'), web.indexOf('- **Hover/focus highlight**')));
const docsGroups = flat(docs.slice(docs.indexOf('**Groups**'), docs.indexOf('## Other surfaces')));

test('the kanban skill documents the group file: its folders, its frontmatter keys, the id, and how an agent writes one', () => {
  assert.ok(groupsSection.length > 800, 'the Groups section is found');
  for (const part of ['<padded id>.<slug>.md', 'at most two levels', 'skipped and reported', 'id: I2', 'start_date', 'end_date', 'auto_join', 'cards: [3, 7, 15]',
    'the exact folder `prefixes:` maps it to', '`_` when none does', '`counters:` line', 'Writing a group (agents may)', 'temporary file and a rename',
    'never edited to join or leave a group', 'Deleting a card takes its id out of every group']) {
    assert.ok(groupsSection.includes(part), part);
  }
});

test('the kanban skill\'s config example reads as it says: the groups folder, a groups-folder prefix and the root with no slash', () => {
  const example = parseConfig('groups: .groups\nprefixes:\n  G: goal\n  _: .groups\n  I: .groups/iteration\ncounters: { G: 3, O: 5, I: 2 }\n');
  assert.ok(kanban.includes('  _: .groups      # a group with no type is `_`; the groups: folder itself is the root'));
  assert.ok(kanban.includes('  I: .groups/iteration   # a group in iteration/ is I1, I2...'));
  assert.strictEqual(groupFolderOf(example, example.prefixes._), '');
  assert.strictEqual(groupFolderOf(example, example.prefixes.I), 'iteration');
  assert.strictEqual(groupFolderOf(example, example.prefixes.G), null);
  assert.strictEqual(prefixForGroupFolder(example, 'iteration'), 'I');
  assert.strictEqual(prefixForGroupFolder(example, ''), '_');
});

test('the web skill describes badges, the Group tab, the menu entries, the note question and the routes', () => {
  assert.ok(webBullet.length > 800, 'the Groups bullet is found');
  for (const part of ['up to two small buttons', '`+N`', 'Group tab', 'Show this group\'s cards', '`group:<id>`', '**Add to group…**', '**Make a group from them…**',
    '**Add the note to each card**', '`each of N cards`', '`POST /api/groups`', '`PATCH /api/groups/<id>`', '`POST /api/groups/<id>/members`',
    'two folders deep is skipped', '`group:<id or name>`', '`-group:`']) {
    assert.ok(webBullet.includes(part), part);
  }
});

test('the web docs describe the same, in a paragraph of their own', () => {
  assert.ok(docsGroups.length > 500, 'the Groups paragraph is found');
  for (const part of ['group badges', 'Group** tab', 'Show this group\'s cards', 'Add to group…', 'Make a group from them…', 'Add note…', '`group:I2`', '`group:zephyr-2`', '`-group:`']) {
    assert.ok(docsGroups.includes(part), part);
  }
});

test('the search examples the docs give do what they say', () => {
  const cards = ['3', '7', '15', '22'].map((id) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [] }));
  const ctx = { groups: [{ id: 'I2', name: 'zephyr-2', cards: ['3', '7'] }] };
  const ids = (q) => filterCards(cards, parseSearchQuery(q), ctx).map((c) => c.id);
  assert.deepStrictEqual(ids('group:I2'), ['3', '7']);
  assert.deepStrictEqual(ids('group:zephyr-2'), ['3', '7']);
  assert.deepStrictEqual(ids('group:'), ['3', '7']);
  assert.deepStrictEqual(ids('-group:'), ['15', '22']);
});

test('the snapshot skill says it reads group terms and draws no groups', () => {
  assert.ok(flat(snapshot).includes('`group:<id or name>`, `group:` and `-group:` too, but it draws no groups'));
});

test('the web skill and the docs describe the delete popup: the id leaves every group, the extras are unticked, a group skips members another group holds, archiving asks nothing', () => {
  const skillDelete = flat(web.slice(web.indexOf('- **Delete** —'), web.indexOf('- **Multi-select**')));
  for (const part of ['delete popup', 'its id always leaves every group\'s list', '**Its logbook**', '**unticked**', 'dangling', '**Its member cards**', 'skipped',
    'DELETE /api/cards/<id>', 'DELETE /api/groups/<id>', 'Archiving never opens it and gets none of its questions']) {
    assert.ok(skillDelete.includes(part), part);
  }
  const docsDelete = flat(docs.slice(docs.indexOf('**Delete.**'), docs.indexOf('## Other surfaces')));
  for (const part of ['its id always leaves every group\'s list', '**Its logbook**', 'unticked', '**Delete group…**', '**Its member cards**', 'Archiving never opens it']) {
    assert.ok(docsDelete.includes(part), part);
  }
});

test('the kanban skill card-creation steps tell agents to join the running auto-join groups, and the web docs say the same', () => {
  const creating = flat(kanban.slice(kanban.indexOf('## Creating a Card'), kanban.indexOf('## Moving a Card')));
  for (const part of ['Join the running groups', '`auto_join: true`', 'both days included', 'cards:` line of each such group', 'a dated group without `auto_join` never takes a new card']) {
    assert.ok(creating.includes(part), part);
  }
  for (const part of ['**Auto-join.**', 'both dates and `auto_join: true`', 'written into its `cards:` at creation', 'a temporary file and a rename', 'an edit or a move later never joins one']) {
    assert.ok(groupsSection.includes(part), part);
  }
  for (const part of ['running from its start to its end, both days included', 'same request', '`joined`', 'Joined #I2 zephyr-2.', 'never takes a new card']) {
    assert.ok(webBullet.includes(part), part);
  }
  for (const part of ['`auto_join` on is running', 'Joined #I2 zephyr-2.', 'never takes a new card']) {
    assert.ok(docsGroups.includes(part), part);
  }
});
