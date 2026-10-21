const { test } = require('node:test');
const assert = require('node:assert');
const { KEY_GUARD_SURFACES, keyGuardTyping, keyGuardSurface, keyGuardOff, keyGuardEscape } = require('../web/key-guard');

// The single-key shortcuts (`/` today; the slice keys and `n` later) share one
// guard. It has two parts: a typing check for keys that would insert a
// character, and a surface check for keys that would act behind an open popup.
// Ctrl+F types nothing, so it reads only the surface check.

const field = (tagName, extra = {}) => ({ tagName, isContentEditable: false, ...extra });

// A document whose open surfaces are named by selector, as the page's are.
function fakeDoc({ active = null, open = [] } = {}) {
  return { activeElement: active, querySelector: (sel) => (open.includes(sel) ? { id: 'open' } : null) };
}

const selectorOf = (name) => KEY_GUARD_SURFACES.find((s) => s.name === name).selector;

test('the guard is off while focus is in a text field, a text area, a select or an editable element', () => {
  for (const active of [field('INPUT'), field('TEXTAREA'), field('SELECT'), field('DIV', { isContentEditable: true })]) {
    const doc = fakeDoc({ active });
    assert.strictEqual(keyGuardTyping(doc), true, active.tagName);
    assert.strictEqual(keyGuardOff(doc), true, active.tagName);
  }
});

test('the guard is on while focus sits on a button, the page or nothing', () => {
  for (const active of [field('BUTTON'), field('BODY'), field('A'), field('DIV'), null, undefined]) {
    const doc = fakeDoc({ active });
    assert.strictEqual(keyGuardTyping(doc), false, String(active && active.tagName));
    assert.strictEqual(keyGuardOff(doc), false, String(active && active.tagName));
  }
});

test('the surfaces that turn the guard off are pinned by name: a menu, a dialog, the notifications panel and the preferences sheet', () => {
  assert.deepStrictEqual(KEY_GUARD_SURFACES.map((s) => s.name), ['menu', 'dialog', 'notifications', 'preferences']);
});

test('each surface turns the guard off on its own, and the surface check names it', () => {
  for (const { name, selector } of KEY_GUARD_SURFACES) {
    const doc = fakeDoc({ open: [selector] });
    assert.strictEqual(keyGuardSurface(doc), name);
    assert.strictEqual(keyGuardOff(doc), true, name);
    assert.strictEqual(keyGuardTyping(doc), false, `${name} is a surface, not typing`);
  }
});

test('the surface check says nothing while no surface is open', () => {
  assert.strictEqual(keyGuardSurface(fakeDoc()), null);
  assert.strictEqual(keyGuardSurface(fakeDoc({ active: field('INPUT') })), null, 'typing is not a surface: Ctrl+F still works from a text field');
});

test('every surface is an open-state selector that skips a hidden one', () => {
  for (const { name, selector } of KEY_GUARD_SURFACES) {
    assert.match(selector, /:not\(\.hidden\)$/, `${name} reads as open only while it is not hidden`);
  }
  assert.strictEqual(selectorOf('menu'), '#context-menu:not(.hidden)');
  assert.strictEqual(selectorOf('dialog'), '.modal-backdrop:not(.hidden)');
  assert.strictEqual(selectorOf('notifications'), '#notif-modal:not(.hidden)');
  assert.strictEqual(selectorOf('preferences'), '#prefs-sheet:not(.hidden)');
});

test('the search panel is not a surface: the slice keys work while it is open', () => {
  assert.ok(!KEY_GUARD_SURFACES.some((s) => /search|panel/i.test(s.name + s.selector)));
  const doc = fakeDoc({ open: ['.search-panel:not(.hidden)', '#search-panel:not(.hidden)'] });
  assert.strictEqual(keyGuardSurface(doc), null);
  assert.strictEqual(keyGuardOff(doc), false);
});

// Esc's step in the selection reads this guard too, but with one exception: the
// search box is the text field Esc is for. There Esc clears the box and leaves
// the selection. Everywhere else the step runs only when nothing is open and
// nobody is typing. The answer is 'clear-box', 'step' or null (Esc is not this
// guard's to act on).
const searchBox = field('INPUT', { id: 'search-input' });

test('Esc with focus in the search box clears the box, and never steps the selection', () => {
  assert.strictEqual(keyGuardEscape(fakeDoc({ active: searchBox }), searchBox), 'clear-box');
});

test('Esc with focus on a button, a link, a card, the page or nothing steps the selection', () => {
  for (const active of [field('BUTTON'), field('A'), field('DIV'), field('BODY'), null, undefined]) {
    assert.strictEqual(keyGuardEscape(fakeDoc({ active }), searchBox), 'step', String(active && active.tagName));
  }
});

test('while focus is in a text field other than the search box, Esc never steps the selection', () => {
  const other = [field('INPUT', { id: 'bulk-tag-input' }), field('INPUT'), field('TEXTAREA'), field('SELECT'), field('DIV', { isContentEditable: true })];
  for (const active of other) {
    assert.strictEqual(keyGuardEscape(fakeDoc({ active }), searchBox), null, active.tagName + (active.id || ''));
  }
});

