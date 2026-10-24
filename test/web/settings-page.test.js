const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../../plugin/skills/web/web/settings');

// The gear's sheet as the page holds it (docs/adr/0017): the markup of the menu and its pages, the
// scripts that draw and wire them, and the rules in the stylesheet. The rules themselves are
// settings.js (settings.test.js), the server's are settings-store.js (settings-server.test.js), and
// the real page runs all of it in the browser runner's settings scenario.

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
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

test('This board lists Logbook, Groups, Types, Prefixes and Counters', () => {
  assert.deepStrictEqual(ids(loadUi().pages), ['logbook', 'groups', 'types', 'prefixes', 'counters']);
});

test('a later page is added after the one named, else at the end', () => {
  const ctx = loadUi();
  ctx.add({ id: 'scratchpad', title: 'Scratchpad', build: () => [] }, 'logbook');
  ctx.add({ id: 'last', title: 'Last', build: () => [] });
  ctx.add({ id: 'unknown-anchor', title: 'U', build: () => [] }, 'nothing');
  assert.deepStrictEqual(ids(ctx.pages), ['logbook', 'scratchpad', 'groups', 'types', 'prefixes', 'counters', 'last', 'unknown-anchor']);
});

// --- the page's own open and click ------------------------------------------------------------

test('the gear opens the sheet on the page it had, and the hotkey opens it on the Hotkeys page', () => {
  assert.match(appSrc, /\$\('#prefs-btn'\)\.addEventListener\('click', \(\) => openPrefsSheet\(\)\);/);
  const hot = read('hotkeys-sheet.js').match(/function openHotkeys\([\s\S]*?\n\}/)[0];
  assert.match(hot, /openPrefsSheet\('browser:hotkeys'\)/);
});

test('the payload\'s settings are kept on the page state for the pages to read', () => {
  assert.match(appSrc, /state\.settings = data\.settings \|\| null;/);
  assert.match(appSrc, /groups: null, scratchpad: null, iterations: false, settings: null \};/);
});

// --- the Types and Prefixes pages, built by the real script on a small stand-in DOM ------------------------

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.handlers = {}; this.className = ''; this.own = ''; this.rect = { top: 0, height: 0 }; }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  append(...nodes) { for (const n of nodes) this.children.push(typeof n === 'string' ? Object.assign(new El('#text'), { own: n }) : n); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  getBoundingClientRect() { return this.rect; }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return { add: (c) => { el.className = [...new Set([...list(), c])].join(' '); }, remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); }, contains: (c) => list().includes(c) };
  }
  async fire(type, ev = {}) { for (const f of this.handlers[type] || []) await f({ preventDefault() {}, stopPropagation() {}, ...ev }); }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.all(pred, out); return out; }
  one(pred) { return this.all(pred)[0]; }
}
const byClass = (c) => (el) => el.className.split(/\s+/).includes(c);
const withData = (k, v) => (el) => el.dataset[k] === v;
const labelled = (text) => (el) => el.attrs['aria-label'] === text;

const BASE_SETTINGS = () => ({
  typesOn: true, version: 'v1', idDigits: 4, nextId: 9, counters: {},
  types: [{ name: 'goal', color: '#a371f7', icon: 'star' }, { name: 'epic', icon: 'square' }, { name: 'story' }, { name: 'bug' }],
  hierarchy: ['goal', 'epic', 'sprint'],
  prefixes: [{ prefix: 'G', kind: 'type', target: 'goal' }, { prefix: 'O', kind: 'type', target: 'objective' }, { prefix: 'W', kind: 'folder', target: 'workflow', folder: 'workflow' }],
  typeUse: { goal: 2, bug: 3, spike: 4 },
  logbook: { on: true, folder: 'logbook' }, scratchpad: { on: false, folder: '' }, groups: { on: true, folder: '.groups' },
  paths: { config: 'C:\\board\\config.yaml', logbook: 'C:\\board\\logbook', scratchpad: null, groups: 'C:\\board\\.groups' },
});

function loadPages(over = {}) {
  const calls = [];
  const sandbox = {
    state: { settings: BASE_SETTINGS(), groups: null, iterations: false },
    window: { addEventListener() {} },
    document: { createElement: (tag) => new El(tag) },
    $: () => null,
    api: async (method, url, body) => {
      calls.push([method, url, body]);
      if (sandbox.fail) throw Object.assign(new Error(sandbox.fail.message), { status: sandbox.fail.status });
      return { settings: sandbox.state.settings };
    },
    loadBoard: async () => { sandbox.reads += 1; },
    reads: 0,
    confirm: (text) => { sandbox.asked.push(text); return sandbox.sure; },
    asked: [],
    sure: true,
    fail: null,
    settingsGo: undefined,
    typeIconGlyph: (name) => ({ star: '\u2605', square: '\u25a0', circle: '\u25cf' }[name] || ''),
    TYPE_ICON_NAMES: ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star'],
    paintTypeColors() {},
    navigator: { clipboard: { writeText: async (text) => { sandbox.copied.push(text); } } },
    copied: [],
    setTimeout: () => 0,
    ...settings,
    ...over,
  };
  vm.createContext(sandbox);
  vm.runInContext(ui, sandbox);
  sandbox.run = (code) => vm.runInContext(code, sandbox);
  sandbox.calls = calls;
  sandbox.page = (id) => { const nodes = sandbox.run(`settingsBoardPages.find((p) => p.id === ${JSON.stringify(id)}).build(state.settings)`); const root = new El('div'); root.append(...nodes); return root; };
  sandbox.settle = async () => {
    await sandbox.run('settingsUi.tail');
    while (sandbox.run('settingsUi.sending') > 0) await new Promise((r) => setImmediate(r));
  };
  return sandbox;
}
const area = (root, which) => root.one((el) => el.tag === 'ul' && el.dataset.area === which);
const rowsOf = (list) => list.children.filter((li) => li.dataset.type !== undefined);
const rowNamed = (root, name) => root.one((el) => el.tag === 'li' && el.dataset.type === name);
const act = (row, a) => row.one((el) => el.tag === 'button' && el.dataset.act === a);

