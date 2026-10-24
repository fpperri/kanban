const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A tile's head row carries the id (with its priority label), the status dot,
// the assignee and up to two stickers, beside a date stack. Without wrapping,
// a full head overflowed the text column and ran under the dates.
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
const rule = (sel) => {
  const at = css.indexOf('\n' + sel + ' {');
  assert.ok(at !== -1, `rule not found: ${sel}`);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

test('a crowded tile head wraps to a second line instead of overflowing into the date stack', () => {
  assert.match(rule('.card-head'), /flex-wrap:\s*wrap/);
  assert.match(rule('.card-main'), /min-width:\s*0/, 'the text column may shrink, so its content wraps inside it');
});

test('the id keeps its priority label on one line', () => {
  assert.match(rule('.card-id'), /white-space:\s*nowrap/);
});
