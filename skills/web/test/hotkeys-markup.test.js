const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Hotkeys section of the preferences sheet, as the page's files hold it: its markup in the
// sheet, the scripts that draw and open it and the order the page loads them in, the stylesheet
// rules for what the script builds, and the script's own rules (no style, no inline handler,
// the shared key guard). The behaviour is hotkeys-sheet.test.js's, and the real page is the
// browser runner's (scenarios/hotkeys.js).

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const sheetSrc = read('hotkeys-sheet.js');
const listSrc = read('hotkeys.js');

const sheetStart = html.indexOf('<div id="prefs-sheet"');
const sheetHtml = html.slice(sheetStart, html.indexOf('\n</div>\n', sheetStart) + 7);
const sectionStart = sheetHtml.indexOf('<section class="prefs-group" id="prefs-hotkeys"');
const section = sectionStart === -1 ? '' : sheetHtml.slice(sectionStart, sheetHtml.indexOf('</section>', sectionStart) + 10);
const tag = (markup, re) => { const m = markup.match(re); return m ? m[0] : null; };
const attr = (t, name) => { const m = t.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };

// --- the markup -------------------------------------------------------------------------

test('the sheet has a Hotkeys section after the search panel\'s, named by its heading', () => {
  assert.ok(section, 'a section with the id prefs-hotkeys in the sheet');
  const root = tag(section, /<section[^>]*>/);
  assert.strictEqual(attr(root, 'aria-labelledby'), 'prefs-hotkeys-title');
  assert.match(root, /class="prefs-group"/);
  assert.match(section, /<h3 id="prefs-hotkeys-title">Hotkeys<\/h3>/);
  assert.ok(sheetHtml.indexOf('id="prefs-hotkeys"') > sheetHtml.indexOf('id="prefs-panel-title"'), 'it follows the search panel group');
});

test('the section holds an empty list for the script to fill, and a hint that names the ? key', () => {
  const list = tag(section, /<ul[^>]*>/);
  assert.ok(list, 'a list');
  assert.strictEqual(attr(list, 'id'), 'hotkeys-list');
  assert.match(list, /class="hotkeys-list"/);
  assert.match(section, /<ul[^>]*><\/ul>/, 'it is empty: the rows come from hotkeys.js, never from a second copy in the markup');
  const hint = tag(section, /<p class="prefs-hint">[\s\S]*?<\/p>/);
  assert.ok(hint, 'a hint');
  assert.match(hint, /Press \? to open this list/);
});

test('the section sets no tab order and no style, so Tab still leaves the sheet from its last control', () => {
  assert.doesNotMatch(section, /tabindex|\sstyle=|\son[a-z]+=/i);
});

// --- the scripts ----------------------------------------------------------------------------

const at = (name) => html.indexOf(`<script src="/${name}"></script>`);

test('the page loads hotkeys.js and then hotkeys-sheet.js, after the scripts whose globals the sheet script reads', () => {
  assert.ok(at('hotkeys.js') > -1 && at('hotkeys-sheet.js') > -1, 'both are loaded');
  assert.ok(at('hotkeys.js') < at('hotkeys-sheet.js'));
  for (const name of ['key-guard.js', 'selection.js', 'search-panel.js', 'search-slices.js', 'slice-run.js', 'pills.js', 'prefs.js']) {
    assert.ok(at(name) > -1 && at(name) < at('hotkeys-sheet.js'), `${name} loads first`);
  }
  assert.ok(at('isolate.js') < at('hotkeys-sheet.js'));
  assert.ok(at('hotkeys-sheet.js') < at('app.js'));
});

test('the sheet script asks the shared key guard and the list\'s own check for the key, and draws no style', () => {
  assert.match(sheetSrc.match(/function onHotkeysKey\([\s\S]*?\n\}/)[0], /hotkeyIsHelp\(e\)/);
  assert.match(sheetSrc.match(/function onHotkeysKey\([\s\S]*?\n\}/)[0], /keyGuardOff\(document\)/);
  assert.doesNotMatch(sheetSrc, /\.style\b|style=|setAttribute\('style'|innerHTML|insertAdjacentHTML|\.onclick|\.onkeydown/);
  assert.doesNotMatch(listSrc, /\bdocument\b|\bwindow\.(?!HOTKEYS|hotkeyRows|hotkeyIsHelp)/, 'the list is pure: it touches the page only to export itself');
});

test('? opens the sheet through the page\'s own open, not a second path, and brings the section to the top', () => {
  const open = sheetSrc.match(/function openHotkeys\([\s\S]*?\n\}/)[0];
  assert.match(open, /openPrefsSheet\(\)/);
  assert.match(open, /scrollIntoView\(\{ block: 'start' \}\)/);
  assert.ok(open.indexOf('syncHotkeys()') < open.indexOf('openPrefsSheet()'), 'the rows are drawn before the sheet shows');
  assert.ok(open.indexOf('openPrefsSheet()') < open.indexOf('scrollIntoView'), 'the sheet is open, and laid out, before the section is scrolled to');
});

// --- the stylesheet -------------------------------------------------------------------------

const block = css.slice(css.indexOf('/* Preferences sheet'), css.indexOf('/* End preferences sheet */'));

test('every class the sheet script gives an element has a rule in the sheet\'s block of the stylesheet', () => {
  const classes = [...sheetSrc.matchAll(/className = '([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(classes)].sort(), ['hotkey-key', 'hotkey-keys', 'hotkey-row', 'hotkey-state', 'hotkey-what']);
  for (const name of [...classes, 'hotkeys-list']) assert.match(block, new RegExp(`\\.${name}[ ,{:]`), `.${name} has a rule`);
});

test('the Hotkeys rules take their colours from the theme tokens: no hex and no rgb', () => {
  const rules = block.split('\n').filter((line) => /\.hotkey/.test(line));
  assert.ok(rules.length >= 6, 'the rules are found');
  for (const rule of rules) assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, rule);
  for (const token of new Set(rules.join('\n').match(/var\(--[a-z-]+\)/g))) {
    assert.ok(css.includes(`${token.slice(4, -1)}:`), `${token} is a defined token`);
  }
});