test('the Types page sits between Groups and Prefixes in the menu', () => {
  const ctx = loadPages();
  assert.deepStrictEqual(ids(ctx.run('settingsBoardPages')), ['logbook', 'groups', 'types', 'prefixes', 'counters']);
  assert.strictEqual(ctx.run("settingsBoardPages.find((p) => p.id === 'types').title"), 'Types');
});

test('the Types page has a Hierarchy list and an Other types list, each a real list labelled by its heading', () => {
  const root = loadPages().page('types');
  const hier = area(root, 'hierarchy');
  const other = area(root, 'other');
  assert.strictEqual(hier.tag, 'ul');
  assert.strictEqual(other.tag, 'ul');
  for (const [list, title] of [[hier, 'Hierarchy'], [other, 'Other types']]) {
    const heading = root.one((el) => el.id === list.attrs['aria-labelledby']);
    assert.strictEqual(heading.textContent, title);
  }
  assert.deepStrictEqual(rowsOf(hier).map((li) => li.dataset.type), ['goal', 'epic', 'sprint']);
  assert.deepStrictEqual(rowsOf(other).map((li) => li.dataset.type), ['story', 'bug']);
});

test('a hierarchy name that is not a listed type is a warning chip in the Hierarchy area, with no name field', () => {
  const root = loadPages().page('types');
  const row = rowNamed(root, 'sprint');
  assert.ok(row.one(byClass('types-chip-warn')));
  assert.match(row.one(byClass('types-chip-warn')).textContent, /sprint/);
  assert.strictEqual(row.one((el) => el.tag === 'input'), undefined);
  assert.ok(act(row, 'remove'));
  assert.match(act(row, 'remove').attrs['aria-label'], /Remove sprint from the hierarchy/);
});

