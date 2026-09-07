const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Close guard (kanban.proj #251): warn before the page is closed or
// dismissed while changes are pending, and make a best-effort clipboard
// copy on the way out through the SAME copyPayload() helper card #252
// introduced. Same source-as-text technique format-body.test.js,
// stack-mode.test.js, pointer-drag.test.js and pill-copy.test.js use (no
// build step, no DOM) -- extract the relevant expressions from
// build_editor.py by marker + first-match scan and assert on their text.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function sliceFrom(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, `"${startMarker}" not found in build_editor.py`);
  const endAt = src.indexOf(endMarker, start);
  assert.ok(endAt !== -1, `"${endMarker}" not found after "${startMarker}"`);
  return src.slice(start, endAt + endMarker.length);
}

test('beforeunload only guards while ops are queued, and prevents default + sets returnValue to trigger the native prompt', () => {
  const handler = sliceFrom('window.addEventListener("beforeunload",', '});');
  assert.match(handler, /if\(!ops\.length\)return;/, 'an empty tray must never arm the guard');
  assert.match(handler, /e\.preventDefault\(\)/, 'must call preventDefault to raise the host\'s confirm-exit prompt');
  assert.match(handler, /e\.returnValue\s*=/, 'must set returnValue -- some engines require a truthy value to fire at all');
  assert.ok(!/e\.returnValue\s*=\s*""/.test(handler), 'returnValue must not be an empty string -- some engines need it truthy to fire');
});

test('pagehide and visibilitychange(hidden) both trigger a best-effort exit copy, since the Claude mobile app dismisses the view without firing beforeunload', () => {
  assert.match(src, /window\.addEventListener\("pagehide",\s*\w+\)/, 'pagehide must be registered');
  assert.match(src, /document\.addEventListener\("visibilitychange",\(\)=>\{if\(document\.visibilityState==="hidden"\)\w+\(\)\}\)/, 'visibilitychange must check for the hidden state before acting');
});

test('the best-effort exit copy early-returns on an empty tray and swallows any failure so it can never block or delay the close', () => {
  const fn = sliceFrom('function bestEffortExitCopy(){', 'catch(err){}}');
  assert.match(fn, /if\(!ops\.length\)return;/, 'an empty tray must be a no-op, same gate as beforeunload');
  assert.match(fn, /try\{copyPayload\(/, 'must be wrapped in a try so a thrown error can never block/delay the close');
  assert.match(fn, /catch\(err\)\{\}/, 'a failure must be silently swallowed, not surfaced or rethrown');
});

test('the exit copy reuses the SAME copyPayload() helper card #252 introduced, forcing the synchronous execCommand path since async clipboard writes are unreliable during unload', () => {
  const fn = sliceFrom('function bestEffortExitCopy(){', 'catch(err){}}');
  assert.match(fn, /copyPayload\(null,true\)/, 'must call the shared helper with forceSync=true, not duplicate the copy logic');
});

test('copyPayload accepts forceSync and skips the async Clipboard API entirely when it is set', () => {
  const fn = sliceFrom('function copyPayload(onDone,forceSync){', '\nelse fallback()}');
  assert.match(fn, /if\(!forceSync&&navigator\.clipboard&&navigator\.clipboard\.writeText\)/, 'forceSync must gate out the async attempt');
  assert.match(fn, /else fallback\(\)/, 'forceSync (or no Clipboard API) must go straight to the execCommand fallback');
});

test('there is still exactly one clipboard fallback chain (document.execCommand("copy") appears once) after adding the close guard', () => {
  const matches = src.match(/document\.execCommand\("copy"\)/g) || [];
  assert.strictEqual(matches.length, 1, 'the close guard must reuse copyPayload, not add a second execCommand fallback');
});

test('no JS timers were introduced for the close guard -- it is driven entirely by browser exit events', () => {
  assert.ok(!/setInterval|setTimeout/.test(src), 'the close guard must not poll on a timer');
});
