const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');
const { openPalette } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The Todos tab in the real page (helpers/palette-page.js), against the real server on a temporary
// board (docs/adr/0021): the page's own script draws the tab, sends its writes with the version it
// read, and follows the file when it changes under it. The rules each write stands on are
// todo-store.js, tested apart; the browser runner drives the same in Chrome (scenarios/todos.js).

const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n${extra}---\n\n# ${title}\n`;
const CONFIG = 'name: t\nnextId: 30\nlogbook: logbook\nscratchpad: .pads\ntodos: .pads\n';

const ANY_DIALOG = '.modal-backdrop:not(.hidden)';
const OTHER_DIALOG = '.modal-backdrop:not(.hidden):not(#detail-modal)';

// `popup`: a popup other than the card details is up.
async function setup({ config = CONFIG, files = {}, popup = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-todos-page-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [id, title] of [[3, 'Write the cutover plan'], [7, 'Port the zephyr schema']]) fs.writeFileSync(path.join(dir, `${String(id).padStart(4, '0')}.c${id}.card.md`), card(id, title));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const payload = await (await fetch(`${base}/api/board`)).json();
  const toasts = [];
  let inflight = 0;
  const proxied = async (url, init = {}) => {
    inflight++;
    let res;
    let text;
    try {
      res = await fetch(base + url, init);
      text = await res.text();
    } finally {
      inflight--;
    }
    return { ok: res.ok, status: res.status, headers: { get: (k) => res.headers.get(k) }, text: async () => text };
  };
  const entry = control();
  const elements = { '#ctx-todos': entry, [ANY_DIALOG]: null, [OTHER_DIALOG]: popup ? control() : null };
  const p = await openPalette({ payload, fetchWith: proxied, elements });
  p.page.ctx.toast = (m) => toasts.push(m);
  p.page.ctx.renderBoard = () => {}; // the board's tiles are the browser runner's; here the payload is applied and the palette follows it
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
  // Real requests go to the real server: wait until none is on its way, three checks running.
  const settle = async () => {
    for (let quiet = 0, i = 0; quiet < 3 && i < 500; i++) {
      await new Promise((r) => setTimeout(r, 3));
      quiet = inflight === 0 ? quiet + 1 : 0;
    }
  };
  const open = async (id = '7') => { p.page.run(`openNotes({ kind: 'todos', target: '${id}' })`); await settle(); };
  const list = () => p.find('.td-list');
  const rows = () => p.all('.td-row');
  const rowTexts = () => rows().map((r) => (r.querySelector('.td-text') ? r.querySelector('.td-text').innerHTML : '(editing)'));
  const add = () => p.find('.td-add');
  const pressRow = (row, key, over = {}) => {
    const e = { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: row, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
    list().fire('keydown', e);
    return e;
  };
  const typeAdd = async (text) => { add().value = text; p.press(add(), 'Enter'); await settle(); };
  return { p, dir, srv, toasts, entry, read, write, settle, open, list, rows, rowTexts, add, pressRow, typeAdd, close: () => srv.close() };
}

const tabs = (t) => t.p.all('.np-tab').map((b) => b.textContent + (b.classes.includes('on') ? '*' : ''));

test('the tabs of a card on a board that keeps all three are Notes, Scratchpad and Todos, each naming its key', async () => {
  const t = await setup();
  try {
    await t.open();
    assert.deepStrictEqual(tabs(t), ['Notes', 'Scratchpad', 'Todos*']);
    assert.deepStrictEqual(t.p.all('.np-tab').map((b) => b.title), ['Notes (Alt+1)', 'Scratchpad (Alt+2)', 'Todos (Alt+3)']);
    assert.strictEqual(t.p.page.run('notesUi.tab'), 'todos');
  } finally { t.close(); }
});

test('Alt+3 picks the Todos tab from the note box, and Alt+4 is past the last tab', async () => {
  const t = await setup();
  try {
    t.p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
    const alt = (key) => t.p.pal().fire('keydown', { key, code: `Digit${key}`, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} });
    alt('3');
    await t.settle();
    assert.strictEqual(t.p.page.run('notesUi.tab'), 'todos');
    alt('4');
    assert.strictEqual(t.p.page.run('notesUi.tab'), 'todos');
  } finally { t.close(); }
});