test('each listed row has an editable name, a swatch row and hex field, seven icon buttons and a read only prefix with a link', () => {
  const row = rowNamed(loadPages().page('types'), 'goal');
  assert.strictEqual(row.one(labelled('Name of goal')).value, 'goal');
  assert.strictEqual(row.all((el) => el.tag === 'input').filter((el) => el.type === 'color').length, 0, 'no native color popup (docs/adr/0003)');
  const swatches = row.one(labelled('Color of goal'));
  assert.strictEqual(swatches.attrs.role, 'group');
  const buttons = swatches.all((el) => el.tag === 'button');
  assert.strictEqual(buttons[0].dataset.color, '', 'the first clears the color');
  assert.deepStrictEqual(buttons.slice(1).map((b) => b.dataset.color), settings.SETTINGS_TYPE_SWATCHES);
  assert.deepStrictEqual(buttons.filter((b) => b.attrs['aria-pressed'] === 'true').map((b) => b.dataset.color), ['#a371f7']);
  for (const b of buttons.slice(1)) assert.strictEqual(b.dataset.typeColor, b.dataset.color, 'painted by paintTypeColors');
  assert.strictEqual(row.one(labelled('Hex color of goal')).value, '#a371f7');
  const group = row.one(labelled('Icon of goal'));
  assert.strictEqual(group.attrs.role, 'group');
  const icons = group.children;
  assert.deepStrictEqual(icons.map((b) => b.dataset.icon), ['', 'circle', 'square', 'diamond', 'triangle', 'hexagon', 'star']);
  assert.deepStrictEqual(icons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false', 'false', 'false', 'false', 'true']);
  assert.strictEqual(icons[6].textContent, '\u2605');
  assert.strictEqual(icons[0].attrs['aria-label'], 'No icon');
  const prefix = row.one(byClass('types-prefix'));
  assert.match(prefix.textContent, /Prefix G/);
  assert.strictEqual(prefix.one((el) => el.tag === 'input'), undefined, 'the prefix is not editable here');
  assert.ok(prefix.one((el) => el.tag === 'button' && /Prefixes page/.test(el.attrs['aria-label'])));
  assert.match(rowNamed(loadPages().page('types'), 'story').one(byClass('types-prefix')).textContent, /No prefix/);
});

test('the prefix link opens the Prefixes page', async () => {
  const ctx = loadPages({ $: (sel) => (sel === '#prefs-back' ? { focus() {} } : null) });
  const link = rowNamed(ctx.page('types'), 'goal').one((el) => el.tag === 'button' && /Prefixes page/.test(el.attrs['aria-label']));
  await link.fire('click');
  assert.strictEqual(ctx.run('settingsUi.page'), 'board:prefixes');
});

test('every control is a real button or field with a label naming its type, and keeps a selection and holds the poll', () => {
  const root = loadPages().page('types');
  for (const row of [...rowsOf(area(root, 'hierarchy')), ...rowsOf(area(root, 'other'))]) {
    for (const el of row.all((e) => e.tag === 'button' || e.tag === 'input')) {
      assert.ok(el.attrs['aria-label'], `${row.dataset.type}: a control without a label`);
      assert.ok(el.attrs['aria-label'].includes(row.dataset.type) || /^(No icon|circle|square|diamond|triangle|hexagon|star)$/.test(el.attrs['aria-label']), el.attrs['aria-label']);
      if (el.tag === 'button') assert.strictEqual(el.type, 'button');
      assert.notStrictEqual(el.attrs['data-holds-poll'], undefined, el.attrs['aria-label']);
      assert.notStrictEqual(el.attrs['data-keeps-selection'], undefined, el.attrs['aria-label']);
    }
  }
});

test('a hierarchy row has move up, move down and to Other types; an Other row has to Hierarchy; the ends are disabled', () => {
  const root = loadPages().page('types');
  const goal = rowNamed(root, 'goal');
  assert.strictEqual(act(goal, 'up').disabled, true);
  assert.strictEqual(act(goal, 'down').disabled, false);
  assert.strictEqual(act(goal, 'move').textContent, 'To Other types');
  assert.strictEqual(act(rowNamed(root, 'sprint'), 'down').disabled, true);
  const story = rowNamed(root, 'story');
  assert.strictEqual(act(story, 'up'), undefined);
  assert.strictEqual(act(story, 'down'), undefined);
  assert.strictEqual(act(story, 'move').textContent, 'To Hierarchy');
  assert.ok(act(story, 'remove'));
  assert.strictEqual(act(story, 'remove').attrs['aria-label'], 'Remove story');
});

test('the leftovers show as one bullet each, what and why: a hierarchy name no type has, a prefix naming a missing type', () => {
  const root = loadPages().page('types');
  const items = root.one(byClass('prefs-bullets')).children.map((li) => li.textContent);
  assert.strictEqual(items.length, 2);
  assert.match(items[0], /^`sprint` is still in the hierarchy\. Why: /);
  assert.match(items[1], /^The prefix `O` still names `objective`/);
});

test('move down writes the hierarchy block alone, with the version the page read, and focus goes back to that button', async () => {
  const ctx = loadPages();
  await act(rowNamed(ctx.page('types'), 'goal'), 'down').fire('click');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls)), [['POST', '/api/config', { block: 'hierarchy', value: ['epic', 'goal', 'sprint'], version: 'v1' }]]);
  assert.strictEqual(ctx.run('settingsUi.focusKey'), 'act:goal:down');
});

test('To Hierarchy appends the type, To Other types takes it out, emptying the hierarchy sends an empty list', async () => {
  const ctx = loadPages();
  await act(rowNamed(ctx.page('types'), 'story'), 'move').fire('click');
  await act(rowNamed(ctx.page('types'), 'epic'), 'move').fire('click');
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls.map((c) => c[2].value), [['goal', 'epic', 'sprint', 'story'], ['goal', 'sprint']]);
  const only = loadPages();
  only.state.settings.hierarchy = ['goal'];
  await act(rowNamed(only.page('types'), 'goal'), 'move').fire('click');
  await only.settle();
  assert.deepStrictEqual(only.calls[0][2], { block: 'hierarchy', value: [], version: 'v1' });
});

test('a drag from Other types onto the Hierarchy area drops at the row under the pointer', async () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  const hier = area(root, 'hierarchy');
  rowsOf(hier).forEach((li, i) => { li.rect = { top: i * 40, height: 40 }; });
  const handle = rowNamed(root, 'bug').one(byClass('types-handle'));
  const data = {};
  await handle.fire('dragstart', { dataTransfer: { setData: (k, v) => { data[k] = v; }, setDragImage() {} } });
  assert.strictEqual(data['text/plain'], 'bug');
  let prevented = false;
  await hier.fire('dragover', { clientY: 50, dataTransfer: {}, preventDefault() { prevented = true; } });
  assert.strictEqual(prevented, true, 'the area accepts the drop');
  await hier.fire('drop', { clientY: 50, dataTransfer: { getData: () => 'bug' } });
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls[0][2].value, ['goal', 'bug', 'epic', 'sprint']);
});

