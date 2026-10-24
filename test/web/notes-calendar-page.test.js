const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The Calendar's notes strip in the real page (helpers/palette-page.js): the week drawn with its
// divider, the width the divider sets for every day column at once, and the guards that keep a press
// on it from being a card drag, a click on an empty hour or a double click that makes a card. The sums
// are notes-calendar.js, tested apart; the browser runner drives the same in Chrome
// (scenarios/notes-calendar.js).

const NOTES = [
  note('2026-10-15', '7', '09:30', '@human', 'schema diff reviewed and the two enum renames are left to do'),
  note('2026-10-15', '22', '14:10', '@afk', 'cutover window agreed'),
  note('2026-10-13', '3', '11:00', '@human', 'plan drafted'),
];
const KEY = 'kanban.kanban.calendar.notesWidth';
const CSS = (px) => `max(44px, min(${px}px, calc(100% - 24px)))`;

async function weekPage({ stored = {}, container = control() } = {}) {
  const grid = control();
  const p = await openPalette({ notes: NOTES, stored, elements: { '#calendar-view .cal-timegrid': grid, '#calendar-view': container } });
  p.grid = grid;
  p.vars = {};
  grid.style = { setProperty: (k, v) => { p.vars[k] = v; }, removeProperty: (k) => { delete p.vars[k]; } };
  p.container = container;
  return p;
}

// A day column 200px wide with its divider `dividerLeft` from the page's left edge.
function geometry({ left = 300, right = 500, dividerLeft = 380 } = {}) {
  const col = { dataset: { day: '2026-10-15' }, getBoundingClientRect: () => ({ left, right, width: right - left }), closest: () => null };
  const divider = {
    classList: { added: [], add(c) { this.added.push(c); }, remove(c) { this.added = this.added.filter((x) => x !== c); } },
    captured: null,
    setPointerCapture(id) { this.captured = id; },
    getBoundingClientRect: () => ({ left: dividerLeft, width: 6 }),
    closest: (sel) => (sel === '.cal-tg-col' ? col : sel.includes('.cal-note-divider') ? divider : null),
  };
  return { col, divider };
}
const ev = (over) => ({ button: 0, pointerId: 1, clientX: 0, key: '', altKey: false, ctrlKey: false, metaKey: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...over });

test('no width is saved to begin with, and a saved one is read for the board', async () => {
  const p = await weekPage();
  assert.strictEqual(p.page.run('calendarNotesStrip()'), null);
  const q = await weekPage({ stored: { [KEY]: '150' } });
  assert.strictEqual(q.page.run('calendarNotesStrip()'), 150);
});

test('a drag of the divider sets the strip live for every day, saves it on release, and holds the poll', async () => {
  const p = await weekPage();
  const g = geometry();
  p.page.ctx.onCalNotesDividerDown(ev({ target: g.divider, clientX: 380 }));
  assert.strictEqual(p.page.run('isDragging'), true, 'the 5s poll waits');
  assert.strictEqual(g.divider.captured, 1);
  assert.ok(g.divider.classList.added.includes('dragging'));
  p.page.ctx.onCalNotesDividerMove(ev({ clientX: 400 }));
  assert.strictEqual(p.vars['--cal-note-width'], CSS(100));
  assert.strictEqual(p.stored[KEY], undefined, 'nothing is saved mid-drag');
  p.page.ctx.onCalNotesDividerMove(ev({ clientX: 360 }));
  assert.strictEqual(p.vars['--cal-note-width'], CSS(140));
  p.page.ctx.onCalNotesDividerUp(ev({ clientX: 360 }));
  assert.strictEqual(p.page.run('isDragging'), false);
  assert.strictEqual(p.stored[KEY], '140');
  assert.strictEqual(p.page.run('calendarNotesStrip()'), 140);
  assert.ok(!g.divider.classList.added.includes('dragging'));
});

test('a drag stops at the 44px minimum and at the column less a 24px sliver', async () => {
  const p = await weekPage();
  const g = geometry();
  p.page.ctx.onCalNotesDividerDown(ev({ target: g.divider }));
  p.page.ctx.onCalNotesDividerMove(ev({ clientX: 495 }));
  assert.strictEqual(p.vars['--cal-note-width'], CSS(44));
  p.page.ctx.onCalNotesDividerMove(ev({ clientX: 100 }));
  assert.strictEqual(p.vars['--cal-note-width'], CSS(176));
  p.page.ctx.onCalNotesDividerUp(ev({}));
  assert.strictEqual(p.stored[KEY], '176');
});

test('a cancelled drag puts the width back as it was', async () => {
  const p = await weekPage({ stored: { [KEY]: '120' } });
  const g = geometry();
  p.page.ctx.onCalNotesDividerDown(ev({ target: g.divider }));
  p.page.ctx.onCalNotesDividerMove(ev({ clientX: 340 }));
  p.page.ctx.onCalNotesDividerCancel(ev({}));
  assert.strictEqual(p.vars['--cal-note-width'], CSS(120));
  assert.strictEqual(p.stored[KEY], '120');
  assert.strictEqual(p.page.run('isDragging'), false);
});

