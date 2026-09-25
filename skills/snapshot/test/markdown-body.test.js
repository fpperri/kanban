const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Card bodies render as markdown (kanban.proj #274 goals 4+5), replacing
// the old fmtBodySegs/bodyNode pre-wrap div. mdBlocks() is a PURE parser
// (text -> data, no DOM), ported feature-for-feature from skills/web/web/
// app.js's mdToHtml. Unlike the rest of the snapshot's JS, mdInline()/
// mdBlocks()/notif-split code contain regex with backslashes, and
// build_editor.py's TEMPLATE is a plain (non-raw) triple-quoted Python
// string — every backslash in the .py SOURCE TEXT is therefore doubled
// (Python un-escapes `\\d` to `\d`). Extracting straight from the .py
// source text and running it via `new Function()` (the technique
// format-body.test.js and friends use for backslash-free functions like
// fmtBodySegs) would silently run the WRONG regex here. So this file
// actually builds a tiny fixture board through build_editor.py once (also
// exercising the real Python "bl" field, goal 5) and extracts every
// function it needs from THAT generated HTML instead, where Python has
// already un-escaped everything correctly.

const buildScript = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const skillSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build_editor.py'), 'utf8');

let tmpDir, html, data;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-md-test-'));
  fs.writeFileSync(path.join(tmpDir, 'config.yaml'), [
    'name: Fixture Board',
    'statuses: [backlog, todo, doing, done]',
    'assignees:',
    '  - handle: "@human"',
  ].join('\n'));
  const longBody = 'x'.repeat(5000);
  const shortBody = 'short body';
  fs.writeFileSync(path.join(tmpDir, '0001.long.card.md'), `---\nid: 1\nstatus: todo\n---\n# Long\n${longBody}\n`);
  fs.writeFileSync(path.join(tmpDir, '0002.short.card.md'), `---\nid: 2\nstatus: todo\n---\n# Short\n${shortBody}\n`);
  const archDir = path.join(tmpDir, 'archived');
  fs.mkdirSync(archDir);
  fs.writeFileSync(path.join(archDir, '0003.archlong.card.md'), `---\nid: 3\nstatus: done\n---\n# Arch long\n${longBody}\n`);
  fs.writeFileSync(path.join(tmpDir, 'notifications.md'), '');

  const outHtml = path.join(tmpDir, 'out.html');
  execFileSync('python', [buildScript, tmpDir, '--out', outHtml], { encoding: 'utf8' });
  html = fs.readFileSync(outHtml, 'utf8');
  const dataMatch = /const DATA=(\[[\s\S]*?\]);\s*\nconst NOTIFS=/.exec(html);
  assert.ok(dataMatch, 'could not find const DATA=... in the built HTML');
  data = JSON.parse(dataMatch[1]);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in the built HTML`);
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < html.length && html[i] !== q) {
        if (html[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}
function extractConst(name) {
  const marker = `const ${name}=`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in the built HTML`);
  const end = html.indexOf('\n', start);
  return html.slice(start, end);
}

let md;
before(() => {
  const harness = [
    extractConst('TABLE_DELIM_RE'),
    extractFunction('splitRow'),
    extractFunction('mdInline'),
    extractFunction('mdBlocks'),
    extractFunction('thousands'),
    'module.exports = { mdBlocks, mdInline, thousands, TABLE_DELIM_RE };',
  ].join('\n');
  md = new Function('module', 'exports', harness + '\nreturn module.exports;')({ exports: {} }, {});
});

// --- mdBlocks: headings, paragraphs -----------------------------------------

test('mdBlocks: a heading and a paragraph with inline formatting', () => {
  const blocks = md.mdBlocks('# Title\n\nSome text with **bold** and `code`.');
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].t, 'h');
  assert.strictEqual(blocks[0].level, 1);
  assert.deepStrictEqual(blocks[0].inline, [{ t: 'text', v: 'Title' }]);
  assert.strictEqual(blocks[1].t, 'p');
  assert.deepStrictEqual(blocks[1].inline, [
    { t: 'text', v: 'Some text with ' },
    { t: 'bold', v: 'bold' },
    { t: 'text', v: ' and ' },
    { t: 'code', v: 'code' },
    { t: 'text', v: '.' },
  ]);
});

