const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Generated content joins an element's accessible name in the engines that read it: a screen reader
// would speak "right-pointing triangle" after a button called Relatives. Every `content:` that draws
// something therefore carries the alt-text form `content: <value> / ""`, which keeps the glyph on the
// screen and out of the name; `/ "<text>"` is accepted where the glyph means something. An engine
// without alt text drops the whole declaration, so the plain line goes right before the alt line, and
// that pair is the one shape the scan accepts for a plain value. Empty content (`""`, `none`, `normal`)
// draws nothing and a counter or a quote is a number or a mark of its own, so those need no alt.

const WEB = path.join(__dirname, '..', 'web');

const EMPTY = new Set(['""', "''", 'none', 'normal']);
const PURE = /^(?:(?:counters?\([^)]*\)|open-quote|close-quote|no-open-quote|no-close-quote)\s*)+$/;

// The stylesheet with comments blanked and the inside of every string masked, so that a word, a
// semicolon or a brace in a string is not read as CSS. Same length, so positions line up.
function mask(css) {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (c === '"' || c === "'") {
      out += c;
      for (i++; i < css.length && css[i] !== c; i++) {
        if (css[i] === '\\') { out += '__'; i++; } else out += '_';
      }
      out += css[i] || '';
    } else out += c;
  }
  return out;
}

// The content declarations of a stylesheet, in order: their line, their value, and what lies between
// the end of one and the start of the next.
function contentDecls(css) {
  const masked = mask(css);
  const found = [];
  const re = /(?<=[{;]\s*)content\s*:/g;
  let m;
  while ((m = re.exec(masked))) {
    let i = re.lastIndex;
    let depth = 0;
    for (; i < masked.length; i++) {
      const c = masked[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if ((c === ';' || c === '}') && depth <= 0) break;
    }
    found.push({ start: m.index, end: i, line: masked.slice(0, m.index).split('\n').length, value: css.slice(re.lastIndex, i).replace(/\s*!important\s*$/, '').trim() });
    re.lastIndex = i;
  }
  return found.map((d, n) => ({ ...d, between: found[n + 1] ? masked.slice(d.end, found[n + 1].start) : null }));
}

// Counters and quotes, with any strings between them.
function isPure(value) {
  const rest = value.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').trim();
  return rest !== '' && PURE.test(rest);
}

// Splits `<value> / <alt>` at the one slash outside quotes and parentheses.
function splitAlt(value) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '/' && depth === 0) return { base: value.slice(0, i).trim(), alt: value.slice(i + 1).trim() };
  }
  return null;
}

const ALT = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

function contentOffenders(css, file = 'x.css') {
  const offenders = [];
  const decls = contentDecls(css);
  decls.forEach((d, n) => {
    if (EMPTY.has(d.value) || isPure(d.value)) return;
    const parts = splitAlt(d.value);
    if (parts) {
      if (!ALT.test(parts.alt)) offenders.push(`${file}:${d.line}: content "${d.value}" has an alt that is not a string`);
      return;
    }
    const after = decls[n + 1];
    if (after && /^\s*;?\s*$/.test(d.between)) {
      const pair = splitAlt(after.value);
      if (pair && pair.base === d.value && ALT.test(pair.alt)) return;
    }
    offenders.push(`${file}:${d.line}: content: ${d.value} has no alt text, so the glyph is read in the accessible name; write content: ${d.value} / "";`);
  });
  return offenders;
}

test('the scan finds a plain glyph and names its file and line', () => {
  const css = '.a { color: red; }\n.a::after { content: "\\25B8"; }\n';
  const found = contentOffenders(css, 'planted.css');
  assert.strictEqual(found.length, 1);
  assert.match(found[0], /^planted\.css:2: /);
});

test('a plain attr(), a plain string and a plain url() are all found', () => {
  for (const value of ['attr(data-key)', '"x"', "'x'", 'url(a.png)', '"a" attr(data-b)']) {
    assert.strictEqual(contentOffenders(`.a::before { content: ${value}; margin: 0 }`).length, 1, value);
  }
});

