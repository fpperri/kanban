const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Notification layout (kanban.proj #274 goal 6): splitNotification()/
// splitClauses() contain regex with backslashes, so — same reasoning as
// markdown-body.test.js — this builds a tiny fixture board once and
// extracts every function it needs from the GENERATED HTML, where Python
// has already un-escaped the doubled backslashes build_editor.py's
// (non-raw) TEMPLATE string carries in source. See markdown-body.test.js
// for the full rationale.

const buildScript = path.join(__dirname, '..', 'scripts', 'build_editor.py');

let tmpDir, html;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-notif-test-'));
  fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'name: Fixture Board\n');
  fs.writeFileSync(path.join(tmpDir, '0001.card.card.md'), '---\nid: 1\nstatus: todo\n---\n# Card\nbody\n');
  fs.writeFileSync(path.join(tmpDir, 'notifications.md'), '');
  const outHtml = path.join(tmpDir, 'out.html');
  execFileSync('python', [buildScript, tmpDir, '--out', outHtml], { encoding: 'utf8' });
  html = fs.readFileSync(outHtml, 'utf8');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in the built HTML`);
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < html.length && html[i] !== q) {
        if (html[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}
function extractConst(name) {
  const marker = `const ${name}=`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in the built HTML`);
  const end = html.indexOf('\n', start);
  return html.slice(start, end);
}

let nf;
before(() => {
  const harness = [
    extractConst('ABBREVIATIONS'),
    extractFunction('firstSentenceEnd'),
    extractFunction('splitNotification'),
    extractFunction('splitClauses'),
    'module.exports = { splitNotification, splitClauses };',
  ].join('\n');
  nf = new Function('module', 'exports', harness + '\nreturn module.exports;')({ exports: {} }, {});
});

// --- splitNotification: "; more: " (the intended contract) -----------------

test('splitNotification: "; more: " splits cleanly, TLDR excludes the separator', () => {
  const r = nf.splitNotification('applied the fix; more: touched card-store.js and app.js');
  assert.strictEqual(r.tldr, 'applied the fix');
  assert.strictEqual(r.more, 'touched card-store.js and app.js');
});

// --- splitNotification: ". more: " (the real-world mistake) ----------------

test('splitNotification: ". more: " (no semicolon) falls back to first-sentence + a stripped "more:" label', () => {
  const r = nf.splitNotification('applied the fix. more: touched card-store.js and app.js');
  assert.strictEqual(r.tldr, 'applied the fix.');
  assert.strictEqual(r.more, 'touched card-store.js and app.js');
});

test('splitNotification: "more:" label stripping is case-insensitive and eats following whitespace', () => {
  const r = nf.splitNotification('Did the thing. MORE:    lots of detail here');
  assert.strictEqual(r.tldr, 'Did the thing.');
  assert.strictEqual(r.more, 'lots of detail here');
});

// --- splitNotification: no separator at all ---------------------------------

test('splitNotification: no separator, a real sentence boundary exists — splits there, more has no "more:" label to strip', () => {
  const r = nf.splitNotification('First sentence here. Second sentence continues on.');
  assert.strictEqual(r.tldr, 'First sentence here.');
  assert.strictEqual(r.more, 'Second sentence continues on.');
});

test('splitNotification: no separator and no terminal punctuation — the whole message is TLDR', () => {
  const r = nf.splitNotification('no terminal punctuation in this message at all');
  assert.strictEqual(r.tldr, 'no terminal punctuation in this message at all');
  assert.strictEqual(r.more, '');
});

test('splitNotification: an empty/null message never throws', () => {
  assert.deepStrictEqual(nf.splitNotification(''), { tldr: '', more: '' });
  assert.deepStrictEqual(nf.splitNotification(null), { tldr: '', more: '' });
  assert.deepStrictEqual(nf.splitNotification(undefined), { tldr: '', more: '' });
});

// --- splitNotification: abbreviations never end a sentence -----------------

test('splitNotification: "e.g." does not end the sentence, but the NEXT real period does', () => {
  const r = nf.splitNotification('Consider e.g. this case here. Real end here.');
  assert.strictEqual(r.tldr, 'Consider e.g. this case here.');
  assert.strictEqual(r.more, 'Real end here.');
});

test('splitNotification: "i.e./vs/etc/cf" likewise never end the sentence on their own', () => {
  assert.strictEqual(nf.splitNotification('That is, i.e. this one. Real end.').tldr, 'That is, i.e. this one.');
  assert.strictEqual(nf.splitNotification('Team A vs. Team B played. Real end.').tldr, 'Team A vs. Team B played.');
  assert.strictEqual(nf.splitNotification('Fixed bugs, etc. today. Real end.').tldr, 'Fixed bugs, etc. today.');
  assert.strictEqual(nf.splitNotification('See the card, cf. above. Real end.').tldr, 'See the card, cf. above.');
});

test('splitNotification: a single-character word before the mark (an initial like "A.") never ends the sentence either', () => {
  const r = nf.splitNotification('Section A. B. continues. Real end here.');
  // "A." (word length 1) and "B." (word length 1) are both skipped; the
  // first real boundary is after "continues."
  assert.strictEqual(r.tldr, 'Section A. B. continues.');
  assert.strictEqual(r.more, 'Real end here.');
});

