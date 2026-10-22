const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A key listener on the document or the window sees every key press, whatever is open and
// wherever focus is. Each one has to read the key guard (key-guard.js), or say in a marker comment
// why it stands outside it:
//
//   // key-guard: exempt (<reason>)
//
// on the listener's line, on the line directly above it, on the line the handler is declared on, or on
// the first line of its body.
// Listeners on one element (a box, the palette, a menu) are not scanned.

const WEB = path.join(__dirname, '..', 'web');

const LISTENER = /\b(?:document|window|document\.body|document\.documentElement)\.addEventListener\(\s*(['"`])(keydown|keyup|keypress)\1\s*,\s*/g;
const MARKER = /\/\/\s*key-guard: exempt \((.*\S.*)\)\s*$/;
const MARKER_LIKE = /\/\/\s*key-guard\b/;

// The index of the bracket that closes the one at `open`, skipping strings, template literals and comments.
function closeOf(src, open) {
  const pairs = { '{': '}', '(': ')' };
  const stack = [pairs[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
  }
  return -1;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function lineText(src, index) {
  const start = src.lastIndexOf('\n', index - 1) + 1;
  const end = src.indexOf('\n', index);
  return src.slice(start, end < 0 ? src.length : end);
}

// Where a named handler is declared, in any of the files: `function name(` or `const name = (...) =>`.
function findNamed(files, name) {
  const decl = new RegExp(`(?:^|\\n)[ \\t]*(?:async\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b[^(]*)?\\()`);
  for (const [file, src] of Object.entries(files)) {
    const m = decl.exec(src);
    if (!m) continue;
    const paren = m.index + m[0].length - 1;
    const afterParams = closeOf(src, paren);
    const brace = src.indexOf('{', afterParams);
    return { file, src, declAt: m.index + m[0].search(/\S/), brace };
  }
  return null;
}

// The listeners in `files` ({ name: text }) that neither read the key guard nor carry the marker.
function keyListenerOffenders(files, guardNames) {
  const offenders = [];
  for (const [file, src] of Object.entries(files)) {
    LISTENER.lastIndex = 0;
    let m;
    while ((m = LISTENER.exec(src))) {
      const at = m.index;
      const where = `${file}:${lineOf(src, at)}`;
      const rest = src.slice(LISTENER.lastIndex);
      let body, declLine, bodyLine;
      let handler = { file, src };
      const named = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest);
      if (named) {
        const found = findNamed(files, named[1]);
        if (!found) { offenders.push(`${where}: the handler ${named[1]} is not declared in any scanned file`); continue; }
        handler = found;
        body = found.src.slice(found.brace, closeOf(found.src, found.brace) + 1);
        declLine = lineText(found.src, found.declAt);
        bodyLine = lineText(found.src, found.brace + 1 < found.src.length ? found.src.indexOf('\n', found.brace) + 1 : found.brace);
      } else {
        const arrow = src.indexOf('=>', LISTENER.lastIndex);
        const fn = /^(?:async\s+)?function\b[^{]*\{/.exec(rest);
        let open;
        if (fn) open = LISTENER.lastIndex + fn[0].length - 1;
        else if (arrow >= 0) open = src.indexOf('{', arrow);
        else { offenders.push(`${where}: the handler is neither a name nor a function this scan can read`); continue; }
        const exprBody = arrow >= 0 && !fn && /^\s*[^\s{]/.test(src.slice(arrow + 2, open < 0 ? undefined : open)) ? true : false;
        if (exprBody) {
          const end = src.indexOf('\n', arrow);
          body = src.slice(arrow, end < 0 ? src.length : end);
          declLine = lineText(src, at);
          bodyLine = declLine;
        } else {
          body = src.slice(open, closeOf(src, open) + 1);
          declLine = lineText(src, at);
          bodyLine = lineText(src, src.indexOf('\n', open) + 1);
        }
      }
      const lineStart = src.lastIndexOf('\n', at - 1);
      const above = lineStart > 0 ? lineText(src, lineStart) : '';
      const marked = [lineText(src, at), above, declLine, bodyLine].map((l) => MARKER.exec(l)).find(Boolean);
      const called = (body.match(/\bkeyGuard\w*(?=\()/g) || []).filter((n) => guardNames.includes(n));
      if (called.length || marked) continue;
      const malformed = [lineText(src, at), above, declLine, bodyLine].some((l) => MARKER_LIKE.test(l));
      offenders.push(`${where}: a document-level ${m[2]} listener neither calls a keyGuard function nor carries "// key-guard: exempt (<reason>)"${malformed ? ' (a key-guard comment is there but not in that shape)' : ''}`);
    }
  }
  return offenders;
}

const GUARDS = ['keyGuardTyping', 'keyGuardSurface', 'keyGuardOff', 'keyGuardDetailOff', 'keyGuardEscape'];

test('the scan finds a planted listener that skips the guard, and names its file and line', () => {
  const files = { 'planted.js': "function a() {}\ndocument.addEventListener('keydown', (e) => {\n  if (e.key === 'q') run();\n});\n" };
  const found = keyListenerOffenders(files, GUARDS);
  assert.strictEqual(found.length, 1);
  assert.match(found[0], /^planted\.js:2: /);
});

test('a named handler that skips the guard is found where it is declared, and one that reads it passes', () => {
  const bad = { 'a.js': "function onQ(e) {\n  run(e);\n}\nwindow.addEventListener('keyup', onQ);\n" };
  assert.strictEqual(keyListenerOffenders(bad, GUARDS).length, 1);
  const good = { 'a.js': "function onQ(e) {\n  if (keyGuardOff(document)) return;\n  run(e);\n}\nwindow.addEventListener('keyup', onQ);\n" };
  assert.deepStrictEqual(keyListenerOffenders(good, GUARDS), []);
  const split = { 'a.js': "document.addEventListener('keydown', onQ, true);\n", 'b.js': "const onQ = (e) => {\n  if (keyGuardSurface(document)) return;\n};\n" };
  assert.deepStrictEqual(keyListenerOffenders(split, GUARDS), []);
});

test('a name that is not a key guard function does not count, nor does a handler that is declared nowhere', () => {
  const typo = { 'a.js': "document.addEventListener('keypress', (e) => {\n  if (keyGuardOf(document)) return;\n});\n" };
  assert.strictEqual(keyListenerOffenders(typo, GUARDS).length, 1);
  const missing = { 'a.js': "document.addEventListener('keydown', onGone);\n" };
  assert.match(keyListenerOffenders(missing, GUARDS)[0], /not declared/);
});

test('a marker with a reason, on the listener line or the handler first line, exempts the listener', () => {
  const onListener = { 'a.js': "document.addEventListener('keydown', (e) => { x(); }); // key-guard: exempt (only toggles a class)\n" };
  assert.deepStrictEqual(keyListenerOffenders(onListener, GUARDS), []);
  const onBody = { 'a.js': "document.addEventListener('keydown', (e) => {\n  // key-guard: exempt (acts only while the picker is open)\n  close();\n});\n" };
  assert.deepStrictEqual(keyListenerOffenders(onBody, GUARDS), []);
  const above = { 'a.js': "// key-guard: exempt (acts only on an open popup)\ndocument.addEventListener('keydown', (e) => {\n  close();\n});\n" };
  assert.deepStrictEqual(keyListenerOffenders(above, GUARDS), []);
  const farAbove = { 'a.js': "// key-guard: exempt (acts only on an open popup)\n\ndocument.addEventListener('keydown', (e) => {\n  close();\n});\n" };
  assert.strictEqual(keyListenerOffenders(farAbove, GUARDS).length, 1);
  const onDecl = { 'a.js': "function onQ(e) { // key-guard: exempt (acts only while a dialog is open)\n  close();\n}\ndocument.addEventListener('keydown', onQ);\n" };
  assert.deepStrictEqual(keyListenerOffenders(onDecl, GUARDS), []);
});

test('only the exact marker shape counts: a reason is required', () => {
  for (const marker of ['// key-guard: exempt', '// key-guard: exempt ()', '// key-guard: exempt (  )', '// key-guard exempt (why)', '// keyguard: exempt (why)', '/* key-guard: exempt (why) */']) {
    const files = { 'a.js': `document.addEventListener('keydown', (e) => { x(); }); ${marker}\n` };
    assert.strictEqual(keyListenerOffenders(files, GUARDS).length, 1, marker);
  }
});

test('listeners on one element, and other events on the document, are out of scope', () => {
  const files = { 'a.js': "box.addEventListener('keydown', (e) => { x(); });\n$('#p').addEventListener('keydown', onP);\ndocument.addEventListener('click', (e) => { x(); });\n" };
  assert.deepStrictEqual(keyListenerOffenders(files, GUARDS), []);
});

test('braces inside strings and comments do not end a handler early', () => {
  const files = { 'a.js': "document.addEventListener('keydown', (e) => {\n  const s = '}'; // }\n  if (keyGuardOff(document)) return;\n});\n" };
  assert.deepStrictEqual(keyListenerOffenders(files, GUARDS), []);
});

test('every document-level key listener in the page scripts reads the key guard or carries a reasoned exemption', () => {
  const files = {};
  for (const f of fs.readdirSync(WEB).filter((n) => n.endsWith('.js'))) files[`skills/web/web/${f}`] = fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
  const exported = /module\.exports\s*=\s*\{([^}]*)\}/.exec(files['skills/web/web/key-guard.js'])[1].split(',').map((s) => s.trim()).filter((n) => /^keyGuard[A-Z]/.test(n));
  assert.deepStrictEqual(exported.slice().sort(), GUARDS.slice().sort(), 'key-guard.js exports the functions this scan counts as the guard');
  assert.deepStrictEqual(keyListenerOffenders(files, exported), []);
});
