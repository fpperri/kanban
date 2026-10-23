const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette } = require('./helpers/palette-page');

// The card menu with its entries in groups, in the real page (helpers/palette-page.js builds the menu
// from app.html's own markup): which groups and separators show, how a group's panel opens by hover,
// click and key, where it opens and how it closes. The rules are menu-nest.js, tested apart; the
// browser runner drives the same in Chrome (scenarios/card-menu-nest.js).

const WEB = path.join(__dirname, '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

async function open({ groups = null, innerWidth = 1600, innerHeight = 900 } = {}) {
  const p = await openPalette({ menu: true, groups, viewport: { innerWidth, innerHeight } });
  const timers = [];
  let now = 0;
  p.page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, at: now + ms, id: timers.length + 1 }); return timers.length; };
  p.page.ctx.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.cancelled = true; };
  p.tick = (ms) => {
    now += ms;
    for (const t of timers.filter((x) => !x.done && !x.cancelled && x.at <= now).sort((a, b) => a.at - b.at)) { t.done = true; t.fn(); }
  };
  p.pending = () => timers.filter((t) => !t.done && !t.cancelled).length;
  const el = (id) => p.menu.byId[`#${id}`];
  p.el = el;
  p.sub = (name) => el(name).parent;
  p.shown = (id) => !el(id).classList.contains('hidden');
  p.subShown = (name) => !p.sub(name).classList.contains('hidden');
  p.isOpen = (name) => p.sub(name).classList.contains('open');
  p.showMenu = (js) => p.page.run(`${js}; showContextMenu(10, 10)`);
  p.card = () => p.showMenu("menuSubject = cardMenuFor(selectedIds, '3')");
  p.over = (target) => p.menu.root.fire('mouseover', { target });
  p.click = (target, over = {}) => p.menu.root.fire('click', { target, detail: 1, ...over });
  p.key = (key, over = {}) => {
    const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
    p.page.ctx.onMenuNestKey(e);
    return e;
  };
  p.focus = (id) => el(id).focus();
  p.focused = () => p.doc.activeElement && p.doc.activeElement.id;
  return p;
}

// --- the markup -------------------------------------------------------------------------------

test('the menu is Peek, Add note…, Add child…, a separator, Edit, Group, Explore, Scratchpad…, Todos…, Add to selection, a separator, Archive, Restore, Delete', async () => {
  const p = await open();
  const describe = (c) => (c.classes.includes('ctx-sep') ? '---' : c.classes.includes('ctx-sub') ? `${c.children[0].id}[${c.children[1].children.map(describe).join(',')}]` : c.id);
  const rows = p.menu.root.children.map(describe);
  assert.deepStrictEqual(rows, [
    'ctx-peek', 'ctx-note', 'ctx-child', '---',
    'ctx-edit[ctx-assign,ctx-priority,ctx-tags,ctx-schedule]',
    'ctx-group[ctx-group-add,ctx-group-make]',
    'ctx-explore[ctx-isolate,ctx-path[ctx-hpath,ctx-dpath],ctx-tree[ctx-htree,ctx-dtree]]',
    'ctx-scratch', 'ctx-todos', 'ctx-add', '---', 'ctx-archive', 'ctx-restore', 'ctx-delete',
  ]);
});

test('Archive and Restore keep their labels, and Delete is a top-level entry marked as dangerous, last', async () => {
  const p = await open();
  assert.strictEqual(p.text(p.el('ctx-archive')), 'Archive selected');
  assert.strictEqual(p.text(p.el('ctx-restore')), 'Restore selected');
  const last = p.menu.root.children[p.menu.root.children.length - 1];
  assert.strictEqual(last.id, 'ctx-delete');
  assert.ok(last.classes.includes('danger'));
  assert.strictEqual(last.parent.id, 'context-menu', 'never inside a group');
});

test('each group row has aria-haspopup and aria-expanded, and the menu and its panels are menus', async () => {
  const p = await open();
  for (const id of ['ctx-edit', 'ctx-group', 'ctx-explore', 'ctx-path', 'ctx-tree']) {
    assert.strictEqual(p.el(id).getAttribute('aria-haspopup'), 'menu', id);
    assert.strictEqual(p.el(id).getAttribute('aria-expanded'), 'false', id);
    assert.strictEqual(p.el(id).parent.children[1].getAttribute('role'), 'menu', id);
  }
  assert.strictEqual(p.menu.root.getAttribute('role'), 'menu');
});

