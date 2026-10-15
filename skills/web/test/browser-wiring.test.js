const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// run.js and fault-check.js only run against a real Chrome, which no unit test
// starts. What can go wrong in them without a browser is a name that the module
// it came from does not export, which would only show as a TypeError in CI. This
// reads every runner file's `const { a, b } = require('./x')` and checks each
// name is there, and that every runner file parses.

const browserDir = path.join(__dirname, 'browser');
const files = [];
for (const dir of [browserDir, path.join(browserDir, 'scenarios')]) {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) files.push(path.join(dir, f));
}

test('every name a runner file takes from another runner module is exported by it', () => {
  let seen = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\('(\.[^']*)'\)/g)) {
      const mod = require(path.resolve(path.dirname(file), m[2]));
      for (const part of m[1].split(',')) {
        const name = part.split(':')[0].trim();
        if (!name) continue;
        seen += 1;
        assert.ok(name in mod, `${path.relative(browserDir, file)} takes ${name} from ${m[2]}, which does not export it`);
      }
    }
  }
  assert.ok(seen >= 20, `only ${seen} imports were read, so the pattern no longer matches`);
});

test('every runner file is valid JavaScript', () => {
  const { spawnSync } = require('node:child_process');
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${path.relative(browserDir, file)}: ${r.stderr}`);
  }
});

test('the runner entry loads only the runner\'s own modules and Node\'s, never a package', () => {
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\('([^']+)'\)/g)) {
      assert.ok(m[1].startsWith('.') || /^(node:)?(fs|os|net|path|child_process)$/.test(m[1]), `${path.relative(browserDir, file)} requires ${m[1]}`);
    }
  }
});
