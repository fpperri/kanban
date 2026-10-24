const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./helpers/doc-text');
const { decide, isDocsTest } = require('./docs-pinned-check');
const { createServer } = require('../../plugin/skills/web/scripts/server');
const steps = require('./browser/steps');

// docs/testing.md names the npm scripts, the runner's flags and variables, the helpers a scenario
// calls and the files a test author is sent to. What it names is what the code has.

const doc = read('docs', 'testing.md');
const pkg = JSON.parse(read('package.json'));
const runner = read('test', 'web', 'browser', 'run.js');
const harness = read('test', 'web', 'browser', 'harness.js');
const cdp = read('test', 'web', 'browser', 'cdp.js');

test('the testing doc names every npm test script, and only scripts that exist', () => {
  for (const name of Object.keys(pkg.scripts).filter((n) => n === 'test' || n.startsWith('test:'))) {
    const cmd = name === 'test' ? 'npm test' : `npm run ${name}`;
    assert.ok(doc.includes(`\`${cmd}\``), `${cmd} is in the testing doc`);
  }
  for (const m of doc.matchAll(/`npm run (test:[\w-]+)/g)) assert.ok(pkg.scripts[m[1]], `${m[1]} is a script in package.json`);
});

test('test:unit leaves the launcher test out and test:launcher runs it alone', () => {
  assert.match(pkg.scripts['test:unit'], /!\(launcher\)/);
  assert.match(pkg.scripts['test:unit'], /test\/snapshot/);
  assert.strictEqual(pkg.scripts['test:launcher'], 'node --test test/web/launcher.test.js');
});

test('test:ci runs what the workflow runs, in order', () => {
  const steps = pkg.scripts['test:ci'].split(' && ');
  assert.deepStrictEqual(steps, [
    'npm test', 'npm run test:browser', 'npm run test:browser -- --reverse',
    'npm run test:browser -- --only smoke --plugin older', 'node test/web/browser/fault-check.js',
  ]);
  const workflow = read('.github', 'workflows', 'test.yml');
  for (const step of ['npm test', 'node test/web/docs-pinned-check.js', 'npm run test:browser -- --reverse', 'node test/web/browser/fault-check.js']) assert.ok(workflow.includes(step), `the workflow runs ${step}`);
});

test('the escape hatch the testing doc shows lets a contract doc through once it has a reason, and the placeholder does not', () => {
  const line = /^(Docs-test: none, <reason>)$/m.exec(doc);
  assert.ok(line, 'the doc shows the line');
  const changed = ['plugin/skills/kanban/SKILL.md'];
  assert.strictEqual(decide({ changed, messages: [line[1]] }).ok, false, 'the placeholder is not a reason');
  assert.strictEqual(decide({ changed, messages: [line[1].replace('<reason>', 'a typo')] }).ok, true);
});

test('the docs tests the testing doc lists are docs tests the check counts, and each exists', () => {
  const listed = [...doc.matchAll(/`(test\/(?:web|snapshot)\/[\w-]+\.test\.js)`/g)].map((m) => m[1]).filter((p) => isDocsTest(p));
  assert.ok(listed.length >= 6, 'the doc lists the docs tests');
  for (const file of listed) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
  for (const file of fs.readdirSync(path.join(ROOT, 'test', 'web')).filter((f) => /-contract\.test\.js$|^doc-(examples|paths)\.test\.js$/.test(f))) {
    assert.ok(doc.includes(`test/web/${file}`), `test/web/${file} is in the testing doc`);
  }
  for (const file of fs.readdirSync(path.join(ROOT, 'test', 'snapshot')).filter((f) => /-contract\.test\.js$/.test(f))) {
    assert.ok(doc.includes(`test/snapshot/${file}`), `test/snapshot/${file} is in the testing doc`);
  }
});

test('the runner takes the flags the testing doc names, and reads the variables it names', () => {
  const flags = [...(/The browser runner takes ([^\n]*)/.exec(doc) || ['', ''])[1].matchAll(/`(--[\w-]+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(flags, ['--only', '--reverse', '--list', '--shots', '--plugin']);
  for (const flag of flags) assert.ok(runner.includes(flag), `run.js knows ${flag}`);
  for (const name of ['KANBAN_BROWSER_CPU_THROTTLE', 'CI']) {
    assert.ok(doc.includes(name), `the doc names ${name}`);
    assert.ok(harness.includes(name === 'CI' ? 'env.CI' : name), `harness.js reads ${name}`);
  }
});

test('the waits a scenario calls, which the testing doc says the throttle lengthens, are the ones the page object has', () => {
  for (const name of ['scaled', 'sleep', 'waitFor', 'waitUntil']) {
    assert.ok(doc.includes(`page.${name}`), `the doc names page.${name}`);
    assert.match(cdp, new RegExp(`\\b${name}\\b`), `cdp.js has ${name}`);
  }
});

test('a phone step is a file that exports run, in the folders the testing doc names, and steps.js gives the touch helpers it names', () => {
  for (const dir of ['phone-steps', 'phone-flip-steps']) {
    assert.ok(doc.includes(`${dir}/`), `the doc names ${dir}/`);
    const files = fs.readdirSync(path.join(ROOT, 'test', 'web', 'browser', 'scenarios', dir)).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0);
    for (const file of files) assert.strictEqual(typeof require(`./browser/scenarios/${dir}/${file}`).run, 'function', `${dir}/${file} exports run`);
  }
  for (const name of ['tap', 'swipe', 'pinch']) {
    assert.ok(doc.includes(`\`${name}\``), `the doc names ${name}`);
    assert.strictEqual(typeof steps[name], 'function', `steps.js exports ${name}`);
  }
  assert.ok(read('test', 'web', 'browser-globals.test.js').includes('const PAGE_GLOBALS'), 'PAGE_GLOBALS is declared where the doc says');
});

test('the server tests the doc points at start the real server in-process: createServer is exported, and the model test uses it', () => {
  assert.strictEqual(typeof createServer, 'function');
  assert.ok(doc.includes('createServer(dir)') && doc.includes('test/web/delete-server.test.js'));
  assert.match(read('test', 'web', 'delete-server.test.js'), /createServer\(/);
});
