const { test } = require('node:test');
const assert = require('node:assert');
const { markdownEditSpans, MARKDOWN_EDIT_KINDS, MARKDOWN_EDIT_MAX_CHARS } = require('../web/markdown-edit.js');

// The tokenizer behind the colours in the description box and the Scratchpad's Edit box: text in, a
// sorted list of { from, to, kind } out, covering what the renderer would turn into a heading, bold,
// a link and the rest. Nothing here touches the DOM (markdown-edit-ui.js paints the spans).

const spans = (text) => markdownEditSpans(text).map((s) => [text.slice(s.from, s.to), s.kind]);

// --- headings ----------------------------------------------------------------------------

test('a heading line is one heading span, with the constructs inside it keeping their own', () => {
  assert.deepStrictEqual(spans('# Title'), [['# Title', 'heading']]);
  assert.deepStrictEqual(spans('##### Five'), [['##### Five', 'heading']]);
  assert.deepStrictEqual(spans('## Fix `x` now'), [['## Fix ', 'heading'], ['`x`', 'code'], [' now', 'heading']]);
  assert.deepStrictEqual(spans('# **a**'), [['# ', 'heading'], ['**a**', 'bold']]);
});

test('a sixth-level heading is its own kind, as the preview keeps it muted: h4 to h6 share a size, so colour is its only cue', () => {
  assert.deepStrictEqual(spans('###### Six'), [['###### Six', 'heading-six']]);
  assert.deepStrictEqual(spans('###### Six `x` **b**'), [['###### Six ', 'heading-six'], ['`x`', 'code'], [' ', 'heading-six'], ['**b**', 'bold']]);
  assert.deepStrictEqual(spans('> ###### quoted'), [['>', 'marker'], ['###### quoted', 'heading-six']]);
  assert.deepStrictEqual(spans('##### Five'), [['##### Five', 'heading']]);
});

test('a hash that is not a heading stays plain: no space after it, seven of them, or four spaces in', () => {
  assert.deepStrictEqual(spans('#tag'), []);
  assert.deepStrictEqual(spans('####### seven'), []);
  assert.deepStrictEqual(spans('    # indented'), []);
  assert.deepStrictEqual(spans('   # three spaces'), [['   # three spaces', 'heading']]);
});

// --- inline marks ------------------------------------------------------------------------

test('bold, italic and strike, in both spellings of the first two', () => {
  assert.deepStrictEqual(spans('a **b** c'), [['**b**', 'bold']]);
  assert.deepStrictEqual(spans('a __b__ c'), [['__b__', 'bold']]);
  assert.deepStrictEqual(spans('a *b* c'), [['*b*', 'italic']]);
  assert.deepStrictEqual(spans('a _b_ c'), [['_b_', 'italic']]);
  assert.deepStrictEqual(spans('a ~~b~~ c'), [['~~b~~', 'strike']]);
  assert.deepStrictEqual(spans('***both***'), [['***both***', 'bold']]);
});

test('a mark that never closes, or has a space inside its edge, stays plain', () => {
  assert.deepStrictEqual(spans('a **b c'), []);
  assert.deepStrictEqual(spans('a * b * c'), []);
  assert.deepStrictEqual(spans('2 * 3 * 4'), []);
  assert.deepStrictEqual(spans('a ~~ b ~~ c'), []);
  assert.deepStrictEqual(spans('a ~b~ c'), []);
});

test('an underscore inside a word is not emphasis, and an italic holds a bold inside it', () => {
  assert.deepStrictEqual(spans('snake_case_name and other_thing'), []);
  assert.deepStrictEqual(spans('*a **b** c*'), [['*a **b** c*', 'italic']]);
});

test('an escaped mark is text', () => {
  assert.deepStrictEqual(spans('\\*not italic\\*'), []);
  assert.deepStrictEqual(spans('\\`not code\\` and `code`'), [['`code`', 'code']]);
});

test('inline code, with a longer fence of backticks holding a shorter one', () => {
  assert.deepStrictEqual(spans('a `b` c'), [['`b`', 'code']]);
  assert.deepStrictEqual(spans('a ``b ` c`` d'), [['``b ` c``', 'code']]);
  assert.deepStrictEqual(spans('a `b c'), []);
  assert.deepStrictEqual(spans('`**not bold**`'), [['`**not bold**`', 'code']]);
});