// --- splitNotification: a period inside backticks/quotes/parens is not a boundary ---

test('splitNotification: a period inside a backtick code span is not a sentence boundary', () => {
  const r = nf.splitNotification('see `a.b. c` for detail. Real end.');
  assert.strictEqual(r.tldr, 'see `a.b. c` for detail.');
  assert.strictEqual(r.more, 'Real end.');
});

test('splitNotification: a period inside double quotes is not a sentence boundary', () => {
  const r = nf.splitNotification('she said "wait. really?" and left. Real end.');
  assert.strictEqual(r.tldr, 'she said "wait. really?" and left.');
  assert.strictEqual(r.more, 'Real end.');
});

test('splitNotification: a period inside parentheses is not a sentence boundary', () => {
  const r = nf.splitNotification('fixed it (see #42. for context) today. Real end.');
  assert.strictEqual(r.tldr, 'fixed it (see #42. for context) today.');
  assert.strictEqual(r.more, 'Real end.');
});

test('splitNotification: "?" and "!" are also valid sentence terminators', () => {
  assert.strictEqual(nf.splitNotification('Did it work? Yes it did.').tldr, 'Did it work?');
  assert.strictEqual(nf.splitNotification('Great news! Ship it now.').tldr, 'Great news!');
});

// --- splitClauses: refuses to split inside code/quotes/parens --------------

test('splitClauses: splits at "; " outside every exclusion zone, keeping the ";" on each piece', () => {
  const pieces = nf.splitClauses('one; two "a; b" three; (x; y) four;');
  assert.deepStrictEqual(pieces, ['one;', 'two "a; b" three;', '(x; y) four;']);
});

test('splitClauses: refuses to split inside a backtick code span', () => {
  const pieces = nf.splitClauses('see `a; b; c` for detail; second clause');
  assert.deepStrictEqual(pieces, ['see `a; b; c` for detail;', 'second clause']);
});

test('splitClauses: refuses to split inside double quotes', () => {
  const pieces = nf.splitClauses('she said "a; b; c" today; second clause');
  assert.deepStrictEqual(pieces, ['she said "a; b; c" today;', 'second clause']);
});

test('splitClauses: refuses to split inside parentheses', () => {
  const pieces = nf.splitClauses('did it (a; b; c) today; second clause');
  assert.deepStrictEqual(pieces, ['did it (a; b; c) today;', 'second clause']);
});

test('splitClauses: empty pieces are dropped, a lone piece with no "; " at all is returned whole', () => {
  assert.deepStrictEqual(nf.splitClauses(''), []);
  assert.deepStrictEqual(nf.splitClauses('just one clause, no split'), ['just one clause, no split']);
  assert.deepStrictEqual(nf.splitClauses('a; ; b'), ['a;', ';', 'b']);
});

// --- rendering: source-pattern checks for notifListNode ---------------------

test('notifListNode: meta line is "from · time" (mono, --mut), matching the web\'s own format', () => {
  const src = extractFunction('notifListNode');
  assert.match(src, /el\("div","nmeta",\(n\.from\|\|"unknown"\)\+\(n\.at\?" · "\+n\.at:""\)\)/);
});

test('notifListNode: TLDR renders in its own .ntldr line, and MORE only appears (with a .nmorelbl "More" label) when non-empty', () => {
  const src = extractFunction('notifListNode');
  assert.match(src, /el\("div","ntldr"\)/);
  assert.match(src, /if\(parts\.more\)\{/);
  assert.match(src, /el\("div","nmorelbl","More"\)/);
});

test('notifListNode: MORE renders as a <ul> of clauses when there are two or more, else a single paragraph', () => {
  const src = extractFunction('notifListNode');
  assert.match(src, /if\(clauses\.length>=2\)\{/);
  assert.match(src, /const ul=el\("ul"\)/);
});

test('notifListNode/notifSegNodes reuse fmtBodySegs (bold+code) and codeSegNode (mention-aware) — not the fuller mdInline parser', () => {
  const src = extractFunction('notifSegNodes');
  assert.match(src, /fmtBodySegs\(text\)/);
  assert.match(src, /codeSegNode\(s\.v,boardName\)/);
});

test('notifListNode never builds via innerHTML', () => {
  const src = extractFunction('notifListNode');
  assert.ok(!src.includes('innerHTML'));
});

// --- CSS: the new notification classes exist and use the right tokens ------

test('the .ntldr/.nmorelbl/.nmore CSS rules exist with the tokens the brief specifies', () => {
  assert.match(html, /\.ntldr\{[^}]*color:var\(--ink-strong\)[^}]*font-weight:600[^}]*\}/);
  const nmorelblMatch = /\.nmorelbl\{([^}]*)\}/.exec(html);
  assert.ok(nmorelblMatch, '.nmorelbl rule not found');
  assert.match(nmorelblMatch[1], /text-transform:uppercase/);
  assert.match(nmorelblMatch[1], /letter-spacing:\.12em/);
  assert.match(nmorelblMatch[1], /color:var\(--mut\)/);
  assert.match(html, /\.nmore\{[^}]*color:var\(--prose\)[^}]*\}/);
});
