const { test } = require('node:test');
const assert = require('node:assert');
const { searchHotkeyPrefill, searchHashStrip } = require('../../plugin/skills/web/web/search-hotkey');

// Ctrl+F / Cmd+F focuses the search box instead of the
// browser's own find bar, pre-filling "#" (caret right after) so digits
// immediately form the #<id> exact-match term. Pure chord + value-decision
// logic; the DOM wiring in app.js is a thin preventDefault + focus/value/
// setSelectionRange shim, same split as save-hotkey.js.

const noSurface = { surfaceOpen: false, currentValue: '' };

test('Ctrl+F on an empty box prefills "#" with the caret right after it', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, noSurface),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('Cmd+F (mac) matches identically', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }, noSurface),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('uppercase F (CapsLock) still matches', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'F', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, noSurface),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('both Ctrl and Meta held still matches (either modifier suffices)', () => {
  assert.deepStrictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: true, altKey: false, shiftKey: false }, noSurface),
    { value: '#', selectionStart: 1, selectionEnd: 1 },
  );
});

test('bare f without a modifier never matches (typing in a field)', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, noSurface),
    null,
  );
});

test('Shift chord is excluded', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }, noSurface),
    null,
  );
});

test('Alt chord is excluded', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'f', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }, noSurface),
    null,
  );
});