test('only Add note… shows a key hint, and it is n', async () => {
  const p = await open();
  const hints = Object.entries(p.menu.byId).filter(([, e]) => e.dataset.hint !== undefined).map(([id, e]) => [id, e.dataset.hint]);
  assert.deepStrictEqual(hints, [['#ctx-note', 'n']]);
  assert.strictEqual(p.text(p.el('ctx-note')), 'Add note…', 'the hint is drawn by the stylesheet, so the entry\'s text is its name');
  assert.match(css, /button\[data-hint\]::after \{ content: attr\(data-hint\);/);
});

test('a group row wears a ▸ drawn by the stylesheet', () => {
  assert.match(css, /\.ctx-parent::after \{ content: "▸";/);
});

// --- which groups and separators show ---------------------------------------------------------------

test('a card outside the selection: Peek, Add note…, Add child…, Edit and Explore show, Group is out with groups off', async () => {
  const p = await open();
  p.card();
  assert.deepStrictEqual(['ctx-peek', 'ctx-note', 'ctx-child'].map(p.shown), [true, true, true]);
  assert.strictEqual(p.subShown('ctx-edit'), true);
  assert.strictEqual(p.subShown('ctx-group'), false, 'all its entries are out');
  assert.strictEqual(p.subShown('ctx-explore'), true);
});

test('with groups on the Group row shows, with one entry for one card and two for several', async () => {
  const p = await open({ groups: { folder: 'groups', list: [], skipped: [], folders: [], prefixes: [] } });
  p.card();
  assert.strictEqual(p.subShown('ctx-group'), true);
  assert.deepStrictEqual(['ctx-group-add', 'ctx-group-make'].map(p.shown), [true, false], 'a submenu with one entry left is still a submenu');
});

test('Explore stays on every card menu through Path and Tree, and is out of the canvas menu when Isolate is', async () => {
  const p = await open();
  p.showMenu("menuSubject = { ids: ['3', '7'], inSelection: true, peek: false, add: false, isolate: false, clicked: '3' }");
  assert.strictEqual(p.subShown('ctx-explore'), true, 'Path and Tree are there without Isolate');
  assert.strictEqual(p.shown('ctx-isolate'), false);
  assert.deepStrictEqual(['ctx-path', 'ctx-tree'].map(p.subShown), [true, true]);
  p.showMenu("menuSubject = { ids: [], inSelection: false, peek: false, add: false, isolate: false, clicked: null, canvas: true }");
  assert.strictEqual(p.subShown('ctx-explore'), false, 'nothing of the group shows in the canvas menu');
});

test('Path and Tree are groups of Hierarchy and Dependency on every card menu, and out of the canvas menu', async () => {
  const p = await open();
  for (const subject of ["cardMenuFor(selectedIds, '3')", "cardMenuFor(new Set(['3', '7']), '3')", "cardMenuFor(selectedIds, '3', { fromDetail: true })"]) {
    p.showMenu(`menuSubject = ${subject}`);
    assert.deepStrictEqual(['ctx-path', 'ctx-tree'].map(p.subShown), [true, true], subject);
    assert.deepStrictEqual(['ctx-hpath', 'ctx-dpath', 'ctx-htree', 'ctx-dtree'].map(p.shown), [true, true, true, true], subject);
  }
  p.showMenu('menuSubject = canvasMenuFor()');
  assert.deepStrictEqual(['ctx-path', 'ctx-tree'].map(p.subShown), [false, false]);
});

test('a separator shows between the groups it divides and goes when one side is empty', async () => {
  const p = await open();
  const seps = () => p.menu.root.children.filter((c) => c.classes.includes('ctx-sep')).map((c) => !c.classes.includes('hidden'));
  p.card();
  assert.deepStrictEqual(seps(), [true, true]);
  p.showMenu("menuSubject = { ids: [], inSelection: true, peek: false, add: false, isolate: true, clicked: null }");
  assert.deepStrictEqual(seps(), [false, true], 'with Peek, Add note… and Add child… out there is nothing above the first one');
});

test('the empty canvas menu is Isolate alone: no row, no other group, no separator', async () => {
  const p = await open();
  p.showMenu('menuSubject = canvasMenuFor()');
  assert.strictEqual(p.subShown('ctx-explore'), true);
  assert.strictEqual(p.subShown('ctx-edit'), false);
  assert.strictEqual(p.subShown('ctx-group'), false);
  assert.ok(p.menu.root.children.filter((c) => c.classes.includes('ctx-sep')).every((c) => c.classes.includes('hidden')));
  assert.match(css, /\.context-menu\.canvas-menu \.ctx-sub-panel \{ display: flex; position: static;/);
  assert.match(css, /\.context-menu\.canvas-menu button:not\(#ctx-isolate\) \{ display: none; \}/);
});

// --- opening a group by hover -------------------------------------------------------------------------

test('hovering a row opens its panel after a short delay, and not before', async () => {
  const p = await open();
  p.card();
  p.over(p.el('ctx-edit'));
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  p.tick(60);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  p.tick(80);
  assert.strictEqual(p.isOpen('ctx-edit'), true);
  assert.strictEqual(p.el('ctx-edit').getAttribute('aria-expanded'), 'true');
});

test('leaving the row before the delay opens nothing', async () => {
  const p = await open();
  p.card();
  p.over(p.el('ctx-edit'));
  p.tick(50);
  p.over(p.el('ctx-peek'));
  p.tick(1000);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
});

test('moving to another row takes longer, so a diagonal move toward the open panel keeps it', async () => {
  const p = await open({ groups: { folder: 'groups', list: [], skipped: [], folders: [], prefixes: [] } });
  p.card();
  p.over(p.el('ctx-edit'));
  p.tick(130);
  assert.strictEqual(p.isOpen('ctx-edit'), true);
  p.over(p.el('ctx-group'));
  p.tick(200);
  assert.strictEqual(p.isOpen('ctx-edit'), true, 'the pointer is crossing the next row');
  p.over(p.el('ctx-assign'));
  p.tick(1000);
  assert.strictEqual(p.isOpen('ctx-edit'), true, 'and it reached the open panel: nothing switches');
  assert.strictEqual(p.isOpen('ctx-group'), false);
});

test('resting on another row switches to its panel', async () => {
  const p = await open({ groups: { folder: 'groups', list: [], skipped: [], folders: [], prefixes: [] } });
  p.card();
  p.over(p.el('ctx-edit'));
  p.tick(130);
  p.over(p.el('ctx-group'));
  p.tick(310);
  assert.strictEqual(p.isOpen('ctx-group'), true);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  assert.strictEqual(p.el('ctx-edit').getAttribute('aria-expanded'), 'false');
});

test('resting on a plain entry closes the open panel', async () => {
  const p = await open();
  p.card();
  p.over(p.el('ctx-edit'));
  p.tick(130);
  p.over(p.el('ctx-add'));
  p.tick(310);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
});

test('a click on a row opens its panel at once and keeps the menu up', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.isOpen('ctx-edit'), true);
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.isOpen('ctx-edit'), true, 'a second click does not shut what hover opened');
  assert.strictEqual(p.menu.root.classList.contains('hidden'), false);
});

test('only one panel is open at a time', async () => {
  const p = await open({ groups: { folder: 'groups', list: [], skipped: [], folders: [], prefixes: [] } });
  p.card();
  p.click(p.el('ctx-edit'));
  p.click(p.el('ctx-explore'));
  assert.deepStrictEqual(['ctx-edit', 'ctx-group', 'ctx-explore'].map(p.isOpen), [false, false, true]);
});

test('closing the menu closes the panel and cancels a hover that was waiting', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-edit'));
  p.over(p.el('ctx-explore'));
  p.page.run('hideContextMenu()');
  p.tick(1000);
  assert.deepStrictEqual(['ctx-edit', 'ctx-explore'].map(p.isOpen), [false, false]);
  assert.strictEqual(p.menu.root.classList.contains('hidden'), true);
});

test('a menu that opens again opens with every panel shut', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-edit'));
  p.card();
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  assert.strictEqual(p.el('ctx-edit').getAttribute('aria-expanded'), 'false');
});

