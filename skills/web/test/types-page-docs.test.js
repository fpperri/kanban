const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Types page, the editable Prefixes page, the path bar and how a save is made (docs/adr/0018) are
// described in the web skill, docs/web.md and the README, and in one short line in the kanban skill.
// Held to the code: a doc cannot promise a refusal the server no longer makes or a control the page no
// longer draws.

const root = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const web = flat(read('skills', 'web', 'SKILL.md'));
const docs = flat(read('docs', 'web.md'));
const readme = flat(read('README.md'));
const kanbanRaw = read('skills', 'kanban', 'SKILL.md');
const kanban = flat(kanbanRaw);
const header = read('skills', 'web', 'web', 'settings.js').split('\n').slice(0, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

const gear = web.slice(web.indexOf('**This board** has the pages Logbook'), web.indexOf('- **Notes (logbook)**'));
const board = docs.slice(docs.indexOf('*This board* has six pages'), docs.indexOf('**Notes** —'));

test('the web skill says a save is one line or one whole block, that comments inside a rewritten block are dropped, and where a missing key goes', () => {
  assert.ok(gear.length > 3000, 'the gear section is found');
  for (const part of ['**One line or one whole block per save.**', 'comments inside the old block are dropped, with no warning', 'the config\'s own order (`KEY_ORDER` in `config-store.js`)',
    'every byte outside it stays, the file\'s line ending included']) {
    assert.ok(gear.includes(part), part);
  }
});

test('the web skill says every save sends the version, what it leaves out and why, and what a 409 does', () => {
  for (const part of ['Every save from the gear sends the `version` the settings answered, a line save as much as a block', 'The version leaves out the `nextId:` and `counters:` lines',
    'which the board moves itself with every card made', 'refused with 409 and writes nothing, and the page reads again and says so', 'A save that sends no version is not checked']) {
    assert.ok(gear.includes(part), part);
  }
});

test('the web skill says the server refuses only what would corrupt the file and keeps a color name, any icon and names that differ in capitals', () => {
  for (const part of ['A value from the file is kept as written (ADR 0004)', 'refuses (400) only what would corrupt the file', 'A color is any text (a hex, a name) and an icon any word',
    'two names that differ only in capitals are both kept, in `types:` and in `hierarchy:`']) {
    assert.ok(gear.includes(part), part);
  }
  for (const gone of ['an icon that is not one of the six', 'repeats another', 'a color that is not a hex color']) assert.ok(!gear.includes(gone), `no longer says: ${gone}`);
});

test('the web skill describes the swatch row, not a native picker, and what the page checks of what is typed', () => {
  for (const part of ['a row of swatches, the starter\'s colors and the status palette', 'no native color popup, ADR 0003', 'The page checks only what the person just typed',
    'the hex field takes a hex color or nothing', 'survives a redraw']) {
    assert.ok(gear.includes(part), part);
  }
  assert.ok(!gear.includes('a picker and a hex field'));
});

test('the web skill describes the editable Prefixes page: the confirm, the queued save by prefix, the clash warning and the path bar', () => {
  for (const part of ['**Prefixes** is editable', 'every change asks first', 'finds its row by the prefix it names', '`prefixClashes`', 'rewrites the block without the other line',
    'Every page of This board shows the absolute path it reads', 'a **Copy** button']) {
    assert.ok(gear.includes(part), part);
  }
  assert.ok(!gear.includes('shows the `prefixes:` block as a read only'));
});

test('docs/web.md describes the six pages, the one-line-or-one-block save, the version, Types off and the editable Prefixes page', () => {
  assert.ok(board.length > 2500, 'the This board section is found');
  for (const part of ['*This board* has six pages', 'or rewrites one whole block (`types:`, `hierarchy:` or `prefixes:`)', 'Comments inside a block that is rewritten go with it, and the page does not warn first',
    'Every save carries the version of `config.yaml` the page read', 'nothing is saved, and the page reads it again and says so', 'leaves out the `nextId:` and `counters:` lines',
    'Every page shows the file or folder it reads, with a Copy button', '*Types* has a switch', 'Off writes `typesOn: false`, on removes the line', 'display only',
    'a row of swatches and a hex field', 'Each edit changes only its own list', '*Prefixes* is editable', 'every change asks first', 'rewrites the block without the line the board ignores']) {
    assert.ok(board.includes(part), part);
  }
  for (const gone of ['five pages', 'read only, and lets you change']) assert.ok(!docs.includes(gone), `no longer says: ${gone}`);
});

test('the README says the Prefixes page edits and the Types switch is display only', () => {
  assert.ok(readme.includes('Prefixes page edits the prefixes'));
  assert.ok(readme.includes('The Types switch turns the display of types off (display only)'));
});

test('the kanban skill keeps typesOn to a sentence or two for AI writers, and the web mechanics live in the web docs', () => {
  const para = kanban.slice(kanban.indexOf('**`typesOn` — Types off.**'), kanban.indexOf('Only a human, or a session a human tells to'));
  assert.ok(para.length > 100 && para.length < 420, `short: ${para.length}`);
  assert.ok(para.includes('display only'));
  assert.ok(para.includes('keep writing `type:` and prefixed ids'));
  assert.ok(!kanban.includes('Blocks the web rewrites'), 'that paragraph moved to the web skill and docs/web.md');
  assert.ok(!kanban.includes('ADR 0018'), 'the agent-facing skill points at no design record');
});

test('the kanban skill\'s "Only a human" paragraph keeps its wording, changing only what became false: the Prefixes page now writes the block', () => {
  const at = kanbanRaw.indexOf('Only a human, or a session a human tells to');
  const para = kanbanRaw.slice(at, kanbanRaw.indexOf('\n', at));
  assert.ok(para.includes('(the web\'s gear sheet writes `idDigits:` for the human, one line, and `prefixes:` one block, and shows `counters:` read only)'));
  assert.ok(para.includes('Only a human, or a session a human tells to, writes `hierarchy:`, `pills:` and `icon:`; nothing that services the board invents them.'));
  assert.ok(para.endsWith('and leave these lines, comments and every unknown key as they were.'));
});

test('settings.js says what the page checks and that a save is one line or one block', () => {
  const text = flat(header);
  for (const part of ['only what the person has just typed', 'never a value already in the file', 'a save is one top-level line, or one whole block', 'carries the version of the file the page read']) {
    assert.ok(text.includes(part), part);
  }
});
