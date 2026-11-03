const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The Calendar's notes strip in the real page (helpers/palette-page.js): the week drawn with its
// divider, the width the divider sets for every day column at once, and the guards that keep a press
// on it from being a card drag, a click on an empty hour or a double click that makes a card; and a
// note's duration drawn as a block, in lanes beside what it overlaps, in both of the strip's states. The sums
// are notes-calendar.js, tested apart; the browser runner drives the same in Chrome
// (scenarios/notes-calendar.js).

const NOTES = [
  note('2026-10-15', '7', '09:30', '@human', 'schema diff reviewed and the two enum renames are left to do'),
  note('2026-10-15', '22', '14:10', '@afk', 'cutover window agreed'),
  note('2026-10-13', '3', '11:00', '@human', 'plan drafted'),
];
const KEY = 'kanban.kanban.calendar.notesWidth';
const CSS = (px) => `max(44px, min(${px}px, calc(100% - 24px)))`;

async function weekPage({ stored = {}, container = control(), notes = NOTES } = {}) {
  const grid = control();
  const p = await openPalette({ notes, stored, elements: { '#calendar-view .cal-timegrid': grid, '#calendar-view': container } });
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

// --- a note's duration: a block on the strip ---------------------------------------------------------------

const ranged = (day, target, at, duration, text, index = 9) => ({ ...note(day, target, at, '@human', text, index), duration });
const MODE_KEY = 'kanban.kanban.calendar.notesMode';

// The week of 15 October drawn with `notes`, in Grouped Notes or in Notes ('each'); `col(day)` is a day's column.
async function weekWith(notes, mode = 'grouped') {
  const p = await weekPage({ notes, stored: mode === 'each' ? { [MODE_KEY]: 'each' } : {} });
  p.page.run("calendarAnchor = '2026-10-15'");
  const host = p.doc.createElement('div');
  p.page.ctx.__host = host;
  p.page.run("renderCalendarTimeGrid(__host, 'week', 0)");
  p.host = host;
  p.col = (day) => host.querySelectorAll('.cal-tg-col').find((c) => c.dataset.day === day);
  p.blocks = (day = '2026-10-15') => p.col(day).querySelectorAll('.cal-note-block');
  return p;
}
const words = (el) => el.textContent + el.children.map(words).join('');

test('a note at 10:30 with 1h30m is one block from the 10:30 line to the 12:00 line, in Grouped Notes and in Notes', async () => {
  for (const mode of ['grouped', 'each']) {
    const p = await weekWith([...NOTES, ranged('2026-10-15', '7', '10:30', '1h30m', 'migration rehearsal')], mode);
    const blocks = p.blocks();
    assert.strictEqual(blocks.length, 1, mode);
    assert.deepStrictEqual([blocks[0].style.top, blocks[0].style.height], ['421px', '58px'], 'the 10:30 line is 420px down and the 12:00 line 480px, less a pixel each side as a chip has');
    assert.strictEqual(words(blocks[0]), '10:30–12:00 #7 migration rehearsal', 'its times, its card and its text, spaced so the line may break between them');
    assert.strictEqual(blocks[0].title, '10:30–12:00 · #7 Port the zephyr schema\nmigration rehearsal');
    assert.strictEqual(p.col('2026-10-15').querySelectorAll('.cal-note-chip').length, 2, 'the range is no chip: the day keeps its two point notes\' chips');
    assert.ok(blocks[0].classes.includes('cal-note'), 'it is one of the notes layer\'s elements');
  }
});

test('a day with only a range keeps a strip and its divider', async () => {
  const p = await weekWith([ranged('2026-10-16', '7', '09:00', '45m', 'alone')]);
  assert.ok(p.col('2026-10-16').classes.includes('has-notes'));
  assert.strictEqual(p.col('2026-10-16').querySelectorAll('.cal-note-divider').length, 1);
  assert.strictEqual(p.blocks('2026-10-16').length, 1);
});

test('in Grouped Notes a range is counted in no chip and no bubble, and in Notes no hour grows for a range', async () => {
  const grouped = await weekWith([note('2026-10-15', '7', '10:10', '@human', 'a point'), ranged('2026-10-15', '22', '10:00', '30m', 'a range', 1), ranged('2026-10-15', '3', '10:20', '15m', 'another', 2)]);
  assert.strictEqual(grouped.col('2026-10-15').querySelectorAll('.cal-note-bubble').length, 0, 'three notes in the half hour, one of them a point: a chip, not a bubble');
  assert.strictEqual(grouped.col('2026-10-15').querySelectorAll('.cal-note-chip').length, 1);
  assert.strictEqual(grouped.blocks().length, 2);
  const three = [0, 1, 2].map((i) => ranged('2026-10-15', '7', `10:${i}5`, '30m', `range ${i}`, i));
  const each = await weekWith(three, 'each');
  assert.strictEqual(each.col('2026-10-15').style.height, '960px', 'three ranges in hour 10 and every hour is still 40px');
  const points = await weekWith(three.map((n) => ({ ...n, duration: null })), 'each');
  assert.strictEqual(points.col('2026-10-15').style.height, '980px', 'where three point notes grow it by a row');
});

test('two overlapping ranges, and a range with a point note inside it, are drawn side by side', async () => {
  const notes = [ranged('2026-10-15', '7', '10:00', '1h', 'first'), ranged('2026-10-15', '22', '10:30', '1h', 'second', 1), note('2026-10-15', '3', '10:40', '@human', 'inside', 2), note('2026-10-15', '3', '14:10', '@human', 'clear', 3)];
  const lane = (el) => [el.style.right, el.style.width];
  const share = (i, of) => [`calc(${i} * var(--cal-note-strip) / ${of} + 2px)`, `calc(var(--cal-note-strip) / ${of} - 4px)`];
  const grouped = await weekWith(notes);
  const [first, second] = grouped.blocks();
  const chips = grouped.col('2026-10-15').querySelectorAll('.cal-note-chip');
  assert.deepStrictEqual(lane(first), share(2, 3), 'the first block is the leftmost of three lanes');
  assert.deepStrictEqual(lane(second), share(1, 3), 'the second beside it');
  assert.deepStrictEqual(lane(chips[0]), share(0, 3), 'the half hour of 10:30, inside both, on the right');
  assert.deepStrictEqual(lane(chips[1]), [undefined, undefined], 'a chip clear of every range keeps the stylesheet\'s whole width');
  const each = await weekWith(notes, 'each');
  const [eFirst, eSecond] = each.blocks();
  const eChips = each.col('2026-10-15').querySelectorAll('.cal-note-chip');
  assert.deepStrictEqual(lane(eFirst), share(1, 2), 'in Notes the first block is the left of two lanes');
  assert.deepStrictEqual(lane(eChips[0]), share(0, 2), 'the chip on its hour line beside it');
  assert.deepStrictEqual(lane(eSecond), share(0, 2), 'and the second block under that chip, in its lane');
  assert.deepStrictEqual(lane(eChips[1]), [undefined, undefined]);
});

test('a note with a duration and no time is listed in the day\'s untimed box with its length before its text', async () => {
  const p = await weekWith([ranged('2026-10-14', '7', null, '45m', 'reviews'), note('2026-10-14', '3', null, '@human', 'kickoff', 1)]);
  const boxes = p.host.querySelectorAll('.cal-tg-allday .cal-note-untimed');
  assert.strictEqual(boxes.length, 1);
  assert.strictEqual(boxes[0].dataset.untimed, '2026-10-14');
  assert.strictEqual(words(boxes[0]), '2 untimed');
  assert.strictEqual(boxes[0].title, '#7: 45m reviews\n#3: kickoff');
  assert.strictEqual(p.blocks('2026-10-14').length, 0, 'and it is no block');
});

test('a 5-minute range is at least as tall as a chip', async () => {
  const p = await weekWith([ranged('2026-10-15', '7', '16:05', '5m', 'quick')]);
  assert.strictEqual(p.blocks()[0].style.height, '18px', 'a chip is 18px in its 20px row');
});

test('with no range the strip is drawn as before: no block and no lane', async () => {
  for (const mode of ['grouped', 'each']) {
    const p = await weekWith(NOTES, mode);
    assert.strictEqual(p.blocks().length, 0);
    for (const el of p.col('2026-10-15').querySelectorAll('.cal-note')) assert.deepStrictEqual([el.style.right, el.style.width], [undefined, undefined]);
  }
});

test('a click on a block opens what a click on that note\'s chip opens: its card at its time, or for no card its half hour', async () => {
  const clicked = async (notes, sel) => {
    const p = await weekWith(notes);
    const opened = [];
    p.page.ctx.openNotes = (req) => { opened.push(req); };
    p.col('2026-10-15').querySelector(sel).click();
    return JSON.parse(JSON.stringify(opened)); // each page is its own VM, with its own Object
  };
  for (const target of ['7', '']) {
    const asBlock = await clicked([ranged('2026-10-15', target, '10:40', '45m', 'work')], '.cal-note-block');
    const asChip = await clicked([note('2026-10-15', target, '10:40', '@human', 'work')], '.cal-note-chip');
    assert.strictEqual(asBlock.length, 1);
    assert.deepStrictEqual(asBlock, asChip, target ? 'a card' : 'no card');
  }
});

test('a press on a block starts no card drag, a click on it is no click on an empty hour, and a double click on it makes no card', async () => {
  const p = await weekWith([ranged('2026-10-15', '7', '10:30', '1h30m', 'work')]);
  const block = p.blocks()[0];
  const e = ev({ target: block, clientY: 440 });
  p.container.fire('pointerdown', e);
  assert.strictEqual(p.page.run('calTimeDrag'), null);
  assert.strictEqual(p.page.run('isDragging'), false);
  const timers = [];
  p.page.ctx.setTimeout = (fn, ms) => { timers.push(ms); return 1; };
  p.container.fire('click', e);
  assert.deepStrictEqual(timers, [], 'no palette opens on the hour under it');
  const made = [];
  p.page.ctx.openModal = (...args) => { made.push(args); };
  p.container.fire('dblclick', e);
  assert.strictEqual(made.length, 0);
});

// --- a drag moves a note ------------------------------------------------------------------------------------

// The week of 15 October laid out in 100px columns (Monday 12th at x 0 to Sunday 18th at x 600), the plain
// 40px hour (1.5 minutes a pixel), the page's api, board load, toast and redraw replaced by recorders.
async function dragPage(notes, mode = 'grouped') {
  const p = await weekWith(notes, mode);
  const cols = p.host.querySelectorAll('.cal-tg-col');
  cols.forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, top: 0, bottom: 960, width: 100, height: 960 }); });
  p.container.querySelectorAll = (sel) => (sel === '.cal-tg-col' ? cols : []);
  p.calls = [];
  p.toasts = [];
  p.redraws = 0;
  p.reject = null;
  p.page.ctx.api = async (method, url, body) => {
    p.calls.push({ method, url, body: JSON.parse(JSON.stringify(body)) });
    if (p.reject) throw new Error(p.reject);
    return {};
  };
  p.page.ctx.loadBoard = async () => {};
  p.page.ctx.toast = (m) => { p.toasts.push(m); };
  p.page.ctx.renderCalendarView = () => { p.redraws++; };
  p.press = (el, x, y) => { el.setPointerCapture = (id) => { el.captured = id; }; p.container.fire('pointerdown', ev({ target: el, clientX: x, clientY: y })); };
  p.move = (x, y) => p.container.fire('pointermove', ev({ clientX: x, clientY: y }));
  p.release = async (x, y) => { p.container.fire('pointerup', ev({ clientX: x, clientY: y })); await p.page.settle(); };
  p.drag = async (el, from, to) => { p.press(el, ...from); p.move(...to); await p.release(...to); };
  p.ref = (n) => ({ day: n.day, target: n.target, index: n.index, file: n.file, expect: { at: n.at, duration: n.duration || null, by: n.by, note: n.note } });
  return p;
}
test('a block dragged down 60px, 90 minutes, is written as one PATCH holding the note\'s ref and its new time', async () => {
  const block = ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4);
  for (const mode of ['grouped', 'each']) {
    const p = await dragPage([block], mode);
    await p.drag(p.blocks()[0], [350, 430], [350, 490]);
    assert.deepStrictEqual(p.calls, [{ method: 'PATCH', url: '/api/notes', body: { ref: p.ref(block), at: '12:00' } }], mode);
  }
});

