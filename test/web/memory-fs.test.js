const { test } = require('node:test');
const assert = require('node:assert');
const { makeMemoryFs } = require('../../plugin/skills/web/scripts/memory-fs');

const codeOf = (fn) => { try { fn(); } catch (e) { return e.code; } return 'none'; };
const text = (u8) => Buffer.from(u8).toString('utf8');

test('files given at the start are there with their folders, as text or as bytes', () => {
  const fs = makeMemoryFs({ '/b/cards/1.card.md': '# One\n', '/b/pic.png': Buffer.from([137, 80, 78, 71]) });
  assert.strictEqual(fs.readFileSync('/b/cards/1.card.md', 'utf8'), '# One\n');
  assert.deepStrictEqual(fs.readdirSync('/b'), ['cards', 'pic.png']);
  assert.ok(fs.statSync('/b/cards').isDirectory());
  const png = fs.readFileSync('/b/pic.png');
  assert.ok(Buffer.isBuffer(png));
  assert.deepStrictEqual([...png], [137, 80, 78, 71]);
  assert.ok(fs.existsSync('/b/pic.png') && !fs.existsSync('/b/none'));
});

test('a byte answer is a Uint8Array where there is no Buffer', () => {
  const fs = makeMemoryFs({ '/a': 'xy' }, { Buffer: null });
  const bytes = fs.readFileSync('/a');
  assert.strictEqual(bytes.constructor, Uint8Array);
  assert.deepStrictEqual([...bytes], [120, 121]);
});

test('text is UTF-8 and keeps a byte order mark, as Node reads it', () => {
  const fs = makeMemoryFs();
  fs.writeFileSync('/f', '﻿café 😀');
  assert.strictEqual(fs.readFileSync('/f', 'utf8'), '﻿café 😀');
  assert.strictEqual(fs.statSync('/f').size, Buffer.byteLength('﻿café 😀'));
  fs.writeFileSync('/bad', Buffer.from([0xff, 0x41]));
  assert.strictEqual(fs.readFileSync('/bad', { encoding: 'utf8' }), '�A');
  assert.strictEqual(codeOf(() => fs.readFileSync('/f', 'latin1')), 'ERR_UNSUPPORTED_ENCODING');
});

test('write replaces, wx refuses an existing name, and a missing folder is ENOENT', () => {
  const fs = makeMemoryFs({ '/d/a': 'one' });
  fs.writeFileSync('/d/a', 'two');
  assert.strictEqual(fs.readFileSync('/d/a', 'utf8'), 'two');
  assert.strictEqual(codeOf(() => fs.writeFileSync('/d/a', 'x', { flag: 'wx' })), 'EEXIST');
  fs.writeFileSync('/d/b', 'new', { flag: 'wx' });
  assert.strictEqual(fs.readFileSync('/d/b', 'utf8'), 'new');
  assert.strictEqual(codeOf(() => fs.writeFileSync('/nowhere/x', 'x')), 'ENOENT');
  assert.strictEqual(codeOf(() => fs.writeFileSync('/d', 'x')), 'EISDIR');
  assert.strictEqual(codeOf(() => fs.writeFileSync('/d/a/x', 'x')), 'ENOTDIR');
});

test('append makes a missing file and adds to an existing one', () => {
  const fs = makeMemoryFs({ '/d/n': 'a\n' });
  fs.appendFileSync('/d/n', 'b\n');
  fs.appendFileSync('/d/m', 'c\n');
  assert.strictEqual(fs.readFileSync('/d/n', 'utf8'), 'a\nb\n');
  assert.strictEqual(fs.readFileSync('/d/m', 'utf8'), 'c\n');
  assert.strictEqual(codeOf(() => fs.appendFileSync('/none/m', 'c')), 'ENOENT');
});

test('mkdir makes one level, or every level with recursive, and EEXIST only where Node says it', () => {
  const fs = makeMemoryFs({ '/x/f': 'f' });
  fs.mkdirSync('/x/one');
  assert.strictEqual(codeOf(() => fs.mkdirSync('/x/one')), 'EEXIST');
  assert.strictEqual(codeOf(() => fs.mkdirSync('/x/p/q')), 'ENOENT');
  assert.strictEqual(fs.mkdirSync('/x/p/q', { recursive: true }), '/x/p');
  assert.strictEqual(fs.mkdirSync('/x/p/q', { recursive: true }), undefined);
  assert.ok(fs.statSync('/x/p/q').isDirectory());
  assert.strictEqual(codeOf(() => fs.mkdirSync('/x/f', { recursive: true })), 'EEXIST');
  assert.strictEqual(codeOf(() => fs.mkdirSync('/x/f/y', { recursive: true })), 'ENOTDIR');
});

test('readdir lists names in order, or entries that say file or folder; a file or a missing folder is an error', () => {
  const fs = makeMemoryFs({ '/r/b.md': '', '/r/a.md': '', '/r/sub/c.md': '' });
  assert.deepStrictEqual(fs.readdirSync('/r'), ['a.md', 'b.md', 'sub']);
  const entries = fs.readdirSync('/r', { withFileTypes: true });
  assert.deepStrictEqual(entries.map((e) => [e.name, e.isDirectory(), e.isFile()]), [['a.md', false, true], ['b.md', false, true], ['sub', true, false]]);
  assert.strictEqual(codeOf(() => fs.readdirSync('/r/a.md')), 'ENOTDIR');
  assert.strictEqual(codeOf(() => fs.readdirSync('/none')), 'ENOENT');
});

