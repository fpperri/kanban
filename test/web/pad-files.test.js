const { test } = require('node:test');
const assert = require('node:assert');
const pf = require('../../plugin/skills/web/web/pad-files');

test('a size reads in bytes, then kilobytes and megabytes with one decimal', () => {
  assert.strictEqual(pf.sizeText(0), '0 B');
  assert.strictEqual(pf.sizeText(1023), '1023 B');
  assert.strictEqual(pf.sizeText(1536), '1.5 KB');
  assert.strictEqual(pf.sizeText(2 * 1024 * 1024), '2.0 MB');
  assert.strictEqual(pf.sizeText(undefined), '');
  assert.strictEqual(pf.sizeText(-1), '');
});

test('a date reads as the local day and minute; a bad one reads blank', () => {
  const at = new Date(2026, 9, 30, 7, 5);
  assert.strictEqual(pf.dateText(at.toISOString()), '2026-10-30 07:05');
  assert.strictEqual(pf.dateText('nope'), '');
});

test('paths join and walk up from the card\'s folder', () => {
  assert.strictEqual(pf.joinPath('', 'a.md'), 'a.md');
  assert.strictEqual(pf.joinPath('sub', 'a.md'), 'sub/a.md');
  assert.strictEqual(pf.parentPath(''), null);
  assert.strictEqual(pf.parentPath('sub'), '');
  assert.strictEqual(pf.parentPath('a/b'), 'a');
  assert.deepStrictEqual(pf.crumbs(''), [{ name: '', path: '' }]);
  assert.deepStrictEqual(pf.crumbs('a/b'), [{ name: '', path: '' }, { name: 'a', path: 'a' }, { name: 'b', path: 'a/b' }]);
});

test('a typed new file name gets .md unless it already ends in .md or .txt', () => {
  assert.strictEqual(pf.newFileName('  idea '), 'idea.md');
  assert.strictEqual(pf.newFileName('log.TXT'), 'log.TXT');
  assert.strictEqual(pf.newFileName('a.md'), 'a.md');
  assert.strictEqual(pf.newFileName('shot.png'), 'shot.png.md');
  assert.strictEqual(pf.newFileName('   '), '');
  assert.strictEqual(pf.newFileName(null), '');
});