test('a move keeps the point where the note was grabbed, taken from the note\'s own time and not from where its chip sits', async () => {
  const early = note('2026-10-15', '22', '10:20', '@afk', 'a chip', 5);
  for (const mode of ['grouped', 'each']) {
    const p = await dragPage([early], mode);
    await p.drag(p.col('2026-10-15').querySelector('.cal-note-chip'), [350, 5], [350, 45]);
    assert.deepStrictEqual(p.calls.map((c) => c.body.at), ['11:15'], `pressed at 00:07 and let go at 01:07: 10:20 + 60 minutes, then onto the 15-minute grid (${mode})`);
  }
});

test('a move to the column under the pointer sends the day with the time, and a chip moves like a block', async () => {
  const chip = note('2026-10-15', '22', '14:10', '@afk', 'cutover window agreed', 6);
  const p = await dragPage([chip]);
  await p.drag(p.col('2026-10-15').querySelector('.cal-note-chip'), [350, 100], [550, 100]);
  assert.deepStrictEqual(p.calls.map((c) => c.body), [{ ref: p.ref(chip), day: '2026-10-17', at: '14:15' }], 'two columns right at the same height: 14:10 snaps to 14:15, the day follows');
});

test('a drag that ends where it started writes nothing, and a drag still swallows the click after it', async () => {
  const block = ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4);
  const p = await dragPage([block]);
  p.press(p.blocks()[0], 350, 430);
  p.move(350, 470);
  p.move(350, 430);
  await p.release(350, 430);
  assert.deepStrictEqual(p.calls, []);
  assert.strictEqual(p.page.run('calTimeClickSuppressed'), true, 'the click that follows is swallowed, as after a card\'s drag');
});

