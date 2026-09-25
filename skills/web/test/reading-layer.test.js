const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The reading layer is a set of rules, not only a set of tokens: the tokens'
// contrast lives in theme-contrast.test.js, and this pins which role paints
// with which token, so a card body cannot drift back to one flat lightness.
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

function rule(selector) {
  const re = new RegExp('(^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}');
  const m = re.exec(css);
  assert.ok(m, `rule not found: ${selector}`);
  return m[2];
}

test('card body prose paints --prose; headings and bold paint --ink-strong', () => {
  assert.match(rule('.detail-body'), /color:\s*var\(--prose\)/);
  assert.match(rule('.detail-body h1, .detail-body h2, .detail-body h3'), /color:\s*var\(--ink-strong\)/);
  assert.match(rule('.detail-body strong'), /color:\s*var\(--ink-strong\)/);
});

test('inline code is its own colour on the raised ground, with no border', () => {
  const code = rule('.detail-body code');
  assert.match(code, /color:\s*var\(--code-ink\)/);
  assert.match(code, /background:\s*var\(--raised\)/);
  assert.doesNotMatch(code, /(^|[^-])border:/, 'a border around every code span is the noise this layer removes');
});

test('table headers sit on the raised ground over the strong rule; the first column carries heading ink', () => {
  const th = rule('.detail-body .md-table th');
  assert.match(th, /background:\s*var\(--raised\)/);
  assert.match(th, /border-bottom-color:\s*var\(--line-strong\)/);
  assert.match(rule('.detail-body .md-table td'), /color:\s*var\(--prose\)/);
  assert.match(rule('.detail-body .md-table td:first-child'), /color:\s*var\(--ink-strong\)/);
});

test('prose stops at 76 characters while tables keep the full width', () => {
  assert.match(rule('.detail-body > p, .detail-body > ul, .detail-body > ol, .detail-body > h1, .detail-body > h2, .detail-body > h3'), /max-width:\s*76ch/);
  assert.doesNotMatch(rule('.detail-body .md-table'), /max-width/);
});

test('only a leading heading drops its section rule; a leading rule or code block keeps its own', () => {
  assert.doesNotMatch(rule('.detail-body > :first-child'), /border|padding/);
  assert.match(rule('.detail-body > h2:first-child'), /border-top:\s*0/);
});

test('a notification leads with its TLDR in the strongest ink and the rest in prose', () => {
  assert.match(rule('.notif-message'), /color:\s*var\(--prose\)/);
  assert.match(rule('.notif-message strong'), /color:\s*var\(--ink-strong\)/);
});
