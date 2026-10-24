const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A key listener on the document or the window sees every key press, whatever is open and
// wherever focus is. Each one has to read the key guard (key-guard.js) before it acts, or say in a
// marker comment why it stands outside it:
//
//   // key-guard: exempt (<reason>)
//
// on the listener's line, on the line directly above it, on the line the handler is declared on, or on
// the first line of its body. Listeners on one element (a box, the palette, a menu) are not scanned.
//
// What the scan reads, on the source with comments and the insides of strings blanked, so a guard named
// in a comment or a string counts for nothing:
// - `addEventListener` of keydown, keyup or keypress on document, window, document.body,
//   document.documentElement, or a name set to document or window (an alias);
// - `document.onkeydown =` and the like, and an event type that is not a string literal. These and an
//   alias are reported for a person to decide: they take the marker too.
// - The handler is a plain name (looked up as a function or a const in any scanned file) or an inline
//   function. Any other form (`obj.onKey`, `fn.bind(x)`) is reported as one the scan can't check.
// - A handler whose whole body is one call `onK(e)` to a plain name is followed to that handler, one level.
// - The guard rule: a keyGuard* function the key-guard.js exports is called before the first statement
//   with an effect. In order, the handler's statements are read: one that calls the guard (in the
//   initializer of a const/let/var, in the condition of an `if`, or at the start of an expression) passes
//   the handler; a declaration, or an `if (...) return;` / `if (...) { return; }` with no else, has no
//   effect and the next statement is read; any other statement acts, and the handler fails.

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');

const normalize = (src) => src.replace(/\r\n?/g, '\n');

const KEY_TYPES =new Set(['keydown', 'keyup', 'keypress']);
const MARKER = /\/\/\s*key-guard: exempt \((.*\S.*)\)\s*$/;
const MARKER_LIKE = /\/\/\s*key-guard\b/;
const IDENT = '[A-Za-z_$][\\w$]*';

// The index of the quote that closes the string opened at `i`.
function quoteEnd(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== src[i]) j += src[j] === '\\' ? 2 : 1;
  return j;
}

// The index of the backtick that closes the template opened at `i`, `${ }` expressions and the templates in them included.
function templateEnd(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') j += 2;
    else if (src[j] === '$' && src[j + 1] === '{') {
      let depth = 1;
      for (j += 2; j < src.length && depth; j++) {
        const c = src[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '`') j = templateEnd(src, j);
        else if (c === '"' || c === "'") j = quoteEnd(src, j);
      }
    } else j++;
  }
  return j;
}

// The source with comments blanked and the inside of every string, template and regex literal replaced by
// underscores. Same length and same line breaks, so a position in one is the position in the other.
function mask(src) {
  let out = '';
  let prev = '';
  const blank = (s) => s.replace(/[^\n]/g, '_');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (c === '"' || c === "'" || c === '`') {
      const j = c === '`' ? templateEnd(src, i) : quoteEnd(src, i);
      out += c + blank(src.slice(i + 1, j)) + (j < src.length ? c : '');
      i = j;
      prev = c;
    } else if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /(?:^|[^\w$])(?:return|typeof|case|in|of)$/.test(out.trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n' && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j++;
      }
      out += '/' + blank(src.slice(i + 1, j)) + (src[j] === '/' ? '/' : '');
      i = j;
      prev = '/';
    } else {
      out += c;
      if (!/\s/.test(c)) prev = c;
    }
  }
  return out;
}

