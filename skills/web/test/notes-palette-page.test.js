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

// A page with the details of card 3 up and card 22 hovered behind them; `besides` puts another popup up
// too, `active` puts focus on an element.
async function withDetails({ besides = false, active = null, open = true } = {}) {
  const other = besides ? control() : null;
  const elements = { [ANY_DIALOG]: open ? control() : null, [OTHER_DIALOG]: other };
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

test('from the details: Esc with focus outside the palette clears the chip, the next closes the palette, the one after is the details\'', async () => {
  const p = await withDetails();
  keyN(p);
  const first = escape(p);
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'none', 'the chip is cleared and the palette is up');
  assert.strictEqual(first.stopped, true, 'and the details never hear that Esc');
  const second = escape(p);
  assert.strictEqual(p.page.run('notesUi.sub'), null, 'the next Esc closes the palette');
  assert.strictEqual(second.stopped, true);
  const third = escape(p);
  assert.strictEqual(third.stopped, undefined, 'a third Esc is left to the details, which close as they do today');
});

test('Esc leaves the palette open when another popup is up over it', async () => {
  const p = await withDetails({ besides: true });
  p.page.run("openNotes({ kind: 'card-notes', id: '3' })");
  escape(p);
  assert.strictEqual(aimedAt(p), '3');
});

test('Esc inside the palette clears the chip first and closes the palette alone the next time', async () => {
  const p = await withDetails();
  keyN(p);
  const first = p.press(p.pal(), 'Escape');
  assert.strictEqual(p.page.run('notesUi.sub.kind'), 'none');
  assert.strictEqual(first.stopped, true);
  const e = p.press(p.pal(), 'Escape');
  assert.strictEqual(p.page.run('notesUi.sub'), null);
  assert.strictEqual(e.stopped, true);
});

// --- the note boxes grow with their text ---------------------------------------------------

// The box a person types in: `lines` of 20px plus 12px of padding and 2px of border make the height.
const typeInto = (box, text) => { box.value = text; box.fire('input', {}); };
const lines = (n, width = 10) => Array.from({ length: n }, () => 'x'.repeat(width)).join('\n');

test('the palette\'s note box starts one line high and has no resize grip', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  assert.strictEqual(p.ui().input.rows, 1);
  typeInto(p.ui().input, '');
  assert.strictEqual(p.ui().input.style.height, '34px');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'web', 'app.css'), 'utf8');
  const rule = (sel) => css.match(new RegExp(`^${sel.replace('.', '\\.')} \\{[^}]*\\}`, 'm'))[0];
  assert.match(rule('.np-input'), /resize: none/);
  assert.match(rule('.np-edit-text'), /resize: none/);
  assert.doesNotMatch(rule('.np-input'), /(min|max)-height/, 'the page, not the stylesheet, sets its height');
});

test('the note box grows by a line for each line typed, and for each line that wraps', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  const box = p.ui().input;
  typeInto(box, lines(3));
  assert.strictEqual(box.style.height, '74px');
  typeInto(box, 'x'.repeat(100));
  assert.strictEqual(box.style.height, '74px', 'one long line wrapping to three is three lines high');
  typeInto(box, `${lines(2)}\n${'x'.repeat(41)}`);
  assert.strictEqual(box.style.height, '94px', 'two short lines and one that wraps once');
  assert.strictEqual(box.style.overflowY, 'hidden');
});

test('the note box shrinks when text is deleted, and goes back to one line when it is empty', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  const box = p.ui().input;
  typeInto(box, lines(8));
  assert.strictEqual(box.style.height, '174px');
  typeInto(box, lines(2));
  assert.strictEqual(box.style.height, '54px');
  typeInto(box, '');
  assert.strictEqual(box.style.height, '34px');
});