test('an entry in a panel still does what it did: its own click handler runs and the menu closes', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-edit'));
  p.page.run('openBulkSingle = (kind) => { globalThis.__opened = kind; }');
  p.el('ctx-priority').fire('click', { target: p.el('ctx-priority') });
  assert.strictEqual(p.page.run('globalThis.__opened'), 'priority');
});

// --- where a panel opens ------------------------------------------------------------------------------

const rect = (left, top, width = 160, height = 28) => ({ left, top, right: left + width, bottom: top + height, width, height });

test('a panel opens on the right of its row when there is room', async () => {
  const p = await open();
  p.card();
  p.el('ctx-edit').getBoundingClientRect = () => rect(100, 100);
  p.sub('ctx-edit').children[1].getBoundingClientRect = () => rect(0, 0, 180, 120);
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.sub('ctx-edit').children[1].classes.includes('flip'), false);
});

test('a panel flips to the left of its row when the right has no room', async () => {
  const p = await open();
  p.card();
  p.el('ctx-edit').getBoundingClientRect = () => rect(1500, 100);
  p.sub('ctx-edit').children[1].getBoundingClientRect = () => rect(0, 0, 180, 120);
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.sub('ctx-edit').children[1].classes.includes('flip'), true);
});

test('a panel that would run off the bottom is lifted', async () => {
  const p = await open({ innerHeight: 800 });
  p.card();
  p.el('ctx-edit').getBoundingClientRect = () => rect(100, 700);
  p.sub('ctx-edit').children[1].getBoundingClientRect = () => rect(0, 0, 180, 120);
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.sub('ctx-edit').children[1].style.top, '-33px', 'the 5px of its own padding and border, and the 28px it ran over');
});

