const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette, note, card } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The card picker and the date range of the notes palette, in the real page (helpers/palette-page.js).
// The rules are notes.js, tested apart (notes-range.test.js); the browser runner drives the same in
// Chrome (scenarios/notes.js, scenarios/notes-calendar.js). 2026-10-21 is a Wednesday.

const WEB = path.join(__dirname, '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

const NOTES = [
  note('2026-10-14', '7', '09:10', '@human', 'a seven wed'),
  note('2026-10-19', '7', '10:00', '@afk', 'b seven mon'),
  note('2026-10-21', '22', '09:40', '@human', 'c twenty-two wed'),
  note('2026-10-21', '', null, '@human', 'd free wed'),
  note('2026-10-22', '7', '10:20', '@human', 'e seven thu'),
  note('2026-10-30', '7', '08:00', '@human', 'f seven fri'),
];
const CARDS = [card(3, 'Write the cutover plan'), card(7, 'Port the zephyr schema'), card(22, 'Cut over the data layer'), card(41, 'Archive the old logbook')];

async function open(extra = {}) {
  const quiet = { '.modal-backdrop:not(.hidden)': null, '.modal-backdrop:not(.hidden):not(#detail-modal)': null };
  const p = await openPalette({ notes: NOTES.map((n) => ({ ...n })), cards: CARDS, ...extra, elements: { ...quiet, ...(extra.elements || {}) } });
  p.calls = [];
  const realFetch = p.page.ctx.fetch;
  p.page.ctx.fetch = async (url, opts = {}) => {
    if (opts.method && opts.method !== 'GET') {
      const body = JSON.parse(opts.body);
      p.calls.push({ method: opts.method, url, body });
      const made = { day: body.day, target: body.target, at: body.at || null, by: '@human', note: body.note, index: 0, file: 'f' };
      p.board.logbook.notes.push(made);
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ note: made }) };
    }
    return realFetch(url, opts);
  };
  p.today = p.page.run('localTodayStr()');
  p.settle = () => p.page.settle();
  p.openCard = (id, day = '2026-10-21') => p.page.run(`openNotes({ kind: 'card-notes', id: '${id}', day: '${day}' })`);
  p.rangeBtn = (mode) => p.find(`.np-range-slot .np-by-btn[data-range="${mode}"]`);
  p.pressed = () => p.all('.np-range-slot .np-by-btn').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.range);
  p.label = () => p.text(p.find('.np-range-label'));
  p.step = (dir) => p.find(`.np-range-step[data-step="${dir}"]`);
  p.listed = () => p.rows().map((r) => r.split(' ')[0]);
  p.pickMenu = () => p.doc.body.querySelector('.np-pick-menu');
  p.menuItems = () => p.pickMenu().children.map((c) => p.text(c));
  p.focusPick = () => { p.ui().pick.focus(); p.ui().pick.fire('focus', {}); };
  p.choose = (text) => {
    const item = p.pickMenu().children.find((c) => p.text(c) === text);
    assert.ok(item, `the menu offers ${text}`);
    item.fire('mousedown', { preventDefault() {} });
  };
  return p;
}
const setBox = (p, text) => { p.ui().input.value = text; p.ui().input.fire('input', {}); p.ui().input.focus(); };

// --- the card picker ----------------------------------------------------------------------------------

test('the picker shows the card the palette is about, as the chip names it', async () => {
  const p = await open();
  p.openCard('7');
  assert.strictEqual(p.ui().pick.value, '#7 Port the zephyr schema');
});

test('on several cards the picker reads how many', async () => {
  const p = await open();
  p.page.run("openNotes({ targets: ['3', '7', '22'] })");
  assert.strictEqual(p.ui().pick.value, '3 cards');
});

test('with nothing aimed at, the picker shows the card Enter would write on, the card last noted, else no card', async () => {
  const p = await open({ stored: { 'kanban.kanban.lastnoted': '22' } });
  p.page.run('openNotes({})');
  assert.strictEqual(p.ui().pick.value, '#22 Cut over the data layer');
  const q = await open();
  q.page.run('openNotes({})');
  assert.strictEqual(q.ui().pick.value, 'no card');
});

test('focusing the picker lists no card and then the live cards, in id order', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  assert.deepStrictEqual(p.menuItems(), ['no card', '#3 Write the cutover plan', '#7 Port the zephyr schema', '#22 Cut over the data layer', '#41 Archive the old logbook']);
});

