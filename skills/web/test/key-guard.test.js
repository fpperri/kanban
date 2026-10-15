const { test } = require('node:test');
const assert = require('node:assert');
const { KEY_GUARD_SURFACES, keyGuardTyping, keyGuardSurface, keyGuardOff } = require('../web/key-guard');

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
