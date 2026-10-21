const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette, note } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The notes palette goes fullscreen as the card details do: the same registry, the same button (icon,
// title, aria-pressed), the same saved choice per board and the same Alt+Enter. The palette is no modal,
// so what is pinned here is that it takes part in all four.

const ANY_DIALOG = '.modal-backdrop:not(.hidden)';
const OTHER_DIALOG = '.modal-backdrop:not(.hidden):not(#detail-modal)';
const KEY = 'kanban.kanban.modal.fullscreen';
const NOTES = [note('2026-10-15', '7', '09:30', '@human', 'early on seven')];

async function open({ detail = false, other = false, stored = {} } = {}) {
  const elements = { [ANY_DIALOG]: detail || other ? control() : null, [OTHER_DIALOG]: other ? control() : null };
  const p = await openPalette({ notes: NOTES, elements, stored });
  if (detail) p.page.run("currentDetailId = '7'");
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.btn = () => p.find('#notes-fullscreen-btn');
  p.on = () => p.pal().classes.includes('fullscreen');
  return p;
}

const altEnter = (target, over = {}) => ({
  key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: true, repeat: false, defaultPrevented: false, target,
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...over,
});
const onDocument = (p, e) => { for (const fn of p.page.documentListeners.keydown || []) fn(e); return e; };
const tall = (p, lines) => {
  p.ui().input.value = Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n');
  p.ui().input.fire('input', {});
  return parseFloat(p.ui().input.style.height);
};

test('the palette has the details\' fullscreen button, in a header row with the tabs ahead of the note bar, collapsed to begin with', async () => {
  const p = await open();
  const btn = p.btn();
  assert.ok(btn, 'the button is there');
  assert.strictEqual(btn.tag, 'button');
  assert.ok(btn.classes.includes('icon-btn'));
  assert.strictEqual(btn.title, 'Expand to full screen');
  assert.strictEqual(btn.getAttribute('aria-label'), 'Expand to full screen');
  assert.strictEqual(btn.getAttribute('aria-pressed'), 'false');
  assert.match(btn.innerHTML, /<svg/);
  const head = p.pal().children[0];
  assert.ok(head.classes.includes('np-head'));
  const inside = head.walk().map((e) => e.uid);
  assert.ok(inside.includes(btn.uid), 'the button is in the header row');
  assert.ok(inside.includes(p.ui().tabsEl.uid), 'the tabs share the row');
  assert.strictEqual(p.on(), false);
});

test('the button turns fullscreen on and off, as the details\' does, and keeps the choice for the board', async () => {
  const p = await open();
  p.btn().click();
  assert.strictEqual(p.on(), true);
  assert.strictEqual(p.btn().title, 'Exit full screen');
  assert.strictEqual(p.btn().getAttribute('aria-pressed'), 'true');
  assert.strictEqual(JSON.parse(p.stored[KEY]).notes, true);
  p.btn().click();
  assert.strictEqual(p.on(), false);
  assert.strictEqual(p.btn().title, 'Expand to full screen');
  assert.strictEqual(JSON.parse(p.stored[KEY]).notes, false);
});

test('a palette opened on a board that saved fullscreen opens fullscreen, and so does one opened again', async () => {
  const p = await open({ stored: { [KEY]: JSON.stringify({ notes: true }) } });
  assert.strictEqual(p.on(), true);
  assert.strictEqual(p.btn().getAttribute('aria-pressed'), 'true');
  p.page.run('notesClose()');
  p.page.run("openNotes({ kind: 'card-notes', id: '22' })");
  assert.strictEqual(p.on(), true);
});

test('fullscreen on the palette leaves the details\' own choice alone', async () => {
  const p = await open();
  p.btn().click();
  assert.deepStrictEqual(JSON.parse(p.stored[KEY]), { edit: false, detail: false, bulkSingle: false, bulkTags: false, bulkSchedule: false, notes: true });
});

test('Alt+Enter in the palette toggles it, writes no note and goes no further', async () => {
  const p = await open();
  p.ui().input.value = 'half a thought';
  const e = altEnter(p.pal());
  p.pal().fire('keydown', e);
  assert.strictEqual(p.on(), true);
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(e.stopped, true);
  assert.strictEqual(p.ui().input.value, 'half a thought');
  p.pal().fire('keydown', altEnter(p.pal()));
  assert.strictEqual(p.on(), false);
});

test('plain Enter, Ctrl+Enter, Shift+Alt+Enter and Meta+Alt+Enter do not toggle it', async () => {
  const p = await open();
  for (const over of [{ altKey: false }, { altKey: false, ctrlKey: true }, { shiftKey: true }, { metaKey: true }]) {
    p.pal().fire('keydown', altEnter(p.pal(), over));
  }
  assert.strictEqual(p.on(), false);
});

test('Alt+Enter with focus outside the palette toggles it when it is the popup that is open', async () => {
  const p = await open();
  const e = onDocument(p, altEnter(p.doc.body));
  assert.strictEqual(p.on(), true);
  assert.strictEqual(e.defaultPrevented, true);
});

test('over the card details Alt+Enter toggles the palette, not the details', async () => {
  const p = await open({ detail: true });
  assert.strictEqual(p.page.run('openFullscreenModalType()'), 'notes');
  onDocument(p, altEnter(p.doc.body));
  assert.strictEqual(p.on(), true);
  assert.strictEqual(JSON.parse(p.stored[KEY]).detail, false);
});

test('with another popup up besides the details Alt+Enter is that popup\'s, not the palette\'s', async () => {
  const p = await open({ other: true });
  assert.notStrictEqual(p.page.run('openFullscreenModalType()'), 'notes');
  onDocument(p, altEnter(p.doc.body));
  assert.strictEqual(p.on(), false);
});

test('a closed palette is not a popup that is open', async () => {
  const p = await open();
  p.page.run('notesClose()');
  assert.notStrictEqual(p.page.run('openFullscreenModalType()'), 'notes');
  assert.strictEqual(p.page.run('notesOnTop()'), false);
});

test('a note box may grow taller on a fullscreen palette, and regrows the moment the button is pressed', async () => {
  const p = await open();
  const small = tall(p, 40);
  p.btn().click();
  assert.ok(parseFloat(p.ui().input.style.height) > small, 'regrown at once');
  assert.ok(tall(p, 40) >= small);
  p.btn().click();
  assert.strictEqual(parseFloat(p.ui().input.style.height), small, 'and back');
});

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').split(String.fromCharCode(13)).join('');

test('the stylesheet fills the window with a fullscreen palette and hands the height to the list and the scratchpad', () => {
  assert.match(css, /\.notes-palette\.fullscreen\s*\{[^}]*inset:\s*0[^}]*max-height:\s*none/s);
  assert.match(css, /\.notes-palette\.fullscreen\s*\{[^}]*transform:\s*none/s);
  assert.match(css, /\.notes-palette\.fullscreen\s+\.np-body\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.notes-palette\.fullscreen\s+\.sp-text\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(css, /\.notes-palette\.fullscreen\s+\.sp-preview\s*\{[^}]*flex:\s*1 1 auto[^}]*max-height:\s*none/s);
});

test('on a phone the button goes, as the details\' does, and the fullscreen rules do not apply: the palette keeps its sheet', () => {
  const at = (marker) => css.indexOf(marker);
  const wide = css.slice(at('@media (min-width: 760px) {\n  .notes-palette.fullscreen'), at('@media (max-width: 759.98px) {\n  #notes-fullscreen-btn'));
  assert.match(wide, /\.notes-palette\.fullscreen \.np-body/);
  assert.strictEqual(css.split('.notes-palette.fullscreen').length - 1, wide.split('.notes-palette.fullscreen').length - 1, 'every fullscreen rule is inside the wide media query');
  const phone = css.slice(at('@media (max-width: 759.98px) {\n  #notes-fullscreen-btn'));
  assert.match(phone.slice(0, phone.indexOf('\n}\n')), /#notes-fullscreen-btn\s*\{\s*display:\s*none/);
});