test('typing in the picker narrows the list by the card\'s id or its title', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  p.ui().pick.value = 'cut';
  p.ui().pick.fire('input', { isTrusted: true });
  assert.deepStrictEqual(p.menuItems(), ['#3 Write the cutover plan', '#22 Cut over the data layer']);
  p.ui().pick.value = '#22';
  p.ui().pick.fire('input', { isTrusted: true });
  assert.deepStrictEqual(p.menuItems(), ['#22 Cut over the data layer']);
});

test('typing in the picker aims nothing until a card is chosen', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  p.ui().pick.value = 'cut';
  p.ui().pick.fire('input', { isTrusted: true });
  assert.strictEqual(p.page.run('notesUi.sub.id'), '7');
});

test('choosing a card aims the palette at it, as a bare mention and Enter does, and keeps what was typed', async () => {
  const p = await open();
  p.openCard('7');
  setBox(p, 'half a thought');
  p.focusPick();
  p.choose('#22 Cut over the data layer');
  assert.strictEqual(p.page.run('notesUi.sub.id'), '22');
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'card');
  assert.strictEqual(p.ui().input.value, 'half a thought', 'the note box is not cleared');
  assert.strictEqual(p.ui().pick.value, '#22 Cut over the data layer', 'the field names the card, not its id');
  assert.match(p.text(p.find('.np-chip-text')), /^#22 Cut over the data layer/);
  assert.match(p.text(p.find('.np-prev-text')), /on #22 Cut over the data layer/);
  assert.deepStrictEqual(p.listed().filter((x) => x === 'c'), ['c'], 'the list is that card\'s');
});

test('a bare mention and Enter aims the same way, so the picker and the line agree', async () => {
  const p = await open();
  p.openCard('7');
  setBox(p, '#22');
  p.press(p.ui().input, 'Enter');
  assert.strictEqual(p.page.run('notesUi.sub.id'), '22');
  assert.strictEqual(p.ui().pick.value, '#22 Cut over the data layer');
});

test('choosing no card writes a note about nothing, whatever card was last noted', async () => {
  const p = await open({ stored: { 'kanban.kanban.lastnoted': '22' } });
  p.openCard('7');
  p.focusPick();
  p.choose('no card');
  assert.strictEqual(p.ui().pick.value, 'no card');
  setBox(p, 'about nothing');
  assert.match(p.text(p.find('.np-prev-text')), /on no card/);
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => [c.body.target, c.body.note]), [['', 'about nothing']]);
});

test('on several cards, choosing one makes it the single target', async () => {
  const p = await open();
  p.page.run("openNotes({ targets: ['3', '7'] })");
  p.focusPick();
  p.choose('#22 Cut over the data layer');
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'card');
  setBox(p, 'one card now');
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => c.body.target), ['22']);
});

test('a card typed at the start of the note wins over the picker, and the preview says which card', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  p.choose('#22 Cut over the data layer');
  setBox(p, '#3 from the line');
  assert.match(p.text(p.find('.np-prev-text')), /on #3 Write the cutover plan/);
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => [c.body.target, c.body.note]), [['3', 'from the line']]);
  assert.strictEqual(p.ui().pick.value, '#22 Cut over the data layer', 'the picker still shows the card the palette is on');
});

test('leaving the picker puts the card back in it, so a half-typed search does not stay', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  p.ui().pick.value = 'cut';
  p.ui().pick.fire('input', { isTrusted: true });
  p.ui().pick.fire('blur', {});
  assert.strictEqual(p.ui().pick.value, '#7 Port the zephyr schema');
});

test('a board refresh does not paint over a search being typed in the picker', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  p.ui().pick.value = 'cu';
  p.page.run('notesOnBoard()');
  assert.strictEqual(p.ui().pick.value, 'cu');
});

test('choosing a card from an hour keeps the hour\'s time and day, as the bare mention does', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 })");
  p.focusPick();
  p.choose('#22 Cut over the data layer');
  assert.strictEqual(p.ui().time.value, '09:00');
  assert.strictEqual(p.ui().date.value, '2026-10-14');
});

