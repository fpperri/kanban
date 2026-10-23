const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');
const { KEY_GUARD_SURFACES } = require('../web/key-guard');

// The tier fan's Names option and the l key in the real page (helpers/page-vm.js runs every
// script the page loads in one vm, with elements a test can read back). Names is a fourth
// option of the row: relevant (the default), all or none, kept per board with the other
// options. A named card shows its title as text, in a label placed where graph-names.js finds
// it room (graph-fan-name-rows-view.test.js); the setting never reaches the layout. The l key steps through the
// values while the Graph shows Tiers, through the shared key guard. The browser runner
// drives the same in Chrome (scenarios/fan-names.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// A board above the small size: 4 parents (1 to 4, each with one child, 11 to 14) and 26
// loose cards, 34 in all. Relevant names the four parents, all names 34, none names none.
// The titles of 1 and 11 are markup, to show a title reaches the page as text.
const SMALL_SIZE = 24;
const makeBoard = (name = 'kanban') => ({
  projectName: name,
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Ship <b>the</b> beta' }), card(2), card(3), card(4),
    card(11, { parent: 1, title: '<img src=x onerror=alert(1)>' }), card(12, { parent: 2 }), card(13, { parent: 3 }), card(14, { parent: 4 }),
    ...Array.from({ length: 26 }, (_, k) => card(100 + k)),
  ],
  archived: [],
});
const PARENTS = [1, 2, 3, 4];

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };
const SELECTOR = Object.fromEntries(KEY_GUARD_SURFACES.map((s) => [s.name, s.selector]));
const key = (name, feature) => `kanban.${name}.${feature}`;

async function open({ stored = {}, name = 'kanban', layout = null, view = 'graph', board = makeBoard(name), surfaces = {} } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host, ...surfaces };
  for (const sel of HIDDEN_SURFACES) if (!(sel in elements)) elements[sel] = hiddenSurface();
  const all = { [`kanban.${name}.view.mode`]: view, ...stored };
  if (layout) all[`kanban.${name}.graph.layout`] = layout;
  const page = await loadPage({ board, stored: all, elements, documentExtras: recordingDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return {
    page, host, stored: all, name,
    run: (code) => page.run(code),
    nodes: () => byClass(host, 'graph-node'),
    names: () => byClass(host, 'graph-node-name'),
    named: () => byClass(host, 'graph-node').filter((n) => n.classes.includes('graph-named')).map((n) => Number(n.attrs['data-id'])).sort((a, b) => a - b),
    row: () => byClass(host, 'graph-options')[0] || null,
    // A press of a key on the document, as the page's listeners see it.
    press(k, mods = {}) {
      return page.fireDocument('keydown', { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...mods });
    },
    // The event a click on `el` makes at the Graph's host.
    click(el) {
      const target = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (el.matches(sel) ? el : null) : harmless(String(k))) });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
  };
}

function matcher(el) {
  el.matches = (sel) => {
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const attrs = [...sel.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]);
    const own = el.classes || [];
    return classes.every((c) => own.includes(c)) && attrs.every(([k, v]) => (v === undefined ? el.dataset[k] !== undefined : el.dataset[k] === v));
  };
  return el;
}

const groups = (row) => byClass(row, 'graph-option').map((g) => ({
  label: byClass(g, 'graph-option-label')[0].textContent,
  title: g.title,
  buttons: byClass(g, 'graph-option-btn').map(matcher).map((b) => ({
    el: b, key: b.dataset.key, val: b.dataset.val, text: b.textContent, pressed: b.getAttribute('aria-pressed'), active: b.classes.includes('active'),
  })),
}));
const button = (s, k, v) => groups(s.row()).flatMap((g) => g.buttons).find((b) => b.key === k && b.val === v);
const pressedNames = (s) => groups(s.row()).find((g) => g.label === 'Names').buttons.filter((b) => b.pressed === 'true').map((b) => b.val);
const current = (s) => s.run('graphLoadOptions().names');

// --- the row --------------------------------------------------------------------------------------