test('a flipped or lifted panel is put back when it closes', async () => {
  const p = await open({ innerHeight: 800 });
  p.card();
  p.el('ctx-edit').getBoundingClientRect = () => rect(1500, 700);
  p.sub('ctx-edit').children[1].getBoundingClientRect = () => rect(0, 0, 180, 120);
  p.click(p.el('ctx-edit'));
  p.page.run('menuNestClose()');
  const panel = p.sub('ctx-edit').children[1];
  assert.deepStrictEqual([panel.classes.includes('flip'), panel.style.top], [false, '']);
});

// --- at phone width ------------------------------------------------------------------------------------

test('at phone width a panel opens in place and is not placed, and a second click on its row closes it', async () => {
  const p = await open({ innerWidth: 500 });
  p.card();
  p.el('ctx-edit').getBoundingClientRect = () => rect(400, 100);
  p.sub('ctx-edit').children[1].getBoundingClientRect = () => rect(0, 0, 180, 120);
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.isOpen('ctx-edit'), true);
  assert.strictEqual(p.sub('ctx-edit').children[1].classes.includes('flip'), false, 'no flip: it is drawn under its row');
  p.click(p.el('ctx-edit'));
  assert.strictEqual(p.isOpen('ctx-edit'), false);
});

test('the stylesheet draws a panel under its row at the phone width line, in the flow', () => {
  const rule = css.match(/@media \(max-width: 759\.98px\) \{\n  \.ctx-sub-panel \{[^}]*\}/);
  assert.ok(rule, 'a phone rule for the panel');
  assert.match(rule[0], /position: static;/);
  assert.match(css, /\.ctx-sub\.open > \.ctx-sub-panel \{ display: flex; \}/);
});

// --- the keyboard ----------------------------------------------------------------------------------------

test('Down highlights the first entry and then the next, Up goes back and wraps', async () => {
  const p = await open();
  p.card();
  const first = p.key('ArrowDown');
  assert.strictEqual(first.prevented, true);
  assert.strictEqual(p.focused(), 'ctx-peek');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-note');
  p.key('ArrowUp');
  p.key('ArrowUp');
  assert.strictEqual(p.focused(), 'ctx-delete', 'Up from the first wraps to the last');
});

test('the highlight skips entries that are out and goes group row by group row', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-child');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-edit');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-explore', 'Group is out');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-add', 'Scratchpad… is out too');
});

