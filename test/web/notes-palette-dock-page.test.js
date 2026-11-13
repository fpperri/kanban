const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette, note } = require('./helpers/palette-page');

// The notes palette as a side dock from 760 px up, and its compact top, in the real page
// (helpers/palette-page.js). The browser runner drives the same in Chrome (scenarios/notes-dock.js).

const KEY = 'kanban.kanban.modal.fullscreen';
const NOTES = [note('2026-10-15', '7', '09:30', '@human', 'early on seven'), note('2026-10-15', '22', '10:00', '@afk', 'later on twenty-two')];
const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

async function open({ width, stored = {} } = {}) {
  const p = await openPalette({ notes: NOTES, stored, viewport: width ? { innerWidth: width } : {} });
  p.docked = () => p.doc.body.classList.contains('notes-docked');
  p.on = () => p.pal().classes.includes('fullscreen');
  p.btn = () => p.find('#notes-fullscreen-btn');
  p.openOn = (id) => p.page.run(`openNotes({ kind: 'card-notes', id: '${id}' })`);
  p.resize = () => { for (const fn of p.page.windowListeners.resize || []) fn({}); };
  return p;
}

const escape = (p, from) => p.pal().fire('keydown', { key: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: from, preventDefault() {}, stopPropagation() {} });

// The page's timers are stubs: a test that wants the palette's delays collects them and runs them.
const timers = (p) => {
  const queue = [];
  p.page.ctx.setTimeout = (fn) => queue.push(fn);
  return () => queue.splice(0).forEach((fn) => fn());
};

// --- the dock ------------------------------------------------------------------------------------------

test('on a wide window the open palette is a dock: the page is told, and told again when it closes', async () => {
  const p = await open();
  assert.strictEqual(p.docked(), false, 'closed');
  p.openOn('7');
  assert.strictEqual(p.docked(), true);
  p.page.run('notesClose()');
  assert.strictEqual(p.docked(), false);
});

test('the full screen button leaves the dock and comes back to it', async () => {
  const p = await open();
  p.openOn('7');
  p.btn().click();
  assert.strictEqual(p.on(), true);
  assert.strictEqual(p.docked(), false, 'a full screen palette leaves no room for a board');
  p.btn().click();
  assert.strictEqual(p.on(), false);
  assert.strictEqual(p.docked(), true);
});

test('a palette opened on a board that saved full screen opens full screen, not docked', async () => {
  const p = await open({ stored: { [KEY]: JSON.stringify({ notes: true }) } });
  p.openOn('7');
  assert.strictEqual(p.docked(), false);
});

test('under 760 px the palette is full screen and never a dock', async () => {
  const p = await open({ width: 500 });
  p.openOn('7');
  assert.strictEqual(p.on(), true);
  assert.strictEqual(p.docked(), false);
});

test('a window that crosses 760 px with the palette open goes between the dock and full screen at once', async () => {
  const p = await open({ width: 500 });
  p.openOn('7');
  p.page.ctx.innerWidth = 1200;
  p.resize();
  assert.strictEqual(p.docked(), true);
  p.page.ctx.innerWidth = 500;
  p.resize();
  assert.strictEqual(p.docked(), false);
});

test('a press on the board does not close the dock, and a press anywhere in the page leaves it up', async () => {
  const p = await open();
  p.openOn('7');
  p.page.fireDocument('mousedown', { target: p.doc.createElement('div') });
  assert.notStrictEqual(p.page.run('notesUi.sub'), null);
  assert.strictEqual(p.docked(), true);
});

test('Esc closes the palette from the dock and from full screen, and the board gets its room back', async () => {
  const p = await open();
  p.openOn('7');
  p.page.run('notesUi.sub = { kind: "none", day: notesUi.sub.day }'); // no chip left to clear: Esc closes
  escape(p, p.ui().input);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
  assert.strictEqual(p.docked(), false);
  p.openOn('7');
  p.btn().click();
  p.page.run('notesUi.sub = { kind: "none", day: notesUi.sub.day }');
  escape(p, p.ui().input);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
});

test('the dock keeps writing as it was: Enter writes the note, and the box is empty for the next', async () => {
  const p = await open();
  const calls = [];
  const real = p.page.ctx.fetch;
  p.page.ctx.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      calls.push(body);
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ note: { ...body, by: '@human', index: 0, file: 'f' } }) };
    }
    return real(url, opts);
  };
  p.openOn('7');
  p.ui().input.value = 'from the dock';
  p.ui().input.fire('input', {});
  p.press(p.ui().input, 'Enter');
  await p.page.settle();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].note, 'from the dock');
  assert.strictEqual(calls[0].target, '7');
  assert.strictEqual(p.ui().input.value, '');
});

// --- the compact top and the pinned box ------------------------------------------------------------------

test('the box is pinned at the bottom: the notes fill the space above it, the preview and the keys go under it', async () => {
  const p = await open();
  p.openOn('7');
  const order = p.pal().children.map((c) => c.classes.find((k) => /^np-(head|filter-row|body|bar|prev|foot)$/.test(k)));
  assert.deepStrictEqual(order, ['np-head', 'np-filter-row', 'np-body', 'np-bar', 'np-prev', 'np-foot']);
});