test('the alt form passes, with an empty alt or a text one', () => {
  for (const decl of ['content: "\\25B8" / "";', 'content: attr(data-key) / "";', 'content: "\\2713" / "done";', "content: 'x' / '';", 'content: url(a.png) / "icon"']) {
    assert.deepStrictEqual(contentOffenders(`.a::after { ${decl} }`), [], decl);
  }
});

test('an alt that is not a string is found', () => {
  assert.strictEqual(contentOffenders('.a::after { content: "x" / attr(title); }').length, 1);
});

test('empty content, a counter and a quote need no alt', () => {
  for (const decl of ['content: "";', "content: '';", 'content: none;', 'content: normal;', 'content: counter(item);', 'content: counter(a) "." counter(b);', 'content: open-quote;', 'content: close-quote']) {
    assert.deepStrictEqual(contentOffenders(`.a::before { ${decl} }`), [], decl);
  }
});

test('a plain line right before its own alt line passes, and nothing else does', () => {
  const pair = '.a::after { content: "\\25B8"; content: "\\25B8" / ""; margin: 0; }';
  assert.deepStrictEqual(contentOffenders(pair), []);
  const other = '.a::after { content: "\\25B8"; content: "\\25BE" / ""; }';
  assert.strictEqual(contentOffenders(other).length, 1, 'the alt line is for another glyph');
  const apart = '.a::after { content: "x"; color: red; content: "x" / ""; }';
  assert.strictEqual(contentOffenders(apart).length, 1, 'a declaration between them');
  const rules = '.a::after { content: "x"; }\n.b::after { content: "x" / ""; }';
  assert.strictEqual(contentOffenders(rules).length, 1, 'the next line is another rule');
  const after = '.a::after { content: "x" / ""; content: "x"; }';
  assert.strictEqual(contentOffenders(after).length, 1, 'the plain line after the alt line wins in a browser that reads both');
});

test('align-content, justify-content, a comment and a string holding the word are not content declarations', () => {
  const css = '.a { align-content: flex-start; justify-content: center; place-content: center; }\n/* content: "x"; */\n.b::after { content: "a; content: b" / ""; }\n';
  assert.deepStrictEqual(contentOffenders(css), []);
});

test('a selector holding content: is not a declaration', () => {
  const css = '.content:hover { color: red; }\n.card .content:focus-within::after { content: "" }\na.content:not(.x) { margin: 0 }\n.b::after { color: red;content : "x"; }\n';
  const found = contentOffenders(css);
  assert.strictEqual(found.length, 1, found.join('\n'));
  assert.match(found[0], /^x\.css:4: /);
});

test('!important after the alt form is still the alt form, and after a plain value it is still plain', () => {
  assert.deepStrictEqual(contentOffenders('.a::after { content: "x" / "" !important; }'), []);
  assert.deepStrictEqual(contentOffenders('.a::after { content: "x" / "y"!important; }'), []);
  assert.deepStrictEqual(contentOffenders('.a::after { content: "" !important; }'), []);
  assert.strictEqual(contentOffenders('.a::after { content: "x" !important; }').length, 1);
  assert.deepStrictEqual(contentOffenders('.a::after { content: "x" !important; content: "x" / "" !important; }'), []);
});

test('a semicolon or a brace inside the string does not end the value early', () => {
  assert.strictEqual(contentOffenders('.a::after { content: "}"; }').length, 1);
  assert.deepStrictEqual(contentOffenders('.a::after { content: ";}" / ""; }'), []);
});

test('every generated content in the page stylesheets keeps out of the accessible name', () => {
  const dir = fs.readdirSync(WEB).filter((n) => n.endsWith('.css'));
  assert.ok(dir.includes('app.css'));
  let seen = 0;
  for (const f of dir) {
    const css = fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
    seen += contentDecls(css).length;
    assert.deepStrictEqual(contentOffenders(css, `skills/web/web/${f}`), []);
  }
  assert.ok(seen > 10, 'sanity: the scan saw the content declarations');
});