test('a different key never matches', () => {
  assert.strictEqual(
    searchHotkeyPrefill({ key: 'g', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, noSurface),
    null,
  );
});

test('a box with an existing query gets select-all, not clobbered with "#"', () => {
  const chord = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.deepStrictEqual(
    searchHotkeyPrefill(chord, { surfaceOpen: false, currentValue: 'status:doing' }),
    { value: 'status:doing', selectionStart: 0, selectionEnd: 12 },
  );
});

test('an already-typed bare "#" (mid #<id> entry) still selects, never re-clobbers', () => {
  const chord = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.deepStrictEqual(
    searchHotkeyPrefill(chord, { surfaceOpen: false, currentValue: '#4' }),
    { value: '#4', selectionStart: 0, selectionEnd: 2 },
  );
});

test('suppressed while a surface is open (a popup, the card menu, the notifications panel, the preferences sheet): valid chord returns null (browser find stands)', () => {
  const chord = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.strictEqual(searchHotkeyPrefill(chord, { surfaceOpen: true, currentValue: '' }), null);
  assert.strictEqual(searchHotkeyPrefill(chord, { surfaceOpen: true, currentValue: 'status:doing' }), null);
});

test('missing arguments resolve to null, never throw', () => {
  assert.strictEqual(searchHotkeyPrefill(null, noSurface), null);
  assert.strictEqual(searchHotkeyPrefill({ key: 'f', ctrlKey: true }, null), null);
  assert.strictEqual(searchHotkeyPrefill({ ctrlKey: true }, noSurface), null);
});

// small correction — the "#" the hotkey prefills is only
// meant to stick around while the user is actually typing an id (digits).
// The moment a non-numeric char lands after it, this drops the leading "#"
// so the box reads as a plain search term instead of a broken #<id> one.

test('bare "#" (nothing typed yet) is left alone', () => {
  assert.strictEqual(searchHashStrip('#'), null);
});

test('"#" followed by digits is left alone (still forming an id)', () => {
  assert.strictEqual(searchHashStrip('#1'), null);
  assert.strictEqual(searchHashStrip('#42'), null);
});

test('"#" followed by a prefix and digits is left alone too: #G7 is an id', () => {
  assert.strictEqual(searchHashStrip('#G'), null);
  assert.strictEqual(searchHashStrip('#G7'), null);
  assert.strictEqual(searchHashStrip('#_12'), null);
});

test('a lower-case letter after a prefix is no id, so the "#" goes', () => {
  assert.strictEqual(searchHashStrip('#Gx'), 'Gx');
});

test('a non-numeric char right after "#" strips the "#"', () => {
  assert.strictEqual(searchHashStrip('#a'), 'a');
});

test('a non-numeric char after some digits strips the "#", keeping the rest', () => {
  assert.strictEqual(searchHashStrip('#12a'), '12a');
});

test('a value with no leading "#" is left alone', () => {
  assert.strictEqual(searchHashStrip('status:doing'), null);
  assert.strictEqual(searchHashStrip(''), null);
});

test('non-string input resolves to null, never throws', () => {
  assert.strictEqual(searchHashStrip(null), null);
  assert.strictEqual(searchHashStrip(undefined), null);
});

// The strip is only for a box that holds one id-in-progress token. Isolate
// writes queries like "#12 | path:40", and a person types "#12 | #14", so a
// second token, a bar or a space after the id must not cost the leading "#".

test('typing "#12 | #14" keeps the leading "#" at every keystroke', () => {
  const typed = '#12 | #14';
  for (let n = 1; n <= typed.length; n++) {
    assert.strictEqual(searchHashStrip(typed.slice(0, n)), null, JSON.stringify(typed.slice(0, n)));
  }
});

test('a box holding more than one token keeps its leading "#", whatever follows the id', () => {
  assert.strictEqual(searchHashStrip('#12 | path:40'), null);
  assert.strictEqual(searchHashStrip('#12 status:doing'), null);
  assert.strictEqual(searchHashStrip('#12 x'), null);
  assert.strictEqual(searchHashStrip('#12 '), null, 'a space after the digits is not the id gone wrong');
  assert.strictEqual(searchHashStrip('#12 | tags:ui (status:doing | #14)'), null);
});

test('a box that is one token still loses the "#" when the token stops being an id', () => {
  assert.strictEqual(searchHashStrip('#a'), 'a');
  assert.strictEqual(searchHashStrip('#12a'), '12a');
  assert.strictEqual(searchHashStrip('#fix '), 'fix ', 'trailing space does not hide a second token that is not there');
  assert.strictEqual(searchHashStrip('#tags:ui'), 'tags:ui');
});

// The notes palette's own Ctrl+F: the note box gets "#" while it is empty and no card is aimed,
// and the id typed after it narrows the list to that card.

const { notesFindPrefill, notesFindScope } = require('../../plugin/skills/web/web/search-hotkey');

const ctrlF = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
const emptyBox = { tab: 'notes', subjectKind: 'none', boxValue: '' };

test('notes: Ctrl+F or Cmd+F on an empty note box with no card aimed puts "#" in it, caret after', () => {
  const want = { value: '#', selectionStart: 1, selectionEnd: 1 };
  assert.deepStrictEqual(notesFindPrefill(ctrlF, emptyBox), want);
  assert.deepStrictEqual(notesFindPrefill({ ...ctrlF, ctrlKey: false, metaKey: true }, emptyBox), want);
  assert.deepStrictEqual(notesFindPrefill({ ...ctrlF, key: 'F' }, emptyBox), want);
  for (const subjectKind of ['slot', 'untimed']) assert.deepStrictEqual(notesFindPrefill(ctrlF, { ...emptyBox, subjectKind }), want, subjectKind);
});

test('notes: text in the note box, or a card, group or several cards aimed, leaves Ctrl+F to the browser', () => {
  assert.strictEqual(notesFindPrefill(ctrlF, { ...emptyBox, boxValue: 'half a note' }), null);
  assert.strictEqual(notesFindPrefill(ctrlF, { ...emptyBox, boxValue: '#' }), null);
  assert.strictEqual(notesFindPrefill(ctrlF, { ...emptyBox, boxValue: ' ' }), null);
  for (const subjectKind of ['card', 'group', 'each']) assert.strictEqual(notesFindPrefill(ctrlF, { ...emptyBox, subjectKind }), null, subjectKind);
});

test('notes: a tab with no note box, another chord or no context is not the palette\'s', () => {
  for (const tab of ['group', 'scratch', 'todos']) assert.strictEqual(notesFindPrefill(ctrlF, { ...emptyBox, tab }), null, tab);
  assert.strictEqual(notesFindPrefill({ ...ctrlF, shiftKey: true }, emptyBox), null);
  assert.strictEqual(notesFindPrefill({ ...ctrlF, altKey: true }, emptyBox), null);
  assert.strictEqual(notesFindPrefill({ ...ctrlF, ctrlKey: false }, emptyBox), null);
  assert.strictEqual(notesFindPrefill({ ...ctrlF, key: 'g' }, emptyBox), null);
  assert.strictEqual(notesFindPrefill(null, emptyBox), null);
  assert.strictEqual(notesFindPrefill(ctrlF, null), null);
});

test('notes: a box holding "#" and a whole id scopes the list to that card', () => {
  assert.strictEqual(notesFindScope('#23'), '23');
  assert.strictEqual(notesFindScope('#2'), '2', 'live: the first digit already scopes');
  assert.strictEqual(notesFindScope('#G7'), 'G7');
  assert.strictEqual(notesFindScope('#_12'), '_12');
  assert.strictEqual(notesFindScope('#0023'), '23', 'the id is its number, as the board reads it');
  assert.strictEqual(notesFindScope('#23 '), '23', 'a trailing space is not a second token');
});

test('notes: "#" alone or with a prefix so far scopes nothing: the list stays whole', () => {
  assert.strictEqual(notesFindScope('#'), null);
  assert.strictEqual(notesFindScope('#G'), null);
  assert.strictEqual(notesFindScope('#_'), null);
});

test('notes: anything that is not "#" and an id puts the list back', () => {
  for (const v of ['', '23', '#a', '#12a', '#12 note', '# 12', 'note #12', '#12\n', '#12 | #14', '#g7', null, undefined, 12]) assert.strictEqual(notesFindScope(v), null, JSON.stringify(v));
});
