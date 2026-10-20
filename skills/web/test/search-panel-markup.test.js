const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The search box, its arrow (the panel's switch) and chip, and the panel under it: the markup the page
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

test('the input\'s hint says the first Esc closes the open panel and a later one clears the box', () => {
  const hint = attr(tagOf('search-input'), 'title');
  assert.doesNotMatch(hint, /Esc to clear/);
  assert.ok(hint.indexOf('closes the search panel') > -1 && hint.indexOf('closes the search panel') < hint.indexOf('clears the box'), hint);
});

test('the arrow is a button that names the panel it controls, says whether it is open, starts closed and keeps a selection', () => {
  const toggle = tagOf('search-panel-toggle');
  assert.strictEqual(attr(toggle, 'type'), 'button');
  assert.strictEqual(attr(toggle, 'aria-expanded'), 'false');
  assert.strictEqual(attr(toggle, 'aria-controls'), 'search-panel');
  assert.ok(attr(toggle, 'aria-label'), 'it has a name for assistive technology');
  assert.notStrictEqual(attr(toggle, 'data-keeps-selection'), null);
});

test('the arrow is a switch: it starts pressed, the panel opening on focus, and its name and tooltip say what it does and name the p key', () => {
  const toggle = tagOf('search-panel-toggle');
  assert.strictEqual(attr(toggle, 'aria-pressed'), 'true', 'on to start, the default');
  assert.match(attr(toggle, 'aria-label'), /opens on focus/i, 'a name that reads right with the pressed state after it');
  assert.match(attr(toggle, 'title'), /opens when the box is focused/i);
  assert.match(attr(toggle, 'title'), /\bp\b/);
});

test('the chip is a hidden button with a name the page fills in, and keeps a selection', () => {
  const chip = tagOf('search-chip');
  assert.match(attr(chip, 'class'), /(^|\s)hidden(\s|$)/, 'hidden to start: a hidden control is no tab stop');
  assert.match(chip, /^<button\b/, 'a real button: Tab reaches it, and Enter and Space reach the page as a click');
  assert.strictEqual(attr(chip, 'type'), 'button');
  assert.strictEqual(attr(chip, 'role'), null, 'the button\'s own role, not an image');
  assert.strictEqual(attr(chip, 'tabindex'), null, 'its place in the page is its place in the Tab order');
  assert.notStrictEqual(attr(chip, 'data-keeps-selection'), null);
  assert.match(bar, /<button type="button" id="search-chip"[^>]*><\/button>/, 'no text of its own: the page writes the count');
});

test('the chip names the panel it opens, which is shut whenever the chip is shown', () => {
  const chip = tagOf('search-chip');
  assert.strictEqual(attr(chip, 'aria-controls'), 'search-panel');
  assert.strictEqual(attr(chip, 'aria-expanded'), 'false');
});

// --- the panel ------------------------------------------------------------------------

test('the panel is hidden to start, a named group, and keeps a selection', () => {
  const panel = tagOf('search-panel');
  assert.match(attr(panel, 'class'), /(^|\s)hidden(\s|$)/);
  assert.strictEqual(attr(panel, 'role'), 'group');
  assert.ok(attr(panel, 'aria-label'));
  assert.notStrictEqual(attr(panel, 'data-keeps-selection'), null, 'a click on its empty space never clears a card selection');
});

test('the panel has the Statuses section, then a slice region, then the pill section, then a divider, then a foot, each its own element', () => {
  const order = [at('search-statuses-fold'), at('search-statuses'), at('search-slices'), at('search-pills-fold'), at('search-pills'), bar.indexOf('class="search-divider"'), at('search-foot')];
  assert.ok(order.every((i) => i > -1), 'every region is there');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  assert.match(bar, /<div id="search-slices"[^>]*><\/div>/, 'the slice region starts empty');
  const foot = bar.slice(bar.indexOf('<div id="search-foot"'));
  assert.match(foot, /^<div id="search-foot"[^>]*>\s*<button[^>]*id="isolate-switch"/, 'the foot holds the Isolate switch, and nothing before it');
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

test('the Statuses section is static markup first in the panel: a fold control that is open, names what it folds and keeps a selection, and a pill host it labels', () => {
  const panel = bar.slice(bar.indexOf('<div id="search-panel"'));
  assert.match(panel, /^<div id="search-panel"[^>]*>\s*<section id="search-statuses-section"/, 'the first thing in the panel');
  const fold = tagOf('search-statuses-fold');
  assert.strictEqual(attr(fold, 'type'), 'button');
  assert.strictEqual(attr(fold, 'aria-expanded'), 'true', 'open to start');
  assert.strictEqual(attr(fold, 'aria-controls'), 'search-statuses');
  assert.strictEqual(attr(fold, 'aria-label'), 'Statuses');
  assert.notStrictEqual(attr(fold, 'data-keeps-selection'), null);
  const host = tagOf('search-statuses');
  assert.strictEqual(attr(host, 'role'), 'group');
  assert.strictEqual(attr(host, 'aria-labelledby'), 'search-statuses-fold');
  assert.notStrictEqual(attr(host, 'data-keeps-selection'), null);
  assert.match(bar, /<div id="search-statuses"[^>]*><\/div>/, 'the host starts empty: the page draws the pills');
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
  const sandbox = { setSelection() { throw new Error('the selection was cleared'); }, renderBoard() { throw new Error('the board repainted'); }, selectedIds: new Set([1, 2]) };
  vm.createContext(sandbox);
  const m = appSrc.match(/function onClickAway\([\s\S]*?\n\}/);
  vm.runInContext(m[0], sandbox);
  for (const id of ['search-panel-toggle', 'search-pills-fold', 'search-panel', 'search-chip']) {
    const marked = tagOf(id);
    assert.ok(marked.includes(KEEPS), id);
    sandbox.onClickAway({ shiftKey: false, ctrlKey: false, metaKey: false, detail: 2, target: { closest: (sel) => (sel === `[${KEEPS}]` ? marked : null) } });
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

test('focusing the search box opens the panel through one focus listener on the box, which asks the switch first', () => {
  const code = panelSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.strictEqual(code.split("'focus'").length - 1, 1, 'one focus listener in the panel script');
  assert.match(code, /\$\('#search-input'\)\.addEventListener\('focus', onSearchBoxFocus\);/);
  assert.match(code.match(/function onSearchBoxFocus\([\s\S]*?\n\}/)[0], /searchPanelSwitchOn\(\)/);
  assert.doesNotMatch(code, /focusin/);
});

test('the p key is read by one document keydown listener of the panel script, through the whole key guard', () => {
  const code = panelSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(code, /document\.addEventListener\('keydown', onSearchPanelKey\);/);
  const handler = code.match(/function onSearchPanelKey\([\s\S]*?\n\}/)[0];
  assert.match(handler, /keyGuardOff\(document\)/, 'off while typing and while a popup is up');
  assert.match(handler, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/, 'a chord is not the key');
  assert.match(handler, /e\.repeat/, 'a held key flips it once');
  assert.ok(handler.indexOf('keyGuardOff') < handler.indexOf('preventDefault'), 'the browser\'s own response is stopped only when the key acts');
  assert.doesNotMatch(handler, /KEY_GUARD_SURFACES|querySelector/, 'the guard decides, not a list of the handler\'s own');
});

test('the m key is read by one document keydown listener of the panel script, through the whole key guard, and steps by the pill list\'s own step', () => {
  const code = panelSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.strictEqual(code.split("addEventListener('keydown', onPillStepKey)").length - 1, 1);
  const handler = code.match(/function onPillStepKey\([\s\S]*?\n\}/)[0];
  assert.match(handler, /keyGuardOff\(document\)/, 'off while typing and while a popup is up');
  assert.match(handler, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/, 'a chord is not the key');
  assert.match(handler, /e\.repeat/, 'a held key steps once');
  assert.match(handler, /e\.shiftKey \? -1 : 1/, 'Shift steps backwards');
  assert.ok(handler.indexOf('keyGuardOff') < handler.indexOf('preventDefault'), 'the browser\'s own response is stopped only when the key acts');
  assert.doesNotMatch(handler, /KEY_GUARD_SURFACES|querySelector/, 'the guard decides, not a list of the handler\'s own');
  const step = code.match(/function stepSearchPill\([\s\S]*?\n\}/)[0];
  assert.match(step, /pillStep\(searchPanelEntries\(\), selectionState\.selection, direction\)/, 'the step is the pill list\'s, over the pills the panel lists');
  assert.match(step, /applyPillGesture\('solo', pill\.key\)/, 'the step is a solo, as a right-click is');
});

test('the arrow and the p key flip one switch, and the preferences sheet sets the same one', () => {
  assert.match(panelSrc, /\$\('#search-panel-toggle'\)\.addEventListener\('click', flipSearchPanelSwitch\);/);
  assert.match(panelSrc.match(/function flipSearchPanelSwitch\([\s\S]*?\n\}/)[0], /setPanelOnFocus\(!searchPanelSwitchOn\(\), true\)/);
  assert.match(panelSrc.match(/function onSearchPanelKey\([\s\S]*?\n\}/)[0], /flipSearchPanelSwitch\(\)/);
  assert.match(appSrc.match(/function setPanelOnFocus\([\s\S]*?\n\}/)[0], /applySearchPanelSwitch\(on, openNow\)/);
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
  const order = ['anyModalOpen()', 'closeSearchPanel()', 'e.repeat', 'escapeStep(e)'].map((s) => handler.indexOf(s));
  assert.ok(order.every((i) => i > -1), 'every link is there');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  assert.strictEqual(appSrc.split('closeSearchPanel()').length - 1, 1, 'called from the handler alone');
  const lines = handler.trimEnd().split('\n');
  assert.strictEqual(lines[lines.length - 2].trim(), 'escapeStep(e);');
});

test('the panel is not a surface the key guard names: the slice keys and the rest work while it is open', () => {
  const guard = require('../web/key-guard');
  assert.ok(!guard.KEY_GUARD_SURFACES.some((s) => /search|panel/i.test(s.name + s.selector)));
});

test('a pill\'s write to the box carries its reason, and nothing else writes with it', () => {
  assert.strictEqual(panelSrc.split("writeSearch(searchJoinSlice(next.boxText, slices), 'pill')").length - 1, 1, 'the one write of a pill gesture puts the run of slices back');
  const writers = [...appSrc.matchAll(/writeSearch\([^)]*'pill'\)/g)];
  assert.strictEqual(writers.length, 1, 'the step down the selection is the one other: it takes a dropped pill out of the box');
  assert.match(appSrc.match(/function moveSelectionTo\([\s\S]*?\n\}/)[0], /writeSearch\(shrunk, 'pill'\)/);
  assert.match(appSrc.match(/function stepSelectionBack\([\s\S]*?\n\}/)[0], /moveSelectionTo\(next\)/, 'Esc takes it');
  assert.match(appSrc.match(/function onClickAway\([\s\S]*?\n\}/)[0], /moveSelectionTo\(/, 'so does a double click on empty space');
  const cardClick = appSrc.match(/function applyCardClick\([\s\S]*?\n\}/)[0];
  assert.match(cardClick, /action === 'select'[^\n]*moveSelectionTo\(selectionState, before\)/, 'and a click on a card that selects it');
  assert.doesNotMatch(cardClick.replace(/\/\/[^\n]*/g, ''), /'open'[^\n]*moveSelectionTo/, 'but opening a card changes no filter: a click that opens it takes no pill out of the box');
});

// --- the stylesheet ------------------------------------------------------------------------

const block = css.slice(css.indexOf('/* Search box and search panel.'), css.indexOf('/* End search box and search panel */'));

test('the search box and panel rules sit in one marked block', () => {
  assert.ok(block.length > 800, 'the block is found');
});

test('every class the markup and the panel script use has a rule', () => {
  for (const cls of ['search-box', 'search-chip', 'search-panel-toggle', 'search-panel', 'search-slices', 'search-section', 'search-fold', 'search-pills', 'query-pill', 'query-pill-count', 'search-divider']) {
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

test('the arrow switched off is struck through, by a rule that dims nothing with opacity', () => {
  const off = block.match(/\.search-panel-toggle\[aria-pressed="false"\] \{([^}]*)\}/);
  assert.ok(off, 'a rule for the arrow while the switch is off');
  assert.match(off[1], /text-decoration: line-through/, 'a cue that is not a colour');
  assert.doesNotMatch(off[1], /opacity/);
});

test('the toggle, the fold control and the pills show a focus ring, and a pill that is on is drawn apart', () => {
  assert.match(block, /\.search-panel-toggle:focus-visible[^{]*\.search-fold:focus-visible[^{]*\.query-pill:focus-visible[^{]*\.slice-entry:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(block, /\.query-pill\.on \{[^}]*background: var\(--accent-soft\)/);
});

test('the chip shows the focus ring the arrow and the pills show, from the same tokens', () => {
  const ring = 'outline: 2px solid var(--accent); outline-offset: 1px;';
  assert.ok(block.includes(`.search-chip:focus-visible { ${ring} }`), 'the chip has the ring');
  assert.ok(block.includes(`.slice-entry:focus-visible { ${ring} }`), 'the same ring as the arrow, the fold controls and the pills');
});

test('the chip draws as it did before it was a button: its own font and no hover wash of the button rule', () => {
  const chip = block.match(/\.search-chip \{([^}]*)\}/)[1];
  assert.match(chip, /font: inherit; font-size: 0\.75em/, 'the button\'s own font is reset, then the chip\'s size');
  assert.match(block, /\.search-chip:hover \{[^}]*background: var\(--accent-soft\)/, 'the global button:hover rule would otherwise wash it');
});

test('the chip takes the pointer hand the other header buttons take, from the button rule, with no cursor of its own to undo it', () => {
  const buttons = css.match(/^button \{([^}]*)\}/m)[1];
  assert.match(buttons, /cursor: pointer/, 'the hand every button has');
  assert.match(tagOf('search-chip'), /^<button\b/, 'the chip is a button, so the rule reaches it');
  for (const selector of ['search-chip', 'search-panel-toggle']) {
    const rule = block.match(new RegExp(`\\.${selector} \\{([^}]*)\\}`))[1];
    assert.doesNotMatch(rule, /cursor/, `${selector} sets no cursor of its own`);
  }
});

test('the pills use their own class, never a status pill\'s, so those rules, the poll\'s focus keeper and the click-away list never reach them', () => {
  assert.doesNotMatch(panelSrc, /map-filter-toggle|gantt-filter-toggle|calendar-filter-toggle|graph-filter-toggle|map-section-toggle/);
  assert.match(panelSrc, /className = 'query-pill'/);
  const keeper = appSrc.match(/const REFOCUS_SELECTOR = [^\n]*\n/)[0];
  assert.doesNotMatch(keeper, /query-pill/);
});

test('every element the panel script looks up by id is in the page', () => {
  const ids = new Set([...panelSrc.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size >= 5, 'the lookups are found');
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `#${id} is in app.html`);
});