test('the picker is a card field: its menu is the form\'s combobox, and the field has a style of its own', async () => {
  const p = await open();
  p.openCard('7');
  assert.ok(p.pickMenu().classes.includes('combobox-menu'));
  assert.match(css, /^\.np-pick-input \{/m);
});

test('the menu hangs off the page, fixed under the field, so the palette\'s edge never clips it', async () => {
  const p = await open();
  p.openCard('7');
  assert.strictEqual(p.pickMenu().parent.uid, p.doc.body.uid, 'a child of the page, not of the palette');
  assert.ok(!p.pal().contains(p.pickMenu()));
  assert.match(css, /^\.combobox-menu\.np-pick-menu \{[^}]*position: fixed;/m);
  p.ui().pick.getBoundingClientRect = () => ({ left: 300, right: 460, top: 100, bottom: 126, width: 160, height: 26 });
  p.focusPick();
  assert.deepStrictEqual([p.pickMenu().style.left, p.pickMenu().style.top], ['300px', '128px']);
});

test('the menu opens above the field when there is no room under it', async () => {
  const p = await open({ viewport: { innerHeight: 400 } });
  p.openCard('7');
  p.ui().pick.getBoundingClientRect = () => ({ left: 300, right: 460, top: 300, bottom: 326, width: 160, height: 26 });
  p.pickMenu().getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 180 });
  p.focusPick();
  assert.strictEqual(p.pickMenu().style.top, '118px');
});

test('a press on the menu is a press in the palette: it stays up', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  const item = p.pickMenu().children[2];
  p.page.fireDocument('mousedown', { target: item });
  assert.notStrictEqual(p.page.run('notesUi.sub'), null);
  p.page.fireDocument('mousedown', { target: p.doc.createElement('div') });
  assert.strictEqual(p.page.run('notesUi.sub'), null, 'a press anywhere else still closes it');
});

// --- Esc clears the chip before it closes the palette -------------------------------------------------------------

const bubbled = (p, from) => { const e = { key: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: from, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }; for (let at = from; at && !e.stopped; at = at.parent) at.fire('keydown', e); return e; };
const esc = (p, from) => bubbled(p, from || p.ui().input);
const footHint = (p, key) => { const kbd = p.ui().foot.querySelectorAll('kbd').find((k) => p.text(k) === key); return kbd && p.text(kbd.parent).replace(p.text(kbd), '').trim(); };

test('Esc on a palette aimed at a card clears the chip, as the backspace does, and keeps the palette open', async () => {
  const p = await open();
  p.openCard('7');
  setBox(p, 'half a thought');
  const e = esc(p);
  assert.strictEqual(e.stopped, true);
  assert.notStrictEqual(p.page.run('notesUi.sub'), null, 'still open');
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'none');
  assert.ok(p.find('.np-chip').hidden, 'no chip shows');
  assert.strictEqual(p.ui().input.value, 'half a thought', 'the box is as it was');
  assert.deepStrictEqual(p.pressed(), ['day'], 'the range is the opening rule\'s with no card');
});

test('the same Esc on several cards clears the chip (a group is a target of the same kind: noteIsAboutCards)', async () => {
  const p = await open();
  p.page.run("openNotes({ targets: ['3', '7'] })");
  esc(p);
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'none');
  assert.notStrictEqual(p.page.run('notesUi.sub'), null);
  p.page.run("notesUi.sub = { kind: 'group', id: 'I2', day: localTodayStr() }; notesPaint = notesPaint");
  assert.strictEqual(p.page.run('notesChipClearable()'), true);
});

test('with no chip showing Esc closes the palette', async () => {
  const p = await open();
  p.openCard('7');
  esc(p);
  esc(p);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
  const q = await open();
  q.page.run('openNotes({})');
  esc(q);
  assert.strictEqual(q.page.run('notesUi.sub'), null, 'a palette aimed at nothing closes at once');
});

test('an hour\'s chip is not cleared by Esc: Esc closes', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-21', fromMin: 540, toMin: 600 })");
  esc(p);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
});

test('Esc in the filter field closes the palette at once, chip or not', async () => {
  const p = await open();
  p.openCard('7');
  assert.strictEqual(bubbled(p, p.ui().filter).stopped, true);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
});

test('Esc in a note\'s edit form cancels the edit first, and then clears the chip', async () => {
  const p = await open();
  p.openCard('7');
  p.press(p.ui().body, 'e', { target: p.all('.np-note')[0] });
  assert.strictEqual(p.all('.np-edit-text').length, 1);
  p.find('.np-edit').fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(p.all('.np-edit-text').length, 0);
  assert.strictEqual(p.page.run('notesUi.sub.id'), '7', 'the chip is still there');
  esc(p, p.ui().body);
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'none');
});

