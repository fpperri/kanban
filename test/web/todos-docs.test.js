const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseConfig } = require('../../plugin/skills/web/scripts/config-store');
const td = require('../../plugin/skills/web/scripts/todo-store');
const { HOTKEYS } = require('../../plugin/skills/web/web/hotkeys');

// The kanban skill documents the todo list file in one short paragraph, and the web skill and docs
// describe what the page does with it (docs/adr/0021). The kanban skill's example is held to the
// store, so a doc cannot promise what the board does not read.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const kanban = read('plugin', 'skills', 'kanban', 'SKILL.md');
const web = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const readme = read('README.md');
const snapshotSkill = read('plugin', 'skills', 'snapshot', 'SKILL.md');
const snapshotDocs = read('docs', 'snapshot.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const section = flat(kanban.slice(kanban.indexOf('### The todo list: a task list per card or group'), kanban.indexOf('### The placeholders in the logbook, scratchpad and todo paths')));
const webBullet = flat(web.slice(web.indexOf('- **Todos** —'), web.indexOf('- **Groups** —')));
const docsTodos = flat(docs.slice(docs.indexOf('**Todos** —'), docs.indexOf('**Iteration folders** —')));

test('the kanban skill documents the todo file in one short paragraph: folder key, name, format, hand edits, and that it means nothing to the board', () => {
  assert.ok(section.length > 600 && section.length < 2000, `the Todo section is found and short (${section.length})`);
  for (const part of ['<padded id>.todo.md', '0007.todo.md', 'I0002.todo.md', '`todos:`', 'the scratchpad\'s folder', '`- [ ] text`', '`- [x] text`', 'two or more spaces (or a tab)',
    'any other line is kept as it is', 'change only the line you mean', 'keep every other byte', 'It means nothing to the board', 'never changes a card\'s status',
    'never holds a card out of `doing`', 'adds into no roll-up', 'acceptance criteria included', '**Todos** tab', '**Its todo list**', '`<iteration>`']) {
    assert.ok(section.includes(part), part);
  }
  assert.ok(kanban.includes('**`todos` — the folder of the board\'s todo lists.**'), 'the config key is documented');
  assert.strictEqual(parseConfig('todos: .todos\n').todos, '.todos');
  assert.ok(kanban.includes('### The placeholders in the logbook, scratchpad and todo paths'));
  assert.ok(kanban.includes('`logbook:`, `scratchpad:` and `todos:` may hold `<iteration>`, `<card>`, `<repo>`'));
  assert.ok(kanban.includes('A scratchpad or a todo list goes to the iteration its card or group is a member of'));
});

test('the kanban skill\'s todo format is the one the store reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-todo-docs-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'todos: .todos\n');
  fs.mkdirSync(path.join(dir, '.todos'));
  fs.writeFileSync(path.join(dir, '.todos', '0007.todo.md'), '- [ ] open\n- [x] done\n  - [ ] a child\n\tnot an item\n');
  const list = td.readTodos(dir, '7');
  assert.deepStrictEqual(list.lines.map((l) => (l.item ? `${l.depth}${l.done ? 'x' : 'o'} ${l.text}` : `= ${l.text}`)), ['0o open', '0x done', '1o a child', '= \tnot an item'], 'nested by indent, other lines kept as written');
  assert.strictEqual(td.canonicalName('I2', 4), 'I0002.todo.md');
});

test('the web skill describes the tab, its ways in, its keys, the routes, the version rule and the payload', () => {
  assert.ok(webBullet.length > 1500, 'the Todos bullet is found');
  for (const part of ['`todos:` line', '`<padded id>.todo.md`', '**Todos** tab', '`t`', '**Todos…**', '`2/5`', '**Enter**', '**Space**', '**e**', '**c**', '**d d**', '**Alt+Up**', '**Alt+Down**', '**Tab** indents it', '**Shift+Tab** outdents it', 'Tab never moves focus', 'the lines indented under it', 'A held key acts once',
    '`markdownInto(el, text, { inline: true })`', '`GET /api/todos/<id>`', '`POST /api/todos/<id>`', '`PATCH`', '`DELETE`', '`POST /api/todos/<id>/move`', '`POST /api/todos/<id>/indent` and `/outdent`', '`version`', '409', '**Its todo list**',
    '`todos: { folder, targets, counts }`', 'means nothing to the board', '`<iteration>`', 'The mobile snapshot has none']) {
    assert.ok(webBullet.includes(part), part);
  }
  assert.ok(flat(web).includes('- **`todos`** (a folder, relative to the board;'), 'the config key is listed');
  assert.ok(flat(web).includes('`DELETE /api/groups/<id>` take `{ logbook, scratchpad, todos, members, memberLogbook, memberScratchpad, memberTodos }`'));
  assert.ok(flat(web).includes('the pages Logbook, Scratchpad, Todos, Groups, Types, Prefixes and Counters'));
  assert.ok(flat(web).includes('**Alt+1** to **Alt+4**'));
  assert.ok(flat(web).includes('**Scratchpad…**, **Todos…**, **Add to selection**'));
});

