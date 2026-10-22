const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../web/settings');

// The todo lists as the page holds them (docs/adr/0021): the script that draws the palette's tab and
// registers the gear's page, how the other scripts reach it, and the stylesheet rules it needs. The
// rules are todo-store.js, notes.js (noteTabs), settings.js and delete-plan.js, each tested apart; the
// tab itself is driven in todos-page.test.js and in the browser runner's todos scenario.

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');
const ui = read('todos-ui.js');
const palette = read('notes-palette.js');
const appSrc = read('app.js');
const groupsUi = read('groups-ui.js');
const deleteUi = read('delete-ui.js');

test('todos-ui.js loads after settings-ui.js, scratchpad-ui.js and markdown-ui.js, which it uses, and before app.js', () => {
  const at = (f) => html.indexOf(`<script src="/${f}"></script>`);
  assert.ok(at('settings-ui.js') > -1 && at('todos-ui.js') > at('settings-ui.js'));
  assert.ok(at('todos-ui.js') > at('scratchpad-ui.js'));
  assert.ok(at('todos-ui.js') > at('markdown-ui.js') && at('markdown-ui.js') > -1);
  assert.ok(at('app.js') > at('todos-ui.js'));
});

test('the gear gains a Todos page right after the Scratchpad\'s, through the hook settings-ui.js leaves', () => {
  const noop = () => {};
  const sandbox = { state: { settings: null, groups: null }, window: { addEventListener: noop }, document: {}, ...settings };
  vm.createContext(sandbox);
  vm.runInContext(`${read('settings-ui.js')}\nthis.pages = settingsBoardPages;`, sandbox);
  vm.runInContext(read('scratchpad-ui.js'), sandbox);
  vm.runInContext(ui, sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.pages.map((p) => p.id))), ['logbook', 'scratchpad', 'todos', 'groups', 'types', 'prefixes', 'counters']);
  assert.strictEqual(sandbox.pages[2].title, 'Todos');
});

test('the page keeps what the board payload says in state.todos, seeded null', () => {
  assert.match(appSrc, /state\.todos = data\.todos \|\| null;/);
  assert.match(appSrc, /logbook: null, todos: null, groups: null,/);
});

test('the palette takes its tabs from noteTabs, draws the Todos tab from todosPanel, opens it for a todos request and follows the board with todosOnBoard', () => {
  assert.match(palette, /return noteTabs\(notesUi\.sub, \{ notesOn: notesOn\(\), scratchpadOn: scratchpadOn\(\), todosOn: todosOn\(\) \}\);/);
  assert.match(palette, /todos: 'Todos'/);
  assert.match(palette, /u\.tab === 'todos'\) \{\s*u\.body\.replaceChildren\(todosPanel\(u\.sub\.id\)\)/);
  assert.match(palette, /req\.kind === 'todos' \? 'todos'/);
  assert.match(palette, /if \(u\.tab === 'todos'\) \{ todosOnBoard\(\); return; \}/);
  assert.match(palette, /todosHints\(\)\.map/);
});

test('a card with the logbook off keeps its palette open on a board refresh while it has a scratchpad or todos', () => {
  assert.match(palette, /if \(missing \|\| \(!notesOn\(\) && sub\.kind !== 'group' && !\(sub\.kind === 'card' && \(scratchpadOn\(\) \|\| todosOn\(\)\)\)\)\) \{ notesClose\(\); return; \}/);
  assert.match(palette, /if \(!notesOn\(\) && sub\.kind !== 'group' && !\(sub\.kind === 'card' && \(scratchpadOn\(\) \|\| todosOn\(\)\)\)\) return;/);
});

