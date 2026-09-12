const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- Assignee handles must be code spans in anything the harness loads ------
//
// `@handle` shares a namespace with the harness's own import syntax: in a file
// Claude Code auto-loads, `@path` is expanded into context, and it does so in
// prose as readily as in data — anywhere outside a code span or a fenced block.
//
// A handle that matches nothing fails safe and loads verbatim, with no error
// and no warning. That is the whole reason this is easy to miss: today
// `@human`, `@hitl` and `@afk` match no file, so nothing happens. **That is
// safety by non-collision, not safety by rule** — the day something in an
// import root is named to collide, a skill doc silently grows an import.
//
// Board files are NOT auto-loaded, so handles in cards, in the assignees
// registry and in notifications are inert and stay as they are. SKILL.md is a
// different case: the harness loads it. So in these files only, a handle is
// written as a code span — which is also already this documentation's own
// convention, and these tests simply stop it drifting.
//
// Deliberately not asserted: whether YAML double-quoting protects a handle
// from expansion. It is untested upstream, and writing a rule that assumes
// quoting is safe would be inventing a guarantee nobody has measured.

const skillsDir = path.join(__dirname, '..', '..');
const SKILL_DOCS = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(skillsDir, e.name, 'SKILL.md'))
  .filter((p) => fs.existsSync(p));

// Strip fenced blocks first, then inline spans: a handle inside either is
// already protected, and stripping in that order avoids a fence's own
// backticks being read as a span delimiter.
function prose(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

// Not preceded by a word character, a backtick or a slash — so an email
// address and an already-spanned handle are both excluded.
const BARE_HANDLE = /(?<![\w`/])@[A-Za-z][\w./-]*/g;

test('every skill doc that exists is actually being scanned', () => {
  assert.ok(SKILL_DOCS.length >= 3, `expected at least three SKILL.md files, found ${SKILL_DOCS.length}`);
});

test('no SKILL.md carries a bare @handle outside a code span', () => {
  const offenders = [];
  for (const file of SKILL_DOCS) {
    const rel = path.relative(skillsDir, file).split(path.sep).join('/');
    const found = prose(fs.readFileSync(file, 'utf8')).match(BARE_HANDLE);
    if (found) offenders.push(rel + ': ' + [...new Set(found)].join(', '));
  }
  assert.deepStrictEqual(offenders, [], 'bare handles in harness-loaded docs: ' + offenders.join(' | '));
});

// The role trio is documented in these files on purpose; this pins that they
// are still present AND still spanned, so a future edit cannot "fix" the test
// above by deleting the documentation instead of the bare handle.
test('the role trio is still documented, as code spans', () => {
  const all = SKILL_DOCS.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const h of ['@human', '@hitl', '@afk']) {
    assert.ok(all.includes('`' + h + '`'), `${h} is no longer documented as a code span in any skill doc`);
  }
});
