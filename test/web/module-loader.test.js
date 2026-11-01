const { test } = require('node:test');
const assert = require('node:assert');
const { makeLoader } = require('../../plugin/skills/web/scripts/module-loader');

test('a module runs with exports, module.exports, require, __filename and __dirname, and its exports are cached', () => {
  const loader = makeLoader({
    sources: {
      'a/main.js': "'use strict';\nconst { n } = require('./dep');\nexports.seen = [n, __filename, __dirname, require('./dep') === require('./dep.js')];\n",
      'a/dep.js': 'let runs = 0; runs += 1; module.exports = { n: runs };',
    },
  });
  assert.deepStrictEqual(loader.load('a/main.js').seen, [1, 'a/main.js', 'a', true]);
  assert.strictEqual(loader.load('a/dep.js'), loader.load('a/dep'.concat('.js')));
});

test('relative requires climb and descend, and a folder resolves to its index.js', () => {
  const loader = makeLoader({
    sources: {
      'scripts/route.js': "module.exports = [require('../web/ids').id, require('./sub').sub];",
      'web/ids.js': "module.exports = { id: 'ids' };",
      'scripts/sub/index.js': "module.exports = { sub: 'index' };",
    },
  });
  assert.deepStrictEqual(loader.load('scripts/route.js'), ['ids', 'index']);
});

test('a built-in comes from the shims given, with or without node:, and one with no shim is an error that names it', () => {
  const fake = { name: 'fake-fs' };
  const loader = makeLoader({
    sources: { 'm.js': "module.exports = [require('fs'), require('node:fs')];", 'bad.js': "require('os');" },
    builtins: { fs: fake },
  });
  assert.deepStrictEqual(loader.load('m.js'), [fake, fake]);
  assert.throws(() => loader.load('bad.js'), /no shim for the Node built-in 'os' \(required by 'bad\.js'\)/);
});

test('a missing relative module is an error that names it and who asked', () => {
  const loader = makeLoader({ sources: { 'x/a.js': "require('./nope');" } });
  assert.throws(() => loader.load('x/a.js'), /Cannot find module '\.\/nope' from 'x\/a\.js'/);
  assert.throws(() => loader.load('x/none.js'), /Cannot find module 'x\/none\.js'/);
});

test('a module that throws while loading is not left half-loaded', () => {
  const loader = makeLoader({ sources: { 'flaky.js': "if (globalThis.__flaky) throw new Error('boom'); module.exports = 1;" } });
  globalThis.__flaky = true;
  try {
    assert.throws(() => loader.load('flaky.js'), /boom/);
    globalThis.__flaky = false;
    assert.strictEqual(loader.load('flaky.js'), 1);
  } finally { delete globalThis.__flaky; }
});

test('a module sees a POSIX process by default and the process and Buffer it is given', () => {
  const src = { 'p.js': 'module.exports = [process.platform, process.pid, typeof Buffer, process.cwd()];' };
  assert.deepStrictEqual(makeLoader({ sources: src }).load('p.js'), ['linux', 1, 'function', '/']);
  const given = makeLoader({ sources: src, globals: { process: { platform: 'x', pid: 7, cwd: () => '/c' }, Buffer: undefined } });
  assert.deepStrictEqual(given.load('p.js'), ['x', 7, 'undefined', '/c']);
});

test('a require cycle sees the exports made so far', () => {
  const loader = makeLoader({
    sources: {
      'a.js': "exports.early = 1; const b = require('./b'); exports.fromB = b.sawEarly;",
      'b.js': "const a = require('./a'); exports.sawEarly = a.early;",
    },
  });
  assert.strictEqual(loader.load('a.js').fromB, 1);
});