test('an open card menu, dialog, notifications panel or preferences sheet takes Esc: neither the step nor the box clear runs, whatever has focus', () => {
  for (const { name, selector } of KEY_GUARD_SURFACES) {
    for (const active of [field('BODY'), field('BUTTON'), searchBox, field('INPUT')]) {
      assert.strictEqual(keyGuardEscape(fakeDoc({ active, open: [selector] }), searchBox), null, `${name} with focus on ${active.tagName}${active.id || ''}`);
    }
  }
});

test('with no search box to compare against, every text field stays guarded and the rest steps', () => {
  assert.strictEqual(keyGuardEscape(fakeDoc({ active: field('INPUT') }), null), null);
  assert.strictEqual(keyGuardEscape(fakeDoc({ active: field('BODY') }), null), 'step');
});

// A key can name one popup that does not turn it off (`n` names the card details: it notes the
// open card). Any other popup, menu or panel open besides still does.
const DETAIL = '#detail-modal';

// A document of the elements that are open, answering the page's selectors the way the page does.
function openDoc({ active = null, open = [] } = {}) {
  const matches = (sel, el) => {
    const not = [...sel.matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1]).filter((s) => s !== '.hidden');
    const base = sel.replace(/:not\([^)]+\)/g, '');
    return el.selectors.includes(base) && !not.some((s) => el.selectors.includes(s));
  };
  return { activeElement: active, querySelector: (sel) => open.find((el) => matches(sel, el)) || null };
}
const popup = (id, ...more) => ({ selectors: [`#${id}`, ...more] });
const detail = popup('detail-modal', '.modal-backdrop');

test('with the card details named, they alone do not turn the guard off', () => {
  const doc = openDoc({ open: [detail] });
  assert.strictEqual(keyGuardSurface(doc), 'dialog');
  assert.strictEqual(keyGuardOff(doc), true, 'without the exception the card details are a dialog');
  assert.strictEqual(keyGuardSurface(doc, DETAIL), null);
  assert.strictEqual(keyGuardOff(doc, DETAIL), false);
});

test('with the card details named, any other popup open beside them still turns the guard off', () => {
  for (const other of [popup('modal', '.modal-backdrop'), popup('delete-modal', '.modal-backdrop'), popup('notif-modal', '.modal-backdrop'), popup('prefs-sheet', '.modal-backdrop')]) {
    const doc = openDoc({ open: [detail, other] });
    assert.strictEqual(keyGuardOff(doc, DETAIL), true, other.selectors[0]);
  }
  assert.strictEqual(keyGuardOff(openDoc({ open: [detail, popup('context-menu')] }), DETAIL), true, 'the card menu over the details');
});

test('with the card details named, typing in a field still turns the guard off', () => {
  assert.strictEqual(keyGuardOff(openDoc({ active: field('TEXTAREA'), open: [detail] }), DETAIL), true);
  assert.strictEqual(keyGuardOff(openDoc({ active: field('BUTTON'), open: [detail] }), DETAIL), false);
});

test('naming a popup that is not open changes nothing', () => {
  assert.strictEqual(keyGuardOff(openDoc({ open: [popup('modal', '.modal-backdrop')] }), DETAIL), true);
  assert.strictEqual(keyGuardOff(openDoc({}), DETAIL), false);
});

// --- the keys that act on the card details -----------------------------------------------------

const { KEY_GUARD_DETAIL_SURFACES, keyGuardDetailOff } = require('../web/key-guard');
const OTHER_DIALOG = `.modal-backdrop:not(.hidden):not(${DETAIL})`;

test('a key that acts on the details is off behind the notes palette, which sits above them; no other key is', () => {
  assert.deepStrictEqual(KEY_GUARD_DETAIL_SURFACES.map((s) => s.name), ['notes']);
  const palette = KEY_GUARD_DETAIL_SURFACES[0].selector;
  const doc = fakeDoc({ open: [palette] });
  assert.strictEqual(keyGuardDetailOff(doc, DETAIL), true);
  assert.strictEqual(keyGuardOff(doc, DETAIL), false, 'n and Alt+1 to Alt+3 still work with the palette up');
  assert.strictEqual(keyGuardOff(doc), false, '/ and the other keys are unchanged');
  assert.strictEqual(keyGuardSurface(doc), null);
});

test('a key that acts on the details reads the rest of the guard as any other key does', () => {
  assert.strictEqual(keyGuardDetailOff(fakeDoc(), DETAIL), false);
  assert.strictEqual(keyGuardDetailOff(fakeDoc({ active: field('TEXTAREA') }), DETAIL), true);
  assert.strictEqual(keyGuardDetailOff(fakeDoc({ open: [OTHER_DIALOG] }), DETAIL), true);
  assert.strictEqual(keyGuardDetailOff(fakeDoc({ open: ['#context-menu:not(.hidden)'] }), DETAIL), true);
  assert.strictEqual(keyGuardDetailOff(fakeDoc({ open: ['.modal-backdrop:not(.hidden)'] }), DETAIL), false, 'the details themselves are no reason');
});