test('links: a bracketed text with an address, an image, and a bare address without its trailing mark', () => {
  assert.deepStrictEqual(spans('see [the docs](https://x.test/a) now'), [['[the docs](https://x.test/a)', 'link']]);
  assert.deepStrictEqual(spans('![alt](pic.png)'), [['![alt](pic.png)', 'link']]);
  assert.deepStrictEqual(spans('go to https://x.test/a, then'), [['https://x.test/a', 'link']]);
  assert.deepStrictEqual(spans('(see http://x.test/a)'), [['http://x.test/a', 'link']]);
  assert.deepStrictEqual(spans('[no address] here'), []);
  assert.deepStrictEqual(spans('[a] [b](u)'), [['[b](u)', 'link']]);
});

test('the tags the renderer knows: <u>, <details> and <summary>, closing ones and one with an attribute', () => {
  assert.deepStrictEqual(spans('<u>x</u>'), [['<u>', 'tag'], ['</u>', 'tag']]);
  assert.deepStrictEqual(spans('<details open>\n<summary>t</summary>\n</details>'),
    [['<details open>', 'tag'], ['<summary>', 'tag'], ['</summary>', 'tag'], ['</details>', 'tag']]);
  assert.deepStrictEqual(spans('<U>x</U>'), [['<U>', 'tag'], ['</U>', 'tag']]);
  assert.deepStrictEqual(spans('<ul> <b>x</b> <up>'), []);
});

// --- card mentions -----------------------------------------------------------------------

test('a code span that is a card mention is a mention, whole, including its title', () => {
  assert.deepStrictEqual(spans('see `webapp#12 Retry budget` ok'), [['`webapp#12 Retry budget`', 'mention']]);
  assert.deepStrictEqual(spans('`kanban#G3`'), [['`kanban#G3`', 'mention']]);
});

test('a code span that only has a hash in it is code', () => {
  assert.deepStrictEqual(spans('`#12`'), [['`#12`', 'code']]);
  assert.deepStrictEqual(spans('`a b#12`'), [['`a b#12`', 'code']]);
  assert.deepStrictEqual(spans('`#a371f7`'), [['`#a371f7`', 'code']]);
});

test('a bare #12, #G3 or board#12 in text is a mention; a hex colour, a heading and a word#12x are not', () => {
  assert.deepStrictEqual(spans('see #12 and #G3.'), [['#12', 'mention'], ['#G3', 'mention']]);
  assert.deepStrictEqual(spans('see webapp#12 now'), [['webapp#12', 'mention']]);
  assert.deepStrictEqual(spans('colour #FF0000 and #a371f7'), []);
  assert.deepStrictEqual(spans('issue#12abc'), []);
  assert.deepStrictEqual(spans('x# 12'), []);
});

test('a mention inside a heading and inside a list item', () => {
  assert.deepStrictEqual(spans('## Fix #12'), [['## Fix ', 'heading'], ['#12', 'mention']]);
  assert.deepStrictEqual(spans('- blocked by #12'), [['-', 'marker'], ['#12', 'mention']]);
});

// --- lists, quotes, rules -----------------------------------------------------------------

test('list markers: bullets, numbers, a nested item and a task box are markers, the text is not', () => {
  assert.deepStrictEqual(spans('- one'), [['-', 'marker']]);
  assert.deepStrictEqual(spans('  * two **b**'), [['*', 'marker'], ['**b**', 'bold']]);
  assert.deepStrictEqual(spans('+ plus'), [['+', 'marker']]);
  assert.deepStrictEqual(spans('12. twelve'), [['12.', 'marker']]);
  assert.deepStrictEqual(spans('3) three'), [['3)', 'marker']]);
  assert.deepStrictEqual(spans('- [ ] open'), [['-', 'marker'], ['[ ]', 'marker']]);
  assert.deepStrictEqual(spans('- [x] done'), [['-', 'marker'], ['[x]', 'marker']]);
});

test('a dash with no space, a bold at the start of a line and a year with a full stop are not list items', () => {
  assert.deepStrictEqual(spans('-dash'), []);
  assert.deepStrictEqual(spans('**b** text'), [['**b**', 'bold']]);
  assert.deepStrictEqual(spans('2026.'), []);
  assert.deepStrictEqual(spans('1.5 is a number'), []);
});

test('quote marks are markers, one for each level, and what follows is read as a line of its own', () => {
  assert.deepStrictEqual(spans('> quoted'), [['>', 'marker']]);
  assert.deepStrictEqual(spans('> > deeper'), [['>', 'marker'], ['>', 'marker']]);
  assert.deepStrictEqual(spans('>tight'), [['>', 'marker']]);
  assert.deepStrictEqual(spans('> - item **b**'), [['>', 'marker'], ['-', 'marker'], ['**b**', 'bold']]);
  assert.deepStrictEqual(spans('> # head'), [['>', 'marker'], ['# head', 'heading']]);
});