test('the card menu has a Todos… entry for one card, and a tile or a badge carries the count', () => {
  assert.match(html, /<button type="button" id="ctx-todos" role="menuitem" class="hidden">Todos…<\/button>/);
  assert.ok(html.indexOf('id="ctx-todos"') > html.indexOf('id="ctx-scratch"') && html.indexOf('id="ctx-todos"') < html.indexOf('id="ctx-add"'), 'beside Scratchpad…');
  assert.match(appSrc, /\$\('#ctx-todos'\)\.classList\.toggle\('hidden', !todosOn\(\) \|\| !!menuSubject\.canvas \|\| menuSubject\.ids\.length !== 1\);/);
  assert.strictEqual((appSrc.match(/const todoCount = todoCountButton\(card\.id\);/g) || []).length, 2, 'the live tile and the archived tile');
  assert.match(groupsUi, /const todos = todoCountButton\(g\.id\);/);
});

test('the delete popup tells the plan whether the board keeps todo lists and which targets have one', () => {
  assert.match(deleteUi, /todosOn: todosOn\(\), todos: todoTargets\(\)/);
});

test('the tab reads and writes through /api/todos only: GET, POST, PATCH, DELETE and .../move for the list, and one PUT of the whole text for Edit', () => {
  assert.deepStrictEqual([...new Set([...ui.matchAll(/api\('([A-Z]+)', url/g)].map((m) => m[1]))].sort(), ['GET', 'PUT']);
  assert.deepStrictEqual([...ui.matchAll(/send\('([A-Z]+)', '([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`).sort(), ['DELETE ', 'PATCH ', 'PATCH ', 'POST ', 'POST /move']);
  assert.match(ui, /const url = `\/api\/todos\/\$\{encodeURIComponent\(target\)\}`;/);
  assert.match(ui, /\{ \.\.\.body, version: list\.version \}/);
  assert.strictEqual((ui.match(/'PUT'/g) || []).length, 1);
  assert.match(ui, /api\('PUT', url, \{ text: sent, version: base \}\)/, 'the text names the version it was read at, not the list\'s latest');
});

test('a path shows the folder the board names for it, the one its path has when the path holds <iteration> (ADR 0019)', () => {
  assert.match(ui, /\$\{list\.folder === undefined \? state\.todos\.folder : list\.folder\}\/\$\{list\.file\}/);
});

test('t is read through the key guard of n, over the card details only', () => {
  assert.match(ui, /if \(keyGuardOff\(document, NOTES_DETAIL\)\) return;/);
  assert.match(ui, /const aimed = notesAimedCard\(\);/, 'the card is aimed as n aims it');
  assert.match(palette, /const aimed = notesAimedCard\(\);\n  openNotes\(aimed === null/);
  assert.match(ui, /document\.addEventListener\('keydown', onTodosKey\);/);
  assert.match(ui, /e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey \|\| e\.repeat/);
});

test('every class the script gives an element has a rule in the stylesheet', () => {
  const used = new Set();
  for (const m of ui.matchAll(/todoEl\('[a-z0-9]+', '([a-z0-9 -]+)'/g)) m[1].split(' ').forEach((c) => used.add(c));
  for (const c of ['td-d1', 'td-d6']) used.add(c);
  assert.ok(used.size >= 12, 'sanity: the script gives elements classes');
  const shared = ['np-muted', 'np-empty', 'np-act', 'np-trigger']; // the palette's own, ruled in its part of the stylesheet
  const ruled = (c) => new RegExp(`\\.${c}(?![\\w-])`).test(css);
  for (const c of used) assert.ok(ruled(c) || shared.includes(c), `a rule for .${c}`);
  for (const c of ['card-todos', 'all-done', 'done', 'editing', 'td-d1', 'td-d6']) assert.ok(ruled(c), c);
  assert.match(css, /\.td-row\.done \.td-text \{[^}]*line-through/, 'a ticked item is struck');
});

test('the script draws with classes from the stylesheet only: no style, no HTML string, no inline handler', () => {
  assert.doesNotMatch(ui, /\.style\b|style=|setAttribute\('style'|innerHTML|insertAdjacentHTML|\.onclick|\.onkeydown/);
});