test('Right on a group row opens its panel and highlights its first entry; Down moves inside the panel only', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-edit');
  const e = p.key('ArrowRight');
  assert.strictEqual(e.prevented, true);
  assert.strictEqual(p.isOpen('ctx-edit'), true);
  assert.strictEqual(p.focused(), 'ctx-assign');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-priority');
  p.key('ArrowUp');
  p.key('ArrowUp');
  assert.strictEqual(p.focused(), 'ctx-schedule', 'it wraps inside the panel, never out of it');
  assert.strictEqual(p.isOpen('ctx-edit'), true);
});

test('Enter on a group row opens it as Right does, and Enter on an entry is left to its click', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  const enter = p.key('Enter');
  assert.strictEqual(enter.prevented, true);
  assert.strictEqual(p.isOpen('ctx-explore'), true);
  assert.strictEqual(p.focused(), 'ctx-path', 'Isolate is out: the first entry that shows');
  p.focus('ctx-peek');
  const onEntry = p.key('Enter');
  assert.strictEqual(onEntry.prevented, undefined);
  assert.strictEqual(onEntry.stopped, undefined);
});

test('Left closes the panel and puts the highlight back on its row', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-edit');
  p.key('ArrowRight');
  const e = p.key('ArrowLeft');
  assert.strictEqual(e.prevented, true);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  assert.strictEqual(p.focused(), 'ctx-edit');
});

test('Esc closes the panel first and the menu stays; a second Esc is the page\'s, which closes the menu', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-edit');
  p.key('ArrowRight');
  const first = p.key('Escape');
  assert.strictEqual(first.stopped, true, 'the page does not see it');
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  assert.strictEqual(p.focused(), 'ctx-edit');
  assert.strictEqual(p.menu.root.classList.contains('hidden'), false);
  const second = p.key('Escape');
  assert.strictEqual(second.stopped, undefined);
  assert.strictEqual(second.prevented, undefined);
});

test('Esc with a panel hover-opened and the highlight on its row closes the panel too', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-edit'));
  p.focus('ctx-edit');
  const e = p.key('Escape');
  assert.strictEqual(e.stopped, true);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
});

test('Left on a row whose panel is open closes that panel and keeps the highlight on the row, as Esc does', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-edit'));
  p.focus('ctx-edit');
  const e = p.key('ArrowLeft');
  assert.strictEqual(e.prevented, true);
  assert.strictEqual(p.isOpen('ctx-edit'), false);
  assert.strictEqual(p.focused(), 'ctx-edit');
  assert.strictEqual(p.menu.root.classList.contains('hidden'), false);
});

test('the keys do nothing while the menu is closed, or with Ctrl, Alt or Cmd held', async () => {
  const p = await open();
  assert.strictEqual(p.key('ArrowDown').prevented, undefined, 'closed');
  p.card();
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) assert.strictEqual(p.key('ArrowDown', { [mod]: true }).prevented, undefined, mod);
  assert.strictEqual(p.doc.activeElement.uid, p.menu.root.uid, 'and the menu keeps the focus it took');
});

test('the keys are read in the capture phase, ahead of everything behind the menu', async () => {
  const src = fs.readFileSync(path.join(WEB, 'menu-nest-ui.js'), 'utf8');
  assert.match(src, /document\.addEventListener\('keydown', onMenuNestKey, true\)/);
});

// --- focus: the keys are the menu's only while focus is in it --------------------------------------------

test('the menu takes the focus when it opens, and gives it back to where it was when it closes', async () => {
  const p = await open();
  const card = p.doc.createElement('div');
  card.focus();
  p.card();
  assert.strictEqual(p.doc.activeElement.uid, p.menu.root.uid);
  assert.strictEqual(p.menu.root.getAttribute('tabindex'), '-1');
  p.page.run('hideContextMenu()');
  assert.strictEqual(p.doc.activeElement.uid, card.uid);
});

test('a menu closed after focus moved on leaves the focus where it went', async () => {
  const p = await open();
  p.card();
  const elsewhere = p.doc.createElement('input');
  elsewhere.focus();
  p.page.run('hideContextMenu()');
  assert.strictEqual(p.doc.activeElement.uid, elsewhere.uid);
});

test('the keys do nothing while focus is outside the menu, in a field behind it included', async () => {
  const p = await open();
  p.card();
  const field = p.doc.createElement('input');
  field.focus();
  for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'Escape']) assert.strictEqual(p.key(k).prevented, undefined, k);
  assert.strictEqual(p.doc.activeElement.uid, field.uid);
});

