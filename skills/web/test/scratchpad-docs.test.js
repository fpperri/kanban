const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseConfig } = require('../scripts/config-store');
const sp = require('../scripts/scratchpad-store');

// The kanban skill documents the scratchpad file and the web skill and docs describe what the page
// does with it. The example the kanban skill gives is held to the store, so a doc cannot promise
// what the board does not read.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const kanban = read('skills', 'kanban', 'SKILL.md');
const web = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const section = kanban.slice(kanban.indexOf('### The scratchpad: a disposable page per card or group'), kanban.indexOf('### Groups: files that list their cards'));
const webBullet = flat(web.slice(web.indexOf('- **Scratchpad** —'), web.indexOf('- **Groups** —')));
const docsPad = flat(docs.slice(docs.indexOf('**Scratchpad** —'), docs.indexOf('**Groups** —')));

test('the kanban skill documents the scratchpad file: its folder, name, frontmatter, the writer\'s rules and that nothing deletes one', () => {
  assert.ok(flat(section).length > 1200, 'the Scratchpad section is found');
  for (const part of ['<padded id>.scratchpad.md', '0007.scratchpad.md', 'I0002.scratchpad.md', 'at most one page', '`refs:`', 'free Markdown', 'Writing a page (agents may)',
    'temporary file and a rename', 'The kanban never deletes one', '**Its scratchpad**', 'Ctrl+Enter']) {
    assert.ok(flat(section).includes(part), part);
  }
  assert.ok(kanban.includes('**`scratchpad` — the folder of the board\'s scratchpads.**'), 'the config key is documented');
  assert.strictEqual(parseConfig('scratchpad: .scratchpad\n').scratchpad, '.scratchpad');
});

test('the example page in the kanban skill reads as it says: three refs and the body below', () => {
  const example = /```yaml\n(---\nrefs:[\s\S]*?\n---\n[\s\S]*?)```/.exec(section)[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-scratchpad-docs-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'scratchpad: .scratchpad\n');
  fs.mkdirSync(path.join(dir, '.scratchpad'));
  fs.writeFileSync(path.join(dir, '.scratchpad', '0007.scratchpad.md'), example);
  const pad = sp.readPad(dir, '7');
  assert.deepStrictEqual(pad.refs, ['src/orders/schema.js', '2026.10.16.0007.logbook.md', '#3']);
  assert.strictEqual(pad.body, 'anything at all, kept as written\n');
  assert.strictEqual(sp.canonicalName('I2', 4), 'I0002.scratchpad.md');
});

test('the web skill describes the tab, its entries, the keys, the routes and the payload', () => {
  assert.ok(webBullet.length > 800, 'the Scratchpad bullet is found');
  for (const part of ['**Scratchpad** tab', '**Scratchpad…**', '`(not written yet)`', '**Ctrl+Enter**', '**Save**', '`GET /api/scratchpad/<id>`', '`PUT /api/scratchpad/<id>`',
    'there is no delete route', '**Its scratchpad**', '`scratchpad: { folder, targets }`']) {
    assert.ok(webBullet.includes(part), part);
  }
  assert.ok(flat(web).includes('`DELETE /api/groups/<id>` take `{ logbook, scratchpad, members, memberLogbook, memberScratchpad }`'));
  assert.ok(flat(web).includes('the pages Logbook, Scratchpad, Groups, Types, Prefixes and Counters'));
});

test('the docs describe the tab, the ways in, the save, and the delete box that is unticked', () => {
  assert.ok(docsPad.length > 600, 'the Scratchpad paragraph is found');
  for (const part of ['**Scratchpad** tab', '**Scratchpad…**', '**Ctrl+Enter**', '**Save**', 'The kanban never deletes a page', '**Its scratchpad**', 'unticked']) {
    assert.ok(docsPad.includes(part), part);
  }
  assert.ok(flat(docs).includes('*This board* has six pages'));
});

test('the docs and the web skill describe Ctrl+Shift+V on the Scratchpad: where it works, what it does, and that the buttons show it', () => {
  for (const [where, text] of [['the web skill', webBullet], ['the web docs', docsPad]]) {
    assert.ok(text.includes('Ctrl+Shift+V'), `${where}: names the key`);
    assert.match(text, /from the box or anywhere (?:else )?in the palette on that tab/, `${where}: where it works`);
    assert.match(text, /flips the switch/, `${where}: what it does`);
    assert.match(text, /Cmd\+Shift\+V/, `${where}: the Mac name`);
    assert.match(text, /buttons show the key/, `${where}: the buttons show it`);
  }
  assert.match(docsPad, /to Edit it puts the cursor at the end of the text, to Preview it keeps the palette's keys working/);
  assert.match(docsPad, /in the box it would only paste, as Ctrl\+V does, and off the tab it is the browser's/);
});

test('the docs describe e on the open card details: the edit form with the title focused, the key guard, the palette, and archived cards', () => {
  const start = docs.indexOf('**Edit from the details**');
  assert.ok(start > -1, 'the paragraph is there');
  const para = flat(docs.slice(start, docs.indexOf('**Notes** —', start)));
  for (const part of ['`e` with a card\'s details open opens its edit form', 'as the details\' Edit button does', 'its tooltip names the key', 'with the cursor in the title field so you can type at once',
    'shared key guard, as `n` is', 'a field in the details gets the letter', 'behind a menu, the edit form, the notifications panel or the preferences sheet',
    'with the notes palette up, which draws above the details, `e` stays the palette\'s', 'An archived card has no Edit button and no `e`']) {
    assert.ok(para.includes(part), part);
  }
});