test('on the Calendar the cleared chip goes back to the Calendar\'s range', async () => {
  const p = await open();
  onCalendar(p);
  p.openCard('7');
  esc(p);
  assert.deepStrictEqual(p.pressed(), ['week']);
});

test('Esc on a group\'s own tabs closes the palette: there is no chip to clear there', async () => {
  const p = await open({ scratchpad: { folder: 'scratch', targets: [] } });
  p.page.run("scratchPanel = () => document.createElement('div')");
  p.openCard('7');
  p.page.run("notesSetTab('scratch')");
  esc(p, p.pal());
  assert.strictEqual(p.page.run('notesUi.sub'), null);
});

test('the footer reads Esc as clear the chip while a chip shows, and close otherwise', async () => {
  const p = await open();
  p.openCard('7');
  assert.strictEqual(footHint(p, 'Esc'), 'clear the chip');
  esc(p);
  assert.strictEqual(footHint(p, 'Esc'), 'close');
});

// --- a closed palette ----------------------------------------------------------------------------------------

test('a closed palette never throws: a stray input, Enter or write finds no subject and does nothing', async () => {
  const p = await open();
  p.openCard('7');
  p.page.run('notesClose()');
  assert.doesNotThrow(() => {
    p.ui().input.fire('input', {});
    p.ui().date.fire('input', {});
    p.ui().time.fire('input', {});
    p.ui().untimed.fire('change', {});
    p.press(p.ui().input, 'Enter');
    p.press(p.ui().pick, 'Enter');
    p.ui().pick.fire('blur', {});
  });
  await p.page.run('notesWrite()');
  assert.deepStrictEqual(p.calls, []);
});

// --- free text in the picker -----------------------------------------------------------------------------------

const typePick = (p, text) => { p.ui().pick.value = text; p.ui().pick.fire('input', { isTrusted: true }); };

test('a card id typed in the picker aims the palette on Enter, as picking it does', async () => {
  const p = await open();
  p.openCard('7');
  setBox(p, 'kept');
  p.focusPick();
  typePick(p, '22');
  p.press(p.ui().pick, 'Enter');
  assert.strictEqual(p.page.run('notesUi.sub.id'), '22');
  assert.strictEqual(p.ui().pick.value, '#22 Cut over the data layer');
  assert.strictEqual(p.ui().input.value, 'kept');
  assert.deepStrictEqual(p.pressed(), ['all']);
});

test('so does #22, on leaving the field', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  typePick(p, '#22');
  p.ui().pick.fire('blur', {});
  assert.strictEqual(p.page.run('notesUi.sub.id'), '22');
});

test('an id that names no card is not a target: the field goes back to the card it had', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  typePick(p, '999');
  p.press(p.ui().pick, 'Enter');
  assert.strictEqual(p.page.run('notesUi.sub.id'), '7');
  assert.strictEqual(p.ui().pick.value, '#7 Port the zephyr schema');
  typePick(p, 'cut');
  p.ui().pick.fire('blur', {});
  assert.strictEqual(p.ui().pick.value, '#7 Port the zephyr schema', 'a search word is not an id either');
});

test('Enter on a highlighted menu row aims once, and the typed text does not aim a second time', async () => {
  const p = await open();
  p.openCard('7');
  p.focusPick();
  typePick(p, 'cut');
  p.press(p.ui().pick, 'ArrowDown');
  p.press(p.ui().pick, 'Enter');
  assert.strictEqual(p.page.run('notesUi.sub.id'), '3');
});

test('the card picker\'s choice reaches the palette through the combobox\'s own hook, not an input event', async () => {
  const src = fs.readFileSync(path.join(WEB, 'notes-palette.js'), 'utf8');
  assert.match(src, /attachCombobox\(u\.pick, notesPickOptions, \{ onPick: notesPicked \}\)/);
  assert.ok(!/isTrusted/.test(src));
  assert.match(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), /if \(opts\.onPick\) opts\.onPick\(choice\);/);
});

// --- the range control -------------------------------------------------------------------------------

