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

test('a folder and a file name join with one slash, whichever way the folder ends', () => {
  assert.strictEqual(pf.joinFolder('../work/0499.x/.scratchpad', '0499.scratchpad.md'), '../work/0499.x/.scratchpad/0499.scratchpad.md');
  assert.strictEqual(pf.joinFolder('../work/0499.x/.scratchpad/', 'a.md'), '../work/0499.x/.scratchpad/a.md');
  assert.strictEqual(pf.joinFolder('a\\b\\', 'c.md'), 'a\\b/c.md');
  assert.strictEqual(pf.joinFolder('', 'c.md'), 'c.md');
  assert.strictEqual(pf.absJoin('C:\\pads\\7', 'a.md'), 'C:\\pads\\7\\a.md');
  assert.strictEqual(pf.absJoin('C:\\pads\\7\\', 'a.md'), 'C:\\pads\\7\\a.md');
  assert.strictEqual(pf.absJoin('/home/pads/7', 'a.md'), '/home/pads/7/a.md');
});

test('a row\'s icon says what the entry is, and its title carries the full name, size and date', () => {
  assert.strictEqual(pf.iconOf({ name: 'x', dir: true }), 'folder');
  assert.strictEqual(pf.iconOf({ name: '7.scratchpad.md', page: true, kind: 'markdown' }), 'page');
  assert.strictEqual(pf.iconOf({ name: 'a.md', kind: 'markdown' }), 'markdown');
  assert.strictEqual(pf.iconOf({ name: 'a.txt', kind: 'text' }), 'text');
  assert.strictEqual(pf.iconOf({ name: 'a.log', kind: 'file', readable: true }), 'text');
  assert.strictEqual(pf.iconOf({ name: 'a.png', kind: 'image' }), 'image');
  assert.strictEqual(pf.iconOf({ name: 'a.bin', kind: 'file', readable: false }), 'other');
  const at = new Date(2026, 9, 30, 7, 5).toISOString();
  assert.strictEqual(pf.rowTitle({ name: 'very-long-name.png', size: 1536, mtime: at }), 'very-long-name.png\n1.5 KB\n2026-10-30 07:05');
  assert.strictEqual(pf.rowTitle({ name: 'sub', dir: true, size: 0, mtime: at }), 'sub\n2026-10-30 07:05');
});

test('the folders a file can move into are the parent and the subfolders of the folder shown', () => {
  const entries = [{ name: '0007.scratchpad.md', page: true }, { name: 'sub', dir: true }, { name: 'a.md' }, { name: 'shots', dir: true }];
  assert.deepStrictEqual(pf.moveTargets('', entries), [{ label: 'sub/', path: 'sub' }, { label: 'shots/', path: 'shots' }]);
  assert.deepStrictEqual(pf.moveTargets('sub', [{ name: 'deeper', dir: true }]), [{ label: '.. (up)', path: '' }, { label: 'deeper/', path: 'sub/deeper' }]);
  assert.deepStrictEqual(pf.moveTargets('a/b', []), [{ label: '.. (up)', path: 'a' }]);
});

test('a rename keeps the file in its folder: a blank, an unchanged or a pathy name makes no move', () => {
  assert.strictEqual(pf.renameDest('sub', 'a.md', ' b.md '), 'sub/b.md');
  assert.strictEqual(pf.renameDest('', 'a.md', 'b.md'), 'b.md');
  assert.strictEqual(pf.renameDest('', 'a.md', 'a.md'), '');
  assert.strictEqual(pf.renameDest('', 'a.md', '   '), '');
  assert.strictEqual(pf.renameDest('', 'a.md', 'x/b.md'), '');
  assert.strictEqual(pf.renameDest('', 'a.md', 'x\\b.md'), '');
});

function memoryStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, m };
}

test('the explorer is open until the person folds it, and the choice is kept per board', () => {
  const s = memoryStorage();
  assert.strictEqual(pf.foldedLoad(s, 'webapp'), false);
  pf.foldedSave(s, 'webapp', true);
  assert.strictEqual(pf.foldedLoad(s, 'webapp'), true);
  assert.strictEqual(pf.foldedLoad(s, 'other'), false);
  assert.ok(s.m.has('kanban.webapp.scratchpad.folded'));
  pf.foldedSave(s, 'webapp', false);
  assert.strictEqual(pf.foldedLoad(s, 'webapp'), false);
  assert.strictEqual(s.m.has('kanban.webapp.scratchpad.folded'), false, 'open is the default, so nothing is kept');
});

test('storage that throws, or holds anything else, leaves the explorer open and never throws', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.strictEqual(pf.foldedLoad(broken, 'webapp'), false);
  assert.doesNotThrow(() => pf.foldedSave(broken, 'webapp', true));
  assert.strictEqual(pf.foldedLoad(null, 'webapp'), false);
  assert.doesNotThrow(() => pf.foldedSave(null, 'webapp', true));
  assert.strictEqual(pf.foldedLoad(memoryStorage({ 'kanban.webapp.scratchpad.folded': 'maybe' }), 'webapp'), false);
});
