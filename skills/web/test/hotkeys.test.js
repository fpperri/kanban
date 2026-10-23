const { test } = require('node:test');
const assert = require('node:assert');
const { HOTKEYS, hotkeyRows, hotkeyIsHelp, hotkeySpace } = require('../web/hotkeys');

// The list the preferences sheet's Hotkeys section shows (hotkeys.js): every key the page
// answers, what it does, and the state of the ones that have one. Pure, so it is driven
// here with the state the page would hand it. hotkeys-coverage.test.js holds the list to
// the keys the page's own handlers read, and hotkeys-sheet.test.js drives the page.

const labels = (rows) => rows.flatMap((row) => row.keys);
const NOW = { names: 'relevant', pills: [], slice: '', isolate: false, panelOnFocus: true };
const rowOf = (rows, id) => rows.find((row) => row.id === id);

test('the list shows every key the page answers, each with what it does', () => {
  const rows = hotkeyRows(NOW);
  const named = ['/', 'Ctrl/Cmd+F', 'Esc', 'Enter', 'Space', 'Shift+Space', 'Ctrl+Space', 'Ctrl/Cmd+S', 'Alt+Enter', 'n', 'e', 'a', 'd d', 'l', '[', ']', '{', '}', 'm', 'i', 'p', '?'];
  assert.deepStrictEqual(named.filter((key) => !labels(rows).includes(key)), []);
  for (const row of rows) {
    assert.ok(typeof row.what === 'string' && row.what.length > 8, `${row.id} says what it does`);
    assert.ok(row.keys.length > 0, `${row.id} names its keys`);
  }
});

test('every entry has its own id and the list is the same list whatever state it is given', () => {
  const ids = HOTKEYS.map((entry) => entry.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.deepStrictEqual(hotkeyRows(NOW).map((row) => row.id), ids);
  assert.deepStrictEqual(hotkeyRows({}).map((row) => row.id), ids);
});

// --- the state of the keys that have one --------------------------------------------------------

const stateOf = (ctx, id) => rowOf(hotkeyRows(ctx), id).state;

test('a key with a state shows it as the card words it: names, pill, slice, isolate and panel on focus', () => {
  const rows = hotkeyRows({ names: 'relevant', pills: ['review'], slice: 'goal..1', isolate: false, panelOnFocus: true });
  assert.strictEqual(rowOf(rows, 'names').state, 'names: relevant');
  assert.strictEqual(rowOf(rows, 'pill').state, 'pill: review');
  assert.strictEqual(rowOf(rows, 'slice').state, 'slice: goal..1');
  assert.strictEqual(rowOf(rows, 'isolate').state, 'isolate: off');
  assert.strictEqual(rowOf(rows, 'panel').state, 'panel on focus: on');
});

test('only the keys that have a state show one', () => {
  const stateful = hotkeyRows(NOW).filter((row) => row.state !== null).map((row) => row.id);
  assert.deepStrictEqual(stateful, ['names', 'slice', 'pill', 'isolate', 'panel']);
});

test('the state follows what is given: names, a cut, pills on, isolate and the panel switch', () => {
  assert.strictEqual(stateOf({ ...NOW, names: 'none' }, 'names'), 'names: none');
  assert.strictEqual(stateOf({ ...NOW, names: 'all' }, 'names'), 'names: all');
  assert.strictEqual(stateOf({ ...NOW, isolate: true }, 'isolate'), 'isolate: on');
  assert.strictEqual(stateOf({ ...NOW, panelOnFocus: false }, 'panel'), 'panel on focus: off');
  assert.strictEqual(stateOf({ ...NOW, slice: '..objective' }, 'slice'), 'slice: ..objective');
});

test('no cut reads all, and no pill on reads off, several pills on read as a list', () => {
  assert.strictEqual(stateOf({ ...NOW, slice: '' }, 'slice'), 'slice: all');
  assert.strictEqual(stateOf({ ...NOW, pills: [] }, 'pill'), 'pill: off');
  assert.strictEqual(stateOf({ ...NOW, pills: ['blocked', 'next'] }, 'pill'), 'pill: blocked, next');
});

test('a state the caller leaves out reads as the page\'s own default, so the list never shows undefined', () => {
  const rows = hotkeyRows({});
  assert.deepStrictEqual(rows.filter((row) => row.state !== null).map((row) => row.state),
    ['names: relevant', 'slice: all', 'pill: off', 'isolate: off', 'panel on focus: on']);
  for (const row of hotkeyRows(undefined)) assert.ok(row.state === null || !/undefined|null/.test(row.state), row.id);
});

test('the list is not changed by asking for it with a state', () => {
  const before = JSON.stringify(HOTKEYS);
  hotkeyRows({ names: 'all', pills: ['x'], slice: 'epic', isolate: true, panelOnFocus: false });
  assert.strictEqual(JSON.stringify(HOTKEYS), before);
});

// --- the ? key -----------------------------------------------------------------------------------

const press = (key, over = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...over });