test('the subject is one control: the card picker with its clear button, and no separate chip', async () => {
  const p = await open();
  p.openOn('7');
  assert.strictEqual(p.find('.np-chip'), null);
  const subject = p.find('.np-subject');
  assert.ok(subject, 'one subject control');
  assert.ok(subject.contains(p.ui().pick), 'the picker is in it');
  const x = subject.querySelector('.np-chip-x');
  assert.ok(x, 'with its clear button');
  assert.strictEqual(p.ui().pick.value, '#7 Port the zephyr schema');
  assert.strictEqual(x.hidden, false);
  x.click();
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'none', 'the button clears the subject');
  assert.strictEqual(x.hidden, true, 'nothing left to clear');
});

test('the date and time fields keep Today and Now as a small reset that shows only when the field says something else', async () => {
  const p = await open();
  p.openOn('7');
  const today = p.find('.np-today-btn');
  const now = p.find('.np-now-btn');
  assert.strictEqual(today.textContent, '↺');
  assert.strictEqual(now.textContent, '↺');
  assert.strictEqual(today.getAttribute('aria-pressed'), 'true', 'the field says Today: the reset is hidden');
  assert.strictEqual(now.getAttribute('aria-pressed'), 'true');
  assert.match(css, /\.np-mode-btn\[aria-pressed="true"\]\s*\{[^}]*display:\s*none/);
  p.ui().date.value = '2026-10-14';
  p.ui().date.fire('input', {});
  assert.strictEqual(today.getAttribute('aria-pressed'), 'false', 'a picked day: the reset shows');
  today.click();
  assert.strictEqual(p.ui().date.value, 'Today');
  assert.strictEqual(today.getAttribute('aria-pressed'), 'true');
});

test('the subject line (the subject, date and time) shows while focus is in the note bar, and goes a moment after it leaves', async () => {
  const p = await open();
  const flush = timers(p);
  p.openOn('7');
  const bar = p.find('.np-bar');
  assert.ok(p.pal().classes.includes('np-focus'), 'opened with the cursor in the box');
  p.ui().input.blur();
  bar.fire('focusout', {});
  assert.ok(p.pal().classes.includes('np-focus'), 'still, for the moment it takes a click to land');
  flush();
  assert.ok(!p.pal().classes.includes('np-focus'));
  bar.fire('focusin', {});
  assert.ok(p.pal().classes.includes('np-focus'));
});

test('the hint line (what Enter will write) shows only while the note box has focus', async () => {
  const p = await open();
  const flush = timers(p);
  p.openOn('7');
  assert.ok(p.pal().classes.includes('np-typing'), 'opened with the cursor in the box');
  p.ui().input.blur();
  p.ui().input.fire('blur', {});
  assert.ok(p.pal().classes.includes('np-typing'), 'still, for the moment it takes a click to land');
  flush();
  assert.ok(!p.pal().classes.includes('np-typing'));
  p.ui().input.fire('focus', {});
  assert.ok(p.pal().classes.includes('np-typing'));
});

test('the filter, the list layout, the author switch and the range share one toolbar, each switch beside a dropdown for a narrow line', async () => {
  const p = await open();
  p.openOn('7');
  const row = p.find('.np-filter-row');
  const kids = row.children.map((c) => c.classes.join(' '));
  for (const part of ['np-filter', 'np-layout-slot', 'np-sel-layout', 'np-by-slot', 'np-sel-by', 'np-range-slot', 'np-sel-range', 'np-range-step', 'np-range-label']) {
    assert.ok(row.walk().some((e) => e.classes && e.classes.includes(part)), `${part} is on the toolbar: ${kids}`);
  }
  assert.strictEqual(p.find('.np-range-row').parent.uid, row.uid, 'the range is no row of its own');
});

test('a dropdown says what the switch beside it says, and changing it does what the switch does', async () => {
  const p = await open();
  p.openOn('7');
  const by = p.find('.np-sel-by');
  const layout = p.find('.np-sel-layout');
  const range = p.find('.np-sel-range');
  assert.strictEqual(by.value, 'all');
  assert.strictEqual(layout.value, 'grouped');
  assert.strictEqual(range.value, p.page.run('notesUi.range.mode'));
  by.value = 'ai';
  by.fire('change', {});
  assert.strictEqual(p.page.run('notesUi.by'), 'ai');
  layout.value = 'timeline';
  layout.fire('change', {});
  assert.strictEqual(p.page.run('notesLayout()'), 'timeline');
  range.value = 'week';
  range.fire('change', {});
  assert.strictEqual(p.page.run('notesUi.range.mode'), 'week');
  assert.strictEqual(p.find('.np-by-btn[data-by="ai"]').getAttribute('aria-pressed'), 'true', 'the switch followed');
  p.page.run("notesSetBy('human')");
  assert.strictEqual(by.value, 'human', 'and the dropdown follows the switch');
});

// --- the stylesheet --------------------------------------------------------------------------------------

test('the palette is a full-height panel docked on the right under the header, and the board is given the room', () => {
  assert.match(css, /\n\.notes-palette \{[^}]*top: calc\(var\(--board-header-h, 64px\) \+ 16px\);[^}]*right: 0; bottom: 0; width: var\(--np-dock-w\);/);
  assert.match(css, /body\.notes-docked main#board[^{]*\{\s*margin-right: var\(--np-dock-w\)/);
  assert.match(css, /--np-dock-w: clamp\(/);
  for (const view of ['.map-view', '.calendar-view', '.gantt-view', '.graph-view']) assert.ok(css.includes(`body.notes-docked ${view}`), view);
});

test('the dock stays under the shared fullscreen box: full screen wins when the class is on', () => {
  assert.match(css, /\.notes-palette\.fullscreen\s*\{[^}]*transform:\s*none/s);
});