test('the note box stops at 12 lines and scrolls inside past them', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  const box = p.ui().input;
  typeInto(box, lines(12));
  assert.deepStrictEqual([box.style.height, box.style.overflowY], ['254px', 'hidden']);
  typeInto(box, lines(30));
  assert.deepStrictEqual([box.style.height, box.style.overflowY], ['254px', 'auto']);
});

test('the note box stops at 40% of the window when that is less than 12 lines', async () => {
  const p = await openPalette({ notes: NOTES, viewport: { innerHeight: 500 } });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  typeInto(p.ui().input, lines(30));
  assert.deepStrictEqual([p.ui().input.style.height, p.ui().input.style.overflowY], ['200px', 'auto']);
});

test('writing a note puts the box back to one line', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  typeInto(p.ui().input, lines(6));
  p.page.run("notesUi.input.value = ''; notesGrow()");
  assert.strictEqual(p.ui().input.style.height, '34px');
});

test('a listed note opens for editing in a box sized to its text at once, and grows and shrinks as it is typed in', async () => {
  const p = await openPalette({ notes: [note('2026-10-15', '7', '09:30', '@human', lines(5))] });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.press(p.ui().body, 'e', { target: p.all('.np-note')[0] });
  const box = p.find('.np-edit-text');
  assert.strictEqual(box.rows, 1);
  assert.strictEqual(box.style.height, '114px', 'five lines, at once');
  typeInto(box, lines(30));
  assert.deepStrictEqual([box.style.height, box.style.overflowY], ['254px', 'auto']);
  typeInto(box, 'short');
  assert.deepStrictEqual([box.style.height, box.style.overflowY], ['34px', 'hidden']);
});

test('a one-line note opens for editing one line high', async () => {
  const p = await openPalette({ notes: [note('2026-10-15', '7', '09:30', '@human', 'one line')] });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.press(p.ui().body, 'e', { target: p.all('.np-note')[0] });
  assert.strictEqual(p.find('.np-edit-text').style.height, '34px');
});

test('a window that changes size regrows the open note box', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  typeInto(p.ui().input, lines(30));
  assert.strictEqual(p.ui().input.style.height, '254px');
  p.page.ctx.innerHeight = 500;
  (p.page.windowListeners.resize || []).forEach((fn) => fn({}));
  assert.strictEqual(p.ui().input.style.height, '200px');
});

// --- Alt+1, Alt+2, Alt+3 -------------------------------------------------------------------

// A card with a scratchpad, so its palette has two tabs: Notes and Scratchpad.
async function twoTabs(elements = { [ANY_DIALOG]: null, [OTHER_DIALOG]: null }) {
  const p = await openPalette({ notes: NOTES, scratchpad: { folder: 'scratch', targets: [] }, elements });
  p.page.run("scratchPanel = () => document.createElement('div')");
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  return p;
}
const altKey = (p, key, target, over = {}) => {
  const e = { key, code: `Digit${key}`, shiftKey: false, ctrlKey: false, metaKey: false, altKey: true, repeat: false, defaultPrevented: false, target, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
  target.fire('keydown', e);
  return e;
};
const tabOf = (p) => p.page.run('notesUi.tab');

test('Alt+2 inside the note box switches to the second tab and Alt+1 back to the first', async () => {
  const p = await twoTabs();
  assert.strictEqual(tabOf(p), 'notes');
  const e = altKey(p, '2', p.pal());
  assert.strictEqual(tabOf(p), 'scratch');
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(e.stopped, true, 'the key stays in the palette');
  altKey(p, '1', p.pal());
  assert.strictEqual(tabOf(p), 'notes');
});

test('a number past the last tab does nothing', async () => {
  const p = await twoTabs();
  altKey(p, '3', p.pal());
  assert.strictEqual(tabOf(p), 'notes');
  altKey(p, '2', p.pal());
  altKey(p, '3', p.pal());
  assert.strictEqual(tabOf(p), 'scratch');
});

test('a palette with one tab has nothing to switch to', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  altKey(p, '2', p.pal());
  assert.strictEqual(tabOf(p), 'notes');
});

