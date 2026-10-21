const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The notes palette in the real page (helpers/palette-page.js): its Grouped or Timeline switch, the
// note boxes that grow with their text, and n on the card whose details are open. The rules each
// one stands on are notes.js and key-guard.js, tested apart; the browser runner drives the same in
// Chrome (scenarios/notes.js).

const NOTES = [
  note('2026-10-15', '7', '09:30', '@human', 'early on seven'),
  note('2026-10-15', '22', '09:10', '@afk', 'twenty-two first'),
  note('2026-10-15', '', null, '@human', 'untimed free'),
  note('2026-10-14', '7', '16:00', '@afk', 'older on seven'),
];

test('the palette builds and lists a card\'s notes', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  assert.deepStrictEqual(p.rows(), ['early on seven', 'older on seven']);
});

const DAY = "{ kind: 'slot', day: '2026-10-15', fromMin: 0, toMin: 1440 }";
const switchBtn = (p, layout) => p.find(`.np-by-btn[data-layout="${layout}"]`);
const pressed = (p) => p.all('.np-layout-slot .np-by-btn').map((b) => `${b.dataset.layout}:${b.getAttribute('aria-pressed')}`);

test('the filter row holds a Grouped and Timeline switch beside the author switch, Grouped pressed to begin with', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run(`openNotes(${DAY})`);
  assert.deepStrictEqual(pressed(p), ['grouped:true', 'timeline:false']);
  const row = p.find('.np-filter-row');
  assert.deepStrictEqual(row.children.map((c) => c.classes.includes('np-layout-slot') ? 'layout' : c.classes.includes('np-by-slot') ? 'by' : 'filter'), ['filter', 'layout', 'by']);
  assert.match(switchBtn(p, 'timeline').title, /By day and time|One list/);
});

test('Grouped is the list as it was: a section per day and card, each headed by its card', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run(`openNotes(${DAY})`);
  assert.deepStrictEqual(p.all('.np-ngroup').map((g) => g.dataset.target), ['7', '22']);
  assert.strictEqual(p.all('.np-tgroup').length, 0);
  assert.strictEqual(p.all('.np-note-card').length, 0, 'a grouped row does not name its card: its heading does');
});

test('Timeline is one flat list by time, each row naming its card, and the choice is kept for the board', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run(`openNotes(${DAY})`);
  switchBtn(p, 'timeline').click();
  assert.deepStrictEqual(pressed(p), ['grouped:false', 'timeline:true']);
  assert.deepStrictEqual(p.rows(), ['twenty-two first', 'early on seven']);
  assert.deepStrictEqual(p.all('.np-note-card').map((c) => p.text(c)), ['#22 Cut over the data layer', '#7 Port the zephyr schema']);
  assert.strictEqual(p.all('.np-ngroup').every((g) => g.classes.includes('np-tgroup')), true);
  assert.strictEqual(p.stored['kanban.kanban.notes.layout'], 'timeline');
  switchBtn(p, 'grouped').click();
  assert.strictEqual(p.all('.np-tgroup').length, 0);
  assert.strictEqual(p.stored['kanban.kanban.notes.layout'], 'grouped');
});

test('a palette opened on a board that saved Timeline lists that way at once', async () => {
  const p = await openPalette({ notes: NOTES, stored: { 'kanban.kanban.notes.layout': 'timeline' } });
  p.page.run(`openNotes(${DAY})`);
  assert.deepStrictEqual(pressed(p), ['grouped:false', 'timeline:true']);
  assert.strictEqual(p.all('.np-note-card').length, 2);
});

test('Timeline names "no card" on a note about nothing, and links the others to their card', async () => {
  const p = await openPalette({ notes: NOTES, stored: { 'kanban.kanban.notes.layout': 'timeline' } });
  p.page.run("openNotes({ kind: 'untimed', day: '2026-10-15' })");
  const label = p.find('.np-note-card');
  assert.strictEqual(p.text(label), 'no card');
  assert.strictEqual(label.tag, 'span', 'a note about nothing links nowhere');
  p.page.run(`openNotes(${DAY})`);
  const link = p.all('.np-note-card')[1];
  assert.strictEqual(link.tag, 'button');
  let opened = null;
  p.page.ctx.openCard = (id) => { opened = id; };
  link.click();
  assert.strictEqual(opened, '7');
  assert.strictEqual(p.page.run('notesUi.sub'), null, 'the palette closes behind the card it opens, as a heading does');
});

test('Timeline shows a day line only where Grouped would: more than one day, or a day that is not today', async () => {
  const p = await openPalette({ notes: NOTES, stored: { 'kanban.kanban.notes.layout': 'timeline' } });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  assert.deepStrictEqual(p.all('.np-tgroup').map((g) => g.dataset.day), ['2026-10-15', '2026-10-14']);
  assert.deepStrictEqual(p.all('.np-tgroup .np-nday').map((d) => p.text(d)), ['Thu 15', 'Wed 14']);
  const today = p.page.run('localTodayStr()');
  const q = await openPalette({ notes: [note(today, '7', '09:00', '@human', 'today only')], stored: { 'kanban.kanban.notes.layout': 'timeline' } });
  q.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  assert.strictEqual(q.all('.np-tgroup').length, 1);
  assert.strictEqual(q.all('.np-nday').length, 0, 'one day, and it is today: no day line');
});