test('? is the help key, with Shift as a US keyboard types it and without it as another layout does', () => {
  assert.strictEqual(hotkeyIsHelp(press('?', { shiftKey: true })), true);
  assert.strictEqual(hotkeyIsHelp(press('?')), true);
});

test('no other key, and no chord with Ctrl, Cmd or Alt, and no held key, is the help key', () => {
  assert.strictEqual(hotkeyIsHelp(press('/')), false);
  assert.strictEqual(hotkeyIsHelp(press('h')), false);
  assert.strictEqual(hotkeyIsHelp(press('?', { ctrlKey: true })), false);
  assert.strictEqual(hotkeyIsHelp(press('?', { metaKey: true })), false);
  assert.strictEqual(hotkeyIsHelp(press('?', { altKey: true })), false);
  assert.strictEqual(hotkeyIsHelp(press('?', { repeat: true })), false);
  assert.strictEqual(hotkeyIsHelp({}), false);
  assert.strictEqual(hotkeyIsHelp(null), false);
});

test('the n line says it notes the card whose details are open, ahead of the hovered or selected card', () => {
  const what = rowOf(hotkeyRows(NOW), 'note').what;
  assert.match(what, /card whose details are open/);
  assert.ok(what.indexOf('details are open') < what.indexOf('hovered or selected'), 'the open details come first');
  assert.match(what, /With no card, on the Calendar it opens on the Calendar's own range, or on the day under the pointer; elsewhere on today/);
});

test('Alt+1 to Alt+4 are listed together as the notes palette\'s tab keys', () => {
  const row = rowOf(hotkeyRows(NOW), 'note-tabs');
  assert.deepStrictEqual(row.keys, ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4']);
  assert.match(row.what, /notes palette/);
  assert.match(row.what, /first, second, third or fourth tab/);
  assert.match(row.what, /Todos/);
  assert.strictEqual(row.state, null);
});

// --- Space, Shift+Space and Ctrl+Space ----------------------------------------------------------

const spaceKey = (over = {}) => ({ key: ' ', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...over });

test('Space writes the hovered card\'s sets, Shift+Space adds them, and Ctrl or Cmd with Space selects the focused card', () => {
  assert.strictEqual(hotkeySpace(spaceKey()), 'write');
  assert.strictEqual(hotkeySpace(spaceKey({ shiftKey: true })), 'add');
  assert.strictEqual(hotkeySpace(spaceKey({ ctrlKey: true })), 'select');
  assert.strictEqual(hotkeySpace(spaceKey({ metaKey: true })), 'select');
});

test('any other chord with Space, a held key and any other key are not Space\'s', () => {
  assert.strictEqual(hotkeySpace(spaceKey({ altKey: true })), null);
  assert.strictEqual(hotkeySpace(spaceKey({ ctrlKey: true, shiftKey: true })), null);
  assert.strictEqual(hotkeySpace(spaceKey({ ctrlKey: true, altKey: true })), null);
  assert.strictEqual(hotkeySpace(spaceKey({ repeat: true })), null);
  assert.strictEqual(hotkeySpace(spaceKey({ ctrlKey: true, repeat: true })), null);
  assert.strictEqual(hotkeySpace(spaceKey({ key: 'Enter' })), null);
  assert.strictEqual(hotkeySpace(spaceKey({ key: 's' })), null);
  assert.strictEqual(hotkeySpace(null), null);
});

test('the list names the three: Space and Shift+Space write, Ctrl+Space selects, and each says what it does', () => {
  const rows = hotkeyRows(NOW);
  assert.deepStrictEqual(rowOf(rows, 'space').keys, ['Space', 'Shift+Space']);
  assert.match(rowOf(rows, 'space').what, /On hover show/);
  assert.match(rowOf(rows, 'space').what, /dlinks:12 \| hlinks:12/);
  assert.match(rowOf(rows, 'space').what, /isolate as it was/);
  assert.match(rowOf(rows, 'space').what, /keeps its own job/, 'with no card, in a field, on a control');
  assert.deepStrictEqual(rowOf(rows, 'space-select').keys, ['Ctrl+Space']);
  assert.match(rowOf(rows, 'space-select').what, /Select the focused card in the Graph/);
  assert.ok(!/Select the focused card/.test(rowOf(rows, 'space').what), 'Space no longer selects');
});
