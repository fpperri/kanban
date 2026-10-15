const { test } = require('node:test');
const assert = require('node:assert');
const { BOARD, withSnapshot } = require('./nesting-fixture');

// The search panel's markup in the page the builder writes, its place beside the box, and the
// stylesheet rules that draw it, in the page's own colour tokens. How the panel behaves is
// panel-pills.test.js, panel-slices.test.js and panel-switch.test.js, which run the page; here the
// page is read as text, since the harness that runs it does not parse markup.

const built = (() => { let page; withSnapshot(BOARD, (html) => { page = html; }); return page; })();
const markup = built.slice(built.indexOf('<body>'), built.indexOf('<script>'));
const style = built.slice(built.indexOf('<style>'), built.indexOf('</style>'));
const bar = markup.slice(markup.indexOf('<div id="searchrow">'), markup.indexOf('<div class="viewtabs"'));

const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };
const tagOf = (id) => { const [tag] = bar.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`)) || []; assert.ok(tag, `#${id} is in the search row`); return tag; };
const at = (id) => bar.indexOf(`id="${id}"`);

test('the search row holds a bordered box round the input, the chip and the arrow, in that order, with the panel under it in the same bar', () => {
  assert.ok(bar.includes('<div class="search-bar">') && bar.includes('<div class="search-box">'));
  const order = ['q', 'search-chip', 'search-panel-toggle', 'search-panel'].map(at);
  assert.ok(order.every((i) => i > -1), 'every part is in the row');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  const box = bar.slice(bar.indexOf('<div class="search-box">'), bar.indexOf('<div id="search-panel"'));
  assert.ok(box.includes('id="q"') && box.includes('id="search-panel-toggle"') && box.includes('id="search-chip"'), 'the chip and the arrow are inside the box');
  assert.doesNotMatch(box, /id="search-panel"/, 'the panel hangs from the bar, it is not inside the box');
});

test('the input is the box it was: the page\'s one search input, with its stop mark and its placeholder', () => {
  assert.match(bar, /<input type="search" id="q" data-stop="1" aria-autocomplete="list" aria-controls="qmenu" placeholder="Search/);
  assert.strictEqual(built.split('id="q"').length - 1, 1);
});

test('the arrow is a switch button that names the panel it controls, starts pressed and closed, and names the p key', () => {
  const t = tagOf('search-panel-toggle');
  assert.match(t, /^<button /);
  assert.strictEqual(attr(t, 'type'), 'button');
  assert.strictEqual(attr(t, 'aria-pressed'), 'true');
  assert.strictEqual(attr(t, 'aria-expanded'), 'false');
  assert.strictEqual(attr(t, 'aria-controls'), 'search-panel');
  assert.match(attr(t, 'aria-label'), /opens on focus/i);
  assert.match(attr(t, 'title'), /opens when the box is focused/i);
  assert.match(attr(t, 'title'), /\bp\b/);
});

test('the chip is a hidden image with a name the page fills in, and no text of its own', () => {
  const t = tagOf('search-chip');
  assert.match(attr(t, 'class'), /(^|\s)hidden(\s|$)/);
  assert.strictEqual(attr(t, 'role'), 'img');
  assert.match(bar, /<span id="search-chip"[^>]*><\/span>/);
});

test('the panel is hidden to start, a named group, and holds the slice section first and the pill section after it, with no divider or foot and no Isolate control', () => {
  const t = tagOf('search-panel');
  assert.match(attr(t, 'class'), /(^|\s)hidden(\s|$)/);
  assert.strictEqual(attr(t, 'role'), 'group');
  assert.ok(attr(t, 'aria-label'));
  const order = ['search-slices-section', 'search-slices-fold', 'search-slices', 'search-pills-section', 'search-pills-fold', 'search-pills'].map(at);
  assert.ok(order.every((i) => i > at('search-panel')));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  const panel = bar.slice(bar.indexOf('<div id="search-panel"'));
  assert.doesNotMatch(panel, /isolate/i, 'the page has no selection, so the panel has no Isolate switch');
  assert.doesNotMatch(panel, /<hr|search-foot/);
});

test('the slice section is hidden until the page finds a slice to list, and starts folded; the pill section starts unfolded', () => {
  assert.match(attr(tagOf('search-slices-section'), 'class'), /(^|\s)hidden(\s|$)/);
  const sf = tagOf('search-slices-fold');
  assert.strictEqual(attr(sf, 'type'), 'button');
  assert.strictEqual(attr(sf, 'aria-expanded'), 'false');
  assert.strictEqual(attr(sf, 'aria-controls'), 'search-slices');
  assert.strictEqual(attr(sf, 'aria-label'), 'Slices');
  assert.match(attr(tagOf('search-slices'), 'class'), /(^|\s)hidden(\s|$)/, 'folded to start');
  const pf = tagOf('search-pills-fold');
  assert.strictEqual(attr(pf, 'type'), 'button');
  assert.strictEqual(attr(pf, 'aria-expanded'), 'true');
  assert.strictEqual(attr(pf, 'aria-controls'), 'search-pills');
  assert.strictEqual(attr(pf, 'aria-label'), 'Pills');
  assert.doesNotMatch(attr(tagOf('search-pills'), 'class'), /hidden/, 'unfolded to start');
  for (const id of ['search-slices', 'search-pills']) {
    assert.strictEqual(attr(tagOf(id), 'role'), 'group');
    assert.ok(attr(tagOf(id), 'aria-labelledby'));
  }
  assert.match(bar, /<div id="search-slices"[^>]*><\/div>/, 'the hosts start empty: the page draws the entries');
  assert.match(bar, /<div id="search-pills"[^>]*><\/div>/);
});

test('nothing in the search row sets a style, an inline handler or a tab order of its own, and the panel\'s controls are the browser\'s own buttons', () => {
  const own = bar.replace(/<div class="qmenu"[^>]*><\/div>/, '');
  assert.ok(own.length < bar.length, 'sanity: the suggestion list is in the row, and belongs to the box, not to the panel');
  assert.doesNotMatch(own, /\sstyle=|\son[a-z]+=|tabindex/i);
  const controls = bar.match(/<button [^>]*>/g) || [];
  assert.strictEqual(controls.length, 3, 'the arrow and the two fold controls');
  for (const c of controls) assert.strictEqual(attr(c, 'type'), 'button');
});

// --- the stylesheet ------------------------------------------------------------------------------

const rules = [...style.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] }));
const rule = (selector) => rules.filter((r) => r.selectors.includes(selector));
const panelCss = style.slice(style.indexOf('/* The search panel:'), style.indexOf('.hdr{'));

