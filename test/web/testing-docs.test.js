const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// docs/testing.md names the npm scripts and the files a test author is sent to. The scripts
// it lists are package.json's, and the files it names exist.

const ROOT = path.join(__dirname, '..', '..', '..');
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'testing.md'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('the testing doc names every npm test script, and only scripts that exist', () => {
  for (const name of Object.keys(pkg.scripts).filter((n) => n === 'test' || n.startsWith('test:'))) {
    const cmd = name === 'test' ? 'npm test' : `npm run ${name}`;
    assert.ok(doc.includes(`\`${cmd}\``), `${cmd} is in the testing doc`);
  }
  for (const m of doc.matchAll(/`npm run (test:[\w-]+)/g)) assert.ok(pkg.scripts[m[1]], `${m[1]} is a script in package.json`);
});

test('test:unit leaves the launcher test out and test:launcher runs it alone', () => {
  assert.match(pkg.scripts['test:unit'], /!\(launcher\)/);
  assert.match(pkg.scripts['test:unit'], /skills\/snapshot\/test/);
  assert.strictEqual(pkg.scripts['test:launcher'], 'node --test skills/web/test/launcher.test.js');
});

test('test:ci runs what the workflow runs, in order', () => {
  const steps = pkg.scripts['test:ci'].split(' && ');
  assert.deepStrictEqual(steps, [
    'npm test', 'npm run test:browser', 'npm run test:browser -- --reverse',
    'npm run test:browser -- --only smoke --plugin older', 'node skills/web/test/browser/fault-check.js',
  ]);
});

test('every file the testing doc points at exists', () => {
  const paths = [...doc.matchAll(/`((?:skills|docs)\/[\w./<>-]+\.(?:js|md|py))`/g)].map((m) => m[1]).filter((p) => !p.includes('<'));
  assert.ok(paths.length >= 8, 'the doc points at files');
  for (const p of paths) assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} exists`);
});

test('the testing doc states the docs rule, the CI step that holds it and the escape hatch', () => {
  assert.match(doc, /## A docs change brings its docs test/);
  for (const name of ['`skills/web/test/docs-pinned-check.js`', '`docs/*.md`', '`SKILL.md`', '`README.md`', '`GLOSSARY.md`', '`skills/**/references/*.md`', '`skills/**/test/*-docs.test.js`', '`docs-agree.test.js`', 'Docs-test: none, <reason>']) {
    assert.ok(doc.includes(name), `${name} is in the testing doc`);
  }
  assert.match(doc, /push to `main`[^.]*does nothing/);
  assert.match(doc, /placeholder `<reason>`[^.]*does not count/);
});

test('the testing doc says how to add a step to the phone and phone-flip scenarios', () => {
  for (const name of ['phone-steps/', 'phone-flip-steps/', '`run(page)`', 'skills/web/test/browser/steps.js', '`tap`', '`swipe`', '`pinch`', 'PAGE_GLOBALS']) {
    assert.ok(doc.includes(name), `${name} is in the testing doc`);
  }
  assert.match(doc, /clean page/);
  assert.match(doc, /puts back any card/);
});

test('the testing doc says which waits the CPU throttle lengthens, and how to turn it off', () => {
  for (const name of ['KANBAN_BROWSER_CPU_THROTTLE', '`page.scaled(ms)`', '`page.sleep`', 'DevTools call timeout', 'watchdog', 'wait for a board server', '`CI` environment variable', 'first line of a run']) {
    assert.ok(doc.includes(name), `${name} is in the testing doc`);
  }
  assert.match(doc, /Nothing registers it/);
});