test('the docs describe the tab, the ways in, the keys, the count, the refusal on a changed list and the unticked delete box', () => {
  for (const part of ['`todos:` line', '`0007.todo.md`', 'the scratchpad\'s', '**Todos**', '`t`', '**Todos…**', '(`2/5`)', '**Enter**', '**Space**', '`e`', '`c`', '`d d`', '**Alt+Up**', '**Alt+Down**',
    'there is no bulk clear', '**Tab** indents it', '**Shift+Tab** outdents it', 'on a row Tab never moves focus', 'the lines indented under it', 'A held key acts once', 'inline Markdown', 'read only', 'refused with the reason and read again', 'means nothing to the board', '**Its todo list**', 'nothing of this shows', 'The mobile snapshot has no todo lists']) {
    assert.ok(docsTodos.includes(part), part);
  }
  assert.ok(flat(docs).includes('`logbook:`, `scratchpad:` and `todos:` may hold `<iteration>`'));
  assert.ok(flat(docs).includes('Scratchpad…, Todos… and Add to selection'));
  assert.ok(flat(docs).includes('*Logbook*, *Scratchpad*, *Todos* and *Groups* have an on/off switch'));
  assert.ok(flat(docs).includes('`Alt+1` to `Alt+4`'));
  assert.ok(flat(docs).includes('*This board* has seven pages'));
});

test('the docs describe the List | Edit | Preview switch: the whole text, its save, the version rule, the preview and the unsaved text', () => {
  for (const part of ['**List | Edit | Preview**', 'List, the default', '**Edit** is the list\'s whole file as text', '**Ctrl+Enter** or **Save** writes it', 'exactly that text in its own line endings',
    'a list not written yet starts empty, and Save makes the file', 'A save names the version of the list it read', 'nothing is written, the reason is said and your text stays in the box',
    'The line under the box then says that Save again replaces the list with your text and that List shows the list as it is now', 'a second save writes it over the list', '**Preview** draws the text, saved or not, as Markdown, read only', '**Ctrl+Shift+V** turns it on and off again, back to List or Edit',
    'until you reload the page', 'the tab opens on Edit while there is some', 'the box follows the list', 'over 300000 characters is refused']) {
    assert.ok(docsTodos.includes(part), part);
  }
});

test('the web skill describes the switch, the PUT of the whole text and the text a read carries', () => {
  for (const part of ['**List | Edit | Preview**', '`.sp-mode`', '`.sp-text`', '**Edit** is the list\'s whole file as text', '`textEditAttach`', '`mdEditAttach`', '**Ctrl+Enter** or **Save** writes it with `PUT`',
    'naming the version the text was read at', 'the text stays in the box', 'a second save writes it over that list', 'the `.sp-status` line says so: "The list changed on disk. Save again to replace it with this text; List shows it as it is now."', '`markdownInto()`', '**Ctrl+Shift+V** (`todosPreviewKey`',
    'the tab opens on Edit while there is some', 'the box follows the list', '`{ todos: { target, exists, file, folder?, version, text, lines } }`', 'no byte order mark',
    '`PUT /api/todos/<id>` with `{ text, version }` writes the whole text', 'every line ending the file\'s own', 'a byte order mark kept', 'made in its folder', 'a whole text over it is refused', 'There is no delete route for a list']) {
    assert.ok(webBullet.includes(part), part);
  }
  assert.ok(!webBullet.includes('no whole-file write'), 'the list has one now');
  assert.ok(flat(web).includes('Ctrl+Enter saves a scratchpad or a todo list\'s text'));
});

test('the hotkeys list names t and the keys of an item, and the tab keys reach the fourth tab', () => {
  const byId = Object.fromEntries(HOTKEYS.map((h) => [h.id, h]));
  assert.deepStrictEqual(byId.todos.keys, ['t']);
  assert.deepStrictEqual(byId['todo-row'].keys, ['Space', 'e', 'Enter', 'c', 'd d', 'Alt+Up', 'Alt+Down', 'Tab', 'Shift+Tab']);
  assert.match(byId['todo-row'].what, /children and the lines indented under it/);
  assert.match(byId['todo-row'].what, /held key acts once/);
  assert.deepStrictEqual(byId['note-tabs'].keys, ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4']);
  assert.match(byId.todos.what, /todos: line/);
  assert.match(byId['scratch-preview'].what, /On the Todos tab: switch Preview on, and off again to List or Edit/);
  assert.match(byId['text-indent'].what, /the Todos tab's Edit box/);
});

test('the README lists the todo lists among the kit the starter turns on', () => {
  assert.ok(flat(readme).includes('todo lists (`todos: <kanban>/.todo/<iteration>/<card>/`'));
  assert.ok(flat(readme).includes('The logbook, scratchpad and todos paths may hold `<iteration>`'));
});

test('the snapshot says it has no todo lists', () => {
  assert.ok(flat(snapshotSkill).includes('**No todo lists.**'));
  assert.ok(flat(snapshotSkill).includes('the snapshot reads no `todos:` folder'));
  assert.ok(flat(snapshotDocs).includes('no `todos:` folder is read'));
});
