const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The search box, its toggle and chip, and the panel under it: the markup the page
// ships, the stylesheet rules that draw it (a strict CSP allows no inline style, so
// every rule is in app.css, in the page's own tokens), and the places in the page
// code that keep it out of the way of a selection, the poll and Esc. How the pills
// behave is search-panel.test.js and search-panel-dom.test.js; the real page is looked
// at in the browser runner (scenarios/search-panel.js).

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const appSrc = read('app.js');
const panelSrc = read('search-panel.js');

const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const bar = header.slice(header.indexOf('<div class="search-bar">'), header.indexOf('<div class="actions">'));
const tagsOf = (markup, re) => markup.match(re) || [];
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };
const tagOf = (id) => { const [tag] = tagsOf(bar, new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`)); assert.ok(tag, `#${id} is in the search bar`); return tag; };
const at = (id) => bar.indexOf(`id="${id}"`);

// --- the box ------------------------------------------------------------------------

test('the search bar holds a box round the input, the chip, the clear button and the toggle, in that order, and the panel beside it', () => {
  assert.ok(bar.includes('<div class="search-box">'));
  const order = ['search-input', 'search-chip', 'search-clear-btn', 'search-panel-toggle', 'search-panel'].map(at);
  assert.ok(order.every((i) => i > -1), 'every part is in the bar');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  const box = bar.slice(bar.indexOf('<div class="search-box">'), bar.indexOf('<div id="search-panel"'));
  assert.ok(box.includes('id="search-input"') && box.includes('id="search-panel-toggle"'), 'the toggle is inside the box');
  assert.doesNotMatch(box, /id="search-panel"/, 'the panel is not inside the box: it hangs from the bar');
});

test('the input and the clear button are as they were, so everything that reads them still finds them', () => {
  assert.match(html, /<input type="search" id="search-input"/);
  assert.match(html, /<button type="button" id="search-clear-btn"/);
});

test('the toggle is a button that names the panel it opens, says whether it is open, starts closed and keeps a selection', () => {
  const toggle = tagOf('search-panel-toggle');
  assert.strictEqual(attr(toggle, 'type'), 'button');
  assert.strictEqual(attr(toggle, 'aria-expanded'), 'false');
  assert.strictEqual(attr(toggle, 'aria-controls'), 'search-panel');
  assert.ok(attr(toggle, 'aria-label'), 'it has a name for assistive technology');
  assert.notStrictEqual(attr(toggle, 'data-keeps-selection'), null);
});

test('the chip is a hidden image with a name the page fills in, and keeps a selection', () => {
  const chip = tagOf('search-chip');
  assert.match(attr(chip, 'class'), /(^|\s)hidden(\s|$)/);
  assert.strictEqual(attr(chip, 'role'), 'img', 'a span with an accessible name needs a role that takes one');
  assert.notStrictEqual(attr(chip, 'data-keeps-selection'), null);
  assert.match(bar, /<span id="search-chip"[^>]*><\/span>/, 'no text of its own: the page writes the count');
});

// --- the panel ------------------------------------------------------------------------

test('the panel is hidden to start, a named group, and keeps a selection', () => {
  const panel = tagOf('search-panel');
  assert.match(attr(panel, 'class'), /(^|\s)hidden(\s|$)/);
  assert.strictEqual(attr(panel, 'role'), 'group');
  assert.ok(attr(panel, 'aria-label'));
  assert.notStrictEqual(attr(panel, 'data-keeps-selection'), null, 'a click on its empty space never clears a card selection');
});

test('the panel has a slice region, then the pill section, then a divider, then a foot, each its own element', () => {
  const order = [at('search-slices'), at('search-pills-fold'), at('search-pills'), bar.indexOf('class="search-divider"'), at('search-foot')];
  assert.ok(order.every((i) => i > -1), 'every region is there');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  for (const id of ['search-slices', 'search-foot']) assert.match(bar, new RegExp(`<div id="${id}"[^>]*></div>`), `${id} starts empty`);
});

test('the pill section has a fold control that says whether it is open and names what it folds, and a pill host it labels', () => {
  const fold = tagOf('search-pills-fold');
  assert.strictEqual(attr(fold, 'type'), 'button');
  assert.strictEqual(attr(fold, 'aria-expanded'), 'true', 'unfolded to start');
  assert.strictEqual(attr(fold, 'aria-controls'), 'search-pills');
  assert.strictEqual(attr(fold, 'aria-label'), 'Pills', 'a name without the caret the stylesheet draws after it');
  assert.notStrictEqual(attr(fold, 'data-keeps-selection'), null);
  const pills = tagOf('search-pills');
  assert.strictEqual(attr(pills, 'role'), 'group');
  assert.strictEqual(attr(pills, 'aria-labelledby'), 'search-pills-fold');
});

test('nothing in the bar or the panel holds the poll: a button left focused by a click would stop it for good', () => {
  assert.doesNotMatch(bar, /data-holds-poll/);
});

test('nothing in the bar or the panel sets a style, an inline handler or a tab order of its own', () => {
  assert.doesNotMatch(bar, /\sstyle=/);
  assert.doesNotMatch(bar, /\son[a-z]+=/i);
  assert.doesNotMatch(bar, /tabindex/i, 'Tab reaches the toggle, the fold control and every pill by their place in the page');
});

test('every button in the bar is a type=button: none can submit a form', () => {
  for (const tag of tagsOf(bar, /<button[^>]*>/g)) assert.strictEqual(attr(tag, 'type'), 'button', tag);
});

test('every control in the bar and the panel is marked to keep a selection, the panel as a whole too', () => {
  for (const tag of [...tagsOf(bar, /<button[^>]*id="search-(panel-toggle|pills-fold)"[^>]*>/g), tagOf('search-chip'), tagOf('search-panel')]) {
    assert.notStrictEqual(attr(tag, 'data-keeps-selection'), null, tag);
  }
});

test('a click on the toggle, the fold control or the panel\'s empty space leaves a selection as it was', () => {
  const { KEEPS } = require('./helpers/markers');
  const sandbox = { setSelection() { throw new Error('the selection was cleared'); }, renderBoard() { throw new Error('the board repainted'); }, selectedIds: new Set([1, 2]), selectionGestureClick: null };
  vm.createContext(sandbox);
  const m = appSrc.match(/function onClickAway\([\s\S]*?\n\}/);
  vm.runInContext(m[0], sandbox);
  for (const id of ['search-panel-toggle', 'search-pills-fold', 'search-panel', 'search-chip']) {
    const marked = tagOf(id);
    assert.ok(marked.includes(KEEPS), id);
    sandbox.onClickAway({ shiftKey: false, ctrlKey: false, metaKey: false, target: { closest: (sel) => (sel === `[${KEEPS}]` ? marked : null) } });
  }
});

// --- the page ------------------------------------------------------------------------------

test('the pill list and the panel are page scripts, the list first, both ahead of graph-view.js and app.js, and the server serves them', async () => {
  const tag = (s) => html.indexOf(`<script src="/${s}"></script>`);
  assert.ok(tag('pills.js') > -1 && tag('search-panel.js') > -1);
  assert.ok(tag('pills.js') < tag('search-panel.js'));
  assert.ok(tag('search-panel.js') < tag('graph-view.js') && tag('graph-view.js') < tag('app.js'));
  assert.ok(tag('selection.js') < tag('search-panel.js'), 'the selection functions load before the panel that calls them');
  const { pageFiles } = require('../scripts/server');
  const served = pageFiles(fs.readFileSync(path.join(WEB, 'app.html'), 'utf8'));
  assert.ok(served.includes('pills.js') && served.includes('search-panel.js'));
});

test('focusing the search box does not open the panel: the panel script never listens to the box', () => {
  const code = panelSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /'focus'|"focus"|focusin/);
});

test('the panel script draws with classes only: no style, no innerHTML, no inline handler', () => {
  const code = panelSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\.style\b|style=|setAttribute\('style'|innerHTML|outerHTML|insertAdjacentHTML|onclick|\.on[a-z]+\s*=/);
});

test('renderBoard repaints the panel after the view, inside its try, and the poll guard names no panel control', () => {
  const body = appSrc.match(/function renderBoard\([\s\S]*?\n\}/)[0];
  assert.ok(body.indexOf('applyViewMode()') < body.indexOf('renderSearchPanel()'));
  assert.ok(body.indexOf('renderSearchPanel()') < body.indexOf('} finally {'));
  const guard = appSrc.match(/function boardControlFocused\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(guard, /#search|search-panel|query-pill/);
});

test('the Esc handler gains one line for the panel, after the popups and before the held-key check and the end of the chain', () => {
  const handler = appSrc.match(/document\.addEventListener\('keydown', \(e\) => \{\n    if \(e\.key !== 'Escape'\) return;[\s\S]*?\n  \}\);/)[0];
  const order = ['anyModalOpen()', 'closeSearchPanel()', 'e.repeat', 'escapeStep()'].map((s) => handler.indexOf(s));
  assert.ok(order.every((i) => i > -1), 'every link is there');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  assert.strictEqual(appSrc.split('closeSearchPanel()').length - 1, 1, 'called from the handler alone');
  const lines = handler.trimEnd().split('\n');
  assert.strictEqual(lines[lines.length - 2].trim(), 'escapeStep();');
});

test('the panel is not a surface the key guard names: the slice keys and the rest work while it is open', () => {
  const guard = require('../web/key-guard');
  assert.ok(!guard.KEY_GUARD_SURFACES.some((s) => /search|panel/i.test(s.name + s.selector)));
});

test('a pill\'s write to the box carries its reason, and nothing else writes with it', () => {
  assert.strictEqual(panelSrc.split("writeSearch(next.boxText, 'pill')").length - 1, 1);
  const writers = [...appSrc.matchAll(/writeSearch\([^)]*'pill'\)/g)];
  assert.strictEqual(writers.length, 1, 'Esc\'s step is the one other: it takes a dropped pill out of the box');
  assert.match(appSrc.match(/function stepSelectionBack\([\s\S]*?\n\}/)[0], /writeSearch\(shrunk, 'pill'\)/);
});

// --- the stylesheet ------------------------------------------------------------------------

const block = css.slice(css.indexOf('/* Search box and search panel.'), css.indexOf('/* End search box and search panel */'));

test('the search box and panel rules sit in one marked block', () => {
  assert.ok(block.length > 800, 'the block is found');
});

test('every class the markup and the panel script use has a rule', () => {
  for (const cls of ['search-box', 'search-chip', 'search-panel-toggle', 'search-panel', 'search-slices', 'search-foot', 'search-section', 'search-fold', 'search-pills', 'query-pill', 'query-pill-count', 'search-divider']) {
    assert.match(block, new RegExp(`\\.${cls}\\b`), `${cls} has a rule`);
  }
  assert.match(css, /\.search-bar \{[^}]*position: relative/, 'the panel hangs from the bar');
});

test('the colours are the page\'s tokens, each one declared, and none is a literal', () => {
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  const declared = new Set([...css.slice(0, css.indexOf(':root[data-theme="dark"]')).matchAll(/--([a-z-]+):/g)].map((m) => m[1]));
  for (const m of block.matchAll(/var\(--([a-z-]+)/g)) assert.ok(declared.has(m[1]), `--${m[1]} is declared`);
});

test('the panel is out of the header\'s flow, so opening it adds no height, and sits under the suggestion list', () => {
  const panel = block.match(/\.search-panel \{([^}]*)\}/)[1];
  assert.match(panel, /position: absolute/);
  assert.match(panel, /top: calc\(100% \+ \d+px\)/, 'it starts below the bar');
  const panelZ = Number(panel.match(/z-index: (\d+)/)[1]);
  const listZ = Number(css.match(/\.combobox-menu \{[^}]*z-index: (\d+)/)[1]);
  assert.ok(panelZ < listZ, `the list (${listZ}) is above the panel (${panelZ})`);
  const headerZ = Number(css.match(/\nheader \{[^}]*z-index: (\d+)/)[1]);
  assert.ok(headerZ < 30, 'the header stays below the popups');
});

test('the box carries the border and the input gives up its own, so the header is as tall as it was', () => {
  assert.match(block, /\.search-box \{[^}]*border: 1px solid var\(--line\)/);
  assert.match(block, /\.search-box \.search-input \{[^}]*border: 0/);
  assert.match(block, /\.search-box:focus-within \{[^}]*border-color: var\(--accent\)/);
});

test('the toggle, the fold control and the pills show a focus ring, and a pill that is on is drawn apart', () => {
  assert.match(block, /\.search-panel-toggle:focus-visible[^{]*\.search-fold:focus-visible[^{]*\.query-pill:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(block, /\.query-pill\.on \{[^}]*background: var\(--accent-soft\)/);
});

test('the pills use their own class, never a status pill\'s, so those rules, the poll\'s focus keeper and the click-away list never reach them', () => {
  assert.doesNotMatch(panelSrc, /map-filter-toggle|gantt-filter-toggle|calendar-filter-toggle|graph-filter-toggle|map-section-toggle/);
  assert.match(panelSrc, /className = 'query-pill'/);
  const keeper = appSrc.match(/const PILL_SELECTOR = [^\n]*\n/)[0];
  assert.doesNotMatch(keeper, /query-pill/);
});
