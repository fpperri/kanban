const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../web/settings');

// The scratchpad as the page holds it (docs/adr/0016): the script that draws the palette's tab and
// registers the gear's page, how the other scripts reach it, and the stylesheet rules it needs. The
// rules are notes.js (noteTabs), settings.js and delete-plan.js, each tested apart; the real page runs
// all of it in the browser runner's scratchpad scenario.

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const ui = read('scratchpad-ui.js');
const palette = read('notes-palette.js');
const appSrc = read('app.js');
const groupsUi = read('groups-ui.js');
const deleteUi = read('delete-ui.js');

test('scratchpad-ui.js loads after settings-ui.js, which it registers a page with, and before app.js', () => {
  const at = (f) => html.indexOf(`<script src="/${f}"></script>`);
  assert.ok(at('settings-ui.js') > -1 && at('scratchpad-ui.js') > at('settings-ui.js'));
  assert.ok(at('app.js') > at('scratchpad-ui.js'));
});

test('the gear gains a Scratchpad page right after the Logbook\'s, through the hook settings-ui.js leaves', () => {
  const noop = () => {};
  const sandbox = {
    state: { settings: null, groups: null }, window: { addEventListener: noop }, document: {}, ...settings,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${read('settings-ui.js')}\nthis.pages = settingsBoardPages;`, sandbox);
  vm.runInContext(ui, sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.pages.map((p) => p.id))), ['logbook', 'scratchpad', 'groups', 'types', 'prefixes', 'counters']);
  assert.strictEqual(sandbox.pages[1].title, 'Scratchpad');
});

test('the page keeps what the board payload says in state.scratchpad, seeded null', () => {
  assert.match(appSrc, /state\.scratchpad = data\.scratchpad \|\| null;/);
  assert.match(appSrc, /groups: null, scratchpad: null, iterations: false, settings: null \};/);
});

test('the palette takes its tabs from noteTabs and draws the Scratchpad tab from scratchPanel', () => {
  assert.match(palette, /return noteTabs\(notesUi\.sub, \{ notesOn: notesOn\(\), scratchpadOn: scratchpadOn\(\) \}\);/);
  assert.match(palette, /scratch: 'Scratchpad'/);
  assert.match(palette, /u\.tab === 'scratch'\) \{\s*u\.body\.replaceChildren\(scratchPanel\(u\.sub\.id\)\)/);
  assert.match(palette, /req\.kind === 'scratchpad' \? 'scratch'/);
});

test('a board payload never redraws the page being written', () => {
  assert.match(palette, /if \(u\.tab === 'scratch'\) return;/);
});

test('the group tab has a Scratchpad button, off with the scratchpad, and the card menu has an entry for one card', () => {
  assert.match(groupsUi, /groupButton\('gp-scratch', 'Scratchpad'/);
  assert.match(groupsUi, /scratch\.disabled = !scratchpadOn\(\);/);
  assert.match(html, /<button type="button" id="ctx-scratch" role="menuitem" class="hidden">Scratchpad…<\/button>/);
  assert.match(appSrc, /\$\('#ctx-scratch'\)\.classList\.toggle\('hidden', !scratchpadOn\(\) \|\| !!menuSubject\.canvas \|\| menuSubject\.ids\.length !== 1\);/);
});

test('the delete popup tells the plan whether the board keeps scratchpads and which targets have one', () => {
  assert.match(deleteUi, /scratchpadOn: scratchpadOn\(\), scratchpads: scratchpadTargets\(\)/);
});

test('Ctrl+Enter and the Save button write the body to PUT /api/scratchpad/<id>, and a page is read with GET', () => {
  assert.deepStrictEqual([...ui.matchAll(/api\('([A-Z]+)', url/g)].map((m) => m[1]), ['PUT', 'GET']);
  assert.match(ui, /const url = `\/api\/scratchpad\/\$\{encodeURIComponent\(target\)\}`;/);
  assert.match(ui, /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(ui, /save\.addEventListener\('click', write\)/);
});

test('the page has no way to delete a scratchpad', () => {
  assert.doesNotMatch(ui, /'DELETE'/);
});

test('every class the script gives an element has a rule in the stylesheet', () => {
  const used = new Set();
  for (const m of ui.matchAll(/scratchEl\('[a-z0-9]+', '([^']+)'/g)) m[1].split(' ').forEach((c) => used.add(c));
  assert.ok(used.size >= 8, 'sanity: the script gives elements classes');
  for (const c of [...used, 'gp-scratch']) assert.ok(new RegExp(`\\.${c}(?![\\w-])`).test(css), `a rule for .${c}`);
});

test('the script draws with classes from the stylesheet only: no style, no HTML string, no inline handler', () => {
  assert.doesNotMatch(ui, /\.style\b|style=|setAttribute\('style'|innerHTML|insertAdjacentHTML|\.onclick|\.onkeydown/);
});