test('the row holds Names, with relevant, all and none, and relevant pressed by default', async () => {
  const s = await open({});
  const names = groups(s.row()).find((g) => g.label === 'Names');
  assert.ok(names, 'a Names group');
  assert.deepStrictEqual(names.buttons.map((b) => [b.key, b.val, b.text]), [['names', 'relevant', 'relevant'], ['names', 'all', 'all'], ['names', 'none', 'none']]);
  assert.deepStrictEqual(pressedNames(s), ['relevant']);
  assert.ok(names.buttons[0].active && !names.buttons[1].active && !names.buttons[2].active, 'the active class follows the pressed value');
  assert.ok(names.title.length > 20 && /\bn\b/.test(names.title), 'it explains itself in a tooltip and says which key steps it');
  assert.deepStrictEqual(groups(s.row()).map((g) => g.label), ['Lines', 'Group', 'Dependencies', 'Order', 'Names', 'Unnested'], 'it follows the four that were there, and Unnested follows it');
  for (const b of names.buttons) {
    assert.strictEqual(b.el.dataset.keepsSelection, '', `${b.val} keeps the selection`);
    assert.strictEqual(b.el.dataset.holdsPoll, undefined, `${b.val} does not hold the poll`);
  }
});

test('a stored choice is the one pressed, and a value the row does not offer reads as relevant', async () => {
  const chosen = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'all', lines: 'off' }) } });
  assert.deepStrictEqual(pressedNames(chosen), ['all']);
  const stale = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'everything' }) } });
  assert.deepStrictEqual(pressedNames(stale), ['relevant']);
  const before = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ lines: 'chain' }) } });
  assert.deepStrictEqual(pressedNames(before), ['relevant'], 'options stored before Names existed');
});

test('the Names press is one of the controls that get focus back after a render, found again by its option and value', async () => {
  const s = await open({});
  s.page.ctx.__button = button(s, 'names', 'all').el;
  assert.strictEqual(s.run('refocusSelector(__button)'), '.graph-option-btn[data-key="names"][data-val="all"]');
});

// --- what is drawn ------------------------------------------------------------------------------------

test('every card of the fan has exactly one name label, with its title as text, and the setting decides which show', async () => {
  const s = await open();
  assert.ok(s.nodes().length > SMALL_SIZE, `${s.nodes().length} cards, above the small size`);
  assert.strictEqual(s.names().length, s.nodes().length, 'one label for each card');
  for (const node of s.nodes()) {
    const own = node.children.filter((c) => c.classes && c.classes.includes('graph-node-name'));
    assert.strictEqual(own.length, 1, `card ${node.attrs['data-id']} has one name`);
    assert.strictEqual(own[0].tag, 'text');
  }
  assert.deepStrictEqual(s.named(), PARENTS, 'relevant, the default, names the four parents');
});

test('a title reaches the page as text: markup in it is shown, never built', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'all' }) } });
  const nameOf = (id) => s.nodes().find((n) => n.attrs['data-id'] === String(id)).children.find((c) => c.classes && c.classes.includes('graph-node-name'));
  assert.strictEqual(nameOf(1).textContent, '#1 Ship <b>the</b> beta');
  assert.strictEqual(nameOf(11).textContent, '#11 <img src=x onerror=alert(1)>');
  assert.strictEqual(nameOf(1).innerHTML, '', 'no markup set');
  assert.strictEqual(nameOf(2).textContent, '#2 Card 2');
});

test('each Names press changes the number of names drawn: relevant 4, all 34, none 0', async () => {
  const s = await open({});
  assert.strictEqual(s.named().length, PARENTS.length);
  s.click(button(s, 'names', 'all').el);
  assert.strictEqual(s.named().length, 34);
  assert.deepStrictEqual(pressedNames(s), ['all'], 'the row shows what is held');
  s.click(button(s, 'names', 'none').el);
  assert.strictEqual(s.named().length, 0);
  assert.deepStrictEqual(pressedNames(s), ['none']);
  s.click(button(s, 'names', 'relevant').el);
  assert.deepStrictEqual(s.named(), PARENTS);
  assert.strictEqual(s.names().length, 34, 'every card keeps its one label, shown or not');
});

test('the options are stored whole under the one key, Names with them', async () => {
  const s = await open({});
  s.click(button(s, 'names', 'none').el);
  assert.deepStrictEqual(JSON.parse(s.stored[key('kanban', 'graph.options')]), { lines: 'chain', group: 'brackets', dependencies: 'on', order: 'status', names: 'none', unnested: 'outermost' });
  assert.deepStrictEqual(Object.keys(s.stored).filter((k) => /names/i.test(k)), [], 'no second storage key');
});

test('pressing Names runs no layout: the layout object is the one the page had, and the view does not move', async () => {
  const s = await open({});
  const layout = s.run('graphCur.layout');
  const view = JSON.stringify(s.run('graphCur.view'));
  s.click(button(s, 'names', 'all').el);
  assert.strictEqual(s.run('graphCur.layout'), layout, 'the cached layout');
  assert.strictEqual(JSON.stringify(s.run('graphCur.view')), view);
  s.click(button(s, 'names', 'none').el);
  assert.strictEqual(s.run('graphCur.layout'), layout);
});