test('mdBlocks: ##/### headings and consecutive lines join into one paragraph', () => {
  const blocks = md.mdBlocks('## Two\nline a\nline b');
  assert.strictEqual(blocks[0].level, 2);
  assert.strictEqual(blocks[1].t, 'p');
  assert.deepStrictEqual(blocks[1].inline, [{ t: 'text', v: 'line a line b' }]);
});

// --- mdBlocks: lists, nesting, tasks, lazy continuation ---------------------

test('mdBlocks: a flat list', () => {
  const blocks = md.mdBlocks('- one\n- two');
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].t, 'ul');
  assert.strictEqual(blocks[0].items.length, 2);
  assert.deepStrictEqual(blocks[0].items[0].inline, [{ t: 'text', v: 'one' }]);
});

test('mdBlocks: indent-depth nesting produces a child list on the parent item', () => {
  const blocks = md.mdBlocks('- a\n  - b\n  - c\n- d');
  const items = blocks[0].items;
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].children.length, 2);
  assert.deepStrictEqual(items[0].children[0].inline, [{ t: 'text', v: 'b' }]);
  assert.strictEqual(items[1].children, undefined);
});

test('mdBlocks: task items carry done/open, distinct from a plain item (task: null)', () => {
  const blocks = md.mdBlocks('- [ ] open one\n- [x] done one\n- [X] done two (capital X)\n- plain');
  const items = blocks[0].items;
  assert.strictEqual(items[0].task, 'open');
  assert.strictEqual(items[1].task, 'done');
  assert.strictEqual(items[2].task, 'done');
  assert.strictEqual(items[3].task, null);
});

test('mdBlocks: a lazy continuation line (no leading "-") joins the last item, not a new paragraph', () => {
  const blocks = md.mdBlocks('- first item\n  continues here\n- second');
  const items = blocks[0].items;
  assert.deepStrictEqual(items[0].inline, [
    { t: 'text', v: 'first item' },
    { t: 'text', v: ' ' },
    { t: 'text', v: 'continues here' },
  ]);
  assert.strictEqual(items.length, 2);
});

test('mdBlocks: a blank line closes the list — text after it is a new paragraph, not a continuation', () => {
  const blocks = md.mdBlocks('- item\n\nafter');
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].t, 'ul');
  assert.strictEqual(blocks[1].t, 'p');
});

// --- mdBlocks: fenced code ---------------------------------------------------

test('mdBlocks: a fenced code block is captured verbatim, no inline parsing inside it', () => {
  const blocks = md.mdBlocks('```\nline with **not bold**\nand `not code` either\n```');
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].t, 'pre');
  assert.strictEqual(blocks[0].code, 'line with **not bold**\nand `not code` either');
});

test('mdBlocks: an UNTERMINATED fenced code block still renders without throwing', () => {
  assert.doesNotThrow(() => md.mdBlocks('```\nhello\nnever closed'));
  const blocks = md.mdBlocks('```\nhello\nnever closed');
  assert.strictEqual(blocks[0].t, 'pre');
  assert.strictEqual(blocks[0].code, 'hello\nnever closed');
});

// --- mdBlocks: pipe tables, including ragged rows ---------------------------

test('mdBlocks: a well-formed table', () => {
  const blocks = md.mdBlocks('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.strictEqual(blocks[0].t, 'table');
  assert.strictEqual(blocks[0].head.length, 2);
  assert.strictEqual(blocks[0].rows.length, 2);
  assert.deepStrictEqual(blocks[0].rows[0][1], [{ t: 'text', v: '2' }]);
});

test('mdBlocks: a ragged row is padded to the header width, an over-long row is truncated', () => {
  const blocks = md.mdBlocks('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
  const rows = blocks[0].rows;
  assert.strictEqual(rows[0].length, 3);
  assert.deepStrictEqual(rows[0][1], []); // padded empty cell
  assert.deepStrictEqual(rows[0][2], []);
  assert.strictEqual(rows[1].length, 3); // the 4th cell is truncated away
});

test('mdBlocks: a line of pipes with no delimiter row underneath stays ordinary prose', () => {
  const blocks = md.mdBlocks('a sentence | with a pipe | in it');
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].t, 'p');
});