test('with focus outside the palette the keys switch its tabs too, and with the palette closed they do nothing', async () => {
  const p = await twoTabs();
  p.page.ctx.document.activeElement = null; // focus on the page, not in a field
  const e = { key: '2', code: 'Digit2', shiftKey: false, ctrlKey: false, metaKey: false, altKey: true, defaultPrevented: false, target: {}, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  p.page.ctx.onNotesTabKey(e);
  assert.strictEqual(tabOf(p), 'scratch');
  assert.strictEqual(e.defaultPrevented, true);
  p.page.run('notesClose()');
  const closed = { ...e, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  p.page.ctx.onNotesTabKey(closed);
  assert.strictEqual(closed.defaultPrevented, false, 'the key is the browser\'s again');
  assert.strictEqual(tabOf(p), 'notes');
});

const tabEvent = (target) => ({ key: '2', code: 'Digit2', shiftKey: false, ctrlKey: false, metaKey: false, altKey: true, defaultPrevented: false, target, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });

test('with focus outside the palette the keys act only on a page with no other surface up', async () => {
  for (const [elements, acts] of [
    [{ [ANY_DIALOG]: control(), [OTHER_DIALOG]: control() }, false],
    [{ [ANY_DIALOG]: control(), [OTHER_DIALOG]: null }, true],
    [{ [ANY_DIALOG]: null, [OTHER_DIALOG]: null, '#context-menu:not(.hidden)': control() }, false],
    [{ [ANY_DIALOG]: null, [OTHER_DIALOG]: null, '#prefs-sheet:not(.hidden)': control() }, false],
  ]) {
    const p = await twoTabs(elements);
    p.page.ctx.document.activeElement = null;
    const e = tabEvent({});
    p.page.ctx.onNotesTabKey(e);
    assert.strictEqual(tabOf(p) === 'scratch', acts, Object.keys(elements).join(' '));
    assert.strictEqual(e.defaultPrevented, acts);
  }
});

test('with focus in a field outside the palette the keys do nothing', async () => {
  const p = await twoTabs();
  p.page.ctx.document.activeElement = { tagName: 'INPUT', isContentEditable: false };
  const e = tabEvent({});
  p.page.ctx.onNotesTabKey(e);
  assert.strictEqual(tabOf(p), 'notes');
  assert.strictEqual(e.defaultPrevented, false);
});

test('with focus inside the palette they act, whatever else is up', async () => {
  const p = await twoTabs({ [ANY_DIALOG]: control(), [OTHER_DIALOG]: control() });
  altKey(p, '2', p.pal());
  assert.strictEqual(tabOf(p), 'scratch');
});

test('the palette hands every key to the Scratchpad preview key, from the box or from a button, and keeps the key when it takes it', async () => {
  const p = await twoTabs();
  const seen = [];
  p.page.run("scratchPreviewKey = (e) => { window.seenKeys.push(e.key); return true; }");
  p.page.ctx.seenKeys = seen;
  const e = altKey(p, 'V', p.pal(), { altKey: false, ctrlKey: true, shiftKey: true });
  assert.deepStrictEqual(seen, ['V']);
  assert.strictEqual(e.stopped, undefined, 'the preview key stops the event itself');
});

test('the one popup the notes keys work over is named once, and every notes key reads it through the key guard', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'web', 'notes-palette.js'), 'utf8');
  assert.match(src, /const NOTES_DETAIL = '#detail-modal';/);
  assert.strictEqual((src.match(/'#detail-modal'/g) || []).length, 1, 'named once');
  assert.strictEqual((src.match(/keyGuard(?:Off|Surface)\(document, NOTES_DETAIL\)/g) || []).length, 3, 'n, Alt+digit and Esc');
  assert.ok(!/#context-menu:not\(\.hidden\), \.modal-backdrop/.test(src), 'no copy of the key guard\'s selectors');
});

