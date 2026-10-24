const { test } = require('node:test');
const assert = require('node:assert');
const { decide, run, isContractDoc, isDocsTest, baseRef, sectionRanges, changedRanges, touchesReadmeConfig, README_SECTIONS } = require('./docs-pinned-check');
const { read } = require('./helpers/doc-text');

// docs/testing.md asks for a docs test only when a contract doc changes. The CI step runs
// docs-pinned-check.js on a pull request; this file holds its decision to fixtures, with no git.

test('the contract docs are the kanban skill, the apply protocol and the cross-harness note, and nothing else', () => {
  for (const f of ['plugin/skills/kanban/SKILL.md', 'plugin/skills/snapshot/references/apply-protocol.md', 'docs/cross-harness.md']) assert.ok(isContractDoc(f), f);
  for (const f of ['plugin/skills/web/SKILL.md', 'plugin/skills/snapshot/SKILL.md', 'plugin/skills/snapshot/references/board-artifact.md', 'docs/web.md', 'docs/snapshot.md', 'docs/testing.md', 'GLOSSARY.md', 'README.md', 'docs/adr/0001-x.md', 'plugin/skills/kanban/scripts/apply-starter.js']) assert.ok(!isContractDoc(f), f);
});

test('the docs tests are the contract tests, the docs lints, doc-examples and doc-paths', () => {
  for (const f of ['test/web/kanban-skill-contract.test.js', 'test/web/notes-kit-contract.test.js', 'test/snapshot/snapshot-contract.test.js', 'test/web/handles-in-skill-docs.test.js', 'test/web/testing-docs.test.js', 'test/web/doc-examples.test.js', 'test/web/doc-paths.test.js']) assert.ok(isDocsTest(f), f);
  for (const f of ['test/web/groups.test.js', 'test/web/docs-utf8.test.js', 'test/web/browser/x-docs.test.js', 'docs/x-docs.test.js', 'test/web/groups-docs.js', 'test/web/doc-examples.js', 'test/web/helpers/doc-text.js']) assert.ok(!isDocsTest(f), f);
});