test('Home and End highlight the first and last entry, and in a panel its own first and last', async () => {
  const p = await open();
  p.card();
  p.key('End');
  assert.strictEqual(p.focused(), 'ctx-delete');
  p.key('Home');
  assert.strictEqual(p.focused(), 'ctx-peek');
  p.focus('ctx-edit');
  p.key('ArrowRight');
  p.key('End');
  assert.strictEqual(p.focused(), 'ctx-schedule');
  p.key('Home');
  assert.strictEqual(p.focused(), 'ctx-assign');
});

test('each group row names the panel it controls', async () => {
  const p = await open();
  for (const id of ['ctx-edit', 'ctx-group', 'ctx-explore', 'ctx-path', 'ctx-tree']) {
    const panel = p.sub(id).children[1];
    assert.ok(panel.id, id);
    assert.strictEqual(p.el(id).getAttribute('aria-controls'), panel.id, id);
  }
});

test('the empty canvas menu is reached with Up and Down: Isolate is the highlight', async () => {
  const p = await open();
  p.showMenu('menuSubject = canvasMenuFor()');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-isolate');
  p.key('ArrowUp');
  assert.strictEqual(p.focused(), 'ctx-isolate');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-isolate', 'one entry, wrapping onto itself');
  const left = p.key('ArrowLeft');
  assert.strictEqual(left.prevented, undefined, 'no group to close here');
});

test('the glyphs and the key hint are out of the accessible name', () => {
  assert.match(css, /\.ctx-parent::after \{ content: "▸"; content: "▸" \/ "";/);
  assert.match(css, /button\[data-hint\]::after \{ content: attr\(data-hint\); content: attr\(data-hint\) \/ "";/);
  assert.match(css, /\.np-tab::after \{ content: attr\(data-key\); content: attr\(data-key\) \/ "";/);
});

// --- the third level: Explore > Path | Tree > Hierarchy | Dependency ---------------------------------------

const THIRD = { ids: ['ctx-path', 'ctx-tree'], entries: ['ctx-hpath', 'ctx-dpath', 'ctx-htree', 'ctx-dtree'] };
const openExplore = (p) => { p.card(); p.click(p.el('ctx-explore')); };

test('hovering Path inside the open Explore panel opens its panel after the short delay and keeps Explore open', async () => {
  const p = await open();
  p.card();
  p.click(p.el('ctx-explore'));
  p.over(p.el('ctx-path'));
  assert.strictEqual(p.isOpen('ctx-path'), false);
  p.tick(130);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path', 'ctx-tree'].map(p.isOpen), [true, true, false]);
  assert.strictEqual(p.el('ctx-path').getAttribute('aria-expanded'), 'true');
});

test('moving from Path to Tree waits the longer delay, and then Tree replaces Path while Explore stays', async () => {
  const p = await open();
  openExplore(p);
  p.over(p.el('ctx-path'));
  p.tick(130);
  p.over(p.el('ctx-tree'));
  p.tick(200);
  assert.strictEqual(p.isOpen('ctx-path'), true, 'the pointer is crossing the next row');
  p.tick(110);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path', 'ctx-tree'].map(p.isOpen), [true, false, true]);
  assert.strictEqual(p.el('ctx-path').getAttribute('aria-expanded'), 'false');
});

test('reaching the open Path panel keeps it, and an entry in it is a hover of the third level only', async () => {
  const p = await open();
  openExplore(p);
  p.over(p.el('ctx-path'));
  p.tick(130);
  p.over(p.el('ctx-tree'));
  p.tick(100);
  p.over(p.el('ctx-hpath'));
  p.tick(1000);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path', 'ctx-tree'].map(p.isOpen), [true, true, false]);
});

test('resting on Isolate, a plain entry of the Explore panel, shuts the third level and keeps Explore open', async () => {
  const p = await open();
  p.showMenu("menuSubject = { ids: ['3', '7'], inSelection: true, peek: false, add: false, isolate: true, clicked: '3' }");
  p.click(p.el('ctx-explore'));
  p.over(p.el('ctx-path'));
  p.tick(130);
  p.over(p.el('ctx-isolate'));
  p.tick(310);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, false]);
});

test('resting on a plain entry of the menu itself shuts Explore and the third level with it', async () => {
  const p = await open();
  openExplore(p);
  p.click(p.el('ctx-path'));
  p.over(p.el('ctx-add'));
  p.tick(310);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [false, false]);
});