test('a drag onto Other types takes the name out of the hierarchy; a drag within Other types writes nothing', async () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  await rowNamed(root, 'epic').one(byClass('types-handle')).fire('dragstart', { dataTransfer: { setData() {}, setDragImage() {} } });
  await area(root, 'other').fire('drop', { clientY: 0, dataTransfer: { getData: () => 'epic' } });
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls.map((c) => c[2].value), [['goal', 'sprint']]);
  const again = loadPages();
  const page = again.page('types');
  await rowNamed(page, 'story').one(byClass('types-handle')).fire('dragstart', { dataTransfer: { setData() {}, setDragImage() {} } });
  await area(page, 'other').fire('drop', { clientY: 0, dataTransfer: { getData: () => 'story' } });
  await again.settle();
  assert.deepStrictEqual(again.calls, []);
});

test('renaming a type writes the types block only, keeps its color and icon, and remembers the old word for the warning', async () => {
  const ctx = loadPages();
  const name = rowNamed(ctx.page('types'), 'goal').one(labelled('Name of goal'));
  name.value = 'objective';
  await name.fire('change');
  await ctx.settle();
  assert.strictEqual(ctx.calls.length, 1, 'the hierarchy and the prefixes are not written');
  assert.deepStrictEqual(ctx.calls[0][2].block, 'types');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2].value[0])), { name: 'objective', color: '#a371f7', icon: 'star' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.run('settingsUi.renamed'))), { goal: 'objective' });
  assert.strictEqual(ctx.run('settingsUi.focusKey'), 'name:objective');
});

test('after a rename the page says how many cards still say the old word, once the lists are read again', () => {
  const ctx = loadPages();
  ctx.run("settingsUi.renamed = { spike: 'task' }");
  const items = ctx.page('types').one(byClass('prefs-bullets')).children.map((li) => li.textContent);
  assert.ok(items.some((t) => /^4 cards still say `spike`\. Why: renaming a type changes only the type list/.test(t)), items.join('|'));
});

test('a name another type has is refused on the page with the text kept, and nothing is asked of the server', async () => {
  const ctx = loadPages();
  const name = rowNamed(ctx.page('types'), 'goal').one(labelled('Name of goal'));
  name.value = 'BUG';
  await name.fire('change');
  assert.deepStrictEqual(ctx.calls, []);
  assert.match(ctx.run("settingsUi.errors['row:goal']"), /already a card type named BUG/);
  assert.strictEqual(ctx.run("settingsUi.drafts['row:goal'].name"), 'BUG');
});

test('a hex color the person types that is not one is refused on the page; a valid one and a swatch write the types block', async () => {
  const ctx = loadPages();
  const row = rowNamed(ctx.page('types'), 'story');
  const hex = row.one(labelled('Hex color of story'));
  hex.value = 'red';
  await hex.fire('change');
  assert.deepStrictEqual(ctx.calls, []);
  assert.match(ctx.run("settingsUi.errors['row:story']"), /hex color/);
  const swatch = rowNamed(ctx.page('types'), 'story').one(labelled('Set the color of story to #3fb950'));
  await swatch.fire('click');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2].value[2])), { name: 'story', color: '#3fb950' });
  const typed = rowNamed(ctx.page('types'), 'story').one(labelled('Hex color of story'));
  typed.value = '#112233';
  await typed.fire('change');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[1][2].value[2])), { name: 'story', color: '#112233' });
  await rowNamed(ctx.page('types'), 'goal').one(labelled('No color for goal')).fire('click');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[2][2].value[0])), { name: 'goal', icon: 'star' });
});

// A value from the file is kept as written (docs/adr/0004): the page checks only what the person just typed.
const TOLERANT = () => ({
  ...BASE_SETTINGS(),
  types: [{ name: 'bug', color: 'red', icon: 'hexagram' }, { name: 'Task', color: 'rebeccapurple' }, { name: 'Bug' }],
  hierarchy: ['bug', 'Bug', 'epic'],
  typeUse: { spike: 2 },
});

test('a row whose stored color is a name shows that name in the field and in a swatch, and no swatch or icon is pressed', () => {
  const ctx = loadPages();
  ctx.state.settings = TOLERANT();
  const row = rowNamed(ctx.page('types'), 'bug');
  assert.strictEqual(row.one(labelled('Hex color of bug')).value, 'red');
  const current = row.one(byClass('is-current'));
  assert.strictEqual(current.dataset.typeColor, 'red');
  assert.deepStrictEqual(row.one(labelled('Color of bug')).all((el) => el.attrs['aria-pressed'] === 'true'), []);
  assert.deepStrictEqual(row.one(labelled('Icon of bug')).children.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false', 'false', 'false', 'false', 'false']);
});

test('a color the browser cannot draw is shown as text in the field and gets no swatch color', () => {
  const ctx = loadPages({ CSS: { supports: (prop, value) => value !== 'rebeccapurple' } });
  ctx.state.settings = TOLERANT();
  const row = rowNamed(ctx.page('types'), 'Task');
  assert.strictEqual(row.one(labelled('Hex color of Task')).value, 'rebeccapurple');
  assert.strictEqual(row.one(byClass('is-current')).dataset.typeColor, undefined);
  assert.strictEqual(rowNamed(ctx.page('types'), 'bug').one(byClass('is-current')).dataset.typeColor, 'red');
});

test('Add from Found on cards saves a board whose colors are names and whose icon this build does not draw, those entries untouched', async () => {
  const ctx = loadPages();
  ctx.state.settings = TOLERANT();
  await ctx.page('types').one(labelled('Add spike to the types')).fire('click');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2].value)), [{ name: 'bug', color: 'red', icon: 'hexagram' }, { name: 'Task', color: 'rebeccapurple' }, { name: 'Bug' }, { name: 'spike' }]);
});

