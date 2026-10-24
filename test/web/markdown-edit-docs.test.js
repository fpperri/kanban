const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The coloured Markdown boxes as the page, the stylesheet and the docs hold them: the scripts load in
// an order that works, the preferences sheet has its switch, the stylesheet colours and does nothing
// else to the text, and the two docs say what the boxes do. The rules are markdown-edit.js's
// (markdown-edit.test.js) and the layer is markdown-edit-ui.js's (markdown-edit-page.test.js); the real
// page runs it in the browser runner's markdown-edit scenario.

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const html = read('plugin', 'skills', 'web', 'web', 'app.html');
const css = read('plugin', 'skills', 'web', 'web', 'app.css');
const web = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const KINDS = ['heading', 'heading-six', 'bold', 'italic', 'strike', 'code', 'link', 'marker', 'tag', 'mention'];
const TOKENS = [...KINDS.map((k) => `--md-edit-${k}`), '--md-edit-mention-bg', '--md-edit-selection', '--md-preview-heading', '--md-preview-bold', '--mention', '--mention-bg'];

const at = (f) => html.indexOf(`<script src="/${f}"></script>`);

test('the tokenizer loads before the layer that calls it, both after the ids and the text-edit keys and before the scripts that attach a box', () => {
  assert.ok(at('markdown-edit.js') > -1 && at('markdown-edit-ui.js') > at('markdown-edit.js'));
  assert.ok(at('markdown-edit.js') > at('ids.js') && at('markdown-edit.js') > at('prose.js'), 'the mention pattern is ids.js\'s and prose.js has the card mention');
  assert.ok(at('scratchpad-ui.js') > at('markdown-edit-ui.js'));
  assert.ok(at('app.js') > at('markdown-edit-ui.js'));
});

test('the preferences sheet has the switch, checked by the page and named Colour Markdown while editing', () => {
  const tag = /<input[^>]*id="prefs-md-colour"[^>]*>/.exec(html);
  assert.ok(tag, 'a checkbox');
  assert.match(tag[0], /type="checkbox"/);
  assert.match(tag[0], /data-keeps-selection/);
  assert.match(tag[0], /data-holds-poll/);
  assert.match(html, /<input[^>]*id="prefs-md-colour"[^>]*> Colour Markdown while editing<\/label>/);
  const page = html.slice(html.indexOf('<section class="prefs-page" data-page="browser:prefs">'), html.indexOf('<section class="prefs-page" data-page="browser:hotkeys">'));
  assert.ok(page.includes('id="prefs-md-colour"'), 'on the browser Preferences page, not the board\'s');
});

test('every colour is a token on :root and in both dark blocks', () => {
  const blocks = [css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')),
    css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf(':root[data-theme="dark"]')),
    css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf(':root[data-theme="light"]'))];
  for (const block of blocks) for (const tok of TOKENS) assert.ok(new RegExp(`${tok}:\\s*[^;]+;`).test(block), `${tok} is declared`);
});

test('every kind has a rule that paints its token and nothing but colour, a dotted line under a link or a line-through', () => {
  const COLOUR_ONLY = /^(color|background|border-radius|border-bottom|text-decoration|-webkit-box-decoration-break|box-decoration-break)$/;
  for (const kind of KINDS) {
    const m = new RegExp(`\\.md-edit-${kind} \\{([^}]*)\\}`).exec(css);
    assert.ok(m, `a rule for ${kind}`);
    const decls = [...m[1].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)];
    assert.match(m[1], new RegExp(`color:\\s*var\\(--md-edit-${kind}\\)`), `${kind} paints its token`);
    for (const d of decls) assert.ok(COLOUR_ONLY.test(d[1]), `.md-edit-${kind} sets ${d[1]}, which could change how a line wraps`);
  }
  assert.match(/\.md-edit-strike \{([^}]*)\}/.exec(css)[1], /text-decoration:\s*line-through/);
  const link = /\.md-edit-link \{([^}]*)\}/.exec(css)[1];
  assert.match(link, /border-bottom:\s*1px dotted var\(--md-edit-link\)/, 'the link cue is the preview dotted border, which is no height on an inline box');
  assert.doesNotMatch(link, /text-decoration|padding/, 'no underline, and no padding that would move the text');
  assert.match(/\.md-edit-mention \{([^}]*)\}/.exec(css)[1], /background:\s*var\(--md-edit-mention-bg\)/);
});

test('the wrapper has no box while the switch is off, and the stylesheet hides it with its textarea', () => {
  assert.match(css, /\.md-edit \{ display: contents; \}/);
  assert.match(css, /\.md-edit\.on:has\(> textarea\[hidden\]\) \{ display: none; \}/);
  assert.match(css, /\.md-edit-back \{ display: none; \}/);
});

test('under forced colours the copy is hidden and the textarea is given the system text colour, not left to be overridden from transparent', () => {
  const at = css.indexOf('@media (forced-colors: active)');
  assert.ok(at > -1, 'a forced-colors block');
  const media = css.slice(at, css.indexOf('}\n}', at) + 3);
  const textarea = /\.md-edit\.on > textarea \{([^}]*)\}/.exec(media);
  assert.ok(textarea, 'the textarea has a rule in it');
  assert.match(textarea[1], /color:\s*CanvasText/);
  assert.match(textarea[1], /background:\s*Canvas;/);
  assert.doesNotMatch(textarea[1], /transparent/);
  assert.match(media, /\.md-edit\.on > \.md-edit-back \{[^}]*display:\s*none/);
  assert.ok(css.indexOf('.md-edit.on > textarea {') < at, 'it follows the rule it overrides');
});