test('a click on Path or Tree opens its panel at once, and a click on another top-level row shuts the lot', async () => {
  const p = await open();
  openExplore(p);
  p.click(p.el('ctx-path'));
  assert.deepStrictEqual(['ctx-explore', 'ctx-path', 'ctx-tree'].map(p.isOpen), [true, true, false]);
  p.click(p.el('ctx-tree'));
  assert.deepStrictEqual(['ctx-explore', 'ctx-path', 'ctx-tree'].map(p.isOpen), [true, false, true], 'one third-level panel at a time');
  p.click(p.el('ctx-edit'));
  assert.deepStrictEqual(['ctx-edit', 'ctx-explore', 'ctx-path', 'ctx-tree'].map(p.isOpen), [true, false, false, false]);
});

test('closing the menu shuts the third level too, and a menu that opens again opens with it shut', async () => {
  const p = await open();
  openExplore(p);
  p.click(p.el('ctx-tree'));
  p.page.run('hideContextMenu()');
  assert.deepStrictEqual(['ctx-explore', 'ctx-tree'].map(p.isOpen), [false, false]);
  assert.strictEqual(p.el('ctx-tree').getAttribute('aria-expanded'), 'false');
  p.card();
  assert.deepStrictEqual(['ctx-explore', 'ctx-tree'].map(p.isOpen), [false, false]);
});

test('an entry of the third level does what it did: its own click handler runs', async () => {
  const p = await open();
  p.page.run('globalThis.__added = []; addExploreToSelection = (kind) => { globalThis.__added.push(kind); }');
  openExplore(p);
  p.click(p.el('ctx-tree'));
  p.el('ctx-dtree').fire('click', { target: p.el('ctx-dtree') });
  assert.strictEqual(p.page.run('globalThis.__added.join()'), 'dtree');
});

test('the third level\'s panel is placed like the first: on the right of its row, on the left when there is no room, lifted at the bottom', async () => {
  const p = await open({ innerHeight: 800 });
  openExplore(p);
  const panel = p.sub('ctx-path').children[1];
  p.el('ctx-path').getBoundingClientRect = () => rect(300, 100);
  panel.getBoundingClientRect = () => rect(0, 0, 150, 60);
  p.click(p.el('ctx-path'));
  assert.strictEqual(panel.classes.includes('flip'), false);
  p.el('ctx-path').getBoundingClientRect = () => rect(1500, 100);
  p.click(p.el('ctx-tree'));
  p.click(p.el('ctx-path'));
  assert.strictEqual(panel.classes.includes('flip'), true);
  p.el('ctx-path').getBoundingClientRect = () => rect(300, 780);
  p.click(p.el('ctx-tree'));
  p.click(p.el('ctx-path'));
  assert.strictEqual(panel.style.top, '-53px', 'the 5px of its own padding and border, and the 48px it ran over');
  p.page.run('menuNestClose()');
  assert.deepStrictEqual([panel.classes.includes('flip'), panel.style.top], [false, ''], 'put back when it closes');
});

test('at phone width a second click on Path shuts its panel and leaves Explore open', async () => {
  const p = await open({ innerWidth: 500 });
  openExplore(p);
  p.click(p.el('ctx-path'));
  assert.strictEqual(p.isOpen('ctx-path'), true);
  p.click(p.el('ctx-path'));
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, false]);
});

test('the stylesheet nests the third level the way it nests the second: the open class opens only its own panel', () => {
  assert.match(css, /\.ctx-sub\.open > \.ctx-sub-panel \{ display: flex; \}/);
  assert.match(css, /\.ctx-sub \{ position: relative;/);
});

test('Right on Explore highlights Path; Right on Path opens its panel and highlights Hierarchy', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('ArrowRight');
  assert.strictEqual(p.focused(), 'ctx-path');
  const e = p.key('ArrowRight');
  assert.strictEqual(e.prevented, true);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, true]);
  assert.strictEqual(p.focused(), 'ctx-hpath');
});

