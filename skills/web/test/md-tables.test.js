const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { escapeHtml } = require('../web/assignee-badge.js');

// Markdown tables in the card detail popup (kanban.proj #256). mdToHtml has always
// been a small hand-rolled renderer and tables were simply not in its set, so a
// table's rows fell through to the paragraph collector and came out as one run-on
// line. Unlike the other app.js tests, which assert on the source text, these run
// the real function: extract it from app.js and call it, so a regression shows up
// as wrong HTML rather than as a missing string.
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function loadRenderer() {
  const helpers = src.match(/const TABLE_DELIM_RE = [\s\S]*?\n\}/);
  assert.ok(helpers, 'TABLE_DELIM_RE and splitRow are defined together above mdToHtml');
  const fn = src.match(/function mdToHtml\([\s\S]*?\n\}/);
  assert.ok(fn, 'mdToHtml is defined in app.js');
  // Evaluated in a vm context rather than required: app.js is a browser script with
  // no exports, and these two definitions are the only part under test. The source is
  // this repo's own file, and the sandbox holds nothing but escapeHtml.
  const sandbox = { escapeHtml };
  vm.createContext(sandbox);
  vm.runInContext(`${helpers[0]}\n${fn[0]}`, sandbox, { filename: 'app.js#mdToHtml' });
  return sandbox.mdToHtml;
}

const mdToHtml = loadRenderer();

const LADDER = [
  '| Step | Your role | Agents |',
  '| --- | --- | --- |',
  '| 0 Gated | — | 0 |',
  '| 1 Assisted | you + an agent (a pair) | ~1 |',
].join('\n');

test('a pipe table renders as a real table, not a run-on paragraph', () => {
  const html = mdToHtml(LADDER);
  assert.ok(html.includes('<table>'), 'a table element is emitted');
  assert.ok(html.includes('<th>Step</th>'), 'the header row becomes th cells');
  assert.ok(html.includes('<td>0 Gated</td>'), 'body rows become td cells');
  assert.strictEqual((html.match(/<tr>/g) || []).length, 3, 'one header row and two body rows');
  // the shape this card exists to kill
  assert.ok(!/<p>[^<]*\|/.test(html), 'no pipe row survives as paragraph text');
});

test('the table scrolls in its own container, so a wide table never scrolls the popup', () => {
  assert.ok(mdToHtml(LADDER).includes('<div class="md-table">'), 'the table is wrapped in its scroller');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.detail-body \.md-table \{[^}]*overflow-x: auto/, 'the wrapper is the scroller');
});

// Alignment is a class, not a style attribute: the app serves a CSP with no
// unsafe-inline for styles, so an inline style="" would be dropped by the browser
// and the colons would silently do nothing. status-colors.test.js polices the
// no-inline-style rule across app.js; this pins the alignment side of it.
test('alignment colons are honoured per column, through classes rather than inline styles', () => {
  const html = mdToHtml([
    '| left | mid | right |',
    '| :--- | :---: | ---: |',
    '| a | b | c |',
  ].join('\n'));
  assert.ok(html.includes('<th class="ta-left">left</th>'), 'left colon');
  assert.ok(html.includes('<th class="ta-center">mid</th>'), 'both colons centre');
  assert.ok(html.includes('<td class="ta-right">c</td>'), 'alignment reaches body cells too');
  assert.ok(!html.includes('style='), 'no inline style attribute — the CSP would drop it');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  for (const a of ['left', 'center', 'right']) {
    assert.match(css, new RegExp(`\\.md-table \\.ta-${a} \\{ text-align: ${a};`), `.ta-${a} has a rule`);
  }
});

test('a ragged row is padded and an over-long one truncated to the header width', () => {
  const html = mdToHtml([
    '| a | b | c |',
    '| --- | --- | --- |',
    '| 1 |',
    '| 1 | 2 | 3 | 4 |',
  ].join('\n'));
  const rows = html.split('<tr>').slice(2); // drop the head and the pre-table chunk
  assert.strictEqual((rows[0].match(/<td/g) || []).length, 3, 'a short row is padded to three cells');
  assert.strictEqual((rows[1].match(/<td/g) || []).length, 3, 'a long row is truncated to three cells');
});

test('pipes without a delimiter row underneath stay prose', () => {
  const html = mdToHtml('the schema is id | status | priority and nothing more');
  assert.ok(html.startsWith('<p>'), 'an ordinary sentence containing pipes is a paragraph');
  assert.ok(!html.includes('<table>'), 'and never becomes a table');
});

test('an escaped pipe is a literal cell character, not a cell boundary', () => {
  const html = mdToHtml(['| a | b |', '| --- | --- |', '| x \\| y | z |'].join('\n'));
  assert.ok(html.includes('<td>x | y</td>'), 'the escaped pipe survives inside one cell');
});

test('content after a table resumes normally', () => {
  const html = mdToHtml([LADDER, '', 'Unlocks named by the source.'].join('\n'));
  assert.ok(html.includes('</table></div><p>Unlocks named by the source.</p>'),
    'the paragraph after the table is a paragraph, and the table closed before it');
});

test('inline markup still applies inside cells', () => {
  const html = mdToHtml(['| a |', '| --- |', '| **bold** and `code` |'].join('\n'));
  assert.ok(html.includes('<strong>bold</strong>'), 'bold inside a cell');
  assert.ok(html.includes('<code>code</code>'), 'inline code inside a cell');
});

test('a cell cannot smuggle markup — escaping still runs over the whole body first', () => {
  const html = mdToHtml(['| a |', '| --- |', '| <script>alert(1)</script> |'].join('\n'));
  assert.ok(!html.includes('<script>'), 'no live script tag survives');
  assert.ok(html.includes('&lt;script&gt;'), 'it is rendered as text');
});