test('the tab shows the file, each item, and the lines that are not items muted and read only', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '# Before the handoff\n- [ ] one\n- [x] two\n  - [ ] two a\nnotes under it\n' } });
  try {
    await t.open();
    assert.strictEqual(t.p.text(t.p.find('.td-path')), '.pads/0007.todo.md');
    assert.deepStrictEqual(t.rowTexts(), ['one', 'two', 'two a']);
    assert.deepStrictEqual(t.rows().map((r) => r.classes.filter((c) => /^td-d|done/.test(c)).join(' ')), ['td-d0', 'td-d0 done', 'td-d1']);
    assert.deepStrictEqual(t.p.all('.td-plain').map((r) => [r.textContent, r.classes.includes('np-muted')]), [['# Before the handoff', true], ['notes under it', true]]);
    assert.deepStrictEqual(t.p.all('.td-tick').map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false']);
    assert.strictEqual(t.p.all('.td-plain').some((r) => r.querySelector('button, input')), false, 'a plain line has no control');
  } finally { t.close(); }
});

test('a list not written yet says so and shows the empty hint', async () => {
  const t = await setup();
  try {
    await t.open('3');
    assert.strictEqual(t.p.text(t.p.find('.td-path')), '.pads/0003.todo.md (not written yet)');
    assert.match(t.p.text(t.p.find('.np-empty')), /No todos yet/);
    assert.strictEqual(t.add().disabled, false);
  } finally { t.close(); }
});

test('an item\'s text is drawn as inline Markdown with no block around it, a card mention a chip', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] **bold** and `t#3 the plan` and `code`\n- [ ] # not a heading\n' } });
  try {
    await t.open();
    const html = t.rows().map((r) => r.querySelector('.td-text').innerHTML);
    assert.ok(html[0].startsWith('<strong>bold</strong> and '));
    assert.ok(html[0].includes('data-card-id="3"') && html[0].includes('<code>code</code>'));
    assert.ok(!html.join('').includes('<p>') && !html.join('').includes('<h1>'));
    assert.strictEqual(html[1], '# not a heading');
  } finally { t.close(); }
});

test('Enter in the box adds an item at the end, clears the box and keeps the focus there', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n' } });
  try {
    await t.open();
    await t.typeAdd('  two  ');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] two\n');
    assert.deepStrictEqual(t.rowTexts(), ['one', 'two']);
    assert.strictEqual(t.add().value, '');
    assert.strictEqual(t.p.doc.activeElement, t.add());
    await t.typeAdd('three');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] two\n- [ ] three\n');
  } finally { t.close(); }
});

test('Enter on an empty box writes nothing, and the first item makes the file', async () => {
  const t = await setup();
  try {
    await t.open('3');
    await t.typeAdd('   ');
    assert.ok(!fs.existsSync(path.join(t.dir, '.pads/0003.todo.md')));
    await t.typeAdd('first');
    assert.strictEqual(t.read('.pads/0003.todo.md'), '- [ ] first\n');
    assert.strictEqual(t.p.text(t.p.find('.td-path')), '.pads/0003.todo.md');
  } finally { t.close(); }
});

test('Space ticks the item and unticks it again; a ticked item stays in place, struck and muted', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n- [ ] two\n' } });
  try {
    await t.open();
    const e = t.pressRow(t.rows()[0], ' ');
    assert.strictEqual(e.defaultPrevented, true);
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [x] one\n- [ ] two\n');
    assert.deepStrictEqual(t.rowTexts(), ['one', 'two']);
    assert.strictEqual(t.rows()[0].classes.includes('done'), true);
    assert.strictEqual(t.p.doc.activeElement.dataset.index, '0', 'the focus stays on the row');
    t.pressRow(t.rows()[0], ' ');
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] two\n');
  } finally { t.close(); }
});

test('two quick presses of Space are two writes in order, each on the version the one before left', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n' } });
  try {
    await t.open();
    t.pressRow(t.rows()[0], ' ');
    t.pressRow(t.rows()[0], ' ');
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n', 'ticked and unticked, with no clash');
    assert.deepStrictEqual(t.toasts, []);
  } finally { t.close(); }
});

test('clicking the box ticks it too', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n' } });
  try {
    await t.open();
    t.p.find('.td-tick').click();
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [x] one\n');
  } finally { t.close(); }
});

test('e edits in place: Enter saves, Esc puts it back, and Esc does not close the palette', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n- [ ] two\n' } });
  try {
    await t.open();
    t.pressRow(t.rows()[1], 'e');
    const input = t.p.find('.td-edit');
    assert.strictEqual(input.value, 'two');
    assert.strictEqual(t.p.doc.activeElement, input);
    input.value = 'TWO';
    const esc = t.p.press(input, 'Escape');
    assert.strictEqual(esc.stopped, true, 'the palette does not hear it');
    await t.settle();
    assert.strictEqual(t.p.find('.td-edit'), null);
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] two\n');
    t.pressRow(t.rows()[1], 'e');
    const again = t.p.find('.td-edit');
    again.value = 'second';
    t.p.press(again, 'Enter');
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] second\n');
    assert.deepStrictEqual(t.rowTexts(), ['one', 'second']);
  } finally { t.close(); }
});