test('a press that moves 3px or less is a click: nothing is written, the click opens the note and is not swallowed', async () => {
  const block = ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4);
  const p = await dragPage([block]);
  const opened = [];
  p.page.ctx.openNotes = (req) => { opened.push(req); };
  p.press(p.blocks()[0], 350, 430);
  assert.strictEqual(p.page.run('isDragging'), true, 'the poll waits from the press');
  p.move(352, 432);
  await p.release(352, 432);
  p.blocks()[0].click();
  assert.deepStrictEqual([p.calls.length, opened.length, p.page.run('calTimeClickSuppressed'), p.page.run('isDragging')], [0, 1, false, false]);
});

test('a bubble and the untimed box start no drag, and neither does a press that is not a left button', async () => {
  const p = await dragPage([note('2026-10-15', '7', '10:00', '@human', 'one', 1), note('2026-10-15', '22', '10:10', '@afk', 'two', 2), note('2026-10-14', '3', null, '@human', 'no time', 3), ranged('2026-10-16', '7', '09:00', '1h', 'range', 4)]);
  const bubble = p.col('2026-10-15').querySelector('.cal-note-bubble');
  assert.ok(bubble);
  p.press(bubble, 350, 400);
  assert.strictEqual(p.page.run('isDragging'), false);
  p.move(350, 460);
  await p.release(350, 460);
  const untimed = p.host.querySelectorAll('.cal-tg-allday .cal-note-untimed')[0];
  p.press(untimed, 250, 10);
  assert.strictEqual(p.page.run('isDragging'), false);
  p.container.fire('pointerdown', ev({ target: p.blocks('2026-10-16')[0], button: 2, clientX: 450, clientY: 390 }));
  assert.strictEqual(p.page.run('isDragging'), false);
  assert.deepStrictEqual(p.calls, []);
});

