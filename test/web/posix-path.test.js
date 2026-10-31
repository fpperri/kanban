const { test } = require('node:test');
const assert = require('node:assert');
const nodePath = require('node:path');
const shim = require('../../plugin/skills/web/scripts/posix-path');

const PATHS = ['', '.', '..', '/', '//', 'a', 'a/', '/a', '/a/b/c', 'a//b', 'a/./b', 'a/../b', '../a', '../../a/b', '/a/../..', '/a/b/../c/.', 'a/b/c.md', 'a/b/.hidden', 'a/b/.', 'a.tar.gz', '.kanban/0001.one.card.md', '/x/y.txt/', 'dir.d/file'];

test('the path shim joins, normalises and resolves as POSIX path does', () => {
  for (const p of PATHS) {
    assert.strictEqual(shim.normalize(p), nodePath.posix.normalize(p), `normalize ${p}`);
    assert.strictEqual(shim.isAbsolute(p), nodePath.posix.isAbsolute(p), `isAbsolute ${p}`);
    assert.strictEqual(shim.join('/base', p), nodePath.posix.join('/base', p), `join ${p}`);
    assert.strictEqual(shim.join(p, 'z'), nodePath.posix.join(p, 'z'), `join-after ${p}`);
  }
  assert.strictEqual(shim.join(), nodePath.posix.join());
  assert.strictEqual(shim.join('a', '', 'b'), nodePath.posix.join('a', '', 'b'));
  assert.strictEqual(shim.join('/a', '../../b'), nodePath.posix.join('/a', '../../b'));
});

test('the path shim names a path\'s parts as POSIX path does', () => {
  for (const p of PATHS.filter((x) => !x.includes('//'))) {
    assert.strictEqual(shim.dirname(p), nodePath.posix.dirname(p), `dirname ${p}`);
    assert.strictEqual(shim.basename(p), nodePath.posix.basename(p), `basename ${p}`);
    assert.strictEqual(shim.extname(p), nodePath.posix.extname(p), `extname ${p}`);
    assert.strictEqual(shim.basename(p, '.md'), nodePath.posix.basename(p, '.md'), `basename-ext ${p}`);
  }
});

test('the path shim finds a relative path as POSIX path does', () => {
  const pairs = [['/a/b', '/a/b/c'], ['/a/b/c', '/a/b'], ['/a/b', '/a/x/y'], ['/a', '/a'], ['/', '/a'], ['/a', '/'], ['/a/b/../c', '/a/c/d'], ['/a/b', '/c']];
  for (const [from, to] of pairs) assert.strictEqual(shim.relative(from, to), nodePath.posix.relative(from, to), `${from} -> ${to}`);
});

test('resolve reads a relative path from the root, and a later absolute path wins', () => {
  assert.strictEqual(shim.resolve('a/b'), '/a/b');
  assert.strictEqual(shim.resolve('/x', 'y', '../z'), '/x/z');
  assert.strictEqual(shim.resolve('/x', '/y'), '/y');
  assert.strictEqual(shim.resolve('/x/y/', '.'), '/x/y');
  assert.strictEqual(shim.resolve('/..'), '/');
  assert.strictEqual(shim.resolve(), '/');
});

test('the shim is POSIX: a slash separates, posix is itself, and a backslash is part of a name', () => {
  assert.strictEqual(shim.sep, '/');
  assert.strictEqual(shim.posix, shim);
  assert.strictEqual(shim.basename('a/b\c'), 'b\c');
  assert.strictEqual(shim.isAbsolute('C:/x'), false);
});