test('a press on anything but the divider, or with another button, or the move of another pointer, is not a drag', async () => {
  const p = await weekPage();
  const g = geometry();
  p.page.ctx.onCalNotesDividerDown(ev({ target: { closest: () => null } }));
  p.page.ctx.onCalNotesDividerDown(ev({ target: g.divider, button: 2 }));
  assert.strictEqual(p.page.run('isDragging'), false);
  p.page.ctx.onCalNotesDividerDown(ev({ target: g.divider }));
  p.page.ctx.onCalNotesDividerMove(ev({ clientX: 340, pointerId: 9 }));
  assert.strictEqual(p.vars['--cal-note-width'], undefined);
  p.page.ctx.onCalNotesDividerUp(ev({ pointerId: 9 }));
  assert.strictEqual(p.page.run('isDragging'), true, 'the drag goes on until its own pointer lets go');
  p.page.ctx.onCalNotesDividerUp(ev({}));
});

test('Left widens the strip and Right narrows it from where it is drawn, and each step is kept', async () => {
  const p = await weekPage();
  const left = ev({ target: geometry({ dividerLeft: 397 }).divider, key: 'ArrowLeft' });
  p.page.ctx.onCalNotesDividerKey(left);
  assert.strictEqual(left.prevented, true);
  assert.strictEqual(p.page.run('calendarNotesStrip()'), 108, 'the divider is 100px from the right edge: 100 and a step');
  assert.strictEqual(p.vars['--cal-note-width'], CSS(108));
  assert.strictEqual(p.stored[KEY], '108');
  p.page.ctx.onCalNotesDividerKey(ev({ target: geometry({ dividerLeft: 405 }).divider, key: 'ArrowRight' }));
  assert.strictEqual(p.page.run('calendarNotesStrip()'), 84, 'drawn 92px from the right edge, less a step');
});

test('a key that is not Left or Right is left alone, and so is Alt+Left, the browser\'s Back', async () => {
  const p = await weekPage();
  const g = geometry();
  const up = ev({ target: g.divider, key: 'ArrowUp' });
  p.page.ctx.onCalNotesDividerKey(up);
  assert.strictEqual(up.prevented, undefined);
  const withAlt = ev({ target: g.divider, key: 'ArrowLeft', altKey: true });
  p.page.ctx.onCalNotesDividerKey(withAlt);
  assert.strictEqual(withAlt.prevented, undefined);
  assert.strictEqual(p.page.run('calendarNotesStrip()'), null);
});

test('a double click on the divider goes back to the default width', async () => {
  const p = await weekPage({ stored: { [KEY]: '150' } });
  p.vars['--cal-note-width'] = 'x';
  const e = ev({ target: geometry().divider });
  p.page.ctx.onCalNotesDividerDblClick(e);
  assert.strictEqual(p.page.run('calendarNotesStrip()'), null);
  assert.strictEqual(p.vars['--cal-note-width'], undefined);
  assert.strictEqual(p.stored[KEY], undefined);
  assert.strictEqual(e.prevented, true);
});

test('the width has three states, named: not read yet, the default, or a number of px', async () => {
  const p = await weekPage();
  assert.strictEqual(p.page.run('calendarNotesWidth'), 'unread');
  assert.strictEqual(p.page.run('calendarNotesStrip()'), null);
  assert.strictEqual(p.page.run('calendarNotesWidth'), 'default');
  p.page.run('setCalendarNotesStrip(150)');
  assert.strictEqual(p.page.run('calendarNotesWidth'), 150);
  p.page.run('setCalendarNotesStrip(null)');
  assert.strictEqual(p.page.run('calendarNotesWidth'), 'default');
  assert.strictEqual(p.page.run('calendarNotesStrip()'), null);
  const q = await weekPage({ stored: { [KEY]: '150' } });
  assert.strictEqual(q.page.run('calendarNotesStrip()'), 150);
  assert.strictEqual(q.page.run('calendarNotesWidth'), 150);
});

test('a board change forgets what was read', async () => {
  const p = await weekPage({ stored: { [KEY]: '150' } });
  p.page.run('calendarNotesStrip()');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8'), /calendarNotesWidth = CAL_NOTES_UNREAD; \/\/ calendar\.notesWidth too/);
});

test('chips show 12 words by default and many more once a width is set', async () => {
  const p = await weekPage();
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  const words = () => p.page.run(`noteFirstWords(${JSON.stringify(long)}, noteChipWords(calendarNotesStrip()))`);
  assert.match(words(), /twelve…$/);
  p.page.run('setCalendarNotesStrip(150)');
  assert.match(words(), /fourteen$/);
});