test('the filter, the author switch and the arrow keys work on the flat list as on the grouped one', async () => {
  const p = await openPalette({ notes: NOTES, stored: { 'kanban.kanban.notes.layout': 'timeline' } });
  p.page.run(`openNotes(${DAY})`);
  p.ui().filter.value = 'by:@afk';
  p.ui().filter.fire('input', {});
  assert.deepStrictEqual(p.rows(), ['twenty-two first']);
  p.ui().filter.value = '';
  p.ui().filter.fire('input', {});
  p.find('.np-by-btn[data-by="human"]').click();
  assert.deepStrictEqual(p.rows(), ['early on seven']);
  p.find('.np-by-btn[data-by="all"]').click();
  p.press(p.ui().input, 'ArrowDown');
  assert.strictEqual(p.doc.activeElement.uid, p.all('.np-note')[0].uid, 'Down from the box lands on the first row');
  p.press(p.ui().body, 'ArrowDown', { target: p.all('.np-note')[0] });
  assert.strictEqual(p.page.run('notesUi.hi'), 1, 'Down steps to the next row');
  p.press(p.ui().body, 'e', { target: p.all('.np-note')[0] });
  assert.ok(p.all('.np-edit-text').length === 1, 'e opens the row for editing');
});

// --- n over the card details ---------------------------------------------------------------

const ANY_DIALOG = '.modal-backdrop:not(.hidden)';
const OTHER_DIALOG = '.modal-backdrop:not(.hidden):not(#detail-modal)';
const ESC_PROBE = '#context-menu:not(.hidden), .modal-backdrop:not(.hidden):not(#detail-modal)';

// A page with the details of card 3 up and card 22 hovered behind them; `besides` puts another popup up
// too, `active` puts focus on an element.
async function withDetails({ besides = false, active = null, open = true } = {}) {
  const other = besides ? control() : null;
  const elements = { [ANY_DIALOG]: open ? control() : null, [OTHER_DIALOG]: other, [ESC_PROBE]: other };
  const p = await openPalette({ notes: NOTES, elements });
  if (open) p.page.run("currentDetailId = '3'");
  p.page.run("hoveredId = '22'");
  p.doc.activeElement = active;
  return p;
}

const keyN = (p, over = {}) => {
  const e = { key: 'n', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
  p.page.ctx.onNotesKey(e);
  return e;
};
const aimedAt = (p) => p.page.run('notesUi.sub && notesUi.sub.id');

test('n with the card details open notes that card, even with another card hovered behind them', async () => {
  const p = await withDetails();
  const e = keyN(p);
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(aimedAt(p), '3');
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'card');
});

test('n with the card details open notes that card even when a different card is selected', async () => {
  const p = await withDetails();
  p.page.run("selectedIds.clear(); selectedIds.add('7')");
  keyN(p);
  assert.strictEqual(aimedAt(p), '3');
});

test('without the details open n is as it was: the hovered card', async () => {
  const p = await withDetails({ open: false });
  keyN(p);
  assert.strictEqual(aimedAt(p), '22');
});

test('n types an n while a field of the details has focus', async () => {
  const p = await withDetails({ active: { tagName: 'TEXTAREA', isContentEditable: false } });
  const e = keyN(p);
  assert.strictEqual(e.defaultPrevented, false);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
});

test('n stays off behind any other popup, over the details or not', async () => {
  const p = await withDetails({ besides: true });
  const e = keyN(p);
  assert.strictEqual(e.defaultPrevented, false);
  assert.strictEqual(p.page.run('notesUi.sub'), null);
});

test('the palette draws above the details when they are open, and not otherwise', async () => {
  const p = await withDetails();
  keyN(p);
  assert.strictEqual(p.pal().classes.includes('np-over-detail'), true);
  p.page.run('notesClose()');
  const q = await withDetails({ open: false });
  keyN(q);
  assert.strictEqual(q.pal().classes.includes('np-over-detail'), false);
});

const escape = (p, target = {}) => {
  const e = { key: 'Escape', defaultPrevented: false, target, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  p.page.ctx.onNotesEscape(e);
  return e;
};

test('Esc with focus outside the palette closes the palette and leaves the details for the next Esc', async () => {
  const p = await withDetails();
  keyN(p);
  const first = escape(p);
  assert.strictEqual(p.page.run('notesUi.sub'), null, 'the palette is closed');
  assert.strictEqual(first.stopped, true, 'and the details never hear that Esc');
  const second = escape(p);
  assert.strictEqual(second.stopped, undefined, 'a second Esc is left to the details, which close as they do today');
});

test('Esc leaves the palette open when another popup is up over it', async () => {
  const p = await withDetails({ besides: true });
  p.page.run("openNotes({ kind: 'card-notes', id: '3' })");
  escape(p);
  assert.strictEqual(aimedAt(p), '3');
});

test('Esc inside the palette closes the palette alone', async () => {
  const p = await withDetails();
  keyN(p);
  const e = p.press(p.pal(), 'Escape');
  assert.strictEqual(p.page.run('notesUi.sub'), null);
  assert.strictEqual(e.stopped, true);
});