test('d twice deletes: the first d asks, the second does it, and the item\'s children go with it', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n  - [ ] one a\n- [ ] two\n' } });
  try {
    await t.open();
    t.pressRow(t.rows()[0], 'd');
    await t.settle();
    assert.strictEqual(t.rows()[0].querySelector('[data-act="delete"]').textContent, 'Sure?');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n  - [ ] one a\n- [ ] two\n');
    t.pressRow(t.rows()[0], 'd');
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] two\n');
    assert.deepStrictEqual(t.rowTexts(), ['two']);
    assert.strictEqual(t.p.doc.activeElement.dataset.index, '0', 'the focus goes to the row now in its place');
  } finally { t.close(); }
});

test('Alt+Down and Alt+Up move an item among its siblings and the focus follows it', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] a\n  - [ ] a1\n- [ ] b\n- [ ] c\n' } });
  try {
    await t.open();
    const e = t.pressRow(t.rows()[0], 'ArrowDown', { altKey: true });
    assert.strictEqual(e.defaultPrevented, true);
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] b\n- [ ] a\n  - [ ] a1\n- [ ] c\n');
    assert.deepStrictEqual(t.rowTexts(), ['b', 'a', 'a1', 'c']);
    assert.strictEqual(t.p.doc.activeElement.querySelector('.td-text').innerHTML, 'a');
    t.pressRow(t.p.doc.activeElement, 'ArrowUp', { altKey: true });
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] a\n  - [ ] a1\n- [ ] b\n- [ ] c\n');
  } finally { t.close(); }
});

test('Up and Down move between the box and the rows', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] a\n- [ ] b\n' } });
  try {
    await t.open();
    t.p.press(t.add(), 'ArrowDown');
    assert.strictEqual(t.p.doc.activeElement, t.rows()[0]);
    t.pressRow(t.rows()[0], 'ArrowDown');
    assert.strictEqual(t.p.doc.activeElement, t.rows()[1]);
    t.pressRow(t.rows()[1], 'ArrowDown');
    assert.strictEqual(t.p.doc.activeElement, t.rows()[1], 'the last row stays');
    t.pressRow(t.rows()[1], 'ArrowUp');
    t.pressRow(t.rows()[0], 'ArrowUp');
    assert.strictEqual(t.p.doc.activeElement, t.add());
  } finally { t.close(); }
});

test('c, or the + Sub button, aims the box under an item: a chip says so, Enter adds a child, Esc takes the chip off', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] a\n- [ ] b\n' } });
  try {
    await t.open();
    t.pressRow(t.rows()[0], 'c');
    assert.strictEqual(t.p.text(t.p.find('.td-under')), 'under: a✕');
    assert.strictEqual(t.p.doc.activeElement, t.add());
    await t.typeAdd('a1');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] a\n  - [ ] a1\n- [ ] b\n');
    assert.ok(t.p.find('.td-under'), 'the chip stays for the next child');
    await t.typeAdd('a2');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n');
    const esc = t.p.press(t.add(), 'Escape');
    assert.strictEqual(esc.stopped, true);
    assert.strictEqual(t.p.find('.td-under'), null);
    assert.ok(t.p.page.run('notesUi.sub'), 'the palette is still up');
    await t.typeAdd('top');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n- [ ] top\n');
    t.rows()[1].querySelector('[data-act="child"]').click();
    assert.match(t.p.text(t.p.find('.td-under')), /under: a1/);
    t.p.find('.td-under-x').click();
    assert.strictEqual(t.p.find('.td-under'), null);
  } finally { t.close(); }
});

test('a hand edit shows when the board refreshes, and an item being edited is not redrawn under the hands', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n' } });
  try {
    await t.open();
    t.write('.pads/0007.todo.md', '- [ ] one\n- [x] by hand\n');
    await t.p.page.run('loadBoard()');
    await t.settle();
    assert.deepStrictEqual(t.rowTexts(), ['one', 'by hand']);
    t.pressRow(t.rows()[0], 'e');
    t.write('.pads/0007.todo.md', '- [ ] one\n- [x] by hand\n- [ ] while editing\n');
    await t.p.page.run('loadBoard()');
    await t.settle();
    assert.deepStrictEqual(t.rowTexts(), ['(editing)', 'by hand'], 'unchanged while the edit box is open');
    t.p.press(t.p.find('.td-edit'), 'Escape');
    await t.settle();
    await t.p.page.run('loadBoard()');
    await t.settle();
    assert.strictEqual(t.rowTexts().length, 3);
  } finally { t.close(); }
});

