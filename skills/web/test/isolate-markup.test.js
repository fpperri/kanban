const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Isolate switch as the page ships it: the markup at the foot of the search panel, the
// stylesheet rules that draw it (a strict CSP allows no inline style, so every rule is in
// app.css, in the page's own tokens), the one script that carries it out, and the places in the
// page code that read it. How it behaves is isolate.test.js; the real page is looked at in the
// browser runner (scenarios/isolate.js).

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const appSrc = read('app.js');
const isolateSrc = read('isolate.js');
const graphViewSrc = read('graph-view.js');
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const foot = html.slice(html.indexOf('<div id="search-foot"'), html.indexOf('</div>', html.indexOf('<div id="search-foot"')) + 6);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };
const tag = (foot.match(/<button[^>]*id="isolate-switch"[^>]*>/) || [''])[0];

// --- the markup ---------------------------------------------------------------------------

test('the switch is the one thing in the panel\'s foot, a button that is a switch for assistive technology, off to start', () => {
  assert.ok(tag, 'the switch is in the foot');
  assert.strictEqual(attr(tag, 'type'), 'button', 'it cannot submit a form');
  assert.strictEqual(attr(tag, 'role'), 'switch');
  assert.strictEqual(attr(tag, 'aria-checked'), 'false', 'off to start; the page keeps it');
  assert.strictEqual((foot.match(/<button/g) || []).length, 1);
});

test('the switch has a name a reader hears, and a tooltip that says what a click does and names the i key', () => {
  assert.match(foot, /<span class="isolate-switch-label">Isolate<\/span>/, 'its text is its name: Isolate, switch, off');
  assert.match(attr(tag, 'title'), /only the selection/i);
  assert.match(attr(tag, 'title'), /press i\b/i);
});

test('the tooltip the script gives an off switch is the one the markup ships with, so the first paint and the first sync agree', () => {
  const off = (isolateSrc.match(/const ISOLATE_SWITCH_OFF = '([^']*)';/) || [])[1];
  assert.ok(off, 'the script names the off tooltip');
  assert.strictEqual(attr(tag, 'title'), off);
});

test('a click on the switch never clears a selection, and the switch holds neither the poll nor a style nor a handler', () => {
  assert.notStrictEqual(attr(tag, 'data-keeps-selection'), null);
  assert.strictEqual(attr(tag, 'data-holds-poll'), null, 'a button left focused by a click would stop the poll for good');
  assert.doesNotMatch(foot, /\sstyle=|\son[a-z]+=/i);
  assert.strictEqual(attr(tag, 'tabindex'), null, 'Tab reaches it by its place in the page');
});

test('the panel\'s foot comes after the divider, so the switch sits at the foot of the panel', () => {
  assert.ok(html.indexOf('class="search-divider"') < html.indexOf('id="isolate-switch"'));
  assert.ok(html.indexOf('id="search-pills"') < html.indexOf('id="isolate-switch"'));
});

// --- the script ---------------------------------------------------------------------------