test('retyping the stored color name or leaving the hex field as it is writes nothing and shows no refusal', async () => {
  const ctx = loadPages();
  ctx.state.settings = TOLERANT();
  const hex = rowNamed(ctx.page('types'), 'bug').one(labelled('Hex color of bug'));
  await hex.fire('change');
  hex.value = 'red';
  await hex.fire('change');
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls, []);
  assert.strictEqual(ctx.run("settingsUi.errors['row:bug']"), undefined);
});

test('names that differ only in capitals are two rows; moving one saves the hierarchy with both names as written', async () => {
  const ctx = loadPages();
  ctx.state.settings = TOLERANT();
  const root = ctx.page('types');
  assert.deepStrictEqual(rowsOf(area(root, 'hierarchy')).map((li) => li.dataset.type), ['bug', 'Bug', 'epic']);
  await act(rowNamed(root, 'Bug'), 'up').fire('click');
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls[0][2].value, ['Bug', 'bug', 'epic']);
  assert.strictEqual(ctx.calls[0][2].block, 'hierarchy');
});

test('an icon button sets the icon and none clears it; the pressed one does nothing', async () => {
  const ctx = loadPages();
  const row = rowNamed(ctx.page('types'), 'epic');
  const icons = row.one(labelled('Icon of epic')).children;
  await icons[2].fire('click');
  await ctx.settle();
  assert.strictEqual(ctx.calls.length, 0, 'square is already the icon');
  await icons[6].fire('click');
  await icons[0].fire('click');
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls.map((c) => JSON.parse(JSON.stringify(c[2].value[1]))), [{ name: 'epic', icon: 'star' }, { name: 'epic' }]);
});

test('removing a type no card uses just removes it from the types block; one cards use asks first, and a no writes nothing', async () => {
  const ctx = loadPages();
  await act(rowNamed(ctx.page('types'), 'story'), 'remove').fire('click');
  await ctx.settle();
  assert.deepStrictEqual(ctx.asked, []);
  assert.deepStrictEqual(ctx.calls[0][2].value.map((t) => t.name), ['goal', 'epic', 'bug']);
  ctx.sure = false;
  await act(rowNamed(ctx.page('types'), 'bug'), 'remove').fire('click');
  await ctx.settle();
  assert.match(ctx.asked[0], /3 cards say `bug`/);
  assert.strictEqual(ctx.calls.length, 1);
  ctx.sure = true;
  await act(rowNamed(ctx.page('types'), 'bug'), 'remove').fire('click');
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls[1][2].value.map((t) => t.name), ['goal', 'epic', 'story']);
  assert.strictEqual(ctx.calls[1][2].block, 'types');
});

test('Found on cards lists the unlisted words with their counts, and Add appends one to the types block', async () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  const found = root.one(byClass('types-found'));
  assert.match(found.textContent, /spike/);
  assert.match(found.textContent, /4 cards/);
  const label = root.all(byClass('prefs-label')).map((l) => l.textContent).find((t) => t.startsWith('Found on cards'));
  assert.strictEqual(label, 'Found on cards (1)');
  const add = found.one((el) => el.tag === 'button');
  assert.strictEqual(add.attrs['aria-label'], 'Add spike to the types');
  await add.fire('click');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2])), { block: 'types', value: [{ name: 'goal', color: '#a371f7', icon: 'star' }, { name: 'epic', icon: 'square' }, { name: 'story' }, { name: 'bug' }, { name: 'spike' }], version: 'v1' });
});

test('Add type takes a name from the field and writes the types block', async () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  const input = root.one((el) => el.tag === 'input' && el.id === 'pf-newType');
  input.value = ' chore ';
  await root.one((el) => el.tag === 'form' && el.all((e) => e === input).length).fire('submit');
  await ctx.settle();
  assert.strictEqual(ctx.calls[0][2].value.at(-1).name, 'chore');
});

test('the Types switch off writes typesOn false with the version; the hint says it is display only', async () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  const off = root.one((el) => el.tag === 'button' && el.dataset.switch === 'typesOn' && el.dataset.value === 'off');
  await off.fire('click');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2])), { key: 'typesOn', value: false, version: 'v1' });
  assert.match(root.textContent, /display only/);
});