test('a press leaves the selection as it is, and the names follow it', async () => {
  const s = await open({});
  s.run('setSelection(addPart(addPart(NO_SELECTION, cardPart(100)), cardPart(101)), 101)');
  s.run('renderGraphView()');
  assert.deepStrictEqual(s.named(), [1, 2, 3, 4, 100, 101], 'the two picked cards and the parents');
  s.click(button(s, 'names', 'none').el);
  assert.deepStrictEqual([...s.run('selectedIds')].map(Number).sort((a, b) => a - b), [100, 101]);
  assert.deepStrictEqual(s.named(), []);
});

test('the fan\'s footer line says the l key steps the names and which is on', async () => {
  const s = await open();
  const line = () => byClass(s.host, 'graph-key')[0].textContent;
  assert.match(line(), /^solid line: parent, .* · l steps the names: relevant$/);
  s.press('l');
  assert.match(line(), /l steps the names: all$/);
  const flow = await open({ layout: 'flow' });
  assert.doesNotMatch(byClass(flow.host, 'graph-key')[0].textContent, /names/, 'Flow has no names');
});

// --- selecting paints names in place -----------------------------------------------------------------------

test('a click on a card names it and the cards it lights in place: no rebuild, and the next click names the new ones', async () => {
  const s = await open();
  const fan = s.run('graphCur');
  assert.deepStrictEqual(s.named(), PARENTS);
  s.run('setSelection(addPart(NO_SELECTION, cardPart(11)), 11)');
  s.run('graphPaintSelection()');
  assert.strictEqual(s.run('graphCur'), fan, 'painted in place');
  assert.deepStrictEqual(s.named(), [1, 2, 3, 4, 11], 'card 11 and the parent it is related to, with the four parents');
  s.run('setSelection(addPart(NO_SELECTION, cardPart(12)), 12)');
  s.run('graphPaintSelection()');
  assert.deepStrictEqual(s.named(), [1, 2, 3, 4, 12], 'card 11 is no longer named');
  s.run('setSelection(NO_SELECTION, null)');
  s.run('graphPaintSelection()');
  assert.deepStrictEqual(s.named(), PARENTS);
});

test('under all and none, painting a selection changes no name', async () => {
  const all = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'all' }) } });
  all.run('setSelection(addPart(NO_SELECTION, cardPart(100)), 100)');
  all.run('graphPaintSelection()');
  assert.strictEqual(all.named().length, 34);
  const none = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'none' }) } });
  none.run('setSelection(addPart(NO_SELECTION, cardPart(100)), 100)');
  none.run('graphPaintSelection()');
  assert.strictEqual(none.named().length, 0);
});

// --- the l key ------------------------------------------------------------------------------------------------

test('n steps relevant, all, none and back to relevant, and each step is kept for the board', async () => {
  const s = await open();
  const seen = [current(s)];
  for (let i = 0; i < 3; i++) {
    const e = s.press('l');
    assert.strictEqual(e.defaultPrevented, true, 'the key is taken');
    seen.push(current(s));
  }
  assert.deepStrictEqual(seen, ['relevant', 'all', 'none', 'relevant']);
  s.press('l');
  assert.strictEqual(JSON.parse(s.stored[key('kanban', 'graph.options')]).names, 'all');
  assert.strictEqual(s.named().length, 34, 'the names drawn follow the key');
});

test('n steps the setting with the panel closed, and the row, once the panel is open, shows it', async () => {
  const s = await open({ stored: { 'kanban.kanban.viewpanel': '{"map":null,"graph":false}' } });
  assert.strictEqual(s.row(), null, 'closed: no option is built');
  s.press('l');
  assert.strictEqual(current(s), 'all');
  const reopened = await open({ stored: { ...s.stored, 'kanban.kanban.viewpanel': '{"map":null,"graph":true}' } });
  assert.deepStrictEqual(pressedNames(reopened), ['all']);
});

test('a capital N with no Shift (Caps Lock) steps it; a chord, Shift on the key and a held key do not', async () => {
  const s = await open();
  s.press('L');
  assert.strictEqual(current(s), 'all');
  for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
    const e = s.press('l', mods);
    assert.strictEqual(e.defaultPrevented, false, JSON.stringify(mods));
    assert.strictEqual(current(s), 'all', JSON.stringify(mods));
  }
  for (const other of ['m', 'a', 'Tab', '']) {
    s.press(other);
    assert.strictEqual(current(s), 'all', `key ${JSON.stringify(other)}`);
  }
});