test('a changed contract doc with no docs test changed fails and names the doc', () => {
  const r = decide({ changed: ['plugin/skills/kanban/SKILL.md', 'plugin/skills/web/web/app.js'], messages: ['web: a thing'] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.docs, ['plugin/skills/kanban/SKILL.md']);
  assert.match(r.message, /plugin\/skills\/kanban\/SKILL\.md/);
  assert.match(r.message, /docs\/testing\.md/);
  assert.match(r.message, /copies, runs or parses/);
  assert.match(r.message, /Docs-test: none, /);
});

test('each contract doc is held to it, and the message names every one that changed', () => {
  for (const doc of ['plugin/skills/kanban/SKILL.md', 'plugin/skills/snapshot/references/apply-protocol.md', 'docs/cross-harness.md']) {
    assert.strictEqual(decide({ changed: [doc], messages: [] }).ok, false, doc);
  }
  const r = decide({ changed: ['docs/cross-harness.md', 'plugin/skills/kanban/SKILL.md'], messages: [] });
  assert.deepStrictEqual(r.docs, ['docs/cross-harness.md', 'plugin/skills/kanban/SKILL.md']);
  for (const d of r.docs) assert.ok(r.message.includes(d), d);
});

test('prose docs ask for nothing, whatever else changes: the web docs and skills, the glossary, the testing doc, the ADRs', () => {
  for (const doc of ['docs/web.md', 'docs/snapshot.md', 'docs/testing.md', 'plugin/skills/web/SKILL.md', 'plugin/skills/snapshot/SKILL.md', 'GLOSSARY.md', 'docs/adr/0014-x.md']) {
    const r = decide({ changed: [doc, 'plugin/skills/web/web/app.js'], messages: [] });
    assert.strictEqual(r.ok, true, doc);
    assert.deepStrictEqual(r.docs, [], doc);
  }
  assert.strictEqual(decide({ changed: [], messages: [] }).ok, true);
});

test('the README asks for a docs test only when its config.yaml or Starter config section changed', () => {
  assert.strictEqual(decide({ changed: ['README.md'], messages: [], readmeConfig: false }).ok, true);
  assert.strictEqual(decide({ changed: ['README.md'], messages: [] }).ok, true);
  const r = decide({ changed: ['README.md'], messages: [], readmeConfig: true });
  assert.strictEqual(r.ok, false);
  assert.match(r.docs[0], /^README\.md \(config\.yaml and Starter config\)$/);
  assert.strictEqual(decide({ changed: ['README.md', 'test/web/kanban-skill-contract.test.js'], messages: [], readmeConfig: true }).ok, true);
});

test('a docs test changed in the same range lets a contract doc through', () => {
  for (const test of ['test/web/kanban-skill-contract.test.js', 'test/snapshot/snapshot-contract.test.js', 'test/web/doc-examples.test.js', 'test/web/doc-paths.test.js', 'test/web/testing-docs.test.js']) {
    const r = decide({ changed: ['docs/cross-harness.md', test], messages: [] });
    assert.strictEqual(r.ok, true, test);
  }
});

test('a test that is not a docs test does not count', () => {
  const r = decide({ changed: ['docs/cross-harness.md', 'test/web/groups.test.js', 'test/web/docs-utf8.test.js'], messages: [] });
  assert.strictEqual(r.ok, false);
});

test('a commit message line "Docs-test: none, <reason>" is the escape hatch', () => {
  const ok = decide({ changed: ['plugin/skills/kanban/SKILL.md'], messages: ['docs: fix a typo\n\nDocs-test: none, a typo in a sentence no test reads\n'] });
  assert.strictEqual(ok.ok, true);
  assert.match(ok.message, /Docs-test: none/);
  const crlf = decide({ changed: ['docs/cross-harness.md'], messages: ['fix\r\n\r\nDocs-test: none, wording only\r\n'] });
  assert.strictEqual(crlf.ok, true);
  const later = decide({ changed: ['docs/cross-harness.md'], messages: ['one', 'two\n\nDocs-test: none, wording only'] });
  assert.strictEqual(later.ok, true, 'any commit in the range may carry it');
});

test('the placeholder itself is not a reason', () => {
  for (const msg of ['Docs-test: none, <reason>', 'x\n\nDocs-test: none, <reason>  ', 'Docs-test: none, <reason> and more']) {
    const r = decide({ changed: ['docs/cross-harness.md'], messages: [msg] });
    assert.strictEqual(r.ok, msg.endsWith('and more'), msg);
  }
});

test('only the exact line counts: a reason is required, and it is a line of its own', () => {
  for (const msg of [
    'Docs-test: none', 'Docs-test: none,', 'Docs-test: none,   ', 'Docs-test: none ', 'docs-test: none, a typo', 'Docs-test none, a typo',
    'Docs-test: skip, a typo', 'see Docs-test: none, a typo above', '> Docs-test: none, quoted', 'fix\n\nDocs-test: none a typo',
  ]) {
    assert.strictEqual(decide({ changed: ['docs/cross-harness.md'], messages: [msg] }).ok, false, msg);
  }
});

test('the sections of a README are found by their heading, to the next ## heading', () => {
  const text = '# t\n\n## One\n\na\n\n## config.yaml\n\nb\nc\n\n## Two\n\nd\n\n## Starter config\n\ne\n';
  assert.deepStrictEqual(sectionRanges(text, README_SECTIONS), [[7, 11], [16, 19]]);
});

test('a diff touches a section when a hunk lands in it, adds to it, or removes a line from it', () => {
  const text = '# t\n\n## One\n\na\n\n## config.yaml\n\nb\nc\n\n## Two\n\nd\n';
  const hunk = (spec) => `diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ ${spec} @@ context\n`;
  assert.deepStrictEqual(changedRanges(hunk('-5 +5')), [[5, 5]]);
  assert.deepStrictEqual(changedRanges(hunk('-9,2 +9,3')), [[9, 11]]);
  assert.deepStrictEqual(changedRanges(hunk('-9,2 +8,0')), [[8, 9]]);
  assert.strictEqual(touchesReadmeConfig(text, hunk('-5 +5')), false, 'a line of the section before');
  assert.strictEqual(touchesReadmeConfig(text, hunk('-9 +9')), true, 'a line inside');
  assert.strictEqual(touchesReadmeConfig(text, hunk('-7 +7')), true, 'the heading line itself');
  assert.strictEqual(touchesReadmeConfig(text, hunk('-11,1 +10,0')), true, 'a removal at the section\'s end');
  assert.strictEqual(touchesReadmeConfig(text, hunk('-13 +13')), false, 'a line of the section after');
  assert.strictEqual(touchesReadmeConfig(text, hunk('-5 +5') + hunk('-10 +10')), true, 'any of several hunks');
  assert.strictEqual(touchesReadmeConfig(text, ''), false);
});

test('the README the repo has holds both sections the check watches', () => {
  const ranges = sectionRanges(read('README.md'), README_SECTIONS);
  assert.strictEqual(ranges.length, README_SECTIONS.length);
  for (const [from, to] of ranges) assert.ok(to > from + 5, 'the section has a body');
});

test('the base is the pull request base from the environment, or --base, and a push has none', () => {
  assert.strictEqual(baseRef({ GITHUB_BASE_REF: 'main' }, []), 'origin/main');
  assert.strictEqual(baseRef({ GITHUB_BASE_REF: '' }, []), null);
  assert.strictEqual(baseRef({}, []), null);
  assert.strictEqual(baseRef({}, ['--base', 'origin/dev']), 'origin/dev');
  assert.strictEqual(baseRef({ GITHUB_BASE_REF: 'main' }, ['--base', 'origin/dev']), 'origin/dev');
});

function fakeGit(changed, messages, fail, readme) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (fail) throw new Error(fail);
    if (args[0] === 'diff' && args.includes('--name-only')) return `${changed.join('\n')}\n`;
    if (args[0] === 'log') return messages.map((m) => `${m}\0`).join('');
    if (args[0] === 'show' && readme) return readme.text;
    if (args[0] === 'diff' && args.includes('-U0') && readme) return readme.diff;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

test('on a push to main there is no base: it does nothing and runs no git', () => {
  const { git, calls } = fakeGit(['plugin/skills/kanban/SKILL.md'], []);
  const r = run({ env: {}, args: [], git });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(calls, []);
});

test('on a pull request it reads git diff --name-only <base>...HEAD and git log <base>..HEAD', () => {
  const { git, calls } = fakeGit(['docs/cross-harness.md'], ['docs: wording\n\nDocs-test: none, wording only']);
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(calls.map((c) => c.split(' ').slice(0, 3).join(' ')), ['diff --name-only origin/main...HEAD', 'log --format=%B%x00 origin/main..HEAD']);
});

test('on a pull request it exits 1 with the message when a contract doc changed alone', () => {
  const { git } = fakeGit(['docs/cross-harness.md', 'plugin/skills/web/web/app.js'], ['web: a thing']);
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git });
  assert.strictEqual(r.code, 1);
  assert.match(r.message, /docs\/cross-harness\.md/);
});