test('a 409 reads the board again and shows one note saying nothing was saved and why; a 400 shows its message under the row', async () => {
  const ctx = loadPages();
  ctx.loadBoard = async () => { ctx.reads += 1; ctx.state.settings.version = 'v2'; };
  ctx.fail = { status: 409, message: 'config.yaml changed on disk' };
  await act(rowNamed(ctx.page('types'), 'goal'), 'down').fire('click');
  await ctx.settle();
  assert.strictEqual(ctx.reads, 1);
  assert.strictEqual(ctx.run('settingsUi.errors.conflict'), settings.settingsConflictNote);
  const note = ctx.page('types').one(byClass('prefs-bullets')).children[0];
  assert.strictEqual(note.textContent, settings.settingsConflictNote);
  assert.strictEqual(note.attrs.role, 'alert');
  ctx.fail = { status: 400, message: 'The icon of goal is one of circle.' };
  await act(rowNamed(ctx.page('types'), 'goal'), 'down').fire('click');
  await ctx.settle();
  assert.strictEqual(ctx.reads, 1, 'a 400 does not read again');
  const row = rowNamed(ctx.page('types'), 'goal');
  assert.strictEqual(row.one(byClass('prefs-error')).textContent, 'The icon of goal is one of circle.');
});

test('a line save from the gear carries the version too, and one refused as stale reads the board again and shows the one note', async () => {
  const ctx = loadPages();
  const logbook = ctx.page('logbook');
  const folder = logbook.one((el) => el.tag === 'input' && el.id === 'pf-logbook');
  folder.value = 'notes';
  await logbook.one((el) => el.tag === 'form').fire('submit');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2])), { key: 'logbook', value: 'notes', version: 'v1' });
  await logbook.one((el) => el.dataset.switch === 'logbook' && el.dataset.value === 'off').fire('click');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[1][2])), { key: 'logbook', value: null, version: 'v1' });
  const groups = ctx.page('groups');
  await groups.one((el) => el.dataset.switch === 'iterations' && el.dataset.value === 'on').fire('click');
  assert.strictEqual(ctx.calls[2][2].version, 'v1');
  const prefixes = ctx.page('prefixes');
  const digits = prefixes.one((el) => el.id === 'pf-idDigits');
  digits.value = '6';
  await prefixes.all((el) => el.tag === 'form').at(-1).fire('submit');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[3][2])), { key: 'idDigits', value: '6', version: 'v1' });
  await ctx.settle();
  const readsBefore = ctx.reads;
  ctx.loadBoard = async () => { ctx.reads += 1; ctx.state.settings.version = 'v2'; };
  ctx.fail = { status: 409, message: 'config.yaml changed on disk after this page read it' };
  const again = ctx.page('prefixes');
  again.one((el) => el.id === 'pf-idDigits').value = '7';
  await again.all((el) => el.tag === 'form').at(-1).fire('submit');
  await ctx.settle();
  assert.strictEqual(ctx.reads, readsBefore + 1);
  assert.strictEqual(ctx.run('settingsUi.errors.conflict'), settings.settingsConflictNote);
  assert.strictEqual(ctx.run("settingsUi.errors.idDigits"), undefined, 'one note, not the server text under the field as well');
  assert.strictEqual(ctx.run("settingsUi.drafts.idDigits"), '7', 'the typed text stays');
});

test('a 409 that is not a stale version (a locked folder) shows its own message under the control', async () => {
  const ctx = loadPages();
  ctx.fail = { status: 409, message: 'This folder is outside the board.' };
  const logbook = ctx.page('logbook');
  logbook.one((el) => el.tag === 'input' && el.id === 'pf-logbook').value = 'notes';
  await logbook.one((el) => el.tag === 'form').fire('submit');
  await ctx.settle();
  assert.strictEqual(ctx.run('settingsUi.errors.conflict'), undefined);
  assert.strictEqual(ctx.run('settingsUi.errors.logbook'), 'This folder is outside the board.');
});

test('two quick changes go one after the other, the second read from the state the first left', async () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  const order = [];
  ctx.api = async (m, u, body) => {
    order.push(JSON.parse(JSON.stringify(body)));
    ctx.state.settings.hierarchy = body.value;
    ctx.state.settings.version = `v${order.length + 1}`;
    return { settings: ctx.state.settings };
  };
  await act(rowNamed(root, 'goal'), 'down').fire('click');
  await act(rowNamed(root, 'goal'), 'down').fire('click');
  await ctx.settle();
  assert.deepStrictEqual(order.map((b) => [b.value.join(), b.version]), [['epic,goal,sprint', 'v1'], ['epic,sprint,goal', 'v2']]);
});

test('every page of This board shows its path with a Copy button; Copied shows after the copy; a page with nothing on shows no path', async () => {
  const ctx = loadPages();
  const node = ctx.run("settingsPathNode('C:\\\\board\\\\config.yaml')");
  assert.match(node.textContent, /C:\\board\\config\.yaml/);
  const copy = node.one((el) => el.tag === 'button');
  assert.strictEqual(copy.textContent, 'Copy');
  assert.match(copy.attrs['aria-label'], /Copy the path/);
  await copy.fire('click');
  assert.deepStrictEqual(ctx.copied, ['C:\\board\\config.yaml']);
  assert.strictEqual(copy.textContent, 'Copied');
  assert.strictEqual(ctx.run("settingsPathNode('')"), null);
});

