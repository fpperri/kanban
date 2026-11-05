const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The test workflow runs the browser runner as a job of its own beside the unit
// job, on the Ubuntu runner's Chrome, so a pull request is guarded by it and a
// Chrome problem never hides a unit failure. There is no YAML reader in this
// repository, so the workflow is read as the text it is, one job at a time.

const root = path.join(__dirname, '..', '..');
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

// The unit job as it was before the browser job joined it, with the full-history checkout and the docs check
// that follow it.
const UNIT_JOB = `    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5
        with:
          python-version: '3.11'
      - run: npm test
      - if: \${{ !cancelled() }}
        run: node test/web/docs-pinned-check.js
`;

test('the workflow has a unit job and a browser job, side by side', () => {
  assert.deepStrictEqual(Object.keys(J), ['test', 'browser']);
});

test('the unit job is Node, Python, npm test and the docs check, and nothing about the browser', () => {
  assert.strictEqual(J.test.replace(/\n+$/, '\n'), UNIT_JOB);
  assert.ok(!/browser/.test(pkg.scripts.test), 'npm test must not run the browser runner');
  assert.strictEqual(pkg.scripts['test:browser'], 'node test/web/browser/run.js');
});

test('the two jobs do not wait on each other, so a Chrome problem never hides a unit failure', () => {
  assert.ok(!/\bneeds:/.test(J.test));
  assert.ok(!/\bneeds:/.test(J.browser));
});

test('the browser job runs on Ubuntu with Node only: checkout and Node 22, no Python', () => {
  assert.match(J.browser, /runs-on: ubuntu-latest/);
  assert.match(J.browser, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4/);
  assert.match(J.browser, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\s+with:\s+node-version: 22/);
  assert.ok(!/setup-python/.test(J.browser));
});

// The job runs every scenario twice (about 290 s a pass on the runner), the older-plugin smoke run and the fault check.
test('the browser job has a time limit that holds two full passes with room to spare, and not more than a quarter of an hour', () => {
  const m = /timeout-minutes: (\d+)/.exec(J.browser);
  assert.ok(m, 'no timeout-minutes');
  assert.ok(Number(m[1]) >= 12 && Number(m[1]) <= 15, `timeout-minutes is ${m[1]}`);
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
  assert.strictEqual(runs[3], 'node test/web/browser/fault-check.js');
  const folders = [runs[0], runs[1], runs[2]].map((r) => r.split('--shots ')[1]);
  assert.strictEqual(new Set(folders).size, 3, 'two runs share a screenshots folder');
});

test('the older plugin is main checked out beside this one, before the run that serves it', () => {
  const older = /- uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\s+with:\s+ref: main\s+path: older\s/.exec(J.browser);
  assert.ok(older, 'no checkout of main into older');
  assert.ok(older.index < J.browser.indexOf('--plugin older'), 'the run comes before the checkout');
  assert.strictEqual(J.browser.split('actions/checkout@11d5960a326750d5838078e36cf38b85af677262').length - 1, 2, 'this checkout and the one of main');
});

test('the browser job uploads its screenshots when a step fails and when the job hits its time limit, which cancels it', () => {
  assert.match(J.browser, /- if: failure\(\) \|\| cancelled\(\)\s+uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4/);
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

test('every action is pinned to the full commit of the tag it used, with the tag named in a comment', () => {
  const uses = [...workflow.matchAll(/uses: (\S+)(.*)$/gm)];
  assert.strictEqual(uses.length, 7);
  for (const [, ref, comment] of uses) {
    assert.match(ref, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${ref} is not pinned to a commit`);
    assert.match(comment, /^ # v\d+$/, `${ref} does not name its tag`);
  }
});
