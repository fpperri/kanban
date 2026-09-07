const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Column-head create controls (kanban.proj #249): every LIVE status column
// head carries a "+" (plain new card) and an AI-prompt control, each
// pre-aiming the new-card sheet at that column's status (and, for the
// second control, opening the sheet with the prompt field already visible).
// Same source-as-text technique format-body.test.js, stack-mode.test.js and
// pointer-drag.test.js use (no build step, no DOM) — extract the relevant
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

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in build_editor.py`);
  let i = src.indexOf('{', start);
  let depth = 0;
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// --- render(): the live-columns loop, not archive -------------------------

test('the live-columns render loop builds a "+" and an AI-prompt control per column, stopping propagation on each', () => {
  const loop = sliceFrom('COLS.filter(col=>isVis(col)).forEach(col=>{', 'board.appendChild(wrap)});');
  assert.match(loop, /const plusBtn=el\("button","colbtn","\+"\);/, 'a plain "+" button must be built per column');
  assert.match(loop, /plusBtn\.addEventListener\("click",ev=>\{ev\.stopPropagation\(\);openNewCard\(col,false\)\}\);/, 'the "+" button must stopPropagation and open the sheet aimed at THIS column, with no prompt field');
  assert.match(loop, /const promptBtn=el\("button","colbtn",/, 'a second, AI-prompt button must be built per column');
  assert.match(loop, /promptBtn\.addEventListener\("click",ev=>\{ev\.stopPropagation\(\);openNewCard\(col,true\)\}\);/, 'the AI-prompt button must stopPropagation and open the sheet aimed at THIS column, with the prompt field open');
  assert.match(loop, /h\.appendChild\(plusBtn\)/, 'the "+" button must actually be attached to the column head');
  assert.match(loop, /h\.appendChild\(promptBtn\)/, 'the AI-prompt button must actually be attached to the column head');
});

test('the archive section gets no create controls', () => {
  const archiveBlock = sliceFrom('if(isVis("archive")){', 'board.appendChild(wrap)}');
  assert.doesNotMatch(archiveBlock, /colbtn/, 'archive is read-only — no "+" or AI-prompt button may appear on its head');
  assert.doesNotMatch(archiveBlock, /openNewCard/, 'archive is read-only — it must never wire up card creation');
});

// --- openNewCard(): the shared entry point the two buttons call -----------

test('openNewCard seeds ncStatus/nfPromptOpen and opens the sheet like the other create entry points', () => {
  const fn = extractFunction('openNewCard');
  assert.match(fn, /nfMore=false;creating=true;sel=null;focusRoot=null;ren=false;descEd=false;delArm=null;pillEd=null;/, 'must reset the same state the existing new-card entry points reset');
  assert.match(fn, /ncStatus=status;nfPromptOpen=!!wantPrompt;/, 'must carry the intended column and prompt-visibility into the module-level seeds newFormNode reads');
  assert.match(fn, /render\(\)/, 'must re-render to actually show the sheet');
});

// --- newFormNode(): status preselect + prompt field ------------------------

test('newFormNode seeds #nc-s from ncStatus, but prev.s (the live select, once open) still wins', () => {
  assert.match(
    src,
    /ss\.value=prev\.s\|\|ncStatus\|\|\(COLS\.includes\("backlog"\)\?"backlog":COLS\[0\]\);/,
    'ncStatus must only be a fallback under prev.s, not override an already-open sheet\'s own selection'
  );
});

test('newFormNode renders a prompt input, gated on nfPromptOpen, and restores it via prev like every other field', () => {
  const fn = extractFunction('newFormNode');
  assert.match(fn, /pr:\$\("nc-pr"\)&&\$\("nc-pr"\)\.value/, 'prev must capture the live #nc-pr value, same pattern as t/s/p/a/b');
  assert.match(fn, /if\(nfPromptOpen\)\{/, 'the prompt field must be gated on nfPromptOpen');
  assert.match(fn, /const pin=el\("input"\);pin\.type="text";pin\.id="nc-pr";/, 'the prompt field must be a plain text input (prompt is a single-line frontmatter field)');
  assert.match(fn, /if\(prev\.pr\)pin\.value=prev\.pr;/, 'a typed prompt must survive a re-render (More…, Accept-then-reopen, etc.) exactly like title/body do');
});

// --- Accept: the prompt rides the create op as fm.prompt -------------------

test('ncadd carries a non-empty prompt through as create.fm.prompt, matching the edit.fm representation the protocol already documents', () => {
  const handler = sliceFrom('if(act==="ncadd"){', 'creating=false;nfMore=false;ncStatus=null;nfPromptOpen=false;render();return}');
  assert.match(handler, /const pr=\$\("nc-pr"\)\?\$\("nc-pr"\)\.value\.trim\(\):"";/, 'must read and trim the prompt input, tolerating an absent field (nfPromptOpen never opened)');
  assert.match(handler, /if\(pr\)cop\.fm=\{prompt:pr\};/, 'an empty prompt must NOT add an fm object to the create op — lean payload, no accidental frontmatter write');
  assert.match(handler, /queue\(cop\)/, 'the create op must still go through queue(), same as every other op');
});

test('accepting or cancelling the sheet resets ncStatus and nfPromptOpen, so a later plain "+ New card" tap starts clean', () => {
  const ncaddHandler = sliceFrom('if(act==="ncadd"){', 'creating=false;nfMore=false;ncStatus=null;nfPromptOpen=false;render();return}');
  assert.match(ncaddHandler, /ncStatus=null;nfPromptOpen=false;/, 'Accept must clear both seeds');
  const cancelHandler = sliceFrom('if(act==="nccancel"){', 'render();return}');
  assert.match(cancelHandler, /ncStatus=null;nfPromptOpen=false;/, 'Cancel must clear both seeds too');
});

test('the global new-card entry points (snew, newbtn) reset ncStatus and nfPromptOpen so they never inherit a column tap\'s state', () => {
  const snewHandler = sliceFrom('$("snew").addEventListener("click",', ');');
  assert.match(snewHandler, /ncStatus=null;nfPromptOpen=false;/, 'the scroll-stack "+" must reset both seeds before opening');
  const newbtnHandler = sliceFrom('if(t.id==="newbtn"){', 'render();return}');
  assert.match(newbtnHandler, /ncStatus=null;nfPromptOpen=false;/, 'the header "+ New card" button must reset both seeds before opening');
});

// --- queue(): the create op accepts an optional fm, mirroring edit ---------

test('queue()\'s create branch carries an optional fm object onto the queued op and the local view snapshot', () => {
  const fn = extractFunction('queue');
  assert.match(fn, /if\(o\.fm\)cr\.fm=o\.fm;/, 'the queued create op must carry fm through when the caller supplied one');
  assert.match(fn, /fm:o\.fm\|\|\{\}/, 'the provisional card pushed into view must reflect fm too, same as every other create field');
});

// --- CSS: compact, adequate tap target, doesn't hijack colh's own tap -----

test('.colbtn is sized as a compact but tappable square, distinct from the generic button rule', () => {
  assert.match(src, /\.colbtn\{[^}]*width:24px;height:24px;/, 'must be a fixed, compact square, not the generic wide button padding');
  assert.match(src, /\.colbtn\{[^}]*flex:none;/, 'must not stretch/shrink in the colh flex row');
});
