const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// stackMode (kanban.proj #240): the scroll-button stack starts collapsed
// (off) on every page load instead of defaulting to medium, and the chosen
// mode persists per page in localStorage. Same source-as-text technique
// format-body.test.js uses (no build step, no DOM) — extract the relevant
// expressions from build_editor.py by marker + balanced/first-match scan and
// assert on their text, rather than executing the inline script.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function sliceFrom(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, `"${startMarker}" not found in build_editor.py`);
  const endAt = src.indexOf(endMarker, start);
  assert.ok(endAt !== -1, `"${endMarker}" not found after "${startMarker}"`);
  return src.slice(start, endAt + endMarker.length);
}

test('stackMode has no leftover hardcoded default of 1', () => {
  assert.ok(!src.includes('let stackMode=1'), 'the old "let stackMode=1" literal must be gone');
});

test('stackMode initializes from localStorage inside a try block, defaulting to 0', () => {
  const init = sliceFrom('let stackMode=', '})();');
  assert.match(init, /try\{/, 'must read localStorage inside a try');
  assert.match(init, /localStorage\.getItem\("kanbanViewer\.stackMode"\)/, 'must read the kanbanViewer.stackMode key');
  assert.match(init, /catch\(\w+\)\{return 0\}/, 'a failed/blocked read must fall back to 0');
  assert.match(init, /return v===0\|\|v===1\|\|v===2\?v:0/, 'only 0, 1, or 2 are accepted; anything else defaults to 0');
});

test('the smore ellipsis click handler persists the cycled mode back to localStorage inside a try block', () => {
  const handler = sliceFrom('$("smore").addEventListener("click",', ');');
  assert.match(handler, /stackMode=\(stackMode\+1\)%3/, 'the medium->extended->off->medium cycle itself must be unchanged');
  assert.match(handler, /try\{localStorage\.setItem\("kanbanViewer\.stackMode",String\(stackMode\)\)\}catch\(\w+\)\{\}/, 'the write-back must be wrapped in its own try/catch');
  assert.match(handler, /syncStack\(\)/, 'the handler must still resync the visible buttons after cycling');
});