test('while a note is dragged the poll is held, and the empty-hour click, the double click and the context menu stand aside', async () => {
  const block = ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4);
  const p = await dragPage([block]);
  let release;
  p.page.ctx.api = (method, url, body) => new Promise((resolve) => { release = () => resolve({}); p.calls.push({ method, url, body }); });
  p.press(p.blocks()[0], 350, 430);
  p.move(350, 490);
  assert.strictEqual(p.page.run('isDragging'), true);
  const timers = [];
  p.page.ctx.setTimeout = (fn, ms) => { timers.push(ms); return 1; };
  const made = [];
  p.page.ctx.openModal = (...args) => { made.push(args); };
  const empty = ev({ target: p.col('2026-10-15'), clientY: 100 });
  p.container.fire('click', empty);
  p.container.fire('dblclick', empty);
  assert.deepStrictEqual([timers.length, made.length], [0, 0]);
  const e = p.page.fireDocument('contextmenu', { target: { closest: () => null }, clientX: 0, clientY: 0 });
  assert.strictEqual(e.defaultPrevented, false, 'the card menu does not open under a drag');
  p.container.fire('pointerup', ev({ clientX: 350, clientY: 490 }));
  assert.deepStrictEqual([p.page.run('isDragging'), p.page.run('pendingDrops')], [false, 1], 'the write holds the poll until it answers');
  release();
  await p.page.settle();
  assert.strictEqual(p.page.run('pendingDrops'), 0);
});