test('Enter on Path or Tree opens it as Right does', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('Enter');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-tree');
  p.key('Enter');
  assert.strictEqual(p.isOpen('ctx-tree'), true);
  assert.strictEqual(p.focused(), 'ctx-htree');
  assert.strictEqual(p.key('Enter').prevented, undefined, 'and Enter on Hierarchy is its click');
});

test('Down and Up move inside the third level only, wrapping within it', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('ArrowRight');
  p.key('ArrowRight');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-dpath');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-hpath', 'it wraps inside the panel, never out of it');
  p.key('ArrowUp');
  assert.strictEqual(p.focused(), 'ctx-dpath');
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, true]);
});

test('Home and End go to the first and last entry of the third level', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('ArrowRight');
  p.key('ArrowDown');
  p.key('ArrowRight');
  p.key('End');
  assert.strictEqual(p.focused(), 'ctx-dtree');
  p.key('Home');
  assert.strictEqual(p.focused(), 'ctx-htree');
});

test('Left closes the third level alone and returns to Path, one level back; a second Left closes Explore', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('ArrowRight');
  p.key('ArrowRight');
  const first = p.key('ArrowLeft');
  assert.strictEqual(first.prevented, true);
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, false]);
  assert.strictEqual(p.focused(), 'ctx-path');
  p.key('ArrowLeft');
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [false, false]);
  assert.strictEqual(p.focused(), 'ctx-explore');
});

test('Esc does the same one level back, and with the highlight on a row whose panel is open it closes that panel only', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('ArrowRight');
  p.key('ArrowRight');
  const first = p.key('Escape');
  assert.strictEqual(first.stopped, true, 'the page does not see it');
  assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, false]);
  assert.strictEqual(p.focused(), 'ctx-path');
  p.click(p.el('ctx-tree'));
  p.focus('ctx-tree');
  p.key('Escape');
  assert.deepStrictEqual(['ctx-explore', 'ctx-tree'].map(p.isOpen), [true, false], 'a hover-opened or clicked panel, the highlight on its row');
  assert.strictEqual(p.focused(), 'ctx-tree');
  p.key('Escape');
  assert.strictEqual(p.isOpen('ctx-explore'), false);
  assert.strictEqual(p.menu.root.classList.contains('hidden'), false, 'the menu stays until the page closes it');
});

test('Left and Esc agree on Path: from the row whose panel is open, either closes that panel alone and keeps Explore open', async () => {
  for (const key of ['ArrowLeft', 'Escape']) {
    const p = await open();
    openExplore(p);
    p.click(p.el('ctx-path'));
    p.focus('ctx-path');
    const e = p.key(key);
    assert.strictEqual(e.prevented, true, key);
    assert.deepStrictEqual(['ctx-explore', 'ctx-path'].map(p.isOpen), [true, false], key);
    assert.strictEqual(p.focused(), 'ctx-path', key);
  }
});

test('moving the highlight off Path with Down shuts its panel, as it does for the first level', async () => {
  const p = await open();
  p.card();
  p.focus('ctx-explore');
  p.key('ArrowRight');
  p.click(p.el('ctx-path'));
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-tree');
  assert.strictEqual(p.isOpen('ctx-path'), false);
  assert.strictEqual(p.isOpen('ctx-explore'), true);
});

test('Explore with Isolate shown: Down from Isolate reaches Path, then Tree, and Home and End take the ends of the Explore panel', async () => {
  const p = await open();
  p.showMenu("menuSubject = { ids: ['3', '7'], inSelection: true, peek: false, add: false, isolate: true, clicked: '3' }");
  p.focus('ctx-explore');
  p.key('ArrowRight');
  assert.strictEqual(p.focused(), 'ctx-isolate');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-path');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-tree');
  p.key('Home');
  assert.strictEqual(p.focused(), 'ctx-isolate');
  p.key('End');
  assert.strictEqual(p.focused(), 'ctx-tree');
});

test('the canvas menu keeps Isolate as its one highlight: Path and Tree are no entries there', async () => {
  const p = await open();
  p.showMenu('menuSubject = canvasMenuFor()');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-isolate');
  p.key('ArrowDown');
  assert.strictEqual(p.focused(), 'ctx-isolate');
});