test('with focus in the search box, or any field, l is typed and the setting stays', async () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    const s = await open();
    s.page.ctx.document.activeElement = { tagName, isContentEditable: false };
    const e = s.press('l');
    assert.strictEqual(e.defaultPrevented, false, tagName);
    assert.strictEqual(current(s), 'relevant', tagName);
  }
  const editable = await open();
  editable.page.ctx.document.activeElement = { tagName: 'DIV', isContentEditable: true };
  editable.press('l');
  assert.strictEqual(current(editable), 'relevant');
});

test('with a card menu, a dialog, the notifications panel or the preferences sheet open, l does nothing', async () => {
  for (const name of ['menu', 'dialog', 'notifications', 'preferences']) {
    const s = await open({ surfaces: { [SELECTOR[name]]: control() } });
    const e = s.press('l');
    assert.strictEqual(e.defaultPrevented, false, name);
    assert.strictEqual(current(s), 'relevant', name);
    assert.strictEqual(s.stored[key('kanban', 'graph.options')], undefined, `${name}: nothing was stored`);
  }
});

test('with the search panel open and focus outside the box, l steps the setting: the guard does not read the panel', async () => {
  const s = await open({ surfaces: { '.search-panel:not(.hidden)': control() } });
  s.run('searchPanelOpen = true');
  s.page.ctx.document.activeElement = { tagName: 'BUTTON', isContentEditable: false };
  const e = s.press('l');
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(current(s), 'all');
});

test('in Flow, and outside the Graph, l does nothing', async () => {
  for (const layout of ['flow']) {
    const s = await open({ layout });
    const e = s.press('l');
    assert.strictEqual(e.defaultPrevented, false, layout);
    assert.strictEqual(current(s), 'relevant', layout);
    assert.strictEqual(s.stored[key('kanban', 'graph.options')], undefined, layout);
  }
  const board = await open({ view: 'board' });
  const e = board.press('l');
  assert.strictEqual(e.defaultPrevented, false);
  assert.strictEqual(board.stored[key('kanban', 'graph.options')], undefined);
  for (const view of ['map', 'calendar', 'gantt']) {
    const other = await open({ view });
    other.press('l');
    assert.strictEqual(other.stored[key('kanban', 'graph.options')], undefined, view);
  }
});

test('n gets no key guard of its own: it reads keyGuardOff as p, m and i do', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = src.match(/function onGraphNamesKey\([\s\S]*?\n\}/)[0];
  assert.match(body, /keyGuardOff\(document\)/);
  assert.doesNotMatch(body, /activeElement|searchPanel|querySelector|tagName/, 'no special case for the box, the panel or a surface');
  assert.match(src, /document\.addEventListener\('keydown', onGraphNamesKey\)/);
});

test('n keeps focus on an option that had it: the step is made through keepControlFocus, the hand-back every press of the row uses', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = src.match(/function onGraphNamesKey\([\s\S]*?\n\}/)[0];
  assert.match(body, /focusedRebuiltControl\(\)/);
  assert.match(body, /keepControlFocus\(/);
});

test('n with focus on an option hands focus back to that same option in the rebuilt row, not to the option the step reached', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'all' }) } });
  const doc = s.page.ctx.document;
  const had = button(s, 'names', 'all').el;
  const refocusSelector = s.run('REFOCUS_SELECTOR');
  doc.activeElement = { tagName: 'BUTTON', isContentEditable: false, closest: (sel) => (sel === refocusSelector ? had : null) };
  const focused = [];
  const lookup = doc.querySelector;
  doc.querySelector = (sel) => {
    const found = sel.startsWith('.graph-option-btn') ? byClass(s.row(), 'graph-option-btn').map(matcher).find((b) => b.matches(sel)) : null;
    if (!found) return lookup(sel);
    found.focus = () => focused.push(found);
    return found;
  };
  s.press('l');
  assert.strictEqual(current(s), 'none', 'the key stepped the setting from all');
  assert.deepStrictEqual(pressedNames(s), ['none'], 'the rebuilt row shows the step');
  assert.strictEqual(focused.length, 1, 'focus was handed back once');
  assert.deepStrictEqual([focused[0].dataset.key, focused[0].dataset.val], ['names', 'all'], 'to the option that had it, which is no longer the pressed one');
  assert.notStrictEqual(focused[0], had, 'to the element the render made, not the one it replaced');
});

// --- the stylesheet --------------------------------------------------------------------------------------------------