test('a path with <iteration> gets a line under the path bar naming the folder a new write goes to today', () => {
  const ctx = loadPages();
  const logbook = ctx.run("settingsPathNowNode('logbook', { kind: 'Folder', path: '/b/s/<iteration>/.logbook', now: '/b/s/0005.x/.logbook' })");
  assert.match(logbook.textContent, /A new note written today goes to \/b\/s\/0005\.x\/\.logbook/);
  const pad = ctx.run("settingsPathNowNode('scratchpad', { kind: 'Folder', path: '/b/s/<iteration>', now: '/b/s' })");
  assert.match(pad.textContent, /A new page written today goes to \/b\/s$/);
  const todos = ctx.run("settingsPathNowNode('todos', { kind: 'Folder', path: '/b/t/<iteration>', now: '/b/t' })");
  assert.match(todos.textContent, /A new list written today goes to \/b\/t$/);
  assert.strictEqual(ctx.run("settingsPathNowNode('logbook', { kind: 'Folder', path: '/b/l' })"), null);
  assert.strictEqual(ctx.run("settingsPathNowNode('logbook', null)"), null);
});

test('the Prefixes page is a table of fields with a Remove each and an Add row, the id note, the warning, and idDigits', () => {
  const root = loadPages().page('prefixes');
  const rows = root.all((el) => el.tag === 'tr' && el.dataset.prefixAt !== undefined);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].one(labelled('Prefix G')).value, 'G');
  assert.strictEqual(rows[0].one(labelled('Card type or folder of G')).value, 'goal');
  assert.ok(rows[0].one((el) => el.tag === 'button' && el.attrs['aria-label'] === 'Remove the prefix G'));
  assert.strictEqual(root.one((el) => el.id === 'pf-newPrefix').tag, 'input');
  const bullets = root.one(byClass('prefs-bullets')).children.map((li) => li.textContent);
  assert.strictEqual(bullets[0], settings.settingsPrefixNote);
  assert.match(bullets[1], /^The prefix `O` still names `objective`/);
  assert.ok(root.one((el) => el.id === 'pf-idDigits'));
});

test('a prefix change asks first; a no writes nothing and a yes writes the prefixes block with the version', async () => {
  const ctx = loadPages();
  const target = () => ctx.page('prefixes').one(labelled('Card type or folder of G'));
  let field = target();
  field.value = 'epic';
  ctx.sure = false;
  await field.fire('change');
  await ctx.settle();
  assert.match(ctx.asked[0], /^Change the prefix G/);
  assert.deepStrictEqual(ctx.calls, []);
  ctx.sure = true;
  field = target();
  field.value = 'epic';
  await field.fire('change');
  await ctx.settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.calls[0][2])), { block: 'prefixes', value: [{ prefix: 'G', target: 'epic' }, { prefix: 'O', target: 'objective' }, { prefix: 'W', target: 'workflow' }], version: 'v1' });
});

test('adding and removing a prefix each ask first and write the prefixes block', async () => {
  const ctx = loadPages();
  const root = ctx.page('prefixes');
  root.one((el) => el.id === 'pf-newPrefix').value = 'B';
  root.one((el) => el.id === 'pf-newTarget').value = 'bug';
  await root.one((el) => el.tag === 'form' && el.dataset.fk === 'prefix-new').fire('submit');
  await ctx.settle();
  assert.match(ctx.asked[0], /^Add the prefix B/);
  assert.deepStrictEqual(ctx.calls[0][2].value.at(-1), { prefix: 'B', target: 'bug' });
  await ctx.page('prefixes').one((el) => el.attrs['aria-label'] === 'Remove the prefix W').fire('click');
  await ctx.settle();
  assert.match(ctx.asked[1], /^Remove the prefix W/);
  assert.deepStrictEqual(ctx.calls[1][2].value.map((r) => r.prefix), ['G', 'O']);
});

test('a prefix a line names twice shows a warning bullet on the Prefixes page, after the note and before the other warnings', () => {
  const ctx = loadPages();
  ctx.state.settings.prefixClashes = [{ prefix: 'G', kept: 'goal', ignored: 'epic' }];
  const bullets = ctx.page('prefixes').one(byClass('prefs-bullets')).children.map((li) => li.textContent);
  assert.strictEqual(bullets[0], settings.settingsPrefixNote);
  assert.match(bullets[1], /^The prefix `G` is declared twice: `goal` is kept and the line for `epic` is ignored\. Saving this page rewrites the prefixes block without that line\. Why: /);
  assert.match(bullets[2], /^The prefix `O` still names `objective`/);
});

// A redraw (a save of another row finishing, the board polled) must not eat what is typed and not yet saved.
const keepDrafts = (ctx, root) => ctx.run('settingsKeepDrafts')({ querySelectorAll: () => root.all((el) => el.tag === 'input') });