test('every class the panel draws with has a rule', () => {
  for (const cls of ['search-bar', 'search-box', 'search-chip', 'search-panel-toggle', 'search-panel', 'search-section', 'search-fold', 'search-pills', 'search-slices',
    'query-pill', 'query-pill-label', 'query-pill-count', 'query-pill-more', 'slice-entry', 'slice-entry-label', 'slice-entry-count', 'slice-entry-icon', 'hidden']) {
    assert.ok(rules.some((r) => r.selectors.some((s) => s.includes(`.${cls}`))), `.${cls} has a rule`);
  }
  assert.match(rule('.hidden')[0].body, /display:none/);
});

test('an entry and a pill on are drawn apart, a pill is no status pill, and the panel hangs from the bar without adding height', () => {
  for (const sel of ['.query-pill.on', '.slice-entry.on']) assert.match(rule(sel)[0].body, /background:var\(--accent-soft\)/, sel);
  assert.match(rule('.search-panel')[0].body, /position:absolute/);
  assert.match(rule('.search-bar')[0].body, /position:relative/);
  assert.ok(!rules.some((r) => r.selectors.some((s) => /\.pillrow\s+\.query-pill|\.query-pill\.off/.test(s))), 'the status pills\' rules do not reach the panel\'s');
  assert.match(rule('.slice-entry-icon:empty')[0].body, /display:none/, 'an icon with no glyph takes no room');
});

