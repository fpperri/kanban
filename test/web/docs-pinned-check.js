'use strict';
// CI step for a pull request: a change to a contract doc brings the test that pins it.
//
// docs/testing.md gives a doc a pinning test only for what a person, a tool or an agent copies, runs
// or parses. The docs that carry such facts are the contract docs: the kanban skill's SKILL.md (card
// and config file formats, commands), the snapshot's references/apply-protocol.md (the payload),
// docs/cross-harness.md (the modules the generator needs) and the README's config.yaml and Starter
// config sections. A pull request that changes one of them and changes no docs test fails here. A
// typo fix says so with a line in one of its commit messages:
//
//   Docs-test: none, <reason>
//
// Any other doc (docs/web.md, the web skill, the glossary, the rest of the README) is prose about the
// app, which the behaviour tests and the browser scenarios hold: changing it asks for nothing. On a
// push to main there is no pull request base, so the step does nothing. Pure apart from reading
// `git diff --name-only --diff-filter=d <base>...HEAD` (a deleted file pins nothing), `git log <base>..HEAD` and, when README.md changed, its diff;
// `decide` takes plain lists.
//
//   node test/web/docs-pinned-check.js [--base <ref>]
//
// The base is --base, or origin/$GITHUB_BASE_REF, which GitHub sets on a pull request. Exit 0 when
// the change passes or there is nothing to check, 1 when a contract doc changed alone, 2 when git
// cannot answer (a shallow clone: check out with fetch-depth: 0).

const CONTRACT_DOCS = [/^plugin\/skills\/kanban\/SKILL\.md$/, /^plugin\/skills\/snapshot\/references\/apply-protocol\.md$/, /^docs\/cross-harness\.md$/];
const README = 'README.md';
const README_SECTIONS = ['## config.yaml', '## Starter config'];
const DOCS_TESTS = [
  /^test\/(?:web|snapshot)\/[^/]+-(?:docs|contract)\.test\.js$/,
  /^test\/web\/doc-(?:examples|paths)\.test\.js$/,
];
const ESCAPE = /^Docs-test: none, (\S.*)$/;

const isContractDoc = (file) => CONTRACT_DOCS.some((re) => re.test(file));
const isDocsTest = (file) => DOCS_TESTS.some((re) => re.test(file));

// The 1-based [first, last] lines of each section of `text` that opens with one of the headings and
// runs to the line before the next `## ` heading.
function sectionRanges(text, headings) {
  const lines = text.split('\n');
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (!headings.some((h) => lines[i].trimEnd() === h)) continue;
    let end = i + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) end++;
    ranges.push([i + 1, end]);
  }
  return ranges;
}

// The lines of the new file a `git diff -U0` touched: [first, last] for each hunk. A hunk that only
// removes lines touches the line before the gap and the line after it.
function changedRanges(diff) {
  const out = [];
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    out.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
  }
  return out;
}

// Whether a diff of the README touches one of the sections the contract tests read.
function touchesReadmeConfig(text, diff) {
  const sections = sectionRanges(text, README_SECTIONS);
  return changedRanges(diff).some(([a, b]) => sections.some(([from, to]) => a <= to && b >= from));
}

function decide({ changed, messages, readmeConfig }) {
  const docs = changed.filter(isContractDoc);
  if (changed.includes(README) && readmeConfig) docs.push(`${README} (${README_SECTIONS.map((h) => h.slice(3)).join(' and ')})`);
  if (!docs.length) return { ok: true, docs, message: 'no contract doc changed; nothing to pin' };
  const tests = changed.filter(isDocsTest);
  if (tests.length) return { ok: true, docs, message: `contract docs changed (${docs.join(', ')}) with ${tests.join(', ')}` };
  const hatch = messages.join('\n').replace(/\r/g, '').split('\n').map((l) => ESCAPE.exec(l.trimEnd())).find((m) => m && m[1] !== '<reason>');
  if (hatch) return { ok: true, docs, message: `contract docs changed (${docs.join(', ')}) with no docs test; the commit says ${hatch[0]}` };
  return {
    ok: false,
    docs,
    message: [
      `This change edits ${docs.join(', ')} and changes no docs test (test/**/*-contract.test.js, *-docs.test.js, doc-examples.test.js or doc-paths.test.js).`,
      'docs/testing.md asks for a test of what a person, a tool or an agent copies, runs or parses: add or extend the test that holds the fact you changed to the code.',
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
  let readmeConfig = false;
  try {
    changed = git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`]).split('\n').map((l) => l.trim()).filter(Boolean);
    messages = git(['log', '--format=%B%x00', `${base}..HEAD`]).split('\0').map((m) => m.trim()).filter(Boolean);
    if (changed.includes(README)) {
      readmeConfig = touchesReadmeConfig(git(['show', `HEAD:${README}`]).replace(/\r\n/g, '\n'), git(['diff', '-U0', `${base}...HEAD`, '--', README]));
    }
  } catch (e) {
    return { code: 2, message: `git could not diff against ${base}: ${e.message}\nCheck out with fetch-depth: 0 so the base is there.` };
  }
  const r = decide({ changed, messages, readmeConfig });
  return { code: r.ok ? 0 : 1, message: r.message };
}

module.exports = { decide, run, isContractDoc, isDocsTest, baseRef, sectionRanges, changedRanges, touchesReadmeConfig, README_SECTIONS };

if (require.main === module) {
  const { execFileSync } = require('node:child_process');
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const r = run({ env: process.env, args: process.argv.slice(2), git });
  (r.code ? console.error : console.log)(r.message);
  process.exit(r.code);
}