test('a write after a hand edit is refused, said, and the list read again; nothing is overwritten', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n' } });
  try {
    await t.open();
    t.write('.pads/0007.todo.md', '- [ ] one\n- [ ] typed by hand\n');
    t.pressRow(t.rows()[0], ' ');
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] typed by hand\n');
    assert.strictEqual(t.toasts.length, 1);
    assert.match(t.toasts[0], /changed on disk/);
    assert.deepStrictEqual(t.rowTexts(), ['one', 'typed by hand']);
    t.pressRow(t.rows()[0], ' ');
    await t.settle();
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [x] one\n- [ ] typed by hand\n', 'the next try, on the version just read, goes through');
  } finally { t.close(); }
});

test('a refused add keeps what was typed in the box', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] one\n' } });
  try {
    await t.open();
    t.write('.pads/0007.todo.md', '- [ ] one\n- [ ] by hand\n');
    await t.typeAdd('mine');
    assert.strictEqual(t.add().value, 'mine');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] by hand\n');
    await t.typeAdd('mine');
    assert.strictEqual(t.read('.pads/0007.todo.md'), '- [ ] one\n- [ ] by hand\n- [ ] mine\n');
  } finally { t.close(); }
});

test('the tile and badge counts come from the board payload: open over all, none for a list with no item', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] a\n- [x] b\n- [x] c\n', '.pads/0003.todo.md': 'only a note\n' } });
  try {
    const b = t.p.page.run("todoCountButton('7')");
    assert.strictEqual(b.textContent, '1/3');
    assert.strictEqual(b.dataset.todoTarget, '7');
    assert.ok(b.classes.includes('card-todos') && b.classes.includes('np-trigger'));
    assert.match(b.title, /1 of 3 todos open/);
    assert.strictEqual(t.p.page.run("todoCountButton('3')"), null);
    assert.strictEqual(t.p.page.run("todoCountButton('99')"), null);
    t.write('.pads/0007.todo.md', '- [x] a\n- [x] b\n');
    await t.p.page.run('loadBoard()');
    assert.ok(t.p.page.run("todoCountButton('7')").classes.includes('all-done'));
    assert.strictEqual(t.p.page.run("todoCountButton('7')").textContent, '0/2');
  } finally { t.close(); }
});

test('clicking a count opens the Todos tab of its card or group', async () => {
  const t = await setup({ files: { '.pads/0007.todo.md': '- [ ] a\n' } });
  try {
    const b = t.p.page.run("todoCountButton('7')");
    t.p.page.fireDocument('click', { target: { closest: (sel) => (sel === '.card-todos' ? b : null) } });
    await t.settle();
    assert.strictEqual(t.p.page.run('notesUi.tab'), 'todos');
    assert.strictEqual(t.p.page.run('notesUi.sub.id'), '7');
  } finally { t.close(); }
});

