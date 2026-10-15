const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The test workflow runs the browser runner as a job of its own beside the unit
// job, on the Ubuntu runner's Chrome, so a pull request is guarded by it and a
// Chrome problem never hides a unit failure. There is no YAML reader in this
// repository, so the workflow is read as the text it is, one job at a time.

const root = path.join(__dirname, '..', '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// The text of each job under `jobs:`, by name.
function jobs(text) {
  const after = text.slice(text.indexOf('\njobs:\n') + 6);
  const out = {};
  let name = null;
  for (const line of after.split('\n')) {
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) { name = head[1]; out[name] = ''; } else if (name) out[name] += `${line}\n`;
  }
  return out;
}
const J = jobs(workflow);

// The unit job as it was before the browser job joined it.
const UNIT_JOB = `    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: npm test
`;

test('the workflow has a unit job and a browser job, side by side', () => {
  assert.deepStrictEqual(Object.keys(J), ['test', 'browser']);
});

test('the unit job is unchanged: Node, Python and npm test, and nothing about the browser', () => {
  assert.strictEqual(J.test.replace(/\n+$/, '\n'), UNIT_JOB);
  assert.ok(!/browser/.test(pkg.scripts.test), 'npm test must not run the browser runner');
  assert.strictEqual(pkg.scripts['test:browser'], 'node skills/web/test/browser/run.js');
});

test('the two jobs do not wait on each other, so a Chrome problem never hides a unit failure', () => {
  assert.ok(!/\bneeds:/.test(J.test));
  assert.ok(!/\bneeds:/.test(J.browser));
});

test('the browser job runs on Ubuntu with Node only: checkout and Node 22, no Python', () => {
  assert.match(J.browser, /runs-on: ubuntu-latest/);
  assert.match(J.browser, /actions\/checkout@v4/);
  assert.match(J.browser, /actions\/setup-node@v4\s+with:\s+node-version: 22/);
  assert.ok(!/setup-python/.test(J.browser));
});

test('the browser job has a time limit of about ten minutes', () => {
  const m = /timeout-minutes: (\d+)/.exec(J.browser);
  assert.ok(m, 'no timeout-minutes');
  assert.ok(Number(m[1]) >= 5 && Number(m[1]) <= 15, `timeout-minutes is ${m[1]}`);
});

test('the browser job sets the sandbox switch the runner reads', () => {
  assert.match(J.browser, /KANBAN_BROWSER_NO_SANDBOX: ['"]1['"]/);
});

test('the browser job runs the scenarios, then in reverse order, then the smoke scenario on the plugin of main, then the fault check', () => {
  const runs = [...J.browser.matchAll(/^\s+- run: (.+)$/gm)].map((m) => m[1]);
  assert.strictEqual(runs.length, 4, runs.join(' | '));
  assert.match(runs[0], /^npm run test:browser -- --shots \S+$/);
  assert.match(runs[1], /^npm run test:browser -- --reverse --shots \S+$/);
  assert.match(runs[2], /^npm run test:browser -- --only smoke --plugin older --shots \S+$/);
  assert.strictEqual(runs[3], 'node skills/web/test/browser/fault-check.js');
  const folders = [runs[0], runs[1], runs[2]].map((r) => r.split('--shots ')[1]);
  assert.strictEqual(new Set(folders).size, 3, 'two runs share a screenshots folder');
});

test('the older plugin is main checked out beside this one, before the run that serves it', () => {
  const older = /- uses: actions\/checkout@v4\s+with:\s+ref: main\s+path: older\s/.exec(J.browser);
  assert.ok(older, 'no checkout of main into older');
  assert.ok(older.index < J.browser.indexOf('--plugin older'), 'the run comes before the checkout');
  assert.strictEqual(J.browser.split('actions/checkout@v4').length - 1, 2, 'this checkout and the one of main');
});

test('the browser job uploads its screenshots when a step fails and when the job hits its time limit, which cancels it', () => {
  assert.match(J.browser, /- if: failure\(\) \|\| cancelled\(\)\s+uses: actions\/upload-artifact@v4/);
  const folders = [...J.browser.matchAll(/--shots (\S+)/g)].map((m) => m[1]);
  for (const f of folders) assert.ok(new RegExp(`^\\s+${f}$`, 'm').test(J.browser), `${f} is not uploaded`);
});

test('a missing browser fails the job, because the runner exits 2 and no step ignores the exit code', () => {
  assert.ok(!/continue-on-error/.test(J.browser));
  assert.ok(!/\|\| true/.test(J.browser));
});

test('the workflow still runs on pushes to main and on pull requests', () => {
  assert.match(workflow, /on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/);
});
