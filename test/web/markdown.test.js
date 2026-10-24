const { test } = require('node:test');
const assert = require('node:assert');
const { mdToHtml: render, parseMarkdown, parseInline, codeLang } = require('../../plugin/skills/web/web/markdown.js');

// The one Markdown renderer: card bodies, notes and scratchpad previews all go through
// it, and the snapshot embeds its parser. These run the real functions, so a regression
// shows up as wrong HTML. Tables have their own file (markdown-tables.test.js).
const md = (text) => render(text, { board: 'webapp' });

// --- what rendered before stays --------------------------------------------------------

test('nested bullets, continuation lines and tasks render to the exact HTML they always did', () => {
  assert.strictEqual(md('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  assert.strictEqual(md('- a\n  - b\n    - c\n- d'), '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>');
  assert.strictEqual(md('- a\n  more of a\n- b'), '<ul><li>a more of a</li><li>b</li></ul>');
  assert.strictEqual(md('- a\n  - b\n    more of b\n- c'), '<ul><li>a<ul><li>b more of b</li></ul></li><li>c</li></ul>');
  const tasks = md('- [x] shipped\n- [ ] pending');
  assert.ok(tasks.includes('<li class="task done"><span class="tick">&#9745;</span> shipped'));
  assert.ok(tasks.includes('<li class="task open"><span class="tick">&#9744;</span> pending'));
});

test('a blank line before anything but an item ends a list, and a heading, rule or fence closes every open level', () => {
  assert.strictEqual(md('- a\n\nafter'), '<ul><li>a</li></ul><p>after</p>');
  assert.strictEqual(md('- a\n  - b\n# T'), '<ul><li>a<ul><li>b</li></ul></li></ul><h1>T</h1>');
  assert.strictEqual(md('- a\n---\nafter'), '<ul><li>a</li></ul><hr><p>after</p>');
});

test('the old inline marks keep their HTML: bold, italic, code, links', () => {
  assert.strictEqual(md('a **b** and *c* and `d`'), '<p>a <strong>b</strong> and <em>c</em> and <code>d</code></p>');
  assert.strictEqual(md('[x](https://e.test/a?b=1&c=2)'),
    '<p><a href="https://e.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a></p>');
  assert.strictEqual(md('**`kanban-loop`**'), '<p><strong><code>kanban-loop</code></strong></p>');
});

test('headings one to three and a rule render as before; a paragraph of several lines is one paragraph', () => {
  assert.strictEqual(md('# One\n## Two\n### Three\n---'), '<h1>One</h1><h2>Two</h2><h3>Three</h3><hr>');
  assert.strictEqual(md('line a\nline b'), '<p>line a line b</p>');
});

test('a mention code span renders as a chip; one on this board carries its id for the click', () => {
  assert.ok(md('see `webapp#12 Retry budget`').includes('<code class="mention same" data-card-id="12" tabindex="0" role="link">webapp#12 Retry budget</code>'));
  assert.ok(md('see `other#3 Title`').includes('<code class="mention">other#3 Title</code>'));
  assert.ok(md('run `git status`').includes('<code>git status</code>'), 'ordinary code stays code');
  assert.ok(md('see `webapp#G3 a group`').includes('data-card-id="G3"'), 'a group mention carries its whole id');
});

// --- the XSS rules ------------------------------------------------------------------------

test('every tag in the body is text: the renderer never lets markup through', () => {
  assert.strictEqual(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.strictEqual(md('- <img src=x onerror=alert(1)>\n  more <script>evil</script>'),
    '<ul><li>&lt;img src=x onerror=alert(1)&gt; more &lt;script&gt;evil&lt;/script&gt;</li></ul>');
  const html = md('`webapp#1 <img src=x onerror=alert(1)>`');
  assert.ok(!html.includes('<img') && html.includes('&lt;img'));
  assert.ok(!/<(img|script|svg|iframe)/i.test(md('> <img src=x>\n\n```html\n<script>x</script>\n```\n\n**<b>**')), 'quotes, fences and emphasis stay text too');
});

test('a link only keeps its address for http, https, mailto, a fragment or a path', () => {
  for (const url of ['https://x.test', 'http://x.test', 'mailto:a@b.test', '#frag', '/local']) {
    assert.ok(md(`[a](${url})`).includes(`href="${url}"`), url);
  }
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
    assert.ok(md(`[a](${url})`).includes('href="#"'), url);
  }
  assert.ok(!md('[a](https://x.test/"onmouseover="alert(1))').includes('"onmouseover'), 'a quote cannot end the attribute');
});

test('a bare address becomes a link only when it is http or https', () => {
  assert.ok(!md('javascript:alert(1) and ftp://x.test').includes('<a '));
  assert.ok(md('go to https://x.test/a"b now').includes('href="https://x.test/a&quot;b"'));
});

test('an unterminated fence still renders and cannot swallow markup into the page', () => {
  assert.strictEqual(md('```\n<b>never closed'), '<pre><code>&lt;b&gt;never closed</code></pre>');
});

// --- headings ---------------------------------------------------------------------------

test('headings run from one # to six', () => {
  for (let n = 1; n <= 6; n++) assert.strictEqual(md(`${'#'.repeat(n)} Title`), `<h${n}>Title</h${n}>`);
  assert.strictEqual(md('####### seven'), '<p>####### seven</p>', 'seven hashes is not a heading');
  assert.strictEqual(md('#hashtag'), '<p>#hashtag</p>', 'a heading needs the space');
});

// --- ordered lists ----------------------------------------------------------------------

test('an ordered list is an ol, and starts where its first number says', () => {
  assert.strictEqual(md('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  assert.strictEqual(md('3. three\n4. four'), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.strictEqual(md('1) one\n2) two'), '<ol><li>one</li><li>two</li></ol>');
});

test('lists nest and mix: an ordered list under a bullet, a bullet under a number', () => {
  assert.strictEqual(md('- a\n  1. x\n  2. y\n- b'), '<ul><li>a<ol><li>x</li><li>y</li></ol></li><li>b</li></ul>');
  assert.strictEqual(md('1. a\n   - x\n2. b'), '<ol><li>a<ul><li>x</li></ul></li><li>b</li></ol>');
});

test('a bullet after a number at the same depth starts a new list of the other kind', () => {
  assert.strictEqual(md('1. a\n- b'), '<ol><li>a</li></ol><ul><li>b</li></ul>');
});

test('star and plus bullets are bullets; a number only interrupts a paragraph when it is 1', () => {
  assert.strictEqual(md('* a\n+ b'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(md('in\n2026. a year'), '<p>in 2026. a year</p>');
  assert.strictEqual(md('in\n1. a list'), '<p>in</p><ol><li>a list</li></ol>');
});

test('an ordered task item carries its tick too', () => {
  assert.ok(md('1. [x] done').includes('<li class="task done"><span class="tick">&#9745;</span> done'));
});

// --- block quotes -----------------------------------------------------------------------

test('a block quote wraps its lines, and a blank > line splits its paragraphs', () => {
  assert.strictEqual(md('> a\n> b'), '<blockquote><p>a b</p></blockquote>');
  assert.strictEqual(md('> a\n>\n> b'), '<blockquote><p>a</p><p>b</p></blockquote>');
  assert.strictEqual(md('>a'), '<blockquote><p>a</p></blockquote>');
});

test('block quotes nest, and hold lists, headings and code', () => {
  assert.strictEqual(md('> a\n>> b'), '<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>');
  assert.strictEqual(md('> - x\n> - y'), '<blockquote><ul><li>x</li><li>y</li></ul></blockquote>');
  assert.strictEqual(md('> ## Head\n> text'), '<blockquote><h2>Head</h2><p>text</p></blockquote>');
  assert.strictEqual(md('> ```\n> code\n> ```'), '<blockquote><pre><code>code</code></pre></blockquote>');
});

test('a quote ends at the first line without a >, and the text after it is its own paragraph', () => {
  assert.strictEqual(md('> a\n\nafter'), '<blockquote><p>a</p></blockquote><p>after</p>');
});

// --- strike, bold italic, underscores, autolinks, breaks ---------------------------------

test('~~strike~~ is a del, and a lone tilde pair stays text', () => {
  assert.strictEqual(md('a ~~gone~~ b'), '<p>a <del>gone</del> b</p>');
  assert.strictEqual(md('~~ x'), '<p>~~ x</p>');
});

test('***bold italic*** nests an em around a strong', () => {
  assert.strictEqual(md('***both***'), '<p><em><strong>both</strong></em></p>');
});

test('_em_ and __strong__ work, and snake_case words stay whole', () => {
  assert.strictEqual(md('an _em_ and a __strong__ one'), '<p>an <em>em</em> and a <strong>strong</strong> one</p>');
  assert.strictEqual(md('use my_snake_case_name here'), '<p>use my_snake_case_name here</p>');
  assert.strictEqual(md('call __init__.py'), '<p>call <strong>init</strong>.py</p>');
  assert.strictEqual(md('a_b_ c'), '<p>a_b_ c</p>');
  assert.strictEqual(md('snake_case and _real em_'), '<p>snake_case and <em>real em</em></p>');
});

test('a star needs a word against it: 2 * 3 * 4 is arithmetic, not emphasis', () => {
  assert.strictEqual(md('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  assert.strictEqual(md('**not bold **'), '<p>**not bold **</p>');
});

test('emphasis nests and spans the lines of a paragraph', () => {
  assert.strictEqual(md('**bold *and em* here**'), '<p><strong>bold <em>and em</em> here</strong></p>');
  assert.strictEqual(md('**across\nlines**'), '<p><strong>across lines</strong></p>');
});

test('emphasis marks inside a code span are code, not emphasis', () => {
  assert.strictEqual(md('*a `*` b*'), '<p><em>a <code>*</code> b</em></p>');
  assert.strictEqual(md('`**x**`'), '<p><code>**x**</code></p>');
});

test('a double-backtick span can hold a backtick', () => {
  assert.strictEqual(md('use `` a`b `` now'), '<p>use <code>a`b</code> now</p>');
});

test('a bare https address is a link, minus its trailing punctuation', () => {
  const a = (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  assert.strictEqual(md('see https://x.test/a.'), `<p>see ${a('https://x.test/a')}.</p>`);
  assert.strictEqual(md('(http://x.test/a)'), `<p>(${a('http://x.test/a')})</p>`);
  assert.strictEqual(md('https://x.test/w_(y)'), `<p>${a('https://x.test/w_(y)')}</p>`);
  assert.strictEqual(md('https://x.test/some_file_name_x'), `<p>${a('https://x.test/some_file_name_x')}</p>`);
  assert.strictEqual(md('"https://x.test", ok'), `<p>&quot;${a('https://x.test')}&quot;, ok</p>`);
});

test('a bare address inside a link, a code span or a word is left alone', () => {
  assert.strictEqual(md('[https://x.test](https://y.test)'),
    '<p><a href="https://y.test" target="_blank" rel="noopener noreferrer">https://x.test</a></p>');
  assert.strictEqual(md('`https://x.test`'), '<p><code>https://x.test</code></p>');
  assert.ok(!md('nothttps://x.test').includes('<a '));
});

test('two trailing spaces or a trailing backslash break the line', () => {
  assert.strictEqual(md('a  \nb'), '<p>a<br>b</p>');
  assert.strictEqual(md('a\\\nb'), '<p>a<br>b</p>');
  assert.strictEqual(md('a \nb'), '<p>a b</p>', 'one space is a soft break');
  assert.strictEqual(md('- a  \n  b'), '<ul><li>a<br>b</li></ul>', 'a list item breaks too');
  assert.strictEqual(md('a\\'), '<p>a\\</p>', 'a backslash ending the text is a backslash');
});

// --- underline: the one tag --------------------------------------------------------------

test('<u>text</u> is an underline, the one tag the renderer lets through', () => {
  assert.strictEqual(md('a <u>marked</u> word'), '<p>a <u>marked</u> word</p>');
  assert.strictEqual(md('<u>**bold** and `code`</u>'), '<p><u><strong>bold</strong> and <code>code</code></u></p>');
  assert.strictEqual(md('# <u>Head</u>\n- <u>item</u>\n> <u>quoted</u>'),
    '<h1><u>Head</u></h1><ul><li><u>item</u></li></ul><blockquote><p><u>quoted</u></p></blockquote>');
  assert.ok(md('| a |\n| --- |\n| <u>cell</u> |').includes('<td><u>cell</u></td>'));
});

test('underline holds marks and sits inside them', () => {
  assert.strictEqual(md('**<u>both</u>**'), '<p><strong><u>both</u></strong></p>');
  assert.strictEqual(md('<u>a</u> and <u>b</u>'), '<p><u>a</u> and <u>b</u></p>');
});

test('a <u> with attributes, another case, another tag or no partner is shown as written', () => {
  assert.strictEqual(md('<u onclick=alert(1)>x</u>'), '<p>&lt;u onclick=alert(1)&gt;x&lt;/u&gt;</p>');
  assert.strictEqual(md('<U>x</U>'), '<p>&lt;U&gt;x&lt;/U&gt;</p>');
  assert.strictEqual(md('<u >x</u>'), '<p>&lt;u &gt;x&lt;/u&gt;</p>');
  assert.strictEqual(md('<u>unmatched'), '<p>&lt;u&gt;unmatched</p>');
  assert.strictEqual(md('closed only</u>'), '<p>closed only&lt;/u&gt;</p>');
  assert.strictEqual(md('<u></u>'), '<p>&lt;u&gt;&lt;/u&gt;</p>', 'an empty pair underlines nothing and stays text');
  assert.strictEqual(md('<b>x</b> <i>y</i>'), '<p>&lt;b&gt;x&lt;/b&gt; &lt;i&gt;y&lt;/i&gt;</p>');
  assert.strictEqual(md('<u><script>x</script></u>'), '<p><u>&lt;script&gt;x&lt;/script&gt;</u></p>', 'what is inside is still escaped');
});

test('the pair must close on the same line', () => {
  assert.strictEqual(md('<u>across\nlines</u>'), '<p>&lt;u&gt;across lines&lt;/u&gt;</p>');
});

test('underline tags in code stay code', () => {
  assert.strictEqual(md('`<u>x</u>`'), '<p><code>&lt;u&gt;x&lt;/u&gt;</code></p>');
  assert.ok(md('```\n<u>x</u>\n```').includes('&lt;u&gt;x&lt;/u&gt;'));
  assert.strictEqual(md('<u>a `</u>` b</u>'), '<p><u>a <code>&lt;/u&gt;</code> b</u></p>');
});

// --- collapsible sections: <details> and <summary> ------------------------------------------

test('<details> with a <summary> is a collapsible section whose body is Markdown', () => {
  assert.strictEqual(md('<details>\n<summary>More</summary>\n\nbody **text**\n\n- a\n- b\n\n</details>'),
    '<details><summary>More</summary><p>body <strong>text</strong></p><ul><li>a</li><li>b</li></ul></details>');
  assert.strictEqual(md('<details>\n<summary>More</summary>\nno blank line\n</details>'),
    '<details><summary>More</summary><p>no blank line</p></details>');
});

test('a section starts closed, and open when the tag says <details open>', () => {
  assert.ok(md('<details>\n<summary>x</summary>\ny\n</details>').startsWith('<details><summary>'));
  assert.strictEqual(md('<details open>\n<summary>x</summary>\ny\n</details>'), '<details open><summary>x</summary><p>y</p></details>');
});

test('the summary holds inline marks, and its other tags stay text', () => {
  assert.strictEqual(md('<details>\n<summary>**Bold** and `code`</summary>\nx\n</details>'),
    '<details><summary><strong>Bold</strong> and <code>code</code></summary><p>x</p></details>');
  assert.strictEqual(md('<details>\n<summary><b>x</b></summary>\ny\n</details>'),
    '<details><summary>&lt;b&gt;x&lt;/b&gt;</summary><p>y</p></details>');
});

test('a section with no summary is titled [...]', () => {
  assert.strictEqual(md('<details>\nbare body\n</details>'), '<details><summary>[...]</summary><p>bare body</p></details>');
  assert.strictEqual(md('<details>\n<summary></summary>\nbody\n</details>'), '<details><summary>[...]</summary><p>body</p></details>');
});

test('sections nest', () => {
  assert.strictEqual(md('<details>\n<summary>outer</summary>\n\n<details>\n<summary>inner</summary>\ndeep\n</details>\n\nafter inner\n</details>'),
    '<details><summary>outer</summary><details><summary>inner</summary><p>deep</p></details><p>after inner</p></details>');
});

test('a section sits in a quote and holds a fence that shows the closing tag', () => {
  assert.strictEqual(md('> <details>\n> <summary>q</summary>\n> body\n> </details>'),
    '<blockquote><details><summary>q</summary><p>body</p></details></blockquote>');
  assert.strictEqual(md('<details>\n<summary>s</summary>\n```\n</details>\n```\n</details>\nafter'),
    '<details><summary>s</summary><pre><code>&lt;/details&gt;</code></pre></details><p>after</p>');
});

test('an unclosed <details> shows as written and never swallows the rest of the body', () => {
  assert.strictEqual(md('<details>\n<summary>x</summary>\nrest\n\n# Heading\n\n- item'),
    '<p>&lt;details&gt; &lt;summary&gt;x&lt;/summary&gt; rest</p><h1>Heading</h1><ul><li>item</li></ul>');
});

test('a misnested pair: the unclosed outer tag is text and the closed inner one is a section', () => {
  assert.strictEqual(md('<details>\n<details>\ninner\n</details>'),
    '<p>&lt;details&gt;</p><details><summary>[...]</summary><p>inner</p></details>');
  assert.strictEqual(md('</details>\nstray'), '<p>&lt;/details&gt; stray</p>');
});

test('a <details> with any attribute but a bare open stays escaped text', () => {
  assert.strictEqual(md('<details onclick=alert(1)>\ntext\n</details>'), '<p>&lt;details onclick=alert(1)&gt; text &lt;/details&gt;</p>');
  assert.strictEqual(md('<details open onclick=x>\ntext\n</details>'), '<p>&lt;details open onclick=x&gt; text &lt;/details&gt;</p>');
  assert.strictEqual(md('<details  open>\ntext\n</details>'), '<p>&lt;details  open&gt; text &lt;/details&gt;</p>');
  assert.strictEqual(md('<DETAILS>\ntext\n</DETAILS>'), '<p>&lt;DETAILS&gt; text &lt;/DETAILS&gt;</p>');
  assert.strictEqual(md('<details>\n<summary onclick=x>t</summary>\nb\n</details>'),
    '<details><summary>[...]</summary><p>&lt;summary onclick=x&gt;t&lt;/summary&gt; b</p></details>');
});

test('the tags must stand on lines of their own: inline in a sentence they are text', () => {
  assert.strictEqual(md('a <details>b</details> c'), '<p>a &lt;details&gt;b&lt;/details&gt; c</p>');
  assert.strictEqual(md('<details>x\n</details>'), '<p>&lt;details&gt;x &lt;/details&gt;</p>');
});

test('a summary after the first line of the section is text', () => {
  assert.strictEqual(md('<details>\nfirst\n<summary>late</summary>\n</details>'),
    '<details><summary>[...]</summary><p>first &lt;summary&gt;late&lt;/summary&gt;</p></details>');
});

test('a section inside a list item ends the list, like a heading does', () => {
  assert.strictEqual(md('- a\n<details>\n<summary>s</summary>\nb\n</details>'),
    '<ul><li>a</li></ul><details><summary>s</summary><p>b</p></details>');
});

// --- rules ---------------------------------------------------------------------------------

test('three or more of - * or _, with or without spaces between, are a rule', () => {
  for (const line of ['---', '***', '___', '* * *', '- - -', '_ _ _', '-  -  -', '- - - -', '  * * *  ']) assert.strictEqual(md(line), '<hr>', line);
  assert.strictEqual(md('a\n* * *\nb'), '<p>a</p><hr><p>b</p>');
});

test('two marks, mixed marks and a mark with text are not a rule', () => {
  assert.strictEqual(md('- -'), '<ul><li>-</li></ul>');
  assert.strictEqual(md('* - *'), '<ul><li>- *</li></ul>');
  assert.notStrictEqual(md('- - x'), '<hr>');
  assert.strictEqual(md('**bold**'), '<p><strong>bold</strong></p>');
});

// --- lazy continuation in a quote -------------------------------------------------------------

test('a line with no > after a quoted paragraph line continues that paragraph', () => {
  assert.strictEqual(md('> a\nb'), '<blockquote><p>a b</p></blockquote>');
  assert.strictEqual(md('> a\nb\nc'), '<blockquote><p>a b c</p></blockquote>');
  assert.strictEqual(md('> - a\nb'), '<blockquote><ul><li>a b</li></ul></blockquote>');
  assert.strictEqual(md('> a\n> b\nc'), '<blockquote><p>a b c</p></blockquote>');
});

test('a blank line, a block start or a quoted code block ends the quote, lazy or not', () => {
  assert.strictEqual(md('> a\n\nb'), '<blockquote><p>a</p></blockquote><p>b</p>');
  assert.strictEqual(md('> a\n# h'), '<blockquote><p>a</p></blockquote><h1>h</h1>');
  assert.strictEqual(md('> a\n- x'), '<blockquote><p>a</p></blockquote><ul><li>x</li></ul>');
  assert.strictEqual(md('> a\n---'), '<blockquote><p>a</p></blockquote><hr>');
  assert.strictEqual(md('> a\n```\nx\n```'), '<blockquote><p>a</p></blockquote><pre><code>x</code></pre>');
  assert.strictEqual(md('> ```\n> x\nb'), '<blockquote><pre><code>x</code></pre></blockquote><p>b</p>');
  assert.strictEqual(md('> # h\nb'), '<blockquote><h1>h</h1></blockquote><p>b</p>');
});

// --- loose lists --------------------------------------------------------------------------------

test('items split by a blank line are one loose list, their text in paragraphs', () => {
  assert.strictEqual(md('1. a\n\n2. b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  assert.strictEqual(md('- a\n\n\n- b\n- c'), '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
  assert.strictEqual(md('- a\n  - b\n\n- c'), '<ul><li><p>a</p><ul><li>b</li></ul></li><li><p>c</p></li></ul>');
});

test('a blank line then something that is not an item of the list ends it, and a list of the other kind starts a new one', () => {
  assert.strictEqual(md('- a\n\n- b\n\ntext'), '<ul><li><p>a</p></li><li><p>b</p></li></ul><p>text</p>');
  assert.strictEqual(md('1. a\n\n- b'), '<ol><li>a</li></ol><ul><li>b</li></ul>');
  assert.strictEqual(md('  - a\n\n- b'),'<ul><li>a</li></ul><ul><li>b</li></ul>', 'an item further left than the list ends it');
  assert.strictEqual(md('- a\n\n'), '<ul><li>a</li></ul>');
});

test('a task item in a loose list keeps its tick on the same line as its text', () => {
  assert.strictEqual(md('- [x] a\n\n- [ ] b'),
    '<ul><li class="task done"><span class="tick">&#9745;</span> a</li><li class="task open"><span class="tick">&#9744;</span> b</li></ul>');
});

// --- unknown nodes -------------------------------------------------------------------------------

test('a tree node of a kind the renderer does not know is drawn as its text, escaped', () => {
  const { renderBlocks } = require('../../plugin/skills/web/web/markdown.js');
  assert.strictEqual(renderBlocks([{ t: 'mystery', text: '<img src=x>' }]), '&lt;img src=x&gt;');
  assert.strictEqual(renderBlocks([{ t: 'p', inline: [{ t: 'mystery', v: '<b>' }, { t: 'text', v: 'ok' }] }]), '<p>&lt;b&gt;ok</p>');
  assert.strictEqual(renderBlocks([{ t: 'mystery' }]), '');
  assert.strictEqual(renderBlocks([{ t: 'constructor', text: 'x' }]), 'x', 'a name on Object.prototype is not a node kind');
});

// --- speed ---------------------------------------------------------------------------------------

// A page of 60000 characters that is nothing but openers, or something that nests without end, must
// render in a blink and never overflow the stack. The budget is wide (a slow CI machine) and the
// cases took seconds before the scans were bounded.
const FAST = 750;
const big = (unit, n = 60000) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const PATHOLOGICAL = {
  'unclosed *': big('*a '), 'unclosed _': big('_a '), 'unclosed **': big('**a '), 'unclosed ***': big('***a '), 'unclosed ~~': big('~~a '),
  'unclosed [': big('[a '), 'unclosed [ ]': big('[a] '), 'brackets then a paren that never closes': `${'['.repeat(30000)}](${'x'.repeat(30000)}`,
  'link text, a bad address': big('[a](`b'), 'unclosed backtick': big('`a '), 'unclosed double backtick': big('``a '),
  'unclosed <u>': big('<u>a '), 'h': big('h'), 'http://': big('http://'), 'a long address then brackets': `http://x${')'.repeat(59000)}`,
  'many lines': big('line\n'), 'many soft breaks': big('a \n'), 'many hard breaks': big('a  \n'), 'spaces': ' '.repeat(60000), 'trailing spaces then text': `${' '.repeat(59000)}x\n`,
  'quote marks': '>'.repeat(60000), 'quote lines': big('> a\n'), 'lazy quote lines': `> a\n${big('b\n')}`,
  'unclosed <details>': big('<details>\n'), 'details pairs': big('<details>\n</details>\n'), 'details nest': big('<details>\n', 30000) + big('</details>\n', 30000),
  'list items': big('- a\n'), 'nested lists': Array.from({ length: 300 }, (_, i) => `${' '.repeat(i)}- a`).join('\n'), 'loose list': big('- a\n\n'), 'blank lines in a list': `- a${'\n'.repeat(59000)}- b`,
  'ordered': big('1. a\n'), 'fences': big('```\n'), 'tilde fences': big('~~~a\n'), 'rules': big('* * *\n'),
  'table rows': `| a |\n| - |\n${big('| x |\n')}`, 'pipes': big('|'), 'delimiters': big('| - '), 'dashes': big('-'),
  'nested emphasis': `${'*_'.repeat(15000)}x${'_*'.repeat(15000)}`, 'nested strong': `${'**'.repeat(20000)}x${'**'.repeat(20000)}`,
  'nested quote in a list': big('- > '), 'headings': big('#'), 'hashes': big('# a\n'),
};

for (const [name, text] of Object.entries(PATHOLOGICAL)) {
  test(`${name}: 60 KB renders inside a budget and does not overflow the stack`, () => {
    const t0 = process.hrtime.bigint();
    let html;
    assert.doesNotThrow(() => { html = md(text); });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(typeof html === 'string');
    assert.ok(ms < FAST, `${name} took ${ms.toFixed(0)} ms`);
  });
}

test('the bounds do not change what ordinary text renders to', () => {
  assert.strictEqual(md('*a `*` b* and *c* **d** `e*f`'), '<p><em>a <code>*</code> b</em> and <em>c</em> <strong>d</strong> <code>e*f</code></p>');
  assert.strictEqual(md('[a *b* c](https://x.test) [d](https://y.test)'),
    '<p><a href="https://x.test" target="_blank" rel="noopener noreferrer">a <em>b</em> c</a> <a href="https://y.test" target="_blank" rel="noopener noreferrer">d</a></p>');
  assert.strictEqual(md('*a ` *b* ` *c*'), '<p><em>a <code> *b* </code> *c</em></p>');
  assert.strictEqual(md('<u>a</u> <u>b'), '<p><u>a</u> &lt;u&gt;b</p>');
  assert.strictEqual(md('x <u>a <u>b</u>'), '<p>x <u>a &lt;u&gt;b</u></p>');
});

test('quotes and sections nest to a depth and no deeper, the rest staying text', () => {
  const html = md(`${'> '.repeat(40)}deep`);
  assert.ok(html.startsWith('<blockquote>') && html.includes('deep'));
  assert.ok((html.match(/<blockquote>/g) || []).length < 40, 'a bound on the depth');
  const open = '<details>\n'.repeat(40);
  const sections = md(`${open}deep\n${'</details>\n'.repeat(40)}`);
  assert.ok(sections.includes('deep') && (sections.match(/<details>/g) || []).length < 40);
  const em = md(`${'*a '.repeat(10)}${'*_'.repeat(200)}x${'_*'.repeat(200)}`);
  assert.ok(typeof em === 'string');
});

// --- fences -----------------------------------------------------------------------------

test('a plain fence renders exactly as before', () => {
  assert.strictEqual(md('```\nline with **not bold**\nand `not code`\n```'),
    '<pre><code>line with **not bold**\nand `not code`</code></pre>');
});

test('a tilde fence is a fence', () => {
  assert.strictEqual(md('~~~\nx\n~~~'), '<pre><code>x</code></pre>');
});

test('a longer fence is closed only by a run at least as long, so a fence can show a fence', () => {
  assert.strictEqual(md('````\n```\ninner\n```\n````'), '<pre><code>```\ninner\n```</code></pre>');
  assert.strictEqual(md('```\n~~~\nstill code\n```'), '<pre><code>~~~\nstill code</code></pre>', 'the other fence char does not close');
  assert.strictEqual(md('```\nx\n````'), '<pre><code>x</code></pre>', 'a longer run closes');
});

test('a fence info string with a backtick is not a fence', () => {
  assert.ok(!md('```a`b\nx').includes('<pre'));
});

test('a typed fence shows its language and a Copy button, and keeps the language on the block', () => {
  const html = md('```c#\nvar x = 1;\n```');
  assert.strictEqual(html,
    '<div class="md-code"><div class="md-code-bar"><span class="md-code-lang">c#</span>'
    + '<button type="button" class="md-code-copy" aria-label="Copy c# code">Copy</button></div>'
    + '<pre data-lang="c#"><code>var x = 1;</code></pre></div>');
});

test('the language is the first word of the info string, cut to the safe characters', () => {
  assert.strictEqual(codeLang('ts title="x"'), 'ts');
  assert.strictEqual(codeLang('c++'), 'c++');
  assert.strictEqual(codeLang('f#'), 'f#');
  assert.strictEqual(codeLang('objective-c'), 'objective-c');
  assert.strictEqual(codeLang('a.b_c'), 'a.b_c');
  assert.strictEqual(codeLang('"><img src=x onerror=1>'), 'img');
  assert.strictEqual(codeLang('<script>'), 'script');
  assert.strictEqual(codeLang(''), '');
  assert.strictEqual(codeLang('   '), '');
});

test('a hostile language cannot leave the attribute or the label', () => {
  const html = md('```"><img src=x onerror=alert(1)>\ncode\n```');
  assert.ok(!html.includes('<img') && !html.includes('onerror=alert(1)>'));
  assert.ok(html.includes('data-lang="img'), 'only the safe characters of the first word survive');
});

test('a mermaid fence is a labelled code block for now', () => {
  const html = md('```mermaid\ngraph TD; A-->B;\n```');
  assert.ok(html.includes('<span class="md-code-lang">mermaid</span>'));
  assert.ok(html.includes('<pre data-lang="mermaid"><code>graph TD; A--&gt;B;</code></pre>'));
});

test('an untyped fence has no label and no Copy button', () => {
  assert.ok(!md('```\nx\n```').includes('md-code'));
});

test('a typed fence holds its text verbatim, markdown and all', () => {
  assert.ok(md('```md\n# not a heading\n- not a list\n```').includes('<code># not a heading\n- not a list</code>'));
});

test('inline code is unchanged by all of it', () => {
  assert.strictEqual(md('use `c#` here'), '<p>use <code>c#</code> here</p>');
});

// --- the parse a second renderer can build from ------------------------------------------

test('parseMarkdown hands back a plain tree: blocks with inline tokens, no HTML', () => {
  const blocks = parseMarkdown('# T\n\nsome **bold** [x](https://e.test)\n\n```ts\nlet a;\n```');
  assert.deepStrictEqual(blocks.map((b) => b.t), ['h', 'p', 'pre']);
  assert.strictEqual(blocks[0].level, 1);
  assert.deepStrictEqual(blocks[1].inline.map((t) => t.t), ['text', 'strong', 'text', 'link']);
  assert.deepStrictEqual(blocks[2], { t: 'pre', code: 'let a;', lang: 'ts' });
  assert.ok(!JSON.stringify(blocks).includes('&lt;'), 'the tree holds raw text; the renderer escapes');
});

test('parseInline drops nothing: text that is not a mark comes back as text', () => {
  assert.deepStrictEqual(parseInline('a < b & c'), [{ t: 'text', v: 'a < b & c' }]);
});

// --- what the old snapshot parser held to, kept ---------------------------------------------------

test('a capital X in a task box is done too', () => {
  assert.ok(md('- [X] shipped').includes('<li class="task done"><span class="tick">&#9745;</span> shipped'));
  assert.ok(md('1. [X] shipped').includes('class="task done"'));
});

test('a body cut mid-table keeps its whole rows and the partial row, padded to the header', () => {
  const blocks = parseMarkdown('before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 3');
  const table = blocks.find((b) => b.t === 'table');
  assert.ok(table);
  assert.strictEqual(table.rows.length, 3);
  assert.deepStrictEqual(table.rows[0].map((c) => c[0].v), ['1', '2']);
  assert.deepStrictEqual(table.rows[1].map((c) => c[0].v), ['3', '4']);
  assert.deepStrictEqual(table.rows[2][0], [{ t: 'text', v: '3' }]);
  assert.deepStrictEqual(table.rows[2][1], [], 'the missing cell is empty');
});

test('a body cut mid-fence, mid-list or mid-section still parses to what was there', () => {
  assert.doesNotThrow(() => parseMarkdown('```ts\nlet a\nnever clo'));
  assert.strictEqual(parseMarkdown('```ts\nlet a\nnever clo')[0].code, 'let a\nnever clo');
  assert.strictEqual(md('- a\n  - b\n    - c'), '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>');
  assert.strictEqual(md('<details>\n<summary>s</summary>\nhalf'), '<p>&lt;details&gt; &lt;summary&gt;s&lt;/summary&gt; half</p>');
});
