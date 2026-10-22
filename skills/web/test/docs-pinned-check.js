'use strict';
// CI step for a pull request: a change to a doc brings the test that pins it.
//
// docs/testing.md asks for the doc and its test in the same change. A pull request that changes
// docs/*.md, a SKILL.md, a skill's references/*.md, the README or GLOSSARY.md and changes no
// skills/**/test/*-docs.test.js (or docs-agree.test.js) fails here. A typo fix says so with a line in one of its commit messages:
//
//   Docs-test: none, <reason>
//
// On a push to main there is no pull request base, so it does nothing. Pure apart from reading
// `git diff --name-only <base>...HEAD` and `git log <base>..HEAD`; `decide` takes plain lists.
//
//   node skills/web/test/docs-pinned-check.js [--base <ref>]
//
// The base is --base, or origin/$GITHUB_BASE_REF, which GitHub sets on a pull request. Exit 0 when
// the change passes or there is nothing to check, 1 when a doc changed alone, 2 when git cannot
// answer (a shallow clone: check out with fetch-depth: 0).

const DOCS = [/^docs\/[^/]+\.md$/, /^skills\/(?:.+\/)?SKILL\.md$/, /^skills\/(?:.+\/)?references\/[^/]+\.md$/, /^README\.md$/, /^GLOSSARY\.md$/];
const DOCS_TESTS = [/^skills\/(?:.+\/)?test\/[^/]+-docs\.test\.js$/, /^skills\/(?:.+\/)?test\/docs-agree\.test\.js$/];
const ESCAPE = /^Docs-test: none, (\S.*)$/;

const isDoc = (file) => DOCS.some((re) => re.test(file));
const isDocsTest = (file) => DOCS_TESTS.some((re) => re.test(file));

function decide({ changed, messages }) {
  const docs = changed.filter(isDoc);
  if (!docs.length) return { ok: true, docs, message: 'no doc changed; nothing to pin' };
  const tests = changed.filter(isDocsTest);
  if (tests.length) return { ok: true, docs, message: `docs changed (${docs.join(', ')}) with ${tests.join(', ')}` };
  const hatch = messages.join('\n').replace(/\r/g, '').split('\n').map((l) => ESCAPE.exec(l.trimEnd())).find((m) => m && m[1] !== '<reason>');
  if (hatch) return { ok: true, docs, message: `docs changed (${docs.join(', ')}) with no docs test; the commit says ${hatch[0]}` };
  return {
    ok: false,
    docs,
    message: [
      `This change edits ${docs.join(', ')} and changes no skills/**/test/*-docs.test.js or docs-agree.test.js.`,
      'docs/testing.md asks for the doc and its test in the same change: add or extend the test that pins the words you changed.',
      'For a typo fix, put a line "Docs-test: none, <reason>" in one of the commit messages of this change.',
    ].join('\n'),
  };
}

function baseRef(env, args) {
  const i = args.indexOf('--base');
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : null;
}

function run({ env, args, git }) {
  const base = baseRef(env, args);
  if (!base) return { code: 0, message: 'no pull request base (a push); nothing to check' };
  let changed;
  let messages;
  try {
    changed = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').map((l) => l.trim()).filter(Boolean);
    messages = git(['log', '--format=%B%x00', `${base}..HEAD`]).split('\0').map((m) => m.trim()).filter(Boolean);
  } catch (e) {
    return { code: 2, message: `git could not diff against ${base}: ${e.message}\nCheck out with fetch-depth: 0 so the base is there.` };
  }
  const r = decide({ changed, messages });
  return { code: r.ok ? 0 : 1, message: r.message };
}

module.exports = { decide, run, isDoc, isDocsTest, baseRef };

if (require.main === module) {
  const { execFileSync } = require('node:child_process');
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const r = run({ env: process.env, args: process.argv.slice(2), git });
  (r.code ? console.error : console.log)(r.message);
  process.exit(r.code);
}