const keyT = (t, over = {}) => {
  const e = { key: 't', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
  t.p.page.ctx.onTodosKey(e);
  return e;
};

test('t opens the Todos tab of the hovered card, the open details\' card ahead of it, the one selected card when none is hovered', async () => {
  const t = await setup();
  try {
    t.p.page.run("hoveredId = '3'");
    const e = keyT(t);
    assert.strictEqual(e.defaultPrevented, true);
    assert.deepStrictEqual([t.p.page.run('notesUi.tab'), t.p.page.run('notesUi.sub.id')], ['todos', '3']);
    t.p.page.run('notesClose()');
    t.p.doc.activeElement = null;
    t.p.page.run("hoveredId = null; selectedIds.clear(); selectedIds.add('7')");
    keyT(t);
    assert.strictEqual(t.p.page.run('notesUi.sub.id'), '7');
    t.p.page.run('notesClose()');
    t.p.doc.activeElement = null;
    t.p.page.run("selectedIds.clear(); selectedIds.add('7'); selectedIds.add('3')");
    keyT(t);
    assert.strictEqual(t.p.page.run('notesUi.sub'), null, 'two selected and none hovered: no card is meant');
  } finally { t.close(); }
});

test('t works over the card details and aims at their card; it types a t in a field and stays off behind other popups', async () => {
  const t = await setup();
  const stayed = await setup({ popup: true });
  try {
    t.p.page.run("currentDetailId = '3'; hoveredId = '7'");
    keyT(t);
    assert.strictEqual(t.p.page.run('notesUi.sub.id'), '3', 'the card whose details are open, ahead of the hovered card');
    t.p.page.run('notesClose()');
    t.p.doc.activeElement = { tagName: 'INPUT', isContentEditable: false };
    const typed = keyT(t);
    assert.strictEqual(typed.defaultPrevented, false);
    assert.strictEqual(t.p.page.run('notesUi.sub'), null);
    stayed.p.page.run("hoveredId = '7'");
    const behind = keyT(stayed);
    assert.strictEqual(behind.defaultPrevented, false);
    assert.strictEqual(stayed.p.page.run('notesUi.sub'), null);
  } finally { t.close(); stayed.close(); }
});

test('t with modifiers, Shift, or held down does nothing', async () => {
  const t = await setup();
  try {
    t.p.page.run("hoveredId = '3'");
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { key: 'x' }]) {
      const e = keyT(t, over);
      assert.strictEqual(e.defaultPrevented, false, JSON.stringify(over));
    }
    assert.strictEqual(t.p.page.run('notesUi.sub'), null);
  } finally { t.close(); }
});

test('t on a board with no todos: line says so and opens nothing', async () => {
  const t = await setup({ config: 'name: t\nnextId: 30\nlogbook: logbook\n' });
  try {
    t.p.page.run("hoveredId = '3'");
    const e = keyT(t);
    assert.strictEqual(e.defaultPrevented, true);
    assert.deepStrictEqual(t.toasts, ['Todo lists are off: config.yaml has no todos: line.']);
    assert.strictEqual(t.p.page.run('notesUi.sub'), null);
    assert.strictEqual(t.p.page.run("todoCountButton('3')"), null);
  } finally { t.close(); }
});

test('with the logbook and scratchpad off a card opens on its todos alone, and a board refresh does not close it', async () => {
  const t = await setup({ config: 'name: t\nnextId: 30\ntodos: .todos\n', files: { '.todos/0007.todo.md': '- [ ] a\n' } });
  try {
    await t.open();
    assert.deepStrictEqual(tabs(t), ['Todos*']);
    assert.strictEqual(t.p.page.run('notesUi.tabsEl.hidden'), true, 'one tab needs no tab row');
    await t.p.page.run('loadBoard()');
    await t.settle();
    assert.ok(t.p.page.run('notesUi.sub'), 'the palette stays up');
    assert.deepStrictEqual(t.rowTexts(), ['a']);
  } finally { t.close(); }
});

test('a group has Notes, Group, Scratchpad and Todos, and its list is its own', async () => {
  const t = await setup({
    config: `${CONFIG}groups: .groups\nprefixes:\n  I: .groups/iteration\n`,
    files: { '.groups/iteration/0001.sprint.md': '---\nid: I1\nname: sprint\ncards: [7]\n---\n', '.pads/I0001.todo.md': '- [ ] group item\n' },
  });
  try {
    await t.open('I1');
    assert.deepStrictEqual(tabs(t), ['Notes', 'Group', 'Scratchpad', 'Todos*']);
    assert.deepStrictEqual(t.rowTexts(), ['group item']);
    assert.strictEqual(t.p.text(t.p.find('.td-path')), '.pads/I0001.todo.md');
    const badge = t.p.page.run("groupBadges('7')");
    assert.ok(badge, 'card 7 is in the group');
    assert.strictEqual(badge.walk().filter((e) => e.classes && e.classes.includes('card-todos')).map((e) => e.textContent).join(), '1/1', 'the group\'s count sits by its badge on the tile');
  } finally { t.close(); }
});

test('the card menu has a Todos… entry that opens the tab for one card, and none for several', async () => {
  const t = await setup();
  try {
    t.p.page.run("menuSubject = { ...menuSubject, ids: ['7'] }");
    t.entry.fire('click');
    await t.settle();
    assert.deepStrictEqual([t.p.page.run('notesUi.tab'), t.p.page.run('notesUi.sub.id')], ['todos', '7']);
    t.p.page.run('notesClose()');
    t.p.page.run("menuSubject = { ...menuSubject, ids: ['7', '3'] }");
    t.entry.fire('click');
    assert.strictEqual(t.p.page.run('notesUi.sub'), null);
  } finally { t.close(); }
});