// The index of the bracket that closes the one at `open`, in masked text.
function closeOf(m, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [pairs[m[open]]];
  for (let i = open + 1; i < m.length; i++) {
    const c = m[i];
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

// The function that starts at `at` in masked text, as { head, bodyStart, bodyEnd, block }: `function (..) {..}`,
// `(..) => {..}`, `x => ..`, with `async` before any. bodyStart..bodyEnd is the body, braces left out when it is a block.
function functionAt(m, at) {
  const rest = m.slice(at);
  const fn = new RegExp(`^(?:async\\s+)?function\\b[^(]*\\(`).exec(rest);
  if (fn) {
    const params = at + fn[0].length - 1;
    const afterParams = closeOf(m, params);
    const open = afterParams < 0 ? -1 : m.indexOf('{', afterParams);
    if (open < 0) return null;
    return { bodyStart: open + 1, bodyEnd: closeOf(m, open), block: true, openAt: open };
  }
  const arrow = new RegExp(`^(?:async\\s*)?(?:\\(|${IDENT}\\s*=>)`).exec(rest);
  if (!arrow) return null;
  let arrowAt;
  if (arrow[0].endsWith('(')) {
    const params = at + arrow[0].length - 1;
    const afterParams = closeOf(m, params);
    if (afterParams < 0) return null;
    const after = /^\s*=>/.exec(m.slice(afterParams + 1));
    if (!after) return null;
    arrowAt = afterParams + 1 + after[0].length;
  } else arrowAt = at + arrow[0].length;
  const body = /^\s*/.exec(m.slice(arrowAt))[0].length + arrowAt;
  if (m[body] === '{') return { bodyStart: body + 1, bodyEnd: closeOf(m, body), block: true, openAt: body };
  let end = body;
  for (let depth = 0; end < m.length; end++) {
    const c = m[end];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if ((c === ',' || c === ';') && depth === 0) break;
  }
  return { bodyStart: body, bodyEnd: end, block: false, openAt: body };
}

// Where a named handler is declared, in any of the files: `function name(` or `const name = <function>`.
function findNamed(maskedFiles, name) {
  const decl = new RegExp(`(?:^|\\n)[ \\t]*(?:async\\s+)?function\\s+${name}\\s*\\(|(?:^|\\n)[ \\t]*(?:const|let|var)\\s+${name}\\s*=\\s*(?=(?:async\\b|function\\b|\\(|${IDENT}\\s*=>))`);
  for (const [file, m] of Object.entries(maskedFiles)) {
    const hit = decl.exec(m);
    if (!hit) continue;
    const from = hit.index + hit[0].search(/\S/);
    const start = /^(?:const|let|var)/.test(m.slice(from)) ? hit.index + hit[0].length : from;
    const fn = functionAt(m, start);
    if (fn) return { file, ...fn, declAt: from };
  }
  return null;
}

// The statements of a block body, in masked text, as { text, start }.
function statements(m, from, to) {
  const out = [];
  let i = from;
  const skipSpace = () => { while (i < to && /\s/.test(m[i])) i++; };
  const stop = (j) => { while (j < to && /\s/.test(m[j])) j++; return j; };
  // one statement's end: a `;` at depth 0, or the `}` that ends a block statement
  const endOf = (j, blockEnds) => {
    for (let depth = 0; j < to; j++) {
      const c = m[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0 && c === '}' && blockEnds) return j + 1;
      } else if (c === ';' && depth === 0) return j + 1;
    }
    return to;
  };
  while (true) {
    skipSpace();
    if (i >= to) break;
    const start = i;
    const word = new RegExp(`^(${IDENT})`).exec(m.slice(i, to));
    let end;
    if (word && word[1] === 'if') {
      const paren = m.indexOf('(', i);
      const afterCond = closeOf(m, paren);
      let j = stop(afterCond + 1);
      end = m[j] === '{' ? closeOf(m, j) + 1 : endOf(j, false);
      while (/^else\b/.test(m.slice(stop(end), to))) {
        j = stop(stop(end) + 4);
        if (/^if\b/.test(m.slice(j, to))) {
          const p2 = m.indexOf('(', j);
          j = stop(closeOf(m, p2) + 1);
        }
        end = m[j] === '{' ? closeOf(m, j) + 1 : endOf(j, false);
      }
    } else end = endOf(i, !!word && /^(?:for|while|try|switch|do|function|class)$/.test(word[1]) || m[i] === '{');
    out.push({ text: m.slice(start, end), start });
    i = end;
  }
  return out;
}

const guardCall = (text, guards) => new RegExp(`\\b(?:${guards.join('|')})\\(`).test(text);

// The statement is an `if` whose condition is `cond` and whose body only returns, with no else.
function earlyReturn(text) {
  const paren = text.indexOf('(');
  const close = closeOf(text, paren);
  const rest = text.slice(close + 1).trim();
  return { cond: text.slice(paren, close + 1), inert: /^(?:return\b[^;]*;?|\{\s*return\b[^;]*;?\s*\})$/.test(rest) };
}

// Whether the body (masked text between from and to) reads a guard before it acts.
function guardedBody(m, from, to, guards) {
  for (const st of statements(m, from, to)) {
    const text = st.text.trim();
    if (/^(?:const|let|var)\b/.test(text)) { if (guardCall(text, guards)) return true; continue; }
    if (/^if\b/.test(text)) {
      const { cond, inert } = earlyReturn(text);
      if (guardCall(cond, guards)) return true;
      if (inert) continue;
      return false;
    }
    return new RegExp(`^[!(\\s]*(?:${guards.join('|')})\\(`).test(text);
  }
  return false;
}

// A body that is one call `name(x)`: the plain name it delegates to.
function delegateOf(m, fn) {
  const body = m.slice(fn.bodyStart, fn.bodyEnd).trim();
  const hit = new RegExp(`^(?:return\\s+)?(${IDENT})\\(\\s*${IDENT}\\s*\\)\\s*;?$`).exec(body);
  return hit ? hit[1] : null;
}

// Whether a function (as functionAt describes it, in masked text m) reads a guard before it acts.
function guardsFirst(m, fn, guards) {
  if (fn.block) return guardedBody(m, fn.bodyStart, fn.bodyEnd, guards);
  return new RegExp(`^[!(\\s]*(?:${guards.join('|')})\\(`).test(m.slice(fn.bodyStart, fn.bodyEnd));
}

// The lines of the file a marker may sit on, for a function: where it is declared and its first body line.
function markerLines(src, declAt, openAt) {
  const nl = src.indexOf('\n', openAt);
  return [lineText(src, declAt), nl < 0 ? '' : lineText(src, nl + 1)];
}

// How the handler that starts at `from` fares: { ok: true }, or { why, lines } with the lines a marker may sit on.
function checkHandler(masked, text, file, from, guards) {
  const m = masked[file];
  const start = from + /^\s*/.exec(m.slice(from))[0].length;
  const named = new RegExp(`^(${IDENT})\\s*(?=[,)])`).exec(m.slice(start));
  if (named) {
    const found = findNamed(masked, named[1]);
    if (!found) return { why: `names the handler ${named[1]}, which is not declared in any scanned file`, lines: [] };
    if (guardsFirst(masked[found.file], found, guards)) return { ok: true };
    return { why: 'does not call a keyGuard function before it acts', lines: markerLines(text[found.file], found.declAt, found.openAt) };
  }
  const fn = functionAt(m, start);
  const lines = fn ? markerLines(text[file], start, fn.openAt) : [];
  if (!fn) return { why: `can't check this handler form (${text[file].slice(start, start + 24).split('\n')[0].trim()}...); use a plain name or an inline function`, lines };
  if (guardsFirst(m, fn, guards)) return { ok: true };
  const called = new RegExp(`^(?:return\\s+)?(${IDENT})\\(\\s*${IDENT}\\s*\\)\\s*;?$`).exec(m.slice(fn.bodyStart, fn.bodyEnd).trim());
  if (called && !/^keyGuard/.test(called[1])) {
    const inner = findNamed(masked, called[1]);
    if (!inner) return { why: `delegates to ${called[1]}, which is not declared in any scanned file`, lines };
    if (guardsFirst(masked[inner.file], inner, guards)) return { ok: true };
    return { why: `delegates to ${called[1]}, which does not call a keyGuard function before it acts`, lines };
  }
  return { why: 'does not call a keyGuard function before it acts', lines };
}

// The listeners in `files` ({ name: text }) that neither read the key guard nor carry the marker.
function keyListenerOffenders(files, guards) {
  const text = {};
  const masked = {};
  for (const [file, src] of Object.entries(files)) {
    text[file] = normalize(src);
    masked[file] = mask(text[file]);
  }
  const offenders = [];
  for (const file of Object.keys(files)) {
    const src = text[file];
    const m = masked[file];
    const aliases = [...m.matchAll(new RegExp(`(?:^|[;\\n{}])[ \\t]*(?:(?:const|let|var)\\s+)?(${IDENT})\\s*=\\s*(?:document|window)[ \\t]*(?=[;,\\n])`, 'g'))].map((a) => a[1].replace(/\$/g, '\\$'));
    const root = ['document\\.body', 'document\\.documentElement', 'document', 'window', ...aliases].join('|');
    const report = (at, what, extra = []) => {
      const lineStart = src.lastIndexOf('\n', at - 1);
      const lines = [lineText(src, at), lineStart > 0 ? lineText(src, lineStart) : '', ...extra];
      if (lines.some((l) => MARKER.test(l))) return;
      const malformed = lines.some((l) => MARKER_LIKE.test(l));
      offenders.push(`${file}:${lineOf(src, at)}: ${what}${malformed ? ' (a key-guard comment is there but not in that shape)' : ''}`);
    };

    for (const hit of m.matchAll(/(?<![\w$.])(?:document|window)\s*\.\s*on(keydown|keyup|keypress)\s*=(?!=)/g)) {
      report(hit.index, `document-level on${hit[1]} assignment: put the handler through addEventListener and the key guard, or mark it "// key-guard: exempt (<reason>)"`);
    }

    for (const hit of m.matchAll(new RegExp(`(?<![\\w$.])(${root})\\s*\\.\\s*addEventListener\\s*\\(`, 'g'))) {
      const open = hit.index + hit[0].length - 1;
      const close = closeOf(m, open);
      let comma = -1;
      for (let i = open + 1, depth = 0; i < close; i++) {
        if ('([{'.includes(m[i])) depth++;
        else if (')]}'.includes(m[i])) depth--;
        else if (m[i] === ',' && depth === 0) { comma = i; break; }
      }
      const typeText = src.slice(open + 1, comma < 0 ? close : comma).trim();
      const literal = /^(['"`])(\w+)\1$/.exec(typeText);
      if (literal && !KEY_TYPES.has(literal[2])) continue;
      if (!literal) {
        report(hit.index, `${hit[1]}.addEventListener(${typeText}, ...) names its event type in a variable: the scan can't tell whether it is a key listener; use a literal, or mark it "// key-guard: exempt (<reason>)"`);
        continue;
      }
      if (!/^(?:document|window|document\.body|document\.documentElement)$/.test(hit[1])) {
        report(hit.index, `${hit[1]} is an alias of document or window and listens for ${literal[2]}: use document or window directly, or mark it "// key-guard: exempt (<reason>)"`);
        continue;
      }
      if (comma < 0) continue;
      const verdict = checkHandler(masked, text, file, comma + 1, guards);
      if (!verdict.ok) report(hit.index, `a document-level ${literal[2]} listener: ${verdict.why}; if it rightly stands outside the guard, mark it "// key-guard: exempt (<reason>)"`, verdict.lines);
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

const one = (src) => keyListenerOffenders({ 'a.js': src }, GUARDS);

test('a guard named only in a comment or a string does not count', () => {
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  // keyGuardOff(document) would be wrong here\n  run(e);\n});\n").length, 1);
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  /* if (keyGuardOff(document)) return; */\n  run(e);\n});\n").length, 1);
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  log('keyGuardOff(document)');\n  run(e);\n});\n").length, 1);
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  log(`keyGuardOff(document)`);\n  run(e);\n});\n").length, 1);
  assert.strictEqual(one("function onQ(e) {\n  // keyGuardOff(document)\n  run(e);\n}\ndocument.addEventListener('keydown', onQ);\n").length, 1);
});