test('the range row holds All, Month, Week, 3 days and Day, then previous, the label and next', async () => {
  const p = await open();
  p.openCard('7');
  assert.deepStrictEqual(p.all('.np-range-slot .np-by-btn').map((b) => p.text(b)), ['All', 'Month', 'Week', '3 days', 'Day']);
  assert.deepStrictEqual(p.find('.np-range-row').children.map((c) => c.classes.includes('np-range-slot') ? 'modes' : c.classes.includes('np-range-label') ? 'label' : c.classes.includes('np-range-live') ? 'live' : `step ${c.dataset.step}`), ['modes', 'step -1', 'label', 'step 1', 'live']);
  assert.deepStrictEqual(p.all('.np-range-step').map((b) => p.text(b)), ['‹', '›']);
});

test('a card opens on All and lists every one of its notes, whatever the day', async () => {
  const p = await open();
  p.openCard('7');
  assert.deepStrictEqual(p.pressed(), ['all']);
  assert.deepStrictEqual(p.listed().slice().sort(), ['a', 'b', 'e', 'f']);
});

test('the label button says it goes back to today, in its title and its name', async () => {
  const p = await open();
  p.openCard('7');
  const label = p.find('.np-range-label');
  assert.strictEqual(label.title, 'Back to today');
  assert.strictEqual(label.getAttribute('aria-label'), 'Back to today');
});

test('a change of range is announced politely: the range and how many notes it lists', async () => {
  const p = await open();
  p.openCard('7');
  const live = p.find('.np-range-live');
  assert.strictEqual(live.getAttribute('role'), 'status');
  assert.strictEqual(live.getAttribute('aria-live'), 'polite');
  assert.strictEqual(p.text(live), '', 'nothing is announced for the opening');
  p.rangeBtn('week').click();
  assert.strictEqual(p.text(live), '19–25 Oct: 2 notes');
  p.step(-1).click();
  assert.strictEqual(p.text(live), '12–18 Oct: 1 note');
  p.step(1).click();
  p.step(1).click();
  p.step(1).click();
  assert.strictEqual(p.text(live), '2–8 Nov: no notes');
  assert.match(css, /^\.np-range-live \{[^}]*clip:/m);
});

test('All has nothing to step and no label to go back by', async () => {
  const p = await open();
  p.openCard('7');
  assert.strictEqual(p.step(-1).disabled, true);
  assert.strictEqual(p.step(1).disabled, true);
  assert.strictEqual(p.find('.np-range-label').disabled, true);
  assert.strictEqual(p.label(), 'All dates');
});

test('a card on Week lists that card\'s notes from that week, and the buttons step the week', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('week').click();
  assert.deepStrictEqual(p.pressed(), ['week']);
  assert.strictEqual(p.label(), '19–25 Oct');
  assert.deepStrictEqual(p.listed().slice().sort(), ['b', 'e']);
  p.step(-1).click();
  assert.strictEqual(p.label(), '12–18 Oct');
  assert.deepStrictEqual(p.listed(), ['a']);
  p.step(1).click();
  p.step(1).click();
  p.step(1).click();
  assert.strictEqual(p.label(), '2–8 Nov');
  assert.deepStrictEqual(p.listed(), []);
  assert.match(p.text(p.find('.np-empty')), /No notes in 2–8 Nov yet\./);
});

test('Day, 3 days and Month list what they span', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('day').click();
  assert.strictEqual(p.label(), 'Wed 21 Oct');
  assert.deepStrictEqual(p.listed(), []);
  p.step(1).click();
  assert.strictEqual(p.label(), 'Thu 22 Oct');
  assert.deepStrictEqual(p.listed(), ['e']);
  p.rangeBtn('3day').click();
  assert.strictEqual(p.label(), '22–24 Oct');
  assert.deepStrictEqual(p.listed(), ['e']);
  p.rangeBtn('month').click();
  assert.strictEqual(p.label(), 'October 2026');
  assert.deepStrictEqual(p.listed().slice().sort(), ['a', 'b', 'e', 'f']);
});

test('a click on the label goes back to the range that holds today', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('week').click();
  p.step(-1).click();
  p.find('.np-range-label').click();
  assert.strictEqual(p.label(), p.page.run(`noteRangeLabel('week', '${p.today}')`));
  p.rangeBtn('day').click();
  p.step(-1).click();
  p.find('.np-range-label').click();
  assert.strictEqual(p.label(), p.page.run(`noteRangeLabel('day', '${p.today}')`));
});