test('Alt+Left and Alt+Right are left to the browser, in the palette too', async () => {
  const p = await twoTabs();
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    const e = altKey(p, key, p.pal(), { code: key });
    assert.strictEqual(e.defaultPrevented, false, key);
  }
  assert.strictEqual(tabOf(p), 'notes');
});

test('each tab shows its key as a muted hint and in its title', async () => {
  const p = await twoTabs();
  const tabs = p.all('.np-tab');
  assert.deepStrictEqual(tabs.map((t) => t.dataset.key), ['Alt+1', 'Alt+2']);
  assert.deepStrictEqual(tabs.map((t) => p.text(t)), ['Notes', 'Scratchpad'], 'the hint is drawn by the stylesheet: the text of a tab is still its name');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.np-tab::after \{ content: attr\(data-key\);/);
  assert.deepStrictEqual(tabs.map((t) => t.title), ['Notes (Alt+1)', 'Scratchpad (Alt+2)']);
  assert.deepStrictEqual(tabs.map((t) => t.dataset.tab), ['notes', 'scratch']);
});

// --- Esc in the filter field ---------------------------------------------------------------

// A key at `target`, handed up its parents the way the browser does until something stops it.
function bubble(target, key) {
  const e = { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  for (let at = target; at && !e.stopped; at = at.parent) at.fire('keydown', e);
  return e;
}

test('Esc in the filter field closes the palette at once, with text in the filter or without', async () => {
  for (const typed of ['', 'enum']) {
    const p = await openPalette({ notes: NOTES });
    p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
    p.ui().filter.value = typed;
    p.ui().filter.fire('input', {});
    bubble(p.ui().filter, 'Escape');
    assert.strictEqual(p.page.run('notesUi.sub'), null, `filter ${JSON.stringify(typed)}`);
  }
});

test('the filter starts empty when the palette opens again, as it does today', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().filter.value = 'enum';
  bubble(p.ui().filter, 'Escape');
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  assert.strictEqual(p.ui().filter.value, '');
});

test('Esc in a note\'s edit form or assign field still cancels it and leaves the palette open', async () => {
  const p = await openPalette({ notes: NOTES });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.press(p.ui().body, 'e', { target: p.all('.np-note')[0] });
  assert.strictEqual(p.all('.np-edit-text').length, 1);
  const form = p.find('.np-edit');
  const first = { key: 'Escape', preventDefault() {}, stopPropagation() { this.stopped = true; } };
  form.fire('keydown', first);
  assert.strictEqual(first.stopped, true, 'the form keeps the key');
  assert.strictEqual(p.all('.np-edit-text').length, 0, 'the edit is cancelled');
  assert.notStrictEqual(p.page.run('notesUi.sub'), null, 'and the palette is still up');
});

// --- a palette that has just closed ----------------------------------------------------------------

test('a closed palette lets Esc go on: the box that kept the focus does not swallow the next one', async () => {
  const p = await withDetails();
  keyN(p);
  const input = p.ui().input;
  p.press(p.pal(), 'Escape');
  assert.strictEqual(p.press(p.pal(), 'Escape').stopped, true, 'the second Esc closes it');
  assert.strictEqual(p.page.run('notesUi.sub'), null);
  for (const key of ['Escape', 'a', 'ArrowDown']) {
    const e = p.press(p.pal(), key);
    assert.strictEqual(e.stopped, undefined, `${key} reaches the page`);
    assert.ok(!e.defaultPrevented);
  }
  assert.ok(input);
});

test('closing the palette does not leave the focus in its hidden box', async () => {
  const p = await withDetails();
  keyN(p);
  assert.strictEqual(p.doc.activeElement.uid, p.ui().input.uid);
  p.page.run('notesClose()');
  assert.ok(!p.doc.activeElement || !p.pal().contains(p.doc.activeElement));
});