test('a horizontal rule is a marker', () => {
  assert.deepStrictEqual(spans('---'), [['---', 'marker']]);
  assert.deepStrictEqual(spans('* * *'), [['* * *', 'marker']]);
  assert.deepStrictEqual(spans('___'), [['___', 'marker']]);
  assert.deepStrictEqual(spans('--'), []);
});

// --- tables ------------------------------------------------------------------------------

test('a table is its pipes and its delimiter row as markers, and its cells read inline', () => {
  const t = '| a | **b** |\n|---|:-:|\n| `c` | d |';
  assert.deepStrictEqual(spans(t), [
    ['|', 'marker'], ['|', 'marker'], ['**b**', 'bold'], ['|', 'marker'],
    ['|---|:-:|', 'marker'],
    ['|', 'marker'], ['`c`', 'code'], ['|', 'marker'], ['|', 'marker'],
  ]);
});

test('a line with pipes and no delimiter row under it is not a table', () => {
  assert.deepStrictEqual(spans('a | b | c\nplain'), []);
  assert.deepStrictEqual(spans('| a | b |'), []);
});

test('an escaped pipe in a cell is not a marker, and the table ends at the first line without a pipe', () => {
  const t = 'a | b\n- | -\nx \\| y | z\n\n**after** | not a row';
  assert.deepStrictEqual(spans(t), [
    ['|', 'marker'], ['- | -', 'marker'], ['|', 'marker'], ['**after**', 'bold'],
  ]);
});

// --- fenced code ---------------------------------------------------------------------------

test('a fenced block is one code span from the opening line to the closing line', () => {
  const t = 'before **b**\n```js\nlet *x* = 1;\n```\nafter **c**';
  assert.deepStrictEqual(spans(t), [['**b**', 'bold'], ['```js\nlet *x* = 1;\n```', 'code'], ['**c**', 'bold']]);
});

test('a tilde fence, a longer fence holding a shorter one, and an indented fence', () => {
  assert.deepStrictEqual(spans('~~~\n```\n~~~'), [['~~~\n```\n~~~', 'code']]);
  assert.deepStrictEqual(spans('````\n```\n````'), [['````\n```\n````', 'code']]);
  assert.deepStrictEqual(spans('  ```\n  x\n  ```'), [['  ```\n  x\n  ```', 'code']]);
});

test('a fence that never closes runs to the end of the text, as the renderer reads it', () => {
  assert.deepStrictEqual(spans('```\nlet x;\n**b**'), [['```\nlet x;\n**b**', 'code']]);
});

test('a backtick fence whose line holds another backtick is not a fence', () => {
  assert.deepStrictEqual(spans('``` `x` ```'), [['``` `x` ```', 'code']]);
});

// --- the list of spans ---------------------------------------------------------------------

test('nothing, no text and a non-string have no spans', () => {
  assert.deepStrictEqual(markdownEditSpans(''), []);
  assert.deepStrictEqual(markdownEditSpans('plain words only'), []);
  assert.deepStrictEqual(markdownEditSpans(null), []);
  assert.deepStrictEqual(markdownEditSpans(undefined), []);
  assert.deepStrictEqual(markdownEditSpans(12), []);
});

test('every span is a known kind, sits inside the text, is not empty and follows the one before it', () => {
  const doc = [
    '# Plan for #12', '', 'Some **bold**, *it*, ~~gone~~ and `code` with [a link](http://x.test) and https://y.test/z.', '',
    '- [ ] one `kanban#7 title`', '  1. nested <u>under</u>', '> quote **b**', '', '| a | b |', '|---|---|', '| 1 | `2` |', '',
    '```', 'fenced **x**', '```', '', '<details>', '<summary>s</summary>', '', '---', '', 'tail *open',
  ].join('\n');
  const list = markdownEditSpans(doc);
  assert.ok(list.length > 20);
  let end = 0;
  for (const s of list) {
    assert.ok(MARKDOWN_EDIT_KINDS.includes(s.kind), s.kind);
    assert.ok(Number.isInteger(s.from) && Number.isInteger(s.to) && s.from >= end && s.to > s.from && s.to <= doc.length, JSON.stringify(s));
    end = s.to;
  }
});

