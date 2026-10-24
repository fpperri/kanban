const { test } = require('node:test');
const assert = require('node:assert');
const { decide, run, isDoc, isDocsTest, baseRef } = require('./docs-pinned-check');

// docs/testing.md asks for a doc and the test that pins it in the same change. The CI step runs
// docs-pinned-check.js on a pull request; this file holds its decision to fixtures, with no git.

test('the docs are docs/*.md, every SKILL.md and the README, and nothing deeper or looser', () => {
  for (const f of ['docs/web.md', 'docs/testing.md', 'docs/snapshot.md', 'plugin/skills/web/SKILL.md', 'plugin/skills/snapshot/SKILL.md', 'plugin/skills/a/b/SKILL.md', 'README.md', 'GLOSSARY.md', 'plugin/skills/web/references/apply-protocol.md', 'plugin/skills/snapshot/references/x.md']) assert.ok(isDoc(f), f);
  for (const f of ['docs/agents/x.md', 'docs/img/a.png', 'plugin/skills/web/README.md', 'plugin/skills/web/web/app.js', 'notes/README.md', 'plugin/skills/web/references/deep/x.md', 'plugin/skills/web/references/x.txt', 'references/x.md', 'test/web/foo-docs.test.js']) assert.ok(!isDoc(f), f);
});

test('the docs tests are test/**/*-docs.test.js and docs-agree.test.js', () => {
  for (const f of ['test/web/groups-docs.test.js', 'test/snapshot/x-docs.test.js', 'test/web/docs-agree.test.js', 'test/snapshot/docs-agree.test.js']) assert.ok(isDocsTest(f), f);
  for (const f of ['test/web/groups.test.js', 'test/web/docs-utf8.test.js', 'test/web/browser/x-docs.test.js', 'docs/x-docs.test.js', 'test/web/groups-docs.js']) assert.ok(!isDocsTest(f), f);
});

