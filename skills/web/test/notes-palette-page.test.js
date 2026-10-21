const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');

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
