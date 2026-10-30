const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');

// The icons a card's working material wears on a tile, a group's badge and the card details' header:
// a note count, an open/total todo count and a scratchpad page, in that order, each only when the board
// keeps that feature and the card has it. The browser runner's kit-icons scenario draws them for real.

const NOTES = [note('2026-10-16', '7', '09:00', 'franc', 'a note')];
const SCRATCH = { folder: '.pads', targets: ['7', '22'] };
const TODOS = { folder: '.pads', targets: ['7', '3'], counts: { 7: { open: 1, total: 2 }, 3: { open: 0, total: 1 } } };

const kinds = (p, id) => [...p.page.run(`cardKitIcons('${id}')`)].map((b) => b.classes.find((c) => /^card-(notes|todos|scratch)$/.test(c)));

test('a card with all three wears them in the order notes, todos, scratchpad', async () => {
  const p = await openPalette({ notes: NOTES, scratchpad: SCRATCH, todos: TODOS });
  assert.deepStrictEqual(kinds(p, '7'), ['card-notes', 'card-todos', 'card-scratch']);
});

test('a card shows only the icons it has, and one with none shows none', async () => {
  const p = await openPalette({ notes: NOTES, scratchpad: SCRATCH, todos: TODOS });
  assert.deepStrictEqual(kinds(p, '22'), ['card-scratch']);
  assert.deepStrictEqual(kinds(p, '3'), ['card-todos']);
  assert.deepStrictEqual(kinds(p, '99'), []);
});

test('with the logbook, the todos or the scratchpad off, that icon never shows', async () => {
  const noPad = await openPalette({ notes: NOTES, scratchpad: null, todos: TODOS });
  assert.deepStrictEqual(kinds(noPad, '7'), ['card-notes', 'card-todos']);
  const noTodos = await openPalette({ notes: NOTES, scratchpad: SCRATCH, todos: null });
  assert.deepStrictEqual(kinds(noTodos, '7'), ['card-notes', 'card-scratch']);
});

test('the scratchpad icon has no number, names its card and keeps the target for its click', async () => {
  const p = await openPalette({ scratchpad: SCRATCH });
  const b = p.page.run("scratchpadIconButton('7')");
  assert.strictEqual(p.text(b), '');
  assert.strictEqual(b.dataset.scratchTarget, '7');
  assert.ok(b.classes.includes('np-trigger'));
  assert.match(b.getAttribute('aria-label'), /^#7 Port the zephyr schema: /);
  assert.strictEqual(p.page.run("scratchpadIconButton('3')"), null);
});

test('the todo count wears a checkbox icon before its number, a ticked one when none is open, and keeps its title', async () => {
  const p = await openPalette({ todos: TODOS });
  const open = p.page.run("todoCountButton('7')");
  assert.strictEqual(p.text(open), '1/2');
  assert.strictEqual(open.children[0].tag, 'svg');
  assert.match(open.title, /1 of 2 todos open/);
  const done = p.page.run("todoCountButton('3')");
  assert.ok(done.classes.includes('all-done'));
  assert.notStrictEqual(done.children[0].children[0].attrs ? JSON.stringify(done.children[0].children[0].attrs.d) : done.children[0].children[0].getAttribute('d'), open.children[0].children[0].attrs ? JSON.stringify(open.children[0].children[0].attrs.d) : open.children[0].children[0].getAttribute('d'));
});

test('clicking the scratchpad icon opens the Scratchpad tab of its card', async () => {
  const p = await openPalette({ scratchpad: SCRATCH, fetchWith: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }) });
  const b = p.page.run("scratchpadIconButton('7')");
  p.page.fireDocument('click', { target: { closest: (sel) => (sel === '.card-scratch' ? b : null) } });
  assert.strictEqual(p.page.run('notesUi.tab'), 'scratch');
  assert.strictEqual(p.page.run('notesUi.sub.id'), '7');
});

test('both tile builders, the card details header and a group badge draw the icons', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const web = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', f), 'utf8');
  const app = web('app.js');
  assert.strictEqual(app.match(/for \(const icon of cardKitIcons\(card\.id\)\) el\.querySelector\('\.card-head'\)\.appendChild\(icon\)/g).length, 2);
  assert.match(app, /\$\('#detail-kit'\)\.replaceChildren\(\.\.\.cardKitIcons\(data\.id\)\)/);
  assert.match(web('app.html'), /<div id="detail-kit" class="detail-kit"><\/div>/);
  assert.match(web('groups-ui.js'), /scratchpadIconButton\(g\.id\)/);
});