test('every kind the tokenizer makes is on the list of kinds, and the list names exactly the ten colours', () => {
  assert.deepStrictEqual(MARKDOWN_EDIT_KINDS.slice().sort(), ['bold', 'code', 'heading', 'heading-six', 'italic', 'link', 'marker', 'mention', 'strike', 'tag']);
});

test('Windows line ends and a trailing newline change nothing about the spans', () => {
  assert.deepStrictEqual(spans('# T\r\n- **a**\r\n'), [['# T\r', 'heading'], ['-', 'marker'], ['**a**', 'bold']]);
  assert.deepStrictEqual(spans('**a**\n'), [['**a**', 'bold']]);
});

test('every character is kept: the text a span list cuts is the text it was made from', () => {
  const doc = '# H\n- a **b** `c` #1\n> x\n```\ny\n```\n| a | b |\n|-|-|\n| 1 | 2 |\n';
  let out = '';
  let at = 0;
  for (const s of markdownEditSpans(doc)) { out += doc.slice(at, s.from) + doc.slice(s.from, s.to); at = s.to; }
  assert.strictEqual(out + doc.slice(at), doc);
});

// --- speed -----------------------------------------------------------------------------------

const FAST = 400;
const big = (unit, n = 100000) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const PROSE = '# Heading one\n\nA paragraph with **bold**, *italic*, `code`, [a link](https://x.test/a) and a mention `webapp#12 Title` plus #34.\n\n- item one\n- [ ] item two ~~gone~~\n  1. nested\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\n';
const PATHOLOGICAL = {
  'ordinary 100 KB': big(PROSE),
  'unclosed *': big('*a '), 'unclosed _': big('_a '), 'unclosed **': big('**a '), 'unclosed ***': big('***a '), 'unclosed ~~': big('~~a '),
  'unclosed [': big('[a '), 'unclosed [ ]': big('[a] '), 'brackets then a paren that never closes': `${'['.repeat(50000)}](${'x'.repeat(50000)}`,
  'unclosed backtick': big('`a '), 'unclosed double backtick': big('``a '), 'backtick runs of every length': big('` `` ``` ```` '),
  'unclosed <u>': big('<u>a '), 'h': big('h'), 'http://': big('http://'), 'a long address': `http://x${')'.repeat(99000)}`,
  'many lines': big('line\n'), 'one 100 KB line of words': big('word '), 'spaces': ' '.repeat(100000),
  'quote marks': '>'.repeat(100000), 'quote lines': big('> a\n'), 'hashes': big('#'), 'headings': big('# a\n'), 'mention-like': big('#1#1'), 'dotted words': big('a.'),
  'board hash runs': big('abc#'), 'list items': big('- a\n'), 'ordered': big('1. a\n'), 'fences': big('```\n'), 'tilde fences': big('~~~a\n'), 'rules': big('* * *\n'),
  'table rows': `| a |\n| - |\n${big('| x |\n')}`, 'pipes': big('|'), 'pipe lines': big('a | b\n'), 'delimiters': big('| - '), 'dashes': big('-'),
  'nested emphasis': `${'*_'.repeat(25000)}x${'_*'.repeat(25000)}`, 'backslashes': big('\\'), 'tags': big('<details>'), 'angle brackets': big('<'),
  'task boxes': big('- [ ] '), 'many short lines of marks': big('*\n_\n~~\n`\n'),
};

for (const [name, text] of Object.entries(PATHOLOGICAL)) {
  test(`${name}: 100 KB is tokenized inside a budget`, () => {
    const t0 = process.hrtime.bigint();
    let list;
    assert.doesNotThrow(() => { list = markdownEditSpans(text); });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(Array.isArray(list));
    assert.ok(ms < FAST, `${name} took ${ms.toFixed(0)} ms`);
    let end = 0;
    for (const s of list) { assert.ok(s.from >= end && s.to > s.from && s.to <= text.length); end = s.to; }
  });
}

test('a body past the size bound is left plain, so a huge paste never freezes the box', () => {
  const text = `# H\n${'x'.repeat(MARKDOWN_EDIT_MAX_CHARS)}`;
  assert.deepStrictEqual(markdownEditSpans(text), []);
  assert.ok(markdownEditSpans('# H\n'.repeat(1000)).length > 0);
});

test('a line past the inline bound keeps its block colour and loses the marks beyond the bound', () => {
  const line = `# ${'a'.repeat(5000)} **late**`;
  const list = markdownEditSpans(line);
  assert.strictEqual(list[0].kind, 'heading');
  assert.strictEqual(list[list.length - 1].to, line.length);
  assert.ok(!list.some((s) => s.kind === 'bold'));
});