test('the week is drawn with a divider in each day that keeps a strip, at the width that is set', async () => {
  const p = await weekPage({ stored: { [KEY]: '150' } });
  p.page.run("calendarAnchor = '2026-10-15'");
  const host = p.doc.createElement('div');
  p.page.ctx.__host = host;
  p.page.run("renderCalendarTimeGrid(__host, 'week', 0)");
  const grid = host.querySelector('.cal-timegrid');
  assert.strictEqual(grid.style['--cal-note-width'], CSS(150));
  const cols = host.querySelectorAll('.cal-tg-col');
  assert.deepStrictEqual(cols.filter((c) => c.classes.includes('has-notes')).map((c) => c.dataset.day), ['2026-10-13', '2026-10-15']);
  for (const col of cols) {
    assert.strictEqual(col.querySelectorAll('.cal-note-divider').length, col.classes.includes('has-notes') ? 1 : 0, col.dataset.day);
  }
});

test('every divider reports its width as a percentage of its column, and names its day', async () => {
  const p = await weekPage({ stored: { [KEY]: '100' } });
  p.page.run("calendarAnchor = '2026-10-15'");
  const host = p.doc.createElement('div');
  p.page.ctx.__host = host;
  p.page.run("renderCalendarTimeGrid(__host, 'week', 0)");
  const dividers = host.querySelectorAll('.cal-note-divider');
  assert.deepStrictEqual(dividers.map((d) => d.getAttribute('aria-label')), ['Width of the notes on Tue 13', 'Width of the notes on Thu 15']);
  for (const d of dividers) {
    const col = d.parent;
    col.getBoundingClientRect = () => ({ left: 0, right: 400, width: 400, top: 0, bottom: 0, height: 0 });
    d.getBoundingClientRect = () => ({ left: 297, width: 6, right: 303, top: 0, bottom: 0, height: 0 });
  }
  p.page.ctx.document.querySelectorAll = () => dividers;
  p.page.run('paintCalendarNotesAria()');
  for (const d of dividers) {
    assert.deepStrictEqual([d.getAttribute('aria-valuenow'), d.getAttribute('aria-valuemin'), d.getAttribute('aria-valuemax')], ['25', '11', '94']);
  }
});

test('setting the width, by a drag, a key or a double click, refreshes what each divider reports', async () => {
  const p = await weekPage();
  const d = p.doc.createElement('div');
  const col = p.doc.createElement('div');
  col.className = 'cal-tg-col';
  col.append(d);
  d.className = 'cal-note-divider';
  col.getBoundingClientRect = () => ({ left: 0, right: 400, width: 400, top: 0, bottom: 0, height: 0 });
  d.getBoundingClientRect = () => ({ left: 297, width: 6, right: 303, top: 0, bottom: 0, height: 0 });
  p.page.ctx.document.querySelectorAll = () => [d];
  p.page.run('setCalendarNotesStrip(120)');
  assert.strictEqual(d.getAttribute('aria-valuenow'), '25', 'it is read from where the divider is drawn');
});

test('the divider is a focusable, labelled separator that holds the poll and keeps the selection', async () => {
  const p = await weekPage();
  const d = p.page.run("notesCalendarDivider('2026-10-15')");
  assert.strictEqual(d.tabIndex, 0);
  assert.strictEqual(d.getAttribute('role'), 'separator');
  assert.strictEqual(d.getAttribute('aria-orientation'), 'vertical');
  assert.ok(d.hasAttribute('data-holds-poll'));
  assert.ok(d.hasAttribute('data-keeps-selection'));
  assert.match(d.title, /Drag/);
  assert.match(d.title, /double-click/i);
  assert.match(d.title, /Left and Right/);
});

// --- the guards: a press on the divider is no hour click and no new card ------------------------------------

const column = (g) => ({ closest: (sel) => (sel.includes('.cal-tg-col') ? g.col : null) });
const dividerTarget = (g) => ({ closest: (sel) => (sel.includes('.cal-note-divider') ? g.divider : sel.includes('.cal-tg-col') ? g.col : null) });

test('a click on the divider does not open the palette on an hour, though a click on the empty column does', async () => {
  const run = async (target) => {
    const p = await weekPage();
    const timers = [];
    p.page.ctx.setTimeout = (fn, ms) => { timers.push(ms); return 1; };
    p.container.fire('click', { target, clientY: 100, preventDefault() {} });
    return timers;
  };
  const g = geometry();
  assert.deepStrictEqual(await run(column(g)), [300], 'the column waits out the double click');
  assert.deepStrictEqual(await run(dividerTarget(g)), [], 'the divider does not');
});

test('a double click on the divider makes no card, though a double click on the empty column does', async () => {
  const run = async (target) => {
    const p = await weekPage();
    const opened = [];
    p.page.ctx.openModal = (...args) => { opened.push(args); };
    p.container.fire('dblclick', { target, clientY: 100, preventDefault() {} });
    return opened.length;
  };
  const g = geometry();
  assert.strictEqual(await run(column(g)), 1);
  assert.strictEqual(await run(dividerTarget(g)), 0);
});