test('a refusal redraws the Calendar and says Move failed with the server\'s message', async () => {
  const block = ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4);
  const p = await dragPage([block]);
  p.reject = 'That note has changed or is gone; reload and try again.';
  await p.drag(p.blocks()[0], [350, 430], [350, 490]);
  assert.deepStrictEqual(p.toasts, ['Move failed: That note has changed or is gone; reload and try again.']);
  assert.strictEqual(p.redraws, 1);
  assert.strictEqual(p.page.run('pendingDrops'), 0);
});

test('a cancelled press writes nothing, the preview follows the pointer and is cleared on release, and a move stays inside the day', async () => {
  const block = ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4);
  const p = await dragPage([block]);
  const el = p.blocks()[0];
  p.press(el, 350, 430);
  p.move(450, 490);
  assert.strictEqual(el.style.transform, 'translate(100px, 60px)', 'a column right and 90 minutes down, the 40px hour');
  assert.ok(el.classes.includes('dragging'));
  p.container.fire('pointercancel', ev({}));
  assert.deepStrictEqual([el.style.transform, el.classes.includes('dragging'), p.page.run('isDragging'), p.calls.length], ['', false, false, 0]);
  await p.drag(el, [350, 430], [350, 5000]);
  assert.deepStrictEqual(p.calls.map((c) => c.body.at), ['23:00'], 'let go below the grid: a range of an hour ends at midnight');
});

test('a note that is no longer on the board starts no drag', async () => {
  const p = await dragPage([ranged('2026-10-15', '7', '10:30', '1h', 'rehearsal', 4)]);
  const el = p.blocks()[0];
  el.dataset.noteIndex = '99';
  p.press(el, 350, 430);
  assert.strictEqual(p.page.run('isDragging'), false);
});

test('the notes that can move are the chips and blocks, and the stylesheet lets a finger drag them at once', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8');
  const rule = css.split('\n').find((l) => /^\.cal-note-chip, \.cal-note-block \{/.test(l));
  assert.ok(rule && /touch-action: none/.test(rule), 'chips and blocks get touch-action: none');
  assert.ok(!/\.cal-note-bubble|\.cal-note-untimed/.test(rule), 'a bubble and the untimed box do not');
});
