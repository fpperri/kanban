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

async function open({ detail = false, other = false, stored = {}, width } = {}) {
  const elements = { [ANY_DIALOG]: detail || other ? control() : null, [OTHER_DIALOG]: other ? control() : null };
  const p = await openPalette({ notes: NOTES, elements, stored, viewport: width ? { innerWidth: width } : {} });
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

test('the cap rises in fullscreen in both ways: more lines, and a bigger share of the window', async () => {
  const p = await open({ stored: { [KEY]: JSON.stringify({ notes: true }) } });
  p.page.ctx.innerHeight = 600;
  const full = tall(p, 60);
  p.btn().click();
  const small = tall(p, 60);
  assert.strictEqual(small, 240, '40% of 600');
  assert.strictEqual(full, 420, '70% of 600, under 30 lines');
});

test('Alt+Enter while a popup besides the details is up and focus is in the palette does nothing', async () => {
  const p = await open({ other: true });
  const e = altEnter(p.pal());
  p.pal().fire('keydown', e);
  assert.strictEqual(p.on(), false);
  assert.strictEqual(e.stopped, true, 'and the key stays out of the popup and the boxes');
  assert.strictEqual(p.stored[KEY], undefined);
});

// --- a phone ----------------------------------------------------------------------------------------

const SAVED_JSON = JSON.stringify({ notes: true });
const saved = () => ({ [KEY]: SAVED_JSON });

const resize = (p) => { for (const fn of p.page.windowListeners.resize || []) fn({}); };

test('under the width one constant names, the palette is always full screen, as the card details are: no button, whatever was saved', async () => {
  assert.strictEqual(require('node:vm').runInContext('NOTES_FULLSCREEN_MIN_WIDTH', (await open()).page.ctx), 760);
  for (const stored of [{}, saved(), { [KEY]: JSON.stringify({ notes: false }) }]) {
    const p = await open({ stored, width: 500 });
    assert.strictEqual(p.on(), true, JSON.stringify(stored));
    assert.strictEqual(p.btn().hidden, true);
  }
  const wide = await open({ width: 760 });
  assert.strictEqual(wide.on(), false, 'from the width up it is the saved choice');
  assert.strictEqual(wide.btn().hidden, false);
});

test('on a phone the note box keeps the ordinary cap', async () => {
  const p = await open({ width: 500 });
  p.page.ctx.innerHeight = 1000;
  assert.strictEqual(tall(p, 60), 254, '12 lines, not 30');
});

test('on a phone Alt+Enter and the button neither toggle nor change the saved choice', async () => {
  const p = await open({ stored: saved(), width: 500 });
  const e = altEnter(p.pal());
  p.pal().fire('keydown', e);
  onDocument(p, altEnter(p.doc.body));
  p.btn().click();
  assert.strictEqual(p.on(), true);
  assert.strictEqual(p.stored[KEY], SAVED_JSON);
  assert.strictEqual(e.defaultPrevented, true, 'the chord is still the palette: it writes no note');
  const none = await open({ width: 500 });
  none.pal().fire('keydown', altEnter(none.pal()));
  assert.strictEqual(none.stored[KEY], undefined, 'and nothing is saved');
});

test('a window that crosses the width with the palette open follows at once, to the saved choice from the width up', async () => {
  const p = await open({ width: 500 });
  assert.strictEqual(p.on(), true);
  p.page.ctx.innerWidth = 1200;
  resize(p);
  assert.strictEqual(p.on(), false);
  assert.strictEqual(p.btn().hidden, false);
  p.btn().click();
  p.page.ctx.innerWidth = 500;
  resize(p);
  assert.strictEqual(p.on(), true);
  assert.strictEqual(p.btn().hidden, true);
  p.page.ctx.innerWidth = 1200;
  resize(p);
  assert.strictEqual(p.on(), true, 'back on the choice made at the width');
});

// --- the registry and the sources --------------------------------------------------------------------

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').split(String.fromCharCode(13)).join('');
const appJs = read('web', 'app.js');
const paletteJs = read('web', 'notes-palette.js');
const css = read('web', 'app.css');

test('the registry stays generic: no special case for the palette in the lookup or the toggle, the hooks are in its entry', () => {
  assert.ok(!/type === 'notes'/.test(appJs), 'no type === notes in app.js');
  const entry = /\n  notes: \{[^\n]*\n/.exec(appJs);
  assert.ok(entry, 'the entry');
  for (const hook of ['panel:', 'isOpen:', 'onChange:', 'locked:']) assert.ok(entry[0].includes(hook), hook);
  assert.ok(!/backdrop:/.test(entry[0]), 'the palette has no backdrop');
  assert.match(appJs, /function openFullscreenModalType\(\) \{[\s\S]*?cfg\.isOpen/);
  assert.match(appJs, /function toggleModalFullscreen\(type\) \{[\s\S]*?cfg\.onChange/);
});

test('modal-fullscreen.js no longer says a new type must be a .modal-backdrop popup', () => {
  assert.ok(!/any future \.modal-backdrop popup/.test(read('web', 'modal-fullscreen.js')));
});

test('the palette leaves the button\'s icon, label and pressed state to applyModalFullscreen', () => {
  assert.ok(!/FULLSCREEN_ICON|Expand to full screen|Exit full screen/.test(paletteJs));
  assert.ok(!/fsBtn[^\n]*(innerHTML|aria-|\.title)/.test(paletteJs));
});

test('the palette\'s fullscreen box shares its declarations with .modal.fullscreen, and no media query decides it: the width constant does', () => {
  assert.match(css, /\.modal\.fullscreen,\s*\.notes-palette\.fullscreen\s*\{[^}]*inset:\s*0[^}]*max-height:\s*none/s);
  const insets = css.split('\n').filter((l) => l.includes('.notes-palette.fullscreen') && l.includes('inset:'));
  assert.strictEqual(insets.length, 1, 'the box is declared once, in the shared rule');
  assert.match(css, /\.notes-palette\.fullscreen\s*\{[^}]*transform:\s*none/s);
  assert.ok(!/@media[^{]*\{\s*\n\s*\.notes-palette\.fullscreen/.test(css), 'not behind a media query');
  assert.ok(!/#notes-fullscreen-btn/.test(css), 'the button is hidden by the page script, not the stylesheet');
});

test('the stylesheet hands the height to the list and the scratchpad when the palette is fullscreen', () => {
  assert.match(css, /\.notes-palette\.fullscreen\s+\.np-body\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.notes-palette\.fullscreen\s+\.sp-text\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(css, /\.notes-palette\.fullscreen\s+\.sp-preview\s*\{[^}]*flex:\s*1 1 auto[^}]*max-height:\s*none/s);
});

test('nothing sizes the palette as a sheet on a phone any more: it is the fullscreen box, in dynamic viewport units', () => {
  assert.ok(!/\.notes-palette \{[^}]*82vh/.test(css));
  assert.match(css, /\.notes-palette\.fullscreen\s*\{[^}]*height:\s*100dvh/s);
});