test('mdBlocks: a body cut mid-table renders the rows it has and does not throw', () => {
  assert.doesNotThrow(() => md.mdBlocks('before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3'));
  const blocks = md.mdBlocks('before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3');
  const table = blocks.find((b) => b.t === 'table');
  assert.ok(table);
  assert.strictEqual(table.rows.length, 2);
  assert.deepStrictEqual(table.rows[1][0], [{ t: 'text', v: '3' }]);
});

// --- mdBlocks: hr -------------------------------------------------------------

test('mdBlocks: --- alone on a line is a rule', () => {
  const blocks = md.mdBlocks('above\n\n---\n\nbelow');
  assert.strictEqual(blocks[1].t, 'hr');
});

// --- mdInline: bold/italic/code/links, mentions, url scheme filtering -------

test('mdInline: **bold** and *italic* are distinct token types', () => {
  assert.deepStrictEqual(md.mdInline('**bold** and *italic*'), [
    { t: 'bold', v: 'bold' },
    { t: 'text', v: ' and ' },
    { t: 'italic', v: 'italic' },
  ]);
});

test('mdInline: a code span whose content matches board#id is still just a plain code token here — mention CLASSIFICATION happens in codeSegNode at DOM-build time', () => {
  const toks = md.mdInline('see `MyBoard#42 fix the thing` for detail');
  const codeTok = toks.find((t) => t.t === 'code');
  assert.strictEqual(codeTok.v, 'MyBoard#42 fix the thing');
});

test('mdInline: [text](url) keeps the url only for http/https/mailto/#//-prefixed schemes, else falls back to "#"', () => {
  assert.strictEqual(md.mdInline('[a](https://x.test)')[0].href, 'https://x.test');
  assert.strictEqual(md.mdInline('[a](http://x.test)')[0].href, 'http://x.test');
  assert.strictEqual(md.mdInline('[a](mailto:x@y.test)')[0].href, 'mailto:x@y.test');
  assert.strictEqual(md.mdInline('[a](#section)')[0].href, '#section');
  assert.strictEqual(md.mdInline('[a](/local)')[0].href, '/local');
  assert.strictEqual(md.mdInline('[a](javascript:alert(1))')[0].href, '#');
});

// --- the "bl" field (goal 5): Python records the UNCAPPED length ------------

test('parse_card records "bl" as the uncapped body length, independent of either 4000/1500 truncation', () => {
  const long = data.find((c) => c.id === 1);
  const short = data.find((c) => c.id === 2);
  const archLong = data.find((c) => c.id === 3);
  assert.strictEqual(long.bl, 5000);
  assert.strictEqual(long.body.length, 4000, 'live cards cap at 4000');
  assert.strictEqual(short.bl, short.body.length, 'an uncapped body reports bl === body.length');
  assert.strictEqual(archLong.bl, 5000, 'bl reflects the TRUE original length, unaffected by the archived re-cap');
  assert.strictEqual(archLong.body.length, 1500, 'archived cards re-cap at 1500');
});

test('build_editor.py source: parse_card sets "bl" from the pre-truncation full_body, and archived re-capping never touches it', () => {
  assert.match(skillSrc, /"bl": len\(full_body\),/);
  assert.match(skillSrc, /"body": full_body\[:4000\],/);
  assert.match(skillSrc, /c\["body"\] = c\["body"\]\[:1500\]/);
  // the archived re-cap block only reassigns "body", never "bl"
  const archBlockStart = skillSrc.indexOf('c["arch"] = True');
  const archBlockEnd = skillSrc.indexOf('cards.append(c)', archBlockStart);
  const archBlock = skillSrc.slice(archBlockStart, archBlockEnd);
  assert.ok(!archBlock.includes('"bl"') && !archBlock.includes("c['bl']") && !archBlock.includes('c["bl"]'), 'archived re-cap must not touch bl');
});