test('h6 stays muted in the preview, on purpose, and says why where the rule is', () => {
  const rule = css.lastIndexOf('.detail-body h6 {');
  assert.ok(rule > -1);
  assert.match(css.slice(Math.max(0, rule - 500), rule), /h4 to h6 share a size/);
  assert.match(css.slice(rule, css.indexOf('}', rule)), /color:\s*var\(--mut\)/);
  assert.match(css, /\.md-edit-heading-six \{ color: var\(--md-edit-heading-six\); \}/);
  assert.match(css, /--md-edit-heading-six:\s*var\(--mut\);/);
});

test('on, the textarea is transparent over the copy with its caret and selection kept, and the selection has a wash of its own', () => {
  const textarea = /\.md-edit\.on > textarea \{([^}]*)\}/.exec(css)[1];
  assert.match(textarea, /color:\s*transparent/);
  assert.match(textarea, /background:\s*transparent/);
  assert.match(textarea, /caret-color:\s*var\(--ink\)/);
  const selection = /\.md-edit\.on > textarea::selection \{([^}]*)\}/.exec(css)[1];
  assert.match(selection, /background:\s*var\(--md-edit-selection\)/);
  assert.doesNotMatch(selection, /--accent-wash/);
});

test('the copy cannot take a click, a selection or a place in the layout of its own', () => {
  const back = /\.md-edit\.on > \.md-edit-back \{([^}]*)\}/.exec(css)[1];
  assert.match(back, /position:\s*absolute/);
  assert.match(back, /pointer-events:\s*none/);
  assert.match(back, /user-select:\s*none/);
  assert.match(back, /overflow:\s*hidden/);
  assert.match(back, /margin:\s*0/);
});

test('the full-screen popup hands the description\'s height to the wrapper and the textarea inside it', () => {
  assert.match(css, /\.modal\.fullscreen \.modal-desc textarea \{ flex: 1 1 auto; \}/);
  assert.match(css, /\.modal\.fullscreen \.modal-desc > \.md-edit\.on \{ flex: 1 1 auto; \}/);
  assert.match(css, /\.md-edit\.on > textarea \{[^}]*flex: 1 1 auto/);
});

test('the preview and the card details paint their headings in --md-preview-heading', () => {
  assert.match(css, /\.detail-body h1, \.detail-body h2, \.detail-body h3 \{ color: var\(--md-preview-heading\);/);
  assert.match(css, /\.detail-body h4, \.detail-body h5, \.detail-body h6 \{ color: var\(--md-preview-heading\);/);
});

test('the web skill names the layer, the tokenizer, the kinds, the bounds and every token', () => {
  const bullet = flat(web.slice(web.indexOf('- **Coloured Markdown boxes** —'), web.indexOf('- **Scratchpad** —')));
  assert.ok(bullet.length > 1500, 'the bullet is found');
  for (const part of ['mdEditAttach', 'markdown-edit-ui.js', 'markdownEditSpans', 'markdown-edit.js', '#f-body', '.sp-text', 'the Todos tab\'s Edit box','`display: contents`', 'mdEditSetOn', 'setMdColour', 'ResizeObserver',
    '4000 characters', '400000 characters', 'forced-colors', 'CanvasText', 'requestAnimationFrame', 'One `ResizeObserver`', 'kanban.md-colour', 'dotted', 'never a weight, style or size', 'theme-contrast.test.js', ...TOKENS.map((t) => `\`${t}\``)]) {
    assert.ok(bullet.includes(part), part);
  }
  for (const kind of KINDS) assert.ok(bullet.includes(`\`${kind}\``), kind);
  assert.ok(flat(web).includes('**Colour Markdown while editing** is on by default') && flat(web).includes('`kanban.md-colour`') && flat(web).includes('not per board'), 'the preferences sheet entry, one key for the browser');
  assert.ok(!flat(web).includes('`mdColour`'), 'it is not a key of the prefs entry of a board');
});

test('the docs say what the boxes show, that only colour changes, where it is turned off and which boxes stay plain', () => {
  const para = flat(docs.slice(docs.indexOf('**Coloured Markdown** —'), docs.indexOf('**Scratchpad** —')));
  assert.ok(para.length > 900, 'the paragraph is found');
  for (const part of ['description', 'Scratchpad\'s Edit box', 'the Todos tab\'s Edit box', 'headings', 'links (a dotted line under them', 'card mentions', 'colour and nothing else', 'wraps exactly where it would in a plain box',
    'Undo', 'Ctrl+S and Ctrl+Enter', 'a table without its delimiter row', 'note box', '**Colour Markdown while editing**', 'remembered in your browser, one choice for every board', '`--md-edit-*`', 'sixth-level heading', 'stays muted']) {
    assert.ok(para.includes(part), part);
  }
  const bullet = flat(docs.slice(docs.indexOf('- *Colour Markdown while editing*'), docs.indexOf('- *Hotkeys* lists')));
  assert.ok(bullet.includes('on by default') && bullet.includes('plain boxes') && bullet.includes('every board'), 'the sheet\'s bullet');
});