test('text typed into a type name or hex field and not yet saved survives a redraw, and a value put back leaves no draft', () => {
  const ctx = loadPages();
  const root = ctx.page('types');
  rowNamed(root, 'story').one(labelled('Name of story')).value = 'tale';
  rowNamed(root, 'goal').one(labelled('Hex color of goal')).value = '#12';
  rowNamed(root, 'epic').one(labelled('Name of epic')).value = 'epic';
  keepDrafts(ctx, root);
  const again = ctx.page('types');
  assert.strictEqual(rowNamed(again, 'story').one(labelled('Name of story')).value, 'tale');
  assert.strictEqual(rowNamed(again, 'goal').one(labelled('Hex color of goal')).value, '#12');
  assert.strictEqual(rowNamed(again, 'goal').one(labelled('Name of goal')).value, 'goal', 'only the field typed in');
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(ctx.run('settingsUi.drafts')))).sort(), ['row:goal', 'row:story']);
  rowNamed(again, 'story').one(labelled('Name of story')).value = 'story';
  keepDrafts(ctx, again);
  assert.strictEqual(rowNamed(ctx.page('types'), 'story').one(labelled('Name of story')).value, 'story');
  assert.strictEqual(ctx.run("'row:story' in settingsUi.drafts"), false);
});

test('text typed into a prefix cell or the new prefix row survives a redraw', () => {
  const ctx = loadPages();
  const root = ctx.page('prefixes');
  root.one(labelled('Card type or folder of G')).value = 'epi';
  root.one(labelled('Prefix O')).value = 'Q';
  root.one((el) => el.id === 'pf-newPrefix').value = 'B';
  root.one((el) => el.id === 'pf-newTarget').value = 'bu';
  keepDrafts(ctx, root);
  const again = ctx.page('prefixes');
  assert.strictEqual(again.one(labelled('Card type or folder of G')).value, 'epi');
  assert.strictEqual(again.one(labelled('Prefix G')).value, 'G');
  assert.strictEqual(again.one(labelled('Prefix O')).value, 'Q');
  assert.strictEqual(again.one((el) => el.id === 'pf-newPrefix').value, 'B');
  assert.strictEqual(again.one((el) => el.id === 'pf-newTarget').value, 'bu');
});

test('a field of a line page keeps its typed text through the same collector', () => {
  const ctx = loadPages();
  const root = ctx.page('logbook');
  root.one((el) => el.id === 'pf-logbook').value = 'not';
  keepDrafts(ctx, root);
  assert.strictEqual(ctx.page('logbook').one((el) => el.id === 'pf-logbook').value, 'not');
});

test('the render keeps the drafts of every input before it redraws', () => {
  assert.match(ui, /settingsKeepDrafts\(panel\);/);
});

test('a prefix edit queued behind a removal finds its row by its prefix: the one asked is changed and the others stay', async () => {
  const ctx = loadPages();
  const root = ctx.page('prefixes');
  let release;
  const gate = new Promise((r) => { release = r; });
  ctx.api = async (m, u, body) => {
    ctx.calls.push([m, u, JSON.parse(JSON.stringify(body))]);
    if (ctx.calls.length === 1) await gate;
    ctx.state.settings.prefixes = body.value.map((r) => ({ prefix: r.prefix, kind: 'type', target: r.target }));
    ctx.state.settings.version = `v${ctx.calls.length + 1}`;
    return { settings: ctx.state.settings };
  };
  await root.one(labelled('Remove the prefix G')).fire('click');
  const field = root.one(labelled('Card type or folder of O'));
  field.value = 'epic';
  await field.fire('change');
  release();
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls.map((c) => c[2].value), [
    [{ prefix: 'O', target: 'objective' }, { prefix: 'W', target: 'workflow' }],
    [{ prefix: 'O', target: 'epic' }, { prefix: 'W', target: 'workflow' }],
  ]);
});

test('a prefix edit whose row was removed meanwhile writes nothing', async () => {
  const ctx = loadPages();
  const root = ctx.page('prefixes');
  const field = root.one(labelled('Card type or folder of G'));
  field.value = 'epic';
  ctx.state.settings.prefixes = ctx.state.settings.prefixes.filter((r) => r.prefix !== 'G');
  await field.fire('change');
  await ctx.settle();
  assert.deepStrictEqual(ctx.calls, []);
});

test('a prefix row the page can see is wrong is refused with the text kept, and nothing is asked', async () => {
  const ctx = loadPages();
  const field = ctx.page('prefixes').one(labelled('Prefix G'));
  field.value = 'O';
  await field.fire('change');
  assert.deepStrictEqual(ctx.calls, []);
  assert.deepStrictEqual(ctx.asked, []);
  assert.match(ctx.run("settingsUi.errors['prefix:G']"), /already declared/);
});

test('the other board pages show their path from the settings, and Counters stays read only', () => {
  const ctx = loadPages();
  assert.strictEqual(ctx.run("settingsPagePath('logbook', state.settings)"), 'C:\\board\\logbook');
  assert.strictEqual(ctx.run("settingsPagePath('scratchpad', state.settings)"), null);
  const counters = ctx.page('counters');
  assert.strictEqual(counters.all((el) => el.tag === 'input' || el.tag === 'button').length, 0);
});

test('the render puts the path under the page title for every page, and focus is kept by key with a fallback to the row', () => {
  assert.match(ui, /settingsPageReads\(current\.id, state\.settings\)/);
  assert.match(ui, /settingsUi\.focusKey/);
  assert.match(ui, /navigator\.clipboard\.writeText/);
});