test('the page loads the isolate script after the panel\'s scripts and before the Graph and the app', () => {
  const scripts = [...html.matchAll(/<script src="\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.includes('isolate.js'));
  assert.ok(scripts.indexOf('isolate.js') > scripts.indexOf('search-slices.js'));
  assert.ok(scripts.indexOf('isolate.js') < scripts.indexOf('graph-view.js'));
  assert.ok(scripts.indexOf('isolate.js') < scripts.indexOf('app.js'));
  assert.ok(scripts.indexOf('selection.js') < scripts.indexOf('isolate.js') && scripts.indexOf('search.js') < scripts.indexOf('isolate.js'));
});

test('the script writes the box through the one writer, with the reason isolate, and in no other way', () => {
  const src = code(isolateSrc);
  const writes = [...src.matchAll(/writeSearch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(writes, ["box, 'isolate'", "text, 'isolate'", "text, 'isolate'"], 'turning it on for a query the box lights, turning it on for a selection, and turning it off');
  assert.doesNotMatch(src, /\.value\s*=[^=]/, 'never assigns the box');
  assert.doesNotMatch(src, /setSelection\(/, 'isolate is no selection state: it never writes the selection');
});

test('the script draws with attributes only: no style, no innerHTML, no inline handler', () => {
  assert.doesNotMatch(code(isolateSrc), /\.style\b|style=|innerHTML|outerHTML|insertAdjacentHTML|onclick|\.on[a-z]+\s*=/);
});

test('the i key reads the whole shared key guard, and is registered on the document', () => {
  const body = isolateSrc.match(/function onIsolateKey\([\s\S]*?\n\}/)[0];
  assert.match(body, /keyGuardOff\(document\)/, 'a field, a menu, a dialog, the notifications panel and the preferences sheet turn it off');
  assert.match(body, /e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey \|\| e\.repeat/);
  assert.match(isolateSrc, /document\.addEventListener\('keydown', onIsolateKey\)/);
  assert.match(isolateSrc, /\$\('#isolate-switch'\)\.addEventListener\('click', isolateFlip\)/);
});

test('every element the script looks up by id is in the page', () => {
  for (const id of [...code(isolateSrc).matchAll(/\$\('#([a-z-]+)'\)/g)].map((m) => m[1])) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is in app.html`);
  }
});

// --- where the page reads it ----------------------------------------------------------------

test('the Graph\'s one decision about a query is told whether isolate is on', () => {
  assert.match(appSrc.match(/function currentGraphQueryEffect\([\s\S]*?\n\}/)[0], /\{ isolated: isolateNow\(\) !== null \}/);
});

// A write with the reason isolate leaves the selection as it is, in the Graph too: write-reasons.test.js.

test('Esc stops the browser\'s own Esc with isolate on, in the step that ends the chain after the held-key check, and the step reads the flag', () => {
  const handler = appSrc.match(/document\.addEventListener\('keydown', \(e\) => \{\n    if \(e\.key !== 'Escape'\) return;[\s\S]*?\n  \}\);/)[0];
  const order = ['closeSearchPanel()', 'e.repeat', 'escapeStep(e)'].map((s) => handler.indexOf(s));
  assert.ok(order.every((at) => at !== -1), 'every link is there');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  assert.match(appSrc.match(/function stepSelectionBack\([\s\S]*?\n\}/)[0], /isolate: isolateNow\(\)/);
  assert.match(appSrc.match(/function escapeStep\([\s\S]*?\n\}/)[0], /if \(isolateTurnOff\(\)\) e\.preventDefault\(\);/);
  assert.doesNotMatch(isolateSrc, /isolateEscapeKeepsBox/, 'the second reading of the key guard is gone');
});

test('a click on empty space leaves what isolate wrote, and a click on a card writes nothing while isolate is on', () => {
  assert.match(appSrc.match(/function onClickAway\([\s\S]*?\n\}/)[0], /if \(isolateNow\(\)\) return;/);
  // A click on a Graph card or a Board card while isolated writes nothing: box-mirror-wiring.test.js runs it in the page.
});

test('the keystroke handler leaves the isolate text\'s leading # alone, and nothing else reads the strip', () => {
  assert.match(appSrc, /const stripped = isolateNow\(\) \? null : searchHashStrip\(input\.value\);/);
  assert.strictEqual(appSrc.split('searchHashStrip(').length - 1, 1);
});

test('the chip says isolated, and the switch is repainted with every board repaint', () => {
  const panel = read('search-panel.js');
  assert.match(panel.match(/function syncSearchChip\([\s\S]*?\n\}/)[0], /'isolated'/);
  assert.match(panel.match(/function renderSearchPanel\([\s\S]*?\n\}/)[0], /syncIsolateSwitch\(\)/);
});

// --- the stylesheet -------------------------------------------------------------------------

const block = css.slice(css.indexOf('/* Search box and search panel.'), css.indexOf('/* End search box and search panel */'));

test('every class the switch is drawn with has a rule, in the search panel\'s own block, and it shows when it is on', () => {
  for (const cls of ['isolate-switch', 'isolate-switch-track']) assert.match(block, new RegExp(`\\.${cls}\\b`), `${cls} has a rule`);
  assert.match(block, /\.isolate-switch\[aria-checked="true"\] \.isolate-switch-track \{[^}]*background: var\(--accent-soft\)/, 'on is drawn apart from off');
  assert.match(block, /\.isolate-switch\[aria-checked="true"\] \.isolate-switch-track::after \{[^}]*left: 14px/, 'the knob moves');
});

test('the switch shows a focus ring', () => {
  assert.match(block, /\.isolate-switch:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
});

test('the switch\'s colours are tokens, and its radius is on the page\'s scale', () => {
  const rules = block.split('\n').filter((l) => /\.isolate-switch/.test(l)).join('\n');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  for (const m of rules.matchAll(/border-radius:\s*([^;]+);/g)) assert.ok(['.15rem', '50%'].includes(m[1].trim()), m[1]);
});

// --- the Typing isolates checkboxes in the foot ------------------------------------------------

const typingAt = html.indexOf('<div id="search-typing"');
const typing = html.slice(typingAt, html.indexOf('</div>', typingAt) + 6);
const boxes = [...typing.matchAll(/<label[^>]*>\s*<input[^>]*>[^<]*<\/label>/g)].map((m) => m[0]);

test('the Typing isolates section holds a labelled checkbox for each view, in the order of the views, the Graph last, under a fold control like the other sections', () => {
  assert.ok(typingAt > html.indexOf('id="isolate-switch"'), 'it sits after the switch');
  const sectionAt = html.indexOf('<section id="search-typing-section"');
  assert.ok(sectionAt > html.indexOf('<div id="search-foot"') && sectionAt < typingAt, 'in a section of its own after the foot');
  const fold = html.slice(html.indexOf('<button type="button" id="search-typing-fold"'), html.indexOf('</button>', html.indexOf('id="search-typing-fold"')) + 9);
  assert.strictEqual(attr(fold.match(/<button[^>]*>/)[0], 'class'), 'search-fold');
  assert.strictEqual(attr(fold.match(/<button[^>]*>/)[0], 'aria-controls'), 'search-typing');
  assert.notStrictEqual(attr(fold.match(/<button[^>]*>/)[0], 'data-keeps-selection'), null);
  assert.match(fold, />Typing isolates<\/button>/);
  assert.strictEqual(attr(typing.match(/<div[^>]*>/)[0], 'role'), 'group');
  assert.strictEqual(attr(typing.match(/<div[^>]*>/)[0], 'aria-labelledby'), 'search-typing-fold');
  assert.deepStrictEqual(boxes.map((b) => attr(b.match(/<input[^>]*>/)[0], 'data-typing-view')), ['board', 'calendar', 'gantt', 'map', 'graph']);
  assert.deepStrictEqual(boxes.map((b) => b.replace(/<[^>]*>/g, '').trim()), ['Board', 'Calendar', 'Gantt', 'Map', 'Graph']);
});

test('each checkbox is a checkbox that never clears a selection, holds no poll, and carries no style or handler', () => {
  assert.strictEqual(boxes.length, 5);
  for (const b of boxes) {
    const input = b.match(/<input[^>]*>/)[0];
    assert.strictEqual(attr(input, 'type'), 'checkbox');
    assert.notStrictEqual(attr(input, 'data-keeps-selection'), null, 'a click on it keeps the selection');
    assert.strictEqual(attr(input, 'data-holds-poll'), null, 'a box left focused by a click would stop the poll for good');
    assert.doesNotMatch(b, /\sstyle=|\son[a-z]+=/i);
  }
  assert.notStrictEqual(attr(typing.match(/<div[^>]*>/)[0], 'data-keeps-selection'), null);
});

test('the boxes show the choice on every repaint, and the stylesheet draws the group', () => {
  // A change of a box sets the choice of its view: isolate.test.js fires it in the page.
  assert.match(code(isolateSrc), /typingIsolatesIn\(box\.dataset\.typingView\)/);
  assert.match(css, /\.search-typing \{/);
  assert.match(read('search-panel.js'), /syncTypingIsolates\(\);/, 'every repaint of the board keeps the boxes right');
});

// The writer turns isolate on before the repaint and a view switch ends and starts the isolate the box's own query
// made: write-reasons.test.js and isolate.test.js.

// Every surface paints a lit card with the selected look through paintsSelected: box-lit-paint.test.js draws the
// Board's tiles, a Calendar chip and a Gantt bar in the page, map-render-svg.test.js the Map's node and
// graph-flow-view.test.js the Flow's lane headers. The Gantt's label and the Graph's dots have no seam to draw
// them from, so this keeps the one source check: no surface paints the look from the selection alone.
test('no surface paints the selected look from the selection alone', () => {
  assert.match(appSrc, /function paintsSelected\(id\) \{\s*return selectedIds\.has\(id\) \|\| \(boxLitIds !== null && boxLitIds\.has\(id\)\);/);
  assert.doesNotMatch(appSrc.replace(/function paintsSelected[\s\S]*?\n\}/, ''), /selectedIds\.has\([a-z.]*\) \? ' selected'/);
  assert.doesNotMatch(graphViewSrc, /selectedIds\.has\([a-z.]*\) \? ' selected'/);
});