test('the range follows the filter, the author switch and the layout', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('week').click();
  p.find('.np-by-btn[data-by="ai"]').click();
  assert.deepStrictEqual(p.listed(), ['b']);
  p.find('.np-by-btn[data-by="all"]').click();
  p.find('.np-by-btn[data-layout="timeline"]').click();
  assert.deepStrictEqual(p.listed().slice().sort(), ['b', 'e']);
  assert.strictEqual(p.all('.np-tgroup').length, 2);
  p.step(-1).click();
  assert.deepStrictEqual(p.listed(), ['a']);
});

test('day lines show whenever more than one day is listed', async () => {
  const p = await open();
  // The fixture's days are fixed and the clock is not, so a fixture day that is today wears its mark.
  const dayLine = (iso, text) => (iso === p.today ? `${text} · today` : text);
  p.openCard('7');
  p.rangeBtn('week').click();
  assert.deepStrictEqual(p.all('.np-nday').map((d) => p.text(d)), [dayLine('2026-10-22', 'Thu 22'), dayLine('2026-10-19', 'Mon 19')]);
  p.rangeBtn('day').click();
  p.step(-1).click();
  p.step(-1).click();
  assert.deepStrictEqual(p.all('.np-nday').map((d) => p.text(d)), ['Mon 19'], 'a day that is not today is still named');
});

test('the range is set each time the palette opens and is not remembered', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('week').click();
  p.page.run('notesClose()');
  p.openCard('7');
  assert.deepStrictEqual(p.pressed(), ['all']);
  p.page.run('openNotes({})');
  assert.deepStrictEqual(p.pressed(), ['day']);
  p.rangeBtn('week').click();
  p.page.run('notesClose()');
  p.page.run('openNotes({})');
  assert.deepStrictEqual(p.pressed(), ['day']);
});

test('the range never changes the day a note is written to', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('week').click();
  p.step(-1).click();
  setBox(p, 'written in a range');
  p.ui().date.value = '2026-10-20';
  p.ui().date.fire('input', {});
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => c.body.day), ['2026-10-20']);
});

test('a note written to a day outside the range stays listed, as one written past a filter does', async () => {
  const p = await open();
  p.openCard('7');
  p.rangeBtn('week').click();
  p.ui().date.value = '2026-11-20';
  p.ui().date.fire('input', {});
  setBox(p, 'far away');
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.ok(p.rows().includes('far away'));
});

// --- n with nothing aimed at ------------------------------------------------------------------------------

const keyN = (p) => p.page.ctx.onNotesKey({ key: 'n', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() {} });

test('n with no card, outside the Calendar, opens on Day, today', async () => {
  const p = await open();
  keyN(p);
  assert.deepStrictEqual(p.pressed(), ['day']);
  assert.strictEqual(p.label(), p.page.run(`noteRangeLabel('day', '${p.today}')`));
});

test('n on the Calendar opens on the Calendar\'s own mode and visible range', async () => {
  for (const [subview, mode] of [['month', 'month'], ['week', 'week'], ['3day', '3day'], ['day', 'day']]) {
    const p = await open();
    p.page.run(`viewMode = 'calendar'; calendarSubview = '${subview}'; calendarAnchor = '2026-10-21'`);
    keyN(p);
    assert.deepStrictEqual(p.pressed(), [mode], subview);
    assert.strictEqual(p.label(), p.page.run(`noteRangeLabel('${mode}', '2026-10-21')`), subview);
  }
});

test('n on the Calendar\'s Week lists the week\'s notes of every card', async () => {
  const p = await open();
  p.page.run("viewMode = 'calendar'; calendarSubview = 'week'; calendarAnchor = '2026-10-21'");
  keyN(p);
  assert.deepStrictEqual(p.listed().slice().sort(), ['b', 'c', 'd', 'e']);
});

test('n on the Calendar with the pointer on a day opens on that day', async () => {
  const p = await open();
  p.page.run("viewMode = 'calendar'; calendarSubview = 'week'; calendarAnchor = '2026-10-21'; calendarHoverDay = '2026-10-14'");
  keyN(p);
  assert.deepStrictEqual(p.pressed(), ['day']);
  assert.strictEqual(p.label(), 'Wed 14 Oct');
  assert.deepStrictEqual(p.listed(), ['a']);
  assert.strictEqual(p.ui().date.value, 'Today', 'the pointer sets the range, not the day the note goes to');
});

test('n on the Calendar with a card hovered or selected opens that card on All, whatever the range', async () => {
  const p = await open();
  p.page.run("viewMode = 'calendar'; calendarSubview = 'week'; calendarAnchor = '2026-10-21'; calendarHoverDay = '2026-10-14'; hoveredId = '7'");
  keyN(p);
  assert.deepStrictEqual(p.pressed(), ['all']);
  assert.strictEqual(p.page.run('notesUi.sub.id'), '7');
});