test('a guard that comes after the handler has acted does not count', () => {
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  run(e);\n  if (keyGuardOff(document)) return;\n});\n").length, 1);
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  e.preventDefault();\n  if (keyGuardOff(document)) return;\n  run(e);\n});\n").length, 1);
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  if (e.key === 'q') { run(e); }\n  if (keyGuardOff(document)) return;\n});\n").length, 1);
  assert.strictEqual(one("document.addEventListener('keydown', (e) => {\n  if (e.key === 'q') { run(e); if (keyGuardOff(document)) return; }\n});\n").length, 1);
});

test('a guard before the first effect counts: after key checks, declarations and early returns', () => {
  assert.deepStrictEqual(one("document.addEventListener('keydown', (e) => {\n  if (e.key !== 'q') return;\n  const box = $('#q');\n  if (!box) { return; }\n  if (keyGuardOff(document)) return;\n  run(e);\n});\n"), []);
  assert.deepStrictEqual(one("document.addEventListener('keydown', (e) => {\n  const off = keyGuardOff(document);\n  if (off) return;\n  run(e);\n});\n"), []);
  assert.deepStrictEqual(one("document.addEventListener('keydown', (e) => {\n  const r = hotkey(e, { surfaceOpen: keyGuardSurface(document) !== null });\n  if (!r) return;\n  run(e);\n});\n"), []);
  assert.deepStrictEqual(one("document.addEventListener('keydown', (e) => {\n  if (e.key !== 'q' || keyGuardOff(document)) return;\n  run(e);\n});\n"), []);
  assert.deepStrictEqual(one("document.addEventListener('keydown', (e) => {\n  if (keyGuardOff(document)) { toast('no'); return; }\n  run(e);\n});\n"), []);
});

