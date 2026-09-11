const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Pill copy (kanban.proj #252): tapping the pending pill copies the payload
// to the clipboard through the SAME shared helper the tray's Copy changes
// button uses, then still smooth-scrolls to the tray exactly as before.
// Same source-as-text technique format-body.test.js, stack-mode.test.js and
// pointer-drag.test.js use (no build step, no DOM) -- extract the relevant
// expressions from build_editor.py by marker + first-match scan and assert
// on their text, rather than executing the inline script.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function sliceFrom(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, `"${startMarker}" not found in build_editor.py`);
  const endAt = src.indexOf(endMarker, start);
  assert.ok(endAt !== -1, `"${endMarker}" not found after "${startMarker}"`);
  return src.slice(start, endAt + endMarker.length);
}

test('there is exactly one clipboard fallback chain (document.execCommand("copy") appears once)', () => {
  const matches = src.match(/document\.execCommand\("copy"\)/g) || [];
  assert.strictEqual(matches.length, 1, 'the execCommand fallback must live in ONE shared helper, not be duplicated per caller');
});

test('copyPayload tries the async Clipboard API, falls back to the #payload textarea, and always reports ok/fail via onDone', () => {
  const fn = sliceFrom('function copyPayload(onDone,forceSync){', '\nelse fallback()}');
  assert.match(fn, /navigator\.clipboard&&navigator\.clipboard\.writeText/, 'must prefer the async Clipboard API when present');
  assert.match(fn, /\$\("payload"\)/, 'the fallback must target the #payload textarea');
  assert.match(fn, /document\.execCommand\("copy"\)/, 'the fallback must still use execCommand("copy")');
  assert.match(fn, /copied=true/, 'success must set the existing `copied` state so the tray hint reads as copied');
  assert.match(fn, /if\(onDone\)onDone\(true\)/, 'success must report ok=true to the caller');
  assert.match(fn, /if\(onDone\)onDone\(false\)/, 'failure must report ok=false to the caller');
});

test('the tray Copy changes button (act==="apply") routes through copyPayload instead of its own clipboard logic', () => {
  const handler = sliceFrom('if(act==="apply"){', 'return}');
  assert.match(handler, /copyPayload\(/, 'the tray button must call the shared helper');
  assert.ok(!/navigator\.clipboard/.test(handler), 'the tray handler itself must not touch navigator.clipboard directly anymore');
});

test('the pill click handler copies via copyPayload AND still smooth-scrolls to the tray', () => {
  const handler = sliceFrom('$("pill").addEventListener("click",', ')})});');
  assert.match(handler, /if\(!ops\.length\)return;/, 'a click with no queued ops must still be a no-op');
  assert.match(handler, /sc\.scrollTo\(\{top:sc\.scrollHeight,behavior:"smooth"\}\)/, 'the smooth-scroll-to-tray behavior must be unchanged');
  assert.match(handler, /copyPayload\(/, 'the pill must copy via the shared helper');
});

test('a failed pill copy sets the existing note state and never skips the scroll', () => {
  const handler = sliceFrom('$("pill").addEventListener("click",', ')})});');
  const scrollAt = handler.indexOf('sc.scrollTo');
  const copyAt = handler.indexOf('copyPayload(');
  assert.ok(scrollAt !== -1 && copyAt !== -1 && scrollAt < copyAt, 'the scroll call must be issued before the (possibly async/failing) copy attempt so a copy failure cannot prevent it');
  assert.match(handler, /note=/, 'a failed copy must set the note so the human is told to use the text box below');
});

test('a blocked execCommand copy is reported as a FAILURE — execCommand returns false rather than throwing, so its return value must decide ok/bad', () => {
  const fn = sliceFrom('function copyPayload(onDone,forceSync){', '\nelse fallback()}');
  assert.match(fn, /execCommand\("copy"\)\?ok\(\):bad\(\)/, 'the fallback must branch on execCommand\'s boolean return, not assume success');
  assert.ok(!/execCommand\("copy"\);ok\(\)/.test(fn), 'calling ok() unconditionally after execCommand would report every blocked copy as copied');
});

test('a later successful pill copy clears its own "Copy blocked" note, so the tray can never read Copied and Copy blocked at the same time', () => {
  const handler = sliceFrom('$("pill").addEventListener("click",', ')})});');
  assert.match(handler, /const m="Copy blocked/, 'the blocked-note text must be held in one place so success can match on it');
  assert.match(handler, /if\(!ok\)note=m;else if\(note===m\)note=""/, 'success must clear the note only when it is this handler\'s own blocked note — queue() notes must survive');
});
