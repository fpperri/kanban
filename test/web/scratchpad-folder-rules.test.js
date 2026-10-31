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

test('a case-only rename of a lone file is allowed on either kind of file system; onto a separate file it is not', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.md'), 'lower');
  // With no other A.md present the answer is true everywhere: on a file system that ignores case the two names
  // are one file (the same dev and ino), and on one that does not the destination is simply absent.
  assert.strictEqual(mayReplace(path.join(d, 'a.md'), path.join(d, 'A.md')), true);
  const insensitive = fs.existsSync(path.join(d, 'A.md'));
  if (!insensitive) {
    // Only a case-sensitive file system can hold a separate A.md; replacing it is refused.
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

const { headLooksText, isBinaryName, HEAD_BYTES } = require('../../plugin/skills/web/scripts/scratchpad-folder');

test('the list hint reads at most a head of 8 KB', () => {
  assert.strictEqual(HEAD_BYTES, 8192);
});

test('a head with no NUL and valid UTF-8 looks like text; a NUL or a bad byte does not', () => {
  assert.strictEqual(headLooksText(Buffer.from('plain text\n'), false), true);
  assert.strictEqual(headLooksText(Buffer.from('caf\u00e9\n'), false), true);
  assert.strictEqual(headLooksText(Buffer.from([0x61, 0x00, 0x62]), false), false);
  assert.strictEqual(headLooksText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]), false), false);
  assert.strictEqual(headLooksText(Buffer.alloc(0), false), true);
});

test('a multi-byte character cut by the end of a truncated head is allowed; one cut in a whole file is not', () => {
  const euro = Buffer.from('\u20ac');
  for (let keep = 1; keep < 3; keep++) {
    const head = Buffer.concat([Buffer.from('abc'), euro.subarray(0, keep)]);
    assert.strictEqual(headLooksText(head, true), true, `cut after ${keep} bytes of 3`);
    assert.strictEqual(headLooksText(head, false), false, `whole file ending in ${keep} bytes of 3`);
  }
  const four = Buffer.from('\u{1F600}');
  assert.strictEqual(headLooksText(Buffer.concat([Buffer.from('x'), four.subarray(0, 3)]), true), true);
  assert.strictEqual(headLooksText(Buffer.concat([Buffer.from('x'), Buffer.from([0xe9])]), true), true, 'E9 at the end of a cut head may start a 3-byte character: the full check at open decides');
  assert.strictEqual(headLooksText(Buffer.concat([Buffer.from([0xe9]), Buffer.from('x')]), true), false, 'a bad byte inside the head is bad');
  assert.strictEqual(headLooksText(Buffer.concat([Buffer.from('x'), Buffer.from([0xe2, 0x41])]), true), false, 'a lead byte then a plain byte is bad, not cut');
});

test('a NUL beyond the head is not seen by the hint, which the full check at open then catches', () => {
  const head = Buffer.alloc(8192, 0x61);
  assert.strictEqual(headLooksText(head, true), true);
});

test('names that are binary by extension are skipped without reading', () => {
  for (const n of ['a.zip', 'A.GZ', 'x.7z', 'doc.pdf', 'setup.exe', 'lib.dll', 'a.docx', 'b.xlsx', 'p.png', 'p.JPG', 'c.mp4', 'f.woff2', 'k.bin']) assert.strictEqual(isBinaryName(n), true, n);
  for (const n of ['a.txt', 'a.md', 'run.log', 'data.json', 'a.csv', 'noext', 'zip.txt', 'a.zip.txt']) assert.strictEqual(isBinaryName(n), false, n);
});
