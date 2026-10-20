const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../web/settings');

// The gear's sheet as the page holds it (docs/adr/0017): the markup of the menu and its pages, the
// scripts that draw and wire them, and the rules in the stylesheet. The rules themselves are
// settings.js (settings.test.js), the server's are settings-store.js (settings-server.test.js), and
// the real page runs all of it in the browser runner's settings scenario.

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const ui = read('settings-ui.js');
const appSrc = read('app.js');

const sheetStart = html.indexOf('<div id="prefs-sheet"');
const sheetHtml = html.slice(sheetStart, html.indexOf('\n</div>\n', sheetStart) + 7);
const tagsOf = (markup, re) => markup.match(re) || [];
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };

test('the sheet has a menu with This browser and This board, the second drawn by the script into an empty list', () => {
  const menu = sheetHtml.slice(sheetHtml.indexOf('<nav'), sheetHtml.indexOf('</nav>'));
  assert.match(menu, /<h3 id="prefs-browser-title">This browser<\/h3>/);
  assert.match(menu, /<h3 id="prefs-board-title">This board<\/h3>/);
  assert.match(menu, /<ul class="prefs-menu-list" id="prefs-board-menu"><\/ul>/);
  assert.ok(menu.indexOf('prefs-browser-title') < menu.indexOf('prefs-board-title'), 'This browser comes first');
  assert.match(menu, /config\.yaml/, 'it says This board is written to config.yaml');
});

test('This browser lists its two pages, and each has a page in the sheet', () => {
  const items = tagsOf(sheetHtml, /<button[^>]*class="prefs-menu-item"[^>]*>/g);
  assert.deepStrictEqual(items.map((t) => attr(t, 'data-page')), settings.SETTINGS_BROWSER_PAGES.map((p) => `browser:${p.id}`));
  const pages = tagsOf(sheetHtml, /<section[^>]*class="prefs-page"[^>]*>/g).map((t) => attr(t, 'data-page'));
  for (const id of items.map((t) => attr(t, 'data-page'))) assert.ok(pages.includes(id), `${id} has a page`);
  assert.ok(pages.includes('board'), 'one page holds whichever page of This board shows');
});

test('the default page of a wide sheet is one of the pages the sheet has', () => {
  assert.ok(html.includes(`data-page="${settings.SETTINGS_DEFAULT_PAGE}"`));
});

test('the Preferences page holds the existing groups unchanged and the Hotkeys page its list', () => {
  const prefs = sheetHtml.slice(sheetHtml.indexOf('<section class="prefs-page" data-page="browser:prefs"'), sheetHtml.indexOf('<section class="prefs-page" data-page="browser:hotkeys"'));
  for (const id of ['prefs-click-title', 'prefs-rollup-title', 'prefs-panel-title']) assert.ok(prefs.includes(`id="${id}"`), id);
  const hot = sheetHtml.slice(sheetHtml.indexOf('<section class="prefs-page" data-page="browser:hotkeys"'), sheetHtml.indexOf('id="prefs-board-page"'));
  assert.ok(hot.includes('id="hotkeys-list"'));
});

test('the back button is in the sheet, keeps a selection and holds the poll like the other controls', () => {
  const [back] = tagsOf(sheetHtml, /<button[^>]*id="prefs-back"[^>]*>/);
  assert.ok(back);
  assert.strictEqual(attr(back, 'type'), 'button');
  assert.notStrictEqual(attr(back, 'data-keeps-selection'), null);
  assert.notStrictEqual(attr(back, 'data-holds-poll'), null);
});

test('settings.js loads after ids.js, which it reads, and settings-ui.js after both and before app.js', () => {
  const at = (f) => html.indexOf(`<script src="/${f}"></script>`);
  assert.ok(at('ids.js') > -1 && at('settings.js') > at('ids.js'));
  assert.ok(at('settings-ui.js') > at('settings.js') && at('app.js') > at('settings-ui.js'));
});

