const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mayReplace, isPageName, isReservedName } = require('../../plugin/skills/web/scripts/scratchpad-folder');

// The decisions of the folder browser that need no server: whether a move may land on an existing
// destination, and which names are never made.

function tmp() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-padrules-'))); }

test('a move may land on a destination that is not there, or on the source itself', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.md'), 'a');
  assert.strictEqual(mayReplace(path.join(d, 'a.md'), path.join(d, 'new.md')), true);
  assert.strictEqual(mayReplace(path.join(d, 'a.md'), path.join(d, 'a.md')), true);
});

test('a move never lands on a different file that exists, whatever the case of the names', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.md'), 'lower');
  fs.writeFileSync(path.join(d, 'b.md'), 'other');
  assert.strictEqual(mayReplace(path.join(d, 'a.md'), path.join(d, 'b.md')), false);
});

test('a case-only rename is allowed only where the two names are one file', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.md'), 'lower');
  const insensitive = fs.existsSync(path.join(d, 'A.md'));
  assert.strictEqual(mayReplace(path.join(d, 'a.md'), path.join(d, 'A.md')), insensitive);
  if (!insensitive) {
    fs.writeFileSync(path.join(d, 'A.md'), 'upper');
    assert.strictEqual(mayReplace(path.join(d, 'a.md'), path.join(d, 'A.md')), false, 'two files on a case-sensitive file system');
  }
});

test('a page name is any name that ends in .scratchpad.md, in any case', () => {
  for (const n of ['0001.scratchpad.md', 'x.y.scratchpad.md', 'X.SCRATCHPAD.MD', '.scratchpad.md', 'a.b.c.Scratchpad.Md']) assert.strictEqual(isPageName(n), true, n);
  for (const n of ['scratchpad.md', 'notes.md', 'a.scratchpad.md.txt', 'a.scratchpad.mdx', 'my-scratchpad.md']) assert.strictEqual(isPageName(n), false, n);
});

test('a reserved device name is refused whole or before the first dot, in any case', () => {
  for (const n of ['con', 'CON.md', 'prn.txt', 'Aux.v2.md', 'nul', 'com1', 'COM9.md', 'lpt1.txt', 'LPT9']) assert.strictEqual(isReservedName(n), true, n);
  for (const n of ['console.md', 'com10.md', 'com0.md', 'lpt0', 'a.con', 'x.nul.md', 'comm.md']) assert.strictEqual(isReservedName(n), false, n);
});
