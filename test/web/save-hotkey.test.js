const { test } = require('node:test');
const assert = require('node:assert');
const { saveHotkeyTarget, SAVE_ORDER } = require('../web/save-hotkey');

// Ctrl+S / Cmd+S saves the open popup instead of triggering the
// browser's save-page dialog. Pure chord + target-resolution logic; the DOM
// wiring in app.js is a thin preventDefault + requestSubmit/click shim.

const editOpen = { edit: true, bulkSingle: false, bulkSchedule: false };

test('Ctrl+S with the edit modal open targets the edit form', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, editOpen), 'edit');
});

test('Cmd+S (mac) matches identically', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }, editOpen), 'edit');
});

test('uppercase S (CapsLock) still matches', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 'S', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, editOpen), 'edit');
});

test('both Ctrl and Meta held still matches (either modifier suffices)', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: true, altKey: false, shiftKey: false }, editOpen), 'edit');
});

test('bare s without a modifier never matches (typing in a field)', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, editOpen), null);
});

test('Shift chord (save-as muscle memory) is excluded', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, editOpen), null);
});

test('Alt chord is excluded', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }, editOpen), null);
});

test('a different key never matches', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 'a', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, editOpen), null);
});

test('no save-capable popup open: valid chord returns null (browser default stands)', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { edit: false, bulkSingle: false, bulkSchedule: false }), null);
});

test('bulkSingle open targets bulkSingle', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { edit: false, bulkSingle: true, bulkSchedule: false }), 'bulkSingle');
});

test('bulkSchedule open targets bulkSchedule', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { edit: false, bulkSingle: false, bulkSchedule: true }), 'bulkSchedule');
});

test('edit wins deterministic priority if flags ever overlap', () => {
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, { edit: true, bulkSingle: true, bulkSchedule: true }), 'edit');
});

test('missing arguments resolve to null, never throw', () => {
  assert.strictEqual(saveHotkeyTarget(null, editOpen), null);
  assert.strictEqual(saveHotkeyTarget({ key: 's', ctrlKey: true }, null), null);
  assert.strictEqual(saveHotkeyTarget({ ctrlKey: true }, editOpen), null);
});

test('SAVE_ORDER carries exactly the one-unambiguous-action popups (bulk-tags stays out)', () => {
  assert.deepStrictEqual(SAVE_ORDER, ['edit', 'bulkSingle', 'bulkSchedule']);
});
