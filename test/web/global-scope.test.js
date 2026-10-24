const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- one browser global scope, unique top-level names ---------------
// Every web/*.js loads as a plain <script> into ONE page scope (app.html), so
// two files declaring the same top-level const/let/class kill the LATER file
// at parse ("Identifier 'X' has already been declared") and a duplicate
// var/function silently overwrites the earlier one. The require()-based unit
// tests can never see either failure — require() gives each file its own
// scope — which is exactly how the CAL collision (gantt-model.js vs
// date-picker.js) shipped and left every 📅 button dead. These tests close
// the blind spot class two ways: scan every web/*.js for top-level
// const/let/var/function/class names and assert cross-file uniqueness, and
// ban `var` outright (a var inside a top-level block — every file's export
// tail is one — hoists to page scope where the depth-gated scan can't see it).

const { blankNonCode, topLevelDeclarations, collisions } = require('./helpers/global-scope');

const webDir = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const webFiles = fs.readdirSync(webDir).filter((f) => f.endsWith('.js')).sort();
const readWeb = (f) => fs.readFileSync(path.join(webDir, f), 'utf8');

// --- scanner self-tests: quoted/nested "declarations" must not fool it --------

test('scanner sees only real top-level declarations — not comments, strings, templates, regexes, expressions, or nested scopes', () => {
  const src = [
    "'use strict';",
    'const REAL = 1;',
    '// const IN_LINE_COMMENT = 2;',
    '/* let IN_BLOCK_COMMENT = 3; */',
    "const S = 'let IN_STRING = 4;';",
    'const T = `class InTemplate {} ${REAL} tail`;',
    'const R = /const{1,2}[\'"]\\//g;',
    'const F = function hiddenExpressionName() { return 1; };',
    'const A = (n) => { let inner = n / 2; return inner; };',
    'let x = 1, y = 2;',
    'async function af() {}',
    'function real2() { var deep; for (const q of []) {} }',
    'class RealClass {}',
    // depth>0 miss — a REAL blind spot, not a non-case: every web/*.js except
    // app.js ends in a top-level if/else export tail, and a hoisted var inside
    // one would be a page global this scan never collects. The no-var test
    // below closes that hole by construction; this line pins the miss so the
    // limitation stays visible.
    'if (x) { var hoisted = 1; }',
  ].join('\n');
  assert.deepStrictEqual(topLevelDeclarations(src),
    ['REAL', 'S', 'T', 'R', 'F', 'A', 'x', 'y', 'af', 'real2', 'RealClass']);
});

test('scanner refuses top-level destructuring instead of silently missing names', () => {
  assert.throws(() => topLevelDeclarations('const { a, b } = thing;'), /destructuring/);
  assert.throws(() => topLevelDeclarations('let [p, q] = pair;'), /destructuring/);
});

// --- vars inside top-level blocks — the scan's one hoisting hole

// The depth gate keeps function/block bodies out, which is right for const/let
// (block-scoped, never page globals) but WRONG for `var`: in a classic script a
// `var` inside a plain top-level block — e.g. the module.exports/window export
// tail every web file but app.js ends in — hoists to page scope, exactly the
// silent-overwrite class this file exists to catch, invisible to the uniqueness
// test above. A brace scanner can't tell function braces from block braces, so
// rather than collect vars at depth (function locals would false-positive),
// forbid `var` in web/ outright — these files are const/let-only anyway.
// (Known residual gap, accepted: a sloppy-mode function DECLARATION inside a
// top-level block also hoists; banning the keyword would flag every ordinary
// nested helper, and none exist in blocks today.)

test('the no-var rule catches the export-tail blind spot the declaration scan cannot', () => {
  const src = 'if (typeof module !== "undefined") { module.exports = 1; } else { var SNEAKY = 1; }';
  assert.ok(!topLevelDeclarations(src).includes('SNEAKY'), 'depth-gated scan misses a var in a block — why the ban exists');
  const tokens = blankNonCode(src).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  assert.ok(tokens.includes('var'), 'the raw token scan does see it');
});

test('web/*.js never declare with `var` — inside a top-level block it hoists to page scope, invisibly to the uniqueness scan', () => {
  for (const file of webFiles) {
    const tokens = blankNonCode(readWeb(file)).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    assert.ok(!tokens.includes('var'),
      `${file} declares with var — use const/let (a var in any block is a hoisted page global the cross-file scan can't see)`);
  }
});

// --- canary: an empty or broken scan must never pass the uniqueness test ------

test('scanner finds the known declarations in real files — every web/*.js yields at least one', () => {
  const dp = topLevelDeclarations(readWeb('date-picker.js'));
  assert.ok(dp.includes('pickDay') && dp.includes('initialMonth'), `date-picker.js scan: ${dp}`);
  const gm = topLevelDeclarations(readWeb('gantt-model.js'));
  assert.ok(gm.includes('CAL') && gm.includes('GANTT_DAY_PX') && gm.includes('barSpan'), `gantt-model.js scan: ${gm}`);
  const app = topLevelDeclarations(readWeb('app.js'));
  assert.ok(app.includes('state') && app.includes('datePickerFor') && app.includes('openDatePicker'), 'app.js scan');
  for (const file of webFiles) {
    assert.ok(topLevelDeclarations(readWeb(file)).length > 0, `${file}: no top-level declarations found — scanner broken?`);
  }
});

// --- the real guard: cross-file uniqueness -------------------------------------

test('top-level declaration names are unique across ALL web/*.js — shared page scope, one namespace', () => {
  const clashes = collisions(webFiles.map((file) => ({ label: file, source: readWeb(file) })));
  assert.deepStrictEqual(clashes, [],
    'colliding top-level names — the later <script> dies at parse (const/let/class) or silently overwrites (var/function)');
});
