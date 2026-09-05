const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Pointer drag (kanban.proj #241): native HTML5 drag-and-drop, gated live
// per-event on fineMQ + a Drag switch exactly like the right-click menu
// gates itself on fineMQ. Same source-as-text technique format-body.test.js
// and stack-mode.test.js use (no build step, no DOM) — extract the relevant
// handlers from build_editor.py by marker + first-match scan and assert on
// their text, rather than executing the inline script.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function sliceFrom(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, `"${startMarker}" not found in build_editor.py`);
  const endAt = src.indexOf(endMarker, start);
  assert.ok(endAt !== -1, `"${endMarker}" not found after "${startMarker}"`);
  return src.slice(start, endAt + endMarker.length);
}

test('the dragstart handler exists and gates live on fineMQ.matches', () => {
  const handler = sliceFrom('document.body.addEventListener("dragstart",', '});');
  assert.match(handler, /fineMQ\.matches/, 'must check the live fineMQ MediaQueryList, not a load-time snapshot');
  assert.match(handler, /dragOn/, 'must also check the Drag switch state');
  assert.match(handler, /e\.preventDefault\(\)/, 'a failed gate must cancel the drag, not merely skip queuing later');
  assert.match(handler, /c\.arch/, 'archived tiles must be excluded from the gate\'s pass condition');
});

test('cardNode only marks live, non-archived board tiles draggable', () => {
  assert.match(
    src,
    /d\.dataset\.card=c\.id;\s*\n\s*if\(!detail&&!c\.arch\)d\.draggable=true;/,
    'the detail sheet and archived cards must never get draggable=true'
  );
});

test('the drop handler routes through queue() with a move op, and is a no-op onto the current section', () => {
  const handler = sliceFrom('document.body.addEventListener("drop",', 'render()});');
  assert.match(handler, /queue\(\{op:"move",id:id,to:to\}\)/, 'a drop must queue the SAME move op shape the status pill/"Move to" rows use');
  assert.match(handler, /c\.s===to/, 'dropping onto the card\'s own current section must be detected and skipped');
  assert.match(handler, /render\(\)/, 'a successful drop must re-render');
});

test('each live status section carries its status for drop targeting, not archive', () => {
  assert.match(src, /wrap\.dataset\.status=col;/, 'live boardcol sections must expose their status to the drop handlers');
  const dragoverHandler = sliceFrom('document.body.addEventListener("dragover",', '});');
  assert.match(dragoverHandler, /\.boardcol\[data-status\]/, 'dragover must target boardcol sections that declare a status (archive does not)');
});

test('the Drag switch reads localStorage.kanbanViewer.drag inside a try block, defaulting to on', () => {
  const init = sliceFrom('let dragOn=', '})();');
  assert.match(init, /try\{/, 'must read localStorage inside a try');
  assert.match(init, /localStorage\.getItem\("kanbanViewer\.drag"\)/, 'must read the kanbanViewer.drag key');
  assert.match(init, /catch\(\w+\)\{return true\}/, 'a failed/blocked read must fall back to on');
  assert.match(init, /!==\s*"0"/, 'only an explicit stored "0" may turn the switch off');
});

test('the sdrag toggle button persists its state back to localStorage inside a try/catch', () => {
  const handler = sliceFrom('$("sdrag").addEventListener("click",', ');');
  assert.match(handler, /dragOn=!dragOn/, 'clicking must flip the in-memory switch');
  assert.match(handler, /try\{localStorage\.setItem\("kanbanViewer\.drag",dragOn\?"1":"0"\)\}catch\(\w+\)\{\}/, 'the write-back must be wrapped in its own try/catch');
  assert.match(handler, /syncStack\(\)/, 'the handler must resync the visible stack buttons after toggling');
});

test('no touchstart or pointerdown drag handlers were added for tiles', () => {
  assert.ok(!/addEventListener\(\s*["']touchstart["']/.test(src), 'touch drag is card 242\'s scope, not this one\'s');
  assert.ok(!/addEventListener\(\s*["']pointerdown["']/.test(src), 'pointer-event-based drag is card 242\'s scope, not this one\'s');
});