test('a changed doc with no docs test changed fails and names the doc', () => {
  const r = decide({ changed: ['docs/web.md', 'plugin/skills/web/web/app.js'], messages: ['web: a thing'] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.docs, ['docs/web.md']);
  assert.match(r.message, /docs\/web\.md/);
  assert.match(r.message, /docs\/testing\.md/);
  assert.match(r.message, /same change/);
  assert.match(r.message, /Docs-test: none, /);
});

test('every kind of doc is held to it, and the message names each changed doc', () => {
  for (const doc of ['docs/web.md', 'docs/snapshot.md', 'plugin/skills/web/SKILL.md', 'plugin/skills/snapshot/SKILL.md', 'README.md']) {
    assert.strictEqual(decide({ changed: [doc], messages: [] }).ok, false, doc);
  }
  const r = decide({ changed: ['README.md', 'docs/web.md', 'plugin/skills/kanban/SKILL.md'], messages: [] });
  assert.deepStrictEqual(r.docs, ['README.md', 'docs/web.md', 'plugin/skills/kanban/SKILL.md']);
  for (const d of r.docs) assert.ok(r.message.includes(d), d);
});

test('the glossary and the skills references are held to it too', () => {
  for (const doc of ['GLOSSARY.md', 'plugin/skills/snapshot/references/apply-protocol.md']) {
    const r = decide({ changed: [doc], messages: [] });
    assert.strictEqual(r.ok, false, doc);
    assert.ok(r.message.includes(doc), doc);
  }
});

test('a docs test changed in the same range lets it through', () => {
  for (const test of ['test/web/groups-docs.test.js', 'test/web/docs-agree.test.js', 'test/snapshot/docs-agree.test.js']) {
    const r = decide({ changed: ['docs/web.md', test], messages: [] });
    assert.strictEqual(r.ok, true, test);
  }
});

test('a change that touches no doc has nothing to check, whatever else it changes', () => {
  const r = decide({ changed: ['plugin/skills/web/web/app.js', 'test/web/foo.test.js', 'docs/img/a.png', 'docs/agents/x.md'], messages: [] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.docs, []);
  assert.strictEqual(decide({ changed: [], messages: [] }).ok, true);
});

test('a docs test that is not a docs test does not count', () => {
  const r = decide({ changed: ['docs/web.md', 'test/web/groups.test.js', 'test/web/docs-utf8.test.js'], messages: [] });
  assert.strictEqual(r.ok, false);
});

test('a commit message line "Docs-test: none, <reason>" is the escape hatch', () => {
  const ok = decide({ changed: ['docs/web.md'], messages: ['docs: fix a typo\n\nDocs-test: none, a typo in a sentence no test reads\n'] });
  assert.strictEqual(ok.ok, true);
  assert.match(ok.message, /Docs-test: none/);
  const crlf = decide({ changed: ['README.md'], messages: ['fix\r\n\r\nDocs-test: none, wording only\r\n'] });
  assert.strictEqual(crlf.ok, true);
  const later = decide({ changed: ['README.md'], messages: ['one', 'two\n\nDocs-test: none, wording only'] });
  assert.strictEqual(later.ok, true, 'any commit in the range may carry it');
});

test('the placeholder itself is not a reason', () => {
  for (const msg of ['Docs-test: none, <reason>', 'x\n\nDocs-test: none, <reason>  ', 'Docs-test: none, <reason> and more']) {
    const r = decide({ changed: ['docs/web.md'], messages: [msg] });
    assert.strictEqual(r.ok, msg.endsWith('and more'), msg);
  }
});

test('only the exact line counts: a reason is required, and it is a line of its own', () => {
  for (const msg of [
    'Docs-test: none', 'Docs-test: none,', 'Docs-test: none,   ', 'Docs-test: none ', 'docs-test: none, a typo', 'Docs-test none, a typo',
    'Docs-test: skip, a typo', 'see Docs-test: none, a typo above', '> Docs-test: none, quoted', 'fix\n\nDocs-test: none a typo',
  ]) {
    assert.strictEqual(decide({ changed: ['docs/web.md'], messages: [msg] }).ok, false, msg);
  }
});

test('the base is the pull request base from the environment, or --base, and a push has none', () => {
  assert.strictEqual(baseRef({ GITHUB_BASE_REF: 'main' }, []), 'origin/main');
  assert.strictEqual(baseRef({ GITHUB_BASE_REF: '' }, []), null);
  assert.strictEqual(baseRef({}, []), null);
  assert.strictEqual(baseRef({}, ['--base', 'origin/dev']), 'origin/dev');
  assert.strictEqual(baseRef({ GITHUB_BASE_REF: 'main' }, ['--base', 'origin/dev']), 'origin/dev');
});

function fakeGit(changed, messages, fail) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (fail) throw new Error(fail);
    if (args[0] === 'diff') return `${changed.join('\n')}\n`;
    if (args[0] === 'log') return messages.map((m) => `${m}\0`).join('');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

test('on a push to main there is no base: it does nothing and runs no git', () => {
  const { git, calls } = fakeGit(['docs/web.md'], []);
  const r = run({ env: {}, args: [], git });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(calls, []);
});

test('on a pull request it reads git diff --name-only <base>...HEAD and git log <base>..HEAD', () => {
  const { git, calls } = fakeGit(['docs/web.md'], ['docs: wording\n\nDocs-test: none, wording only']);
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(calls.map((c) => c.split(' ').slice(0, 3).join(' ')), ['diff --name-only origin/main...HEAD', 'log --format=%B%x00 origin/main..HEAD']);
});

test('on a pull request it exits 1 with the message when a doc changed alone', () => {
  const { git } = fakeGit(['README.md', 'plugin/skills/web/web/app.js'], ['web: a thing']);
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git });
  assert.strictEqual(r.code, 1);
  assert.match(r.message, /README\.md/);
});

test('a git that cannot answer (a shallow clone) fails the step, with what to do', () => {
  const { git } = fakeGit([], [], 'fatal: no merge base');
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git });
  assert.strictEqual(r.code, 2);
  assert.match(r.message, /fetch-depth: 0/);
});