test('the stylesheet shows a name for a named node with room only, in a size that holds at any zoom, with tokens and no hex colour', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
  const rule = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at !== -1, `a rule for ${sel}`);
    return css.slice(at, css.indexOf('}', at) + 1);
  };
  assert.match(rule('.graph-node-name'), /display: none/, 'hidden unless the node is named');
  assert.match(rule('.graph-node-name'), /font-size: calc\(11px \/ var\(--graph-k, 1\)\)/);
  assert.match(rule('.graph-node-name'), /stroke-width: calc\(4px \/ var\(--graph-k, 1\)\)/);
  assert.match(rule('.graph-node-name'), /pointer-events: none/, 'a name never takes the pointer from a dot');
  assert.match(rule('.graph-node.graph-named.graph-placed .graph-node-name'), /display: inline/);
  assert.match(rule('.graph-node.graph-named.graph-placed .graph-node-id'), /display: none/, 'a named card whose name found room shows its title in place of its id');
  for (const sel of ['.graph-node-name', '.graph-node.graph-named.graph-placed .graph-node-name', '.graph-node.graph-named.graph-placed .graph-node-id']) {
    assert.doesNotMatch(rule(sel), /#[0-9a-fA-F]{3,8}\b|style=/, sel);
  }
});

test('the plan and the view emit only classes the stylesheet has a rule for', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  for (const cls of ['graph-named', 'graph-node-name']) assert.ok(new RegExp(`\\.${cls}(?![\\w-])`).test(css), cls);
});

// --- the page goes on ------------------------------------------------------------------------------------------------

test('with names on all, a zoom, a pan and a poll leave exactly one name per card, and the page logs no error', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'all' }) } });
  const errors = [];
  s.page.ctx.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ')) };
  s.run('graphZoomBy(1.5, 100, 100)');
  s.run('graphCur.view.x += 40; graphCur.view.y -= 25; graphCur.view.touched = true; graphApplyTransform()');
  assert.strictEqual(s.names().length, 34);
  await s.run('autoRefreshTick()');
  await s.page.settle();
  assert.strictEqual(s.nodes().length, 34);
  assert.strictEqual(s.names().length, 34, 'one name for each card after the poll');
  assert.strictEqual(s.named().length, 34);
  for (const node of s.nodes()) assert.strictEqual(node.children.filter((c) => c.classes && c.classes.includes('graph-node-name')).length, 1);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(s.page.failures.map((e) => e.message), []);
});

test('a poll after the setting changed draws the same names the setting says', async () => {
  const s = await open();
  s.press('l');
  await s.run('autoRefreshTick()');
  await s.page.settle();
  assert.strictEqual(s.named().length, 34, 'all, as the key left it');
  s.press('l');
  await s.run('autoRefreshTick()');
  await s.page.settle();
  assert.strictEqual(s.named().length, 0);
});

test('a board with a card whose parent is missing, a loop of parents and a title that is not text still draws its names', async () => {
  const board = makeBoard();
  board.active.push(
    card(200, { parent: 999 }), card(201, { parent: 202 }), card(202, { parent: 201 }),
    card(203, { title: null }), card(204, { title: 42 }), card(205, { title: '' }),
  );
  const s = await open({ board, stored: { [key('kanban', 'graph.options')]: JSON.stringify({ names: 'all' }) } });
  const errors = [];
  s.page.ctx.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ')) };
  s.run('renderGraphView()');
  assert.strictEqual(s.names().length, s.nodes().length);
  assert.deepStrictEqual(errors, []);
  for (const mode of ['relevant', 'none', 'all']) {
    s.run(`graphSetOption('names', '${mode}')`);
    assert.strictEqual(s.names().length, s.nodes().length, mode);
  }
  assert.deepStrictEqual(errors, []);
});

test('another board keeps its own Names choice, and a reload keeps this board\'s', async () => {
  const first = await open({});
  first.click(button(first, 'names', 'none').el);
  const reloaded = await open({ stored: first.stored });
  assert.strictEqual(current(reloaded), 'none');
  assert.strictEqual(reloaded.named().length, 0);
  const other = await open({ stored: { ...first.stored, [key('shop', 'graph.options')]: JSON.stringify({ names: 'all' }) }, name: 'shop' });
  assert.strictEqual(current(other), 'all');
  assert.strictEqual(current(first), 'none');
  const fresh = await open({ name: 'plain' });
  assert.strictEqual(current(fresh), 'relevant');
});

test('a plain Names value cannot reach the store by the setter unless the row offers it', async () => {
  const s = await open();
  s.run("graphSetOption('names', 'every')");
  assert.strictEqual(s.stored[key('kanban', 'graph.options')], undefined);
  assert.strictEqual(current(s), 'relevant');
  s.run("graphSetOption('names', 'all')");
  assert.strictEqual(current(s), 'all');
});
