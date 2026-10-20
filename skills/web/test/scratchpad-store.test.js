const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sp = require('../scripts/scratchpad-store');
const { StatusError } = require('../scripts/store-common');

// The scratchpad store (docs/adr/0016): one `<padded id>.scratchpad.md` per card or group in the
// folder `scratchpad:` names, optional `refs:` in the frontmatter and a free body. Reading is
// tolerant, a write changes the body and nothing else, and the store never deletes a file but
// on the delete flow's word (deleteTargetFiles).

function tmpBoard(config = 'name: t\nscratchpad: .scratchpad\n', files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-scratchpad-'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const refused = (fn, status) => assert.throws(fn, (e) => e instanceof StatusError && e.status === status);

test('the folder is the one scratchpad: names, relative to the board; null when the line is absent', () => {
  const dir = tmpBoard();
  assert.strictEqual(sp.scratchpadDir(dir), path.join(dir, '.scratchpad'));
  assert.strictEqual(sp.scratchpadDir(tmpBoard('name: t\n')), null);
  assert.strictEqual(sp.scratchpadDir(tmpBoard(null)), null);
});

test('a target with no file reads as an empty page that does not exist yet', () => {
  const dir = tmpBoard();
  assert.deepStrictEqual(sp.readPad(dir, '7'), { target: '7', exists: false, file: '0007.scratchpad.md', refs: [], body: '' });
  assert.ok(!fs.existsSync(path.join(dir, '.scratchpad')), 'reading creates nothing');
});

test('a page reads its refs, block or flow, and the body below the frontmatter', () => {
  const block = '---\nrefs:\n  - src/app.js\n  - "notes: the 12th"   # why\n  - 0007.logbook.md\n---\n\nfirst\n\nsecond\n';
  const dir = tmpBoard(undefined, { '.scratchpad/0007.scratchpad.md': block, '.scratchpad/I0001.scratchpad.md': '---\nrefs: [a.md, "b c.md"]\n---\nno gap\n' });
  assert.deepStrictEqual(sp.readPad(dir, '7'), { target: '7', exists: true, file: '0007.scratchpad.md', refs: ['src/app.js', 'notes: the 12th', '0007.logbook.md'], body: 'first\n\nsecond\n' });
  assert.deepStrictEqual(sp.readPad(dir, 'I1'), { target: 'I1', exists: true, file: 'I0001.scratchpad.md', refs: ['a.md', 'b c.md'], body: 'no gap\n' });
});

test('a file with no frontmatter is all body, and CRLF reads as new lines', () => {
  const dir = tmpBoard(undefined, { '.scratchpad/0003.scratchpad.md': 'one\r\ntwo\r\n', '.scratchpad/0004.scratchpad.md': '---\r\nrefs:\r\n  - x\r\n---\r\n\r\nbody\r\n' });
  assert.strictEqual(sp.readPad(dir, '3').body, 'one\ntwo\n');
  assert.deepStrictEqual(sp.readPad(dir, '4').refs, ['x']);
  assert.strictEqual(sp.readPad(dir, '4').body, 'body\n');
});

test('a file reads by the number whatever its padding, and the canonical name wins', () => {
  const dir = tmpBoard(undefined, { '.scratchpad/7.scratchpad.md': 'short', '.scratchpad/000007.scratchpad.md': 'long' });
  assert.strictEqual(sp.readPad(dir, '7').body, 'long', 'sorted names: the first one found when none is canonical');
  fs.writeFileSync(path.join(dir, '.scratchpad', '0007.scratchpad.md'), 'canon');
  assert.strictEqual(sp.readPad(dir, '7').body, 'canon');
  assert.strictEqual(sp.readPad(dir, '0007').file, '0007.scratchpad.md', 'any spelling of the id finds it');
});

test('writing makes the folder and the file named by the board\'s idDigits, body only', () => {
  const dir = tmpBoard('scratchpad: pads\nidDigits: 3\n');
  const pad = sp.writePad(dir, '7', 'line one\nline two');
  assert.deepStrictEqual(pad, { target: '7', exists: true, file: '007.scratchpad.md', refs: [], body: 'line one\nline two' });
  assert.strictEqual(read(dir, 'pads/007.scratchpad.md'), 'line one\nline two');
  assert.strictEqual(sp.writePad(dir, 'I12', 'g').file, 'I012.scratchpad.md');
  assert.ok(!fs.existsSync(path.join(dir, 'pads', '007.scratchpad.md.tmp')), 'no temp file is left');
});

test('a write changes the body and keeps the frontmatter, the gap and the line ending as they were', () => {
  const dir = tmpBoard(undefined, {
    '.scratchpad/0001.scratchpad.md': '---\r\n# why this pad\r\nrefs:\r\n  - a.md\r\nowner: franc\r\n---\r\n\r\nold\r\n',
    '.scratchpad/0002.scratchpad.md': '---\nrefs: [a]\n---\nold\n',
  });
  const crlf = sp.writePad(dir, '1', 'new\ntext');
  assert.strictEqual(read(dir, '.scratchpad/0001.scratchpad.md'), '---\r\n# why this pad\r\nrefs:\r\n  - a.md\r\nowner: franc\r\n---\r\n\r\nnew\r\ntext');
  assert.deepStrictEqual(crlf.refs, ['a.md']);
  assert.strictEqual(crlf.body, 'new\ntext');
  sp.writePad(dir, '2', 'new\n');
  assert.strictEqual(read(dir, '.scratchpad/0002.scratchpad.md'), '---\nrefs: [a]\n---\nnew\n', 'no blank line was there, none is added');
});

test('a write goes to the file that is there, whatever its padding', () => {
  const dir = tmpBoard(undefined, { '.scratchpad/7.scratchpad.md': 'old' });
  assert.strictEqual(sp.writePad(dir, '7', 'new').file, '7.scratchpad.md');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.scratchpad')), ['7.scratchpad.md']);
});

test('an empty body still writes the file, and a body that opens with --- keeps reading as the body', () => {
  const dir = tmpBoard();
  assert.strictEqual(sp.writePad(dir, '5', '').exists, true);
  assert.strictEqual(read(dir, '.scratchpad/0005.scratchpad.md'), '');
  const tricky = '---\nnot: frontmatter\n---\nafter';
  sp.writePad(dir, '6', tricky);
  assert.strictEqual(sp.readPad(dir, '6').body, tricky);
  assert.deepStrictEqual(sp.readPad(dir, '6').refs, []);
});

test('the pages that exist are listed by id, in id order, from the file names alone', () => {
  const dir = tmpBoard(undefined, {
    '.scratchpad/0010.scratchpad.md': '', '.scratchpad/0002.scratchpad.md': '', '.scratchpad/I0001.scratchpad.md': '',
    '.scratchpad/0002.other.md': '', '.scratchpad/notes.scratchpad.md': '', '.scratchpad/7.scratchpad.md.tmp': '',
  });
  assert.deepStrictEqual(sp.listTargets(dir), ['2', '10', 'I1']);
  assert.deepStrictEqual(sp.listTargets(tmpBoard('name: t\n')), []);
});

test('deleting a target\'s pages removes every padding of it and counts them; the rest stay', () => {
  const dir = tmpBoard(undefined, { '.scratchpad/0007.scratchpad.md': 'a', '.scratchpad/7.scratchpad.md': 'b', '.scratchpad/0008.scratchpad.md': 'c' });
  assert.strictEqual(sp.deleteTargetFiles(dir, '7'), 2);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.scratchpad')), ['0008.scratchpad.md']);
  assert.strictEqual(sp.deleteTargetFiles(dir, '7'), 0);
  assert.strictEqual(sp.deleteTargetFiles(tmpBoard('name: t\n'), '7'), 0, 'a board with no scratchpad has none to delete');
  assert.strictEqual(sp.deleteTargetFiles(dir, 'nope'), 0);
});

test('a request that is wrong is refused with its status, and nothing is written', () => {
  const off = tmpBoard('name: t\n');
  refused(() => sp.readPad(off, '7'), 404);
  refused(() => sp.writePad(off, '7', 'x'), 404);
  const dir = tmpBoard();
  refused(() => sp.readPad(dir, '../7'), 400);
  refused(() => sp.readPad(dir, ''), 400);
  refused(() => sp.writePad(dir, 'x7', 'x'), 400);
  refused(() => sp.writePad(dir, '7', 12), 400);
  refused(() => sp.writePad(dir, '7', 'x'.repeat(sp.MAX_PAD + 1)), 413);
  assert.ok(!fs.existsSync(path.join(dir, '.scratchpad')));
});