// --- cut notice (goal 5): mdBodyNode appends it only when bl > embedded length ---

test('mdBodyNode source: appends the cut <div class="cut"> only when bl exceeds the embedded body\'s own length', () => {
  const src = extractFunction('mdBodyNode');
  assert.match(src, /if\(trueLen>shownLen\)/);
  assert.match(src, /el\("div","cut",/);
});

test('thousands(): comma-separates regardless of locale', () => {
  assert.strictEqual(md.thousands(8138), '8,138');
  assert.strictEqual(md.thousands(4000), '4,000');
  assert.strictEqual(md.thousands(999), '999');
  assert.strictEqual(md.thousands(1000000), '1,000,000');
});

// --- never innerHTML ---------------------------------------------------------

test('mdBodyNode/mdListNode/mdInlineNodes/codeSegNode never build the body via innerHTML — el()/textContent only', () => {
  ['mdBodyNode', 'mdListNode', 'mdInlineNodes', 'codeSegNode'].forEach((name) => {
    const fnSrc = extractFunction(name);
    assert.ok(!fnSrc.includes('innerHTML'), `${name} must never touch innerHTML`);
  });
});

test('the card-sheet render path calls mdBodyNode(c.body,BOARD,c.bl), not the old bodyNode()', () => {
  assert.match(html, /d\.appendChild\(mdBodyNode\(c\.body,BOARD,c\.bl\)\)/);
  assert.ok(!html.includes('function bodyNode('), 'the old bodyNode() must be fully retired');
  assert.ok(!html.includes('"bodytxt"'), 'the old .bodytxt div must be fully retired');
});

// --- DOM-level: mention rendering, cut notice --------------------------------
// node --test has no real DOM and this repo has no jsdom dependency, so this
// is a minimal hand-rolled `document`/`el` stub — just enough surface
// (createElement/createTextNode, classList.add/contains, setAttribute/
// getAttribute, appendChild, textContent) to actually execute codeSegNode()/
// mdBodyNode()/mdListNode() and assert on the resulting node tree, rather
// than only pattern-matching their source text.

class FakeNode {
  constructor(tag) {
    this.tagName = tag ? tag.toUpperCase() : undefined;
    this.childNodes = [];
    this._classes = [];
    this._attrs = {};
    this._text = undefined;
  }
  get classList() {
    const self = this;
    return {
      add: (...names) => { names.forEach((n) => { if (!self._classes.includes(n)) self._classes.push(n); }); },
      contains: (n) => self._classes.includes(n),
    };
  }
  set className(v) { this._classes = v ? String(v).split(' ').filter(Boolean) : []; }
  get className() { return this._classes.join(' '); }
  appendChild(child) { this.childNodes.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  set textContent(v) { this.childNodes = []; this._text = v; }
  get textContent() {
    if (this.childNodes.length === 0) return this._text || '';
    return this.childNodes.map((c) => c.textContent).join('');
  }
}
const fakeDocument = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (data) => ({ nodeType: 3, data, textContent: data }),
};

function domHarness(fnNames) {
  const elSrc = extractConst('el');
  const parts = fnNames.map((n) => extractFunction(n));
  const body = [elSrc, ...parts, `module.exports = { ${fnNames.join(', ')}, el };`].join('\n');
  return new Function('document', 'module', 'exports', body + '\nreturn module.exports;')(fakeDocument, { exports: {} }, {});
}

// The mention regex's board-name capture (`[^\s#\x60]+`) is whitespace-free
// by design — real board names are single tokens (e.g. "kanban.proj"), so
// these use single-word board names rather than the space-bearing fixture
// board name used elsewhere in this file.
test('codeSegNode: a same-board mention gets class="mention same" and a data-mapnode id (openable the way the snapshot opens cards elsewhere)', () => {
  const dom = domHarness(['codeSegNode']);
  const node = dom.codeSegNode('MyBoard#42 fix the thing', 'MyBoard');
  assert.strictEqual(node.tagName, 'CODE');
  assert.strictEqual(node.textContent, 'MyBoard#42 fix the thing');
  assert.ok(node.classList.contains('mention'));
  assert.ok(node.classList.contains('same'));
  assert.strictEqual(node.getAttribute('data-mapnode'), '42');
});

test('codeSegNode: a DIFFERENT board\'s mention gets class="mention" but not "same", and no data-mapnode (nothing to open on this board)', () => {
  const dom = domHarness(['codeSegNode']);
  const node = dom.codeSegNode('OtherBoard#7 title', 'MyBoard');
  assert.ok(node.classList.contains('mention'));
  assert.ok(!node.classList.contains('same'));
  assert.strictEqual(node.getAttribute('data-mapnode'), null);
});

test('codeSegNode: ordinary code (no board#id shape) gets neither mention class', () => {
  const dom = domHarness(['codeSegNode']);
  const node = dom.codeSegNode('just some code', 'MyBoard');
  assert.ok(!node.classList.contains('mention'));
  assert.ok(!node.classList.contains('same'));
});

test('mdBodyNode: a body shorter than bl gets a trailing .cut node with thousands-separated counts; a body equal to bl does not', () => {
  const withSplitRow = new Function('document', 'module', 'exports', [
    extractConst('TABLE_DELIM_RE'),
    extractFunction('splitRow'),
    extractConst('el'),
    extractFunction('codeSegNode'),
    extractFunction('mdInline'),
    extractFunction('mdInlineNodes'),
    extractFunction('mdBlocks'),
    extractFunction('thousands'),
    extractFunction('mdListNode'),
    extractFunction('mdBodyNode'),
    'module.exports = { mdBodyNode };',
    'return module.exports;',
  ].join('\n'))(fakeDocument, { exports: {} }, {});

  const cut = withSplitRow.mdBodyNode('x'.repeat(4000), 'Fixture Board', 8138);
  const cutDiv = cut.childNodes.find((n) => n._classes && n._classes.includes('cut'));
  assert.ok(cutDiv, 'expected a trailing .cut node when bl exceeds the embedded body');
  assert.strictEqual(cutDiv.textContent, 'Cut at 4,000 of 8,138 characters. Open the card on the desk board for the rest.');

  const uncut = withSplitRow.mdBodyNode('short', 'Fixture Board', 5);
  const uncutHasCut = uncut.childNodes.some((n) => n._classes && n._classes.includes('cut'));
  assert.ok(!uncutHasCut, 'no cut node when bl === the embedded body length');
});

test('mdBodyNode: a cut mid-table still renders a table wrapped in .md-table without throwing', () => {
  const withSplitRow = new Function('document', 'module', 'exports', [
    extractConst('TABLE_DELIM_RE'),
    extractFunction('splitRow'),
    extractConst('el'),
    extractFunction('codeSegNode'),
    extractFunction('mdInline'),
    extractFunction('mdInlineNodes'),
    extractFunction('mdBlocks'),
    extractFunction('thousands'),
    extractFunction('mdListNode'),
    extractFunction('mdBodyNode'),
    'module.exports = { mdBodyNode };',
    'return module.exports;',
  ].join('\n'))(fakeDocument, { exports: {} }, {});
  assert.doesNotThrow(() => withSplitRow.mdBodyNode('para\n\n| a | b |\n|---|---|\n| 1', 'Fixture Board', 30));
  const wrap = withSplitRow.mdBodyNode('para\n\n| a | b |\n|---|---|\n| 1', 'Fixture Board', 30);
  const tableWrap = wrap.childNodes.find((n) => n._classes && n._classes.includes('md-table'));
  assert.ok(tableWrap, 'expected a .md-table wrapper');
});