test('a handler that is neither a plain name nor an inline function is reported, not judged on another function', () => {
  const guarded = "function other(e) { if (keyGuardOff(document)) return; }\nconst later = () => {};\n";
  for (const handler of ['obj.onKey', 'fn.bind(x)', 'make()', 'cond ? a : b', 'handlers[0]']) {
    const found = one(`${guarded}document.addEventListener('keydown', ${handler});\nconst z = () => { if (keyGuardOff(document)) return; };\n`);
    assert.strictEqual(found.length, 1, handler);
    assert.match(found[0], /can't check this handler form/, handler);
  }
  assert.deepStrictEqual(one("document.addEventListener('keydown', obj.onKey); // key-guard: exempt (obj guards it)\n"), []);
});

test('document.onkeydown, an alias of document or window, and an event type held in a variable are reported', () => {
  assert.match(one("document.onkeydown = (e) => { run(e); };\n")[0], /onkeydown/);
  assert.match(one("window.onkeyup = function (e) { run(e); };\n")[0], /onkeyup/);
  assert.strictEqual(one("document.onkeypress = null;\n").length, 1, 'even an assignment is for a person to read');
  const alias = one("const d = document;\nd.addEventListener('keydown', (e) => { run(e); });\n");
  assert.strictEqual(alias.length, 1);
  assert.match(alias[0], /^a\.js:2: /);
  assert.strictEqual(one("let w = window;\nw.addEventListener('keyup', (e) => { if (keyGuardOff(document)) return; run(e); });\n").length, 1, 'an alias is reported even with a guarded handler: a person decides');
  const dynamic = one("const type = 'keydown';\ndocument.addEventListener(type, (e) => { run(e); });\n");
  assert.strictEqual(dynamic.length, 1);
  assert.match(dynamic[0], /event type/);
  for (const marked of [
    "document.onkeydown = (e) => { run(e); }; // key-guard: exempt (a test hook)\n",
    "const d = document;\nd.addEventListener('keydown', (e) => { run(e); }); // key-guard: exempt (acts on nothing)\n",
    "document.addEventListener(type, (e) => { run(e); }); // key-guard: exempt (not a key type)\n",
  ]) assert.deepStrictEqual(one(marked), [], marked);
  assert.deepStrictEqual(one("const d = document;\nd.addEventListener('click', (e) => { run(e); });\ndocument.addEventListener('DOMContentLoaded', () => {});\n"), [], 'other literal event types are not key listeners');
});

test('one level of plain delegation follows to a named handler', () => {
  const named = "function onK(e) {\n  if (keyGuardOff(document)) return;\n  run(e);\n}\n";
  assert.deepStrictEqual(one(`${named}document.addEventListener('keydown', (e) => onK(e));\n`), []);
  assert.deepStrictEqual(one(`${named}document.addEventListener('keydown', (e) => { onK(e); });\n`), []);
  assert.deepStrictEqual(one(`${named}document.addEventListener('keydown', function (ev) { return onK(ev); });\n`), []);
  const bare = "function onK(e) {\n  run(e);\n}\n";
  assert.strictEqual(one(`${bare}document.addEventListener('keydown', (e) => onK(e));\n`).length, 1, 'delegating to an unguarded handler');
  assert.strictEqual(one("document.addEventListener('keydown', (e) => onGone(e));\n").length, 1, 'delegating to a handler declared nowhere');
  const twice = "function inner(e) {\n  if (keyGuardOff(document)) return;\n}\nfunction onK(e) { inner(e); }\n";
  assert.strictEqual(one(`${twice}document.addEventListener('keydown', (e) => onK(e));\n`).length, 1, 'only one level is followed');
});

function pageScripts() {
  const files = {};
  for (const f of fs.readdirSync(WEB).filter((n) => n.endsWith('.js'))) files[`skills/web/web/${f}`] = fs.readFileSync(path.join(WEB, f), 'utf8');
  return files;
}

test('the mask keeps every page script the same length and its brackets balanced', () => {
  for (const [file, src] of Object.entries(pageScripts())) {
    const text = normalize(src);
    const m = mask(text);
    assert.strictEqual(m.length, text.length, file);
    for (const [open, close] of ['{}', '()', '[]']) {
      assert.strictEqual(m.split(open).length, m.split(close).length, `${file}: ${open}${close} balance after masking`);
    }
  }
});

test('the real scan is not vacuous: breaking a guard name in a page script is found', () => {
  const files = pageScripts();
  const exported = ['keyGuardTyping', 'keyGuardSurface', 'keyGuardOff', 'keyGuardDetailOff', 'keyGuardEscape'];
  assert.deepStrictEqual(keyListenerOffenders(files, exported), []);
  files['skills/web/web/isolate.js'] = files['skills/web/web/isolate.js'].replace('if (keyGuardOff(document)) return;', 'if (keyGuardOf(document)) return;');
  const found = keyListenerOffenders(files, exported);
  assert.strictEqual(found.length, 1);
  assert.match(found[0], /^skills\/web\/web\/isolate\.js:\d+: /);
});

test('every document-level key listener in the page scripts reads the key guard or carries a reasoned exemption', () => {
  const files = pageScripts();
  const exported = /module\.exports\s*=\s*\{([^}]*)\}/.exec(files['skills/web/web/key-guard.js'])[1].split(',').map((s) => s.trim()).filter((n) => /^keyGuard[A-Z]/.test(n));
  assert.deepStrictEqual(exported.slice().sort(), GUARDS.slice().sort(), 'key-guard.js exports the functions this scan counts as the guard');
  assert.deepStrictEqual(keyListenerOffenders(files, exported), []);
});