test('the pointer over a day is tracked from the Calendar and forgotten when it leaves', async () => {
  const container = control();
  const p = await open({ elements: { '#calendar-view': container } });
  const over = (day) => container.fire('mouseover', { target: { closest: (sel) => (sel.includes('.cal-tg-col') && day ? { dataset: { day } } : null) } });
  over('2026-10-15');
  assert.strictEqual(p.page.run('calendarHoverDay'), '2026-10-15');
  over(null);
  assert.strictEqual(p.page.run('calendarHoverDay'), null, 'over something that is no day');
  over('2026-10-16');
  container.fire('mouseleave', {});
  assert.strictEqual(p.page.run('calendarHoverDay'), null);
});

// --- an hour and the untimed box ----------------------------------------------------------------------------

test('an hour opens on Day, that day, listing the hour; widening it lists the rest of the range', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-21', fromMin: 540, toMin: 600 })");
  assert.deepStrictEqual(p.pressed(), ['day']);
  assert.strictEqual(p.label(), 'Wed 21 Oct');
  assert.deepStrictEqual(p.listed(), ['c']);
  p.rangeBtn('week').click();
  assert.deepStrictEqual(p.listed().slice().sort(), ['b', 'c', 'd', 'e']);
  p.rangeBtn('all').click();
  assert.deepStrictEqual(p.listed().slice().sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('the untimed box opens on Day, that day, listing its untimed notes; widening lists the rest', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'untimed', day: '2026-10-21' })");
  assert.deepStrictEqual(p.listed(), ['d']);
  p.step(1).click();
  assert.strictEqual(p.label(), 'Thu 22 Oct');
  assert.deepStrictEqual(p.listed(), ['e'], 'stepping lists the day\'s notes, not only the untimed ones');
});

test('the range row goes with the notes list: a group\'s other tabs do not show it', async () => {
  const p = await open();
  p.openCard('7');
  assert.strictEqual(p.find('.np-range-row').hidden, false);
  p.page.run("notesUi.tab = 'scratch'; notesPaint = notesPaint");
  p.page.run('notesPaint()');
  assert.strictEqual(p.find('.np-range-row').hidden, true);
});

test('the stylesheet gives the range row its buttons and label', () => {
  for (const sel of ['\\.np-range-row', '\\.np-range-step', '\\.np-range-label']) assert.match(css, new RegExp(`^${sel} \\{`, 'm'), sel);
});

// --- the opening rule again, when the palette is aimed anew --------------------------------------------------

const onCalendar = (p, hover = 'null') => p.page.run(`viewMode = 'calendar'; calendarSubview = 'week'; calendarAnchor = '2026-10-21'; calendarHoverDay = ${hover}`);

test('n with the pointer on a day sets the range to that day and leaves the note\'s own day alone', async () => {
  const p = await open();
  onCalendar(p, "'2026-10-14'");
  keyN(p);
  assert.strictEqual(p.label(), 'Wed 14 Oct');
  assert.strictEqual(p.ui().date.value, 'Today', 'the note still goes to today');
});

test('clearing the chip on the Calendar goes back to the Calendar\'s range, not to Day today', async () => {
  const p = await open();
  onCalendar(p);
  p.openCard('7');
  assert.deepStrictEqual(p.pressed(), ['all']);
  p.page.run('notesClearChip()');
  assert.deepStrictEqual(p.pressed(), ['week']);
  assert.strictEqual(p.label(), '19–25 Oct');
});

test('choosing no card on the Calendar does the same', async () => {
  const p = await open();
  onCalendar(p);
  p.openCard('7');
  p.focusPick();
  p.choose('no card');
  assert.deepStrictEqual(p.pressed(), ['week']);
});

test('aiming at a card on the Calendar opens that card on All', async () => {
  const p = await open();
  onCalendar(p);
  keyN(p);
  p.focusPick();
  p.choose('#7 Port the zephyr schema');
  assert.deepStrictEqual(p.pressed(), ['all']);
});

test('off the Calendar, clearing the chip is Day, today', async () => {
  const p = await open();
  p.openCard('7');
  p.page.run('notesClearChip()');
  assert.deepStrictEqual(p.pressed(), ['day']);
});