test('a README change asks for its diff and the file, and passes or fails on the sections it touched', () => {
  const text = '# t\n\n## config.yaml\n\nb\nc\n\n## Two\n\nd\n';
  const hunk = (spec) => `--- a/README.md\n+++ b/README.md\n@@ ${spec} @@\n`;
  const outside = fakeGit(['README.md'], ['readme: wording'], null, { text, diff: hunk('-9 +9') });
  assert.strictEqual(run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git: outside.git }).code, 0);
  assert.ok(outside.calls.includes('show HEAD:README.md'));
  const inside = fakeGit(['README.md'], ['readme: wording'], null, { text, diff: hunk('-5 +5') });
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git: inside.git });
  assert.strictEqual(r.code, 1);
  assert.match(r.message, /README\.md \(config\.yaml and Starter config\)/);
  const none = fakeGit(['docs/web.md'], ['docs: wording']);
  assert.strictEqual(run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git: none.git }).code, 0);
  assert.ok(!none.calls.some((c) => c.startsWith('show')), 'no README read when it did not change');
});

test('a git that cannot answer (a shallow clone) fails the step, with what to do', () => {
  const { git } = fakeGit([], [], 'fatal: no merge base');
  const r = run({ env: { GITHUB_BASE_REF: 'main' }, args: [], git });
  assert.strictEqual(r.code, 2);
  assert.match(r.message, /fetch-depth: 0/);
});
