const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The slice section's markup, its place in the page and its stylesheet rules: a strict
// CSP allows no inline style, so every rule is in app.css, in the page's own tokens. How
// the section behaves is search-slices.test.js; the real page is looked at in the browser
// runner (scenarios/slice-section.js).

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const appSrc = read('app.js');
const sliceSrc = read('search-slices.js');

const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const bar = header.slice(header.indexOf('<div class="search-bar">'), header.indexOf('<div class="actions">'));
const tagsOf = (markup, re) => markup.match(re) || [];
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };
const tagOf = (id) => { const [tag] = tagsOf(bar, new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`)); assert.ok(tag, `#${id} is in the search bar`); return tag; };
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// --- the markup ---------------------------------------------------------------------------------

test('the slice section is the panel\'s first region: a section with a fold control and a host of entries, ahead of the pill section', () => {
  const at = (id) => bar.indexOf(`id="${id}"`);
  const order = [at('search-slices-section'), at('search-slices-fold'), at('search-slices'), at('search-pills-fold'), at('search-pills')];
  assert.ok(order.every((i) => i > -1));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  const section = tagOf('search-slices-section');
  assert.match(section, /^<section /);
  assert.match(attr(section, 'class'), /\bsearch-section\b/);
  assert.strictEqual(attr(section, 'aria-labelledby'), 'search-slices-fold');
  assert.match(bar, /<div id="search-slices"[^>]*><\/div>/, 'the host starts empty: the page draws the entries');
});

test('the section is out of the panel until the page finds a slice to list', () => {
  assert.match(attr(tagOf('search-slices-section'), 'class'), /(^|\s)hidden(\s|$)/);
});

test('the fold control says whether the section is open and names what it folds, and the section starts folded', () => {
  const fold = tagOf('search-slices-fold');
  assert.strictEqual(attr(fold, 'type'), 'button');
  assert.strictEqual(attr(fold, 'aria-expanded'), 'false', 'folded to start, as the preference says');
  assert.strictEqual(attr(fold, 'aria-controls'), 'search-slices');
  assert.strictEqual(attr(fold, 'aria-label'), 'Slices', 'a name without the caret the stylesheet draws after it');
  assert.match(attr(fold, 'class'), /\bsearch-fold\b/, 'the pill section\'s fold control, drawn the same');
  assert.notStrictEqual(attr(fold, 'data-keeps-selection'), null);
  const host = tagOf('search-slices');
  assert.strictEqual(attr(host, 'role'), 'group');
  assert.strictEqual(attr(host, 'aria-labelledby'), 'search-slices-fold');
  assert.match(attr(host, 'class'), /(^|\s)hidden(\s|$)/, 'folded to start');
});

test('nothing in the section sets a style, an inline handler, a tab order of its own or a hold on the poll', () => {
  const section = bar.slice(bar.indexOf('<section id="search-slices-section"'), bar.indexOf('<section', bar.indexOf('<section id="search-slices-section"') + 5));
  assert.ok(section.length > 100);
  assert.doesNotMatch(section, /\sstyle=|\son[a-z]+=|tabindex|data-holds-poll/i);
});

test('the slice section\'s setting is a checkbox in the preferences sheet', () => {
  assert.match(html, /<input type="checkbox" id="prefs-slices-folded" data-keeps-selection data-holds-poll> Slice section starts folded/);
});

// --- the page -------------------------------------------------------------------------------------

test('the run arithmetic loads after the slices it works on, and the section\'s script after the panel\'s and the key guard, all ahead of the Graph and app.js', async () => {
  const tag = (s) => html.indexOf(`<script src="/${s}"></script>`);
  for (const name of ['slice-run.js', 'search-slices.js']) assert.ok(tag(name) > -1, `${name} is a page script`);
  assert.ok(tag('slices.js') < tag('slice-run.js'));
  assert.ok(tag('search.js') < tag('search-slices.js') && tag('selection.js') < tag('search-slices.js') && tag('key-guard.js') < tag('search-slices.js'));
  assert.ok(tag('search-panel.js') < tag('search-slices.js'));
  assert.ok(tag('slice-run.js') < tag('search-slices.js'));
  assert.ok(tag('search-slices.js') < tag('graph-view.js') && tag('graph-view.js') < tag('app.js'));
  const { pageFiles } = require('../scripts/server');
  const served = pageFiles(fs.readFileSync(path.join(WEB, 'app.html'), 'utf8'));
  assert.ok(served.includes('slice-run.js') && served.includes('search-slices.js'));
});

test('every element the section\'s script looks up by id is in the page', () => {
  const ids = new Set([...sliceSrc.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size >= 4, 'the lookups are found');
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `#${id} is in app.html`);
});

test('the section\'s script writes no style, no markup and no inline handler: its buttons are built, with their own class', () => {
  const src = code(sliceSrc);
  assert.doesNotMatch(src, /\.style\b|setAttribute\('style'|innerHTML|insertAdjacentHTML|\.onclick|\.on[a-z]+ =/);
  assert.match(src, /className = 'slice-entry'/);
  assert.doesNotMatch(src, /query-pill|map-filter-toggle|gantt-filter-toggle|calendar-filter-toggle|graph-filter-toggle|map-section-toggle/, 'never a pill\'s class');
  assert.doesNotMatch(src, /holdsPoll|data-holds-poll/);
  const keeper = appSrc.match(/const PILL_SELECTOR = [^\n]*\n/)[0];
  assert.doesNotMatch(keeper, /slice-entry/, 'the poll\'s focus keeper does not rebuild them');
});

test('the keys read the shared key guard, once, as one document listener, and write the box with the reason slice', () => {
  const src = code(sliceSrc);
  assert.strictEqual(src.split("document.addEventListener('keydown'").length - 1, 1);
  assert.match(src.match(/function onSliceKey\([\s\S]*?\n\}/)[0], /keyGuardOff\(document\)/);
  assert.strictEqual(src.split("writeSearch(next, 'slice')").length - 1, 1, 'one write, and it carries the reason');
  assert.match(src.match(/function onSliceKey\([\s\S]*?\n\}/)[0], /SLICE_RUN_KEYS\.includes\(e\.key\)/);
});

test('the box is written only through the search module\'s term interface, never by joining strings', () => {
  const src = code(sliceSrc);
  assert.match(src, /searchSetSlice\(box, sliceRunValue\(now\.list, run\)\)/);
  assert.doesNotMatch(src, /\$\('#search-input'\)\.value =|input\.value =/);
});

test('the panel draws the section on every repaint and counts the run in the chip, and a pill gesture sets the run apart', () => {
  const panel = read('search-panel.js');
  assert.match(panel.match(/function renderSearchPanel\([\s\S]*?\n\}/)[0], /renderSearchSlices\(\)/);
  assert.match(panel.match(/function syncSearchChip\([\s\S]*?\n\}/)[0], /searchSlicesChipNames\(\)/);
  assert.match(panel.match(/function applyPillGesture\([\s\S]*?\n\}/)[0], /searchSplitSlice\(/);
});

test('a write with the reason slice never makes the box the anchor, and a typed anchor follows it', () => {
  const body = appSrc.match(/function selectionFollowingBox\([\s\S]*?\n\}/)[0];
  assert.match(body, /reason === 'slice'/);
});

// --- the stylesheet -------------------------------------------------------------------------------

const block = css.slice(css.indexOf('/* Search box and search panel.'), css.indexOf('/* End search box and search panel */'));

test('every class the section draws with has a rule, in the search panel\'s own block', () => {
  for (const cls of ['slice-entry', 'slice-entry-icon', 'slice-entry-count', 'search-slices']) assert.match(block, new RegExp(`\\.${cls}\\b`), `${cls} has a rule`);
  assert.match(block, /\.slice-entry\.on \{[^}]*background: var\(--accent-soft\)/, 'an entry in the run is drawn apart, as a pill that is on is');
  assert.match(block, /\.search-pills, \.search-slices \{[^}]*flex-wrap: wrap/);
});

test('an entry has its own rules, apart from a pill\'s: only the focus ring is shared, and it shows', () => {
  const shared = block.split('\n').filter((line) => /\.slice-entry/.test(line) && /\.query-pill/.test(line));
  assert.strictEqual(shared.length, 1, 'one rule names both');
  assert.match(shared[0], /:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  for (const rule of ['.slice-entry {', '.slice-entry:hover {', '.slice-entry.on {']) assert.ok(block.includes(rule), `a rule for ${rule}`);
});

test('an icon with no glyph takes no room', () => {
  assert.match(block, /\.slice-entry-icon:empty \{[^}]*display: none/);
});

test('the section lists the slices the search module builds for the cut, and does not build an axis of its own', () => {
  const src = code(sliceSrc);
  assert.match(src.match(/function searchSlicesSliced\([\s\S]*?\n\}/)[0], /searchSlices\(/);
  assert.doesNotMatch(src, /sliceCards\(|depthMap\(/);
});