test('stat tells file from folder, size, times and a stable identity; bigint stat gives bigints', () => {
  let t = 1000;
  const fs = makeMemoryFs({ '/s/f': 'abc' }, { now: () => t });
  const first = fs.statSync('/s/f');
  assert.ok(first.isFile() && !first.isDirectory() && !first.isSymbolicLink());
  assert.strictEqual(first.size, 3);
  assert.strictEqual(first.mtimeMs, 1000);
  assert.strictEqual(first.mtime.toISOString(), '1970-01-01T00:00:01.000Z');
  t = 2000;
  fs.writeFileSync('/s/f', 'abcd');
  assert.strictEqual(fs.statSync('/s/f').mtimeMs, 2000);
  assert.strictEqual(fs.lstatSync('/s/f').size, 4);
  const a = fs.statSync('/s/f', { bigint: true });
  const b = fs.statSync('/s/f', { bigint: true });
  assert.strictEqual(typeof a.ino, 'bigint');
  assert.strictEqual(a.ino, b.ino);
  assert.notStrictEqual(a.ino, fs.statSync('/s', { bigint: true }).ino);
  assert.strictEqual(codeOf(() => fs.statSync('/s/none')), 'ENOENT');
  assert.strictEqual(codeOf(() => fs.lstatSync('/s/f/x')), 'ENOTDIR');
});

test('rename moves a file over another, carries a folder with what is in it, and keeps its identity', () => {
  const fs = makeMemoryFs({ '/m/a': 'A', '/m/b': 'B', '/m/dir/inner': 'I' });
  const ino = fs.statSync('/m/a', { bigint: true }).ino;
  fs.renameSync('/m/a', '/m/b');
  assert.strictEqual(fs.readFileSync('/m/b', 'utf8'), 'A');
  assert.ok(!fs.existsSync('/m/a'));
  assert.strictEqual(fs.statSync('/m/b', { bigint: true }).ino, ino);
  fs.renameSync('/m/dir', '/m/moved');
  assert.strictEqual(fs.readFileSync('/m/moved/inner', 'utf8'), 'I');
  assert.ok(!fs.existsSync('/m/dir'));
  assert.strictEqual(codeOf(() => fs.renameSync('/m/none', '/m/x')), 'ENOENT');
  assert.strictEqual(codeOf(() => fs.renameSync('/m/b', '/nowhere/x')), 'ENOENT');
  assert.strictEqual(codeOf(() => fs.renameSync('/m/b', '/m/moved')), 'EISDIR');
});

test('unlink removes a file, not a folder', () => {
  const fs = makeMemoryFs({ '/u/f': '1', '/u/d/g': '2' });
  fs.unlinkSync('/u/f');
  assert.ok(!fs.existsSync('/u/f'));
  assert.strictEqual(codeOf(() => fs.unlinkSync('/u/f')), 'ENOENT');
  assert.strictEqual(codeOf(() => fs.unlinkSync('/u/d')), 'EISDIR');
});

test('open, read and close read a head of a file at a position', () => {
  const fs = makeMemoryFs({ '/o/f': '0123456789' });
  const fd = fs.openSync('/o/f', 'r');
  const buf = Buffer.alloc(4);
  assert.strictEqual(fs.readSync(fd, buf, 0, 4, 0), 4);
  assert.strictEqual(text(buf), '0123');
  assert.strictEqual(fs.readSync(fd, buf, 0, 4, 8), 2);
  assert.strictEqual(text(buf.subarray(0, 2)), '89');
  fs.closeSync(fd);
  assert.strictEqual(codeOf(() => fs.closeSync(fd)), 'EBADF');
  assert.strictEqual(codeOf(() => fs.openSync('/o/none', 'r')), 'ENOENT');
});

test('realpath gives the resolved path of what is there and ENOENT of what is not, also as realpathSync.native', () => {
  const fs = makeMemoryFs({ '/p/q/f': '' });
  assert.strictEqual(fs.realpathSync('/p/q/../q/f'), '/p/q/f');
  assert.strictEqual(fs.realpathSync.native('/p/q'), '/p/q');
  assert.strictEqual(codeOf(() => fs.realpathSync('/p/none')), 'ENOENT');
  assert.strictEqual(codeOf(() => fs.realpathSync.native('/p/none')), 'ENOENT');
});

test('a write does not change a seed array or a buffer it was given, and a read is a copy', () => {
  const fs = makeMemoryFs();
  const bytes = Buffer.from('abc');
  fs.writeFileSync('/c', bytes);
  bytes[0] = 0;
  assert.strictEqual(fs.readFileSync('/c', 'utf8'), 'abc');
  const read = fs.readFileSync('/c');
  read[0] = 0;
  assert.strictEqual(fs.readFileSync('/c', 'utf8'), 'abc');
});