test('the suggestion list hangs over the panel, the panel under the sticky header and the list under the card sheet', () => {
  const z = (selector) => Number(/z-index:(\d+)/.exec(rule(selector)[0].body)[1]);
  assert.ok(z('.search-panel') < z('.qmenu'), 'the list is on top where they meet');
  assert.ok(z('.search-panel') < z('.hdr'), 'the panel goes under the sticky header when the page scrolls');
  assert.ok(z('.qmenu') < z('#modal'), 'and the list under the card sheet');
});

test('the panel\'s rules use the page\'s colour tokens only, and every token they name exists on :root', () => {
  assert.ok(panelCss.length > 1500, 'the panel\'s block is found');
  assert.doesNotMatch(panelCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no colour literal');
  const root = style.slice(style.indexOf(':root{'), style.indexOf('}', style.indexOf(':root{')));
  const used = [...new Set([...panelCss.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1]))];
  assert.ok(used.length > 8);
  for (const token of used) assert.ok(root.includes(`--${token}:`), `--${token} is a token of the page`);
});

// --- the page script ---------------------------------------------------------------------------------

const script = built.slice(built.lastIndexOf('<script>'));
const panelJs = script.slice(script.indexOf('// The search panel:'), script.indexOf('function statusPills()'));
const panelCode = panelJs.replace(/\/\/[^\n]*\n/g, '');

test('the panel\'s script builds its buttons with el() and sets text as text: no markup is written, no inline handler, no data-stop', () => {
  assert.ok(panelJs.length > 5000, 'the panel\'s block is found');
  assert.doesNotMatch(panelCode, /innerHTML|insertAdjacentHTML|\.outerHTML|\.onclick|\.on[a-z]+ ?=|\.style\.[a-zA-Z]+ ?=[^=]|setAttribute\("style"|data-stop|dataset\.stop/);
  assert.match(panelJs, /el\("button","query-pill"\)/);
  assert.match(panelJs, /el\("button","slice-entry"\)/);
});

test('the panel\'s script has no Isolate switch and no selection: a pill click only writes the box', () => {
  assert.ok(!/isolate/i.test(panelCode), 'no Isolate');
  assert.ok(!/\bselection\b|setAnchor|additions/.test(panelJs.replace(/\/\/[^\n]*\n/g, '')), 'no selection in the code (comments aside)');
});

test('the box is written only through writeBox, from the search module\'s term interface, never by joining strings', () => {
  const code = panelJs.replace(/\/\/[^\n]*\n/g, '');
  assert.strictEqual(code.split('writeBox(').length - 1, 4, 'one writer: its definition, the two writes of a pill gesture and the one of a run');
  assert.doesNotMatch(code, /\$\("q"\)\.value\s*=[^=]/);
  assert.match(code, /searchSetSlice\(\$\("q"\)\.value,sliceRunValue\(now\.list,run\)\)/);
  assert.match(code, /searchAddAlt\(box,pill\.query\)/);
  assert.match(code, /searchRemoveAlt\(box,pill\.query\)/);
});

test('the keys read one guard: a field with focus, a sheet, a card menu or the change tray', () => {
  const guard = panelJs.slice(panelJs.indexOf('function keysOff()'), panelJs.indexOf('function sliceKeyIsChord'));
  for (const part of ['INPUT', 'TEXTAREA', 'SELECT', 'isContentEditable', 'ctxMenuEl', 'modalOpen()', '$("pend")']) assert.ok(guard.includes(part), part);
  const keys = panelJs.slice(panelJs.indexOf('function panelKey(e)'));
  assert.strictEqual(keys.split('keysOff()').length - 1, 2, 'the slice keys and p read it');
  assert.ok(keys.indexOf('keysOff()') > keys.indexOf('ContextMenu'), 'the context-menu key is the entry\'s own and reads no guard');
});