test('the wide layout starts at the width settings.js says', () => {
  assert.strictEqual(settings.settingsIsWide(760), true);
  assert.strictEqual(settings.settingsIsWide(759), false);
  assert.ok(css.includes('@media (min-width: 760px) { .prefs-sheet { width: min(760px, 100vw); } }'));
});

test('the script draws with classes from the stylesheet only: no style, no HTML string, no inline handler', () => {
  assert.doesNotMatch(ui, /\.style\b|style=|setAttribute\('style'|innerHTML|insertAdjacentHTML|\.onclick|\.onkeydown/);
});

test('every class the script gives an element has a rule in the stylesheet', () => {
  const used = new Set();
  for (const m of ui.matchAll(/settingsEl\('[a-z0-9]+', '([^']+)'/g)) m[1].split(' ').forEach((c) => used.add(c));
  assert.ok(used.size >= 10, 'sanity: the script gives elements classes');
  for (const c of [...used, 'pick-list', 'pick-btn', 'pick-meta']) assert.ok(new RegExp(`\\.${c}(?![\\w-])`).test(css), `a rule for .${c}`);
});

test('a control the script draws keeps a selection and holds the poll', () => {
  assert.match(ui, /function settingsMark\(el\) \{[^}]*data-keeps-selection[^}]*data-holds-poll/);
  const body = (name) => ui.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
  assert.match(body('settingsSwitch'), /settingsMark\(settingsEl\('button', 'prefs-opt'/);
  assert.match(body('settingsField'), /const input = settingsMark/);
  assert.match(body('settingsField'), /const save = settingsMark/);
  assert.match(body('settingsMenuItem'), /settingsMark\(/);
});

test('the only request is POST /api/config, and a refusal is shown under its control', () => {
  assert.deepStrictEqual([...ui.matchAll(/api\('([A-Z]+)', '([^']+)'/g)].map((m) => [m[1], m[2]]), [['POST', '/api/config']]);
  assert.match(ui, /'role', 'alert'/);
});

// --- the page registry --------------------------------------------------------------------

const ids = (pages) => JSON.parse(JSON.stringify(pages.map((p) => p.id)));

function loadUi() {
  const sandbox = { state: { settings: null, groups: null }, window: { addEventListener() {} }, document: {}, ...settings };
  vm.createContext(sandbox);
  vm.runInContext(`${ui}\nthis.pages = settingsBoardPages; this.add = settingsAddBoardPage;`, sandbox);
  return sandbox;
}

test('This board lists Logbook, Groups, Prefixes and Counters', () => {
  assert.deepStrictEqual(ids(loadUi().pages), ['logbook', 'groups', 'prefixes', 'counters']);
});

test('a later page is added after the one named, else at the end', () => {
  const ctx = loadUi();
  ctx.add({ id: 'scratchpad', title: 'Scratchpad', build: () => [] }, 'logbook');
  ctx.add({ id: 'last', title: 'Last', build: () => [] });
  ctx.add({ id: 'unknown-anchor', title: 'U', build: () => [] }, 'nothing');
  assert.deepStrictEqual(ids(ctx.pages), ['logbook', 'scratchpad', 'groups', 'prefixes', 'counters', 'last', 'unknown-anchor']);
});

// --- the page's own open and click ------------------------------------------------------------

test('the gear opens the sheet on the page it had, and the hotkey opens it on the Hotkeys page', () => {
  assert.match(appSrc, /\$\('#prefs-btn'\)\.addEventListener\('click', \(\) => openPrefsSheet\(\)\);/);
  const hot = read('hotkeys-sheet.js').match(/function openHotkeys\([\s\S]*?\n\}/)[0];
  assert.match(hot, /openPrefsSheet\('browser:hotkeys'\)/);
});

test('the payload\'s settings are kept on the page state for the pages to read', () => {
  assert.match(appSrc, /state\.settings = data\.settings \|\| null;/);
  assert.match(appSrc, /groups: null, iterations: false, settings: null \};/);
});
