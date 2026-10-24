const { test } = require('node:test');
const assert = require('node:assert');
const t = require('../../plugin/skills/web/web/text-edit');

// The keys of the multiline text boxes (text-edit.js): given the text, the selection and the key, the
// edit to make. `at` plays an edit on the text the way the page does (replace [from, to) with insert,
// then select [start, end]), so each test reads as before and after.

const key = (k, over = {}) => ({ key: k, code: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over });
const ctrl = (k, over = {}) => key(k, { ctrlKey: true, ...over });

function play(text, start, end, e) {
  const edit = t.textEditKey(text, start, end, e);
  if (!edit) return null;
  const out = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return { text: out, sel: out.slice(edit.start, edit.end), start: edit.start, end: edit.end, edit };
}
const sel = (text, word) => [text.indexOf(word), text.indexOf(word) + word.length];
const on = (text, word, e) => play(text, ...sel(text, word), e);

// --- Tab and Shift+Tab ------------------------------------------------------------------------

test('Tab inserts two spaces at the cursor and moves the cursor past them', () => {
  const r = play('hello', 2, 2, key('Tab'));
  assert.strictEqual(r.text, 'he  llo');
  assert.deepStrictEqual([r.start, r.end], [4, 4]);
});

test('Tab on a selection inside one line replaces it with two spaces', () => {
  const r = on('say hello now', 'hello', key('Tab'));
  assert.strictEqual(r.text, 'say    now');
  assert.deepStrictEqual([r.start, r.end], [6, 6]);
});

test('Tab on several lines indents every selected line and keeps the selection on them', () => {
  const text = 'one\ntwo\nthree\nfour';
  const r = play(text, 5, 11, key('Tab'));
  assert.strictEqual(r.text, 'one\n  two\n  three\nfour');
  assert.strictEqual(r.sel, 'wo\n  thr', 'the same characters stay selected, the lines moved');
  assert.deepStrictEqual([r.edit.from, r.edit.to], [4, 13], 'one edit, over the two lines only');
});

test('Tab on a selection that ends at the start of a line leaves that line alone', () => {
  const text = 'one\ntwo\nthree';
  const r = play(text, 0, 8, key('Tab'));
  assert.strictEqual(r.text, '  one\n  two\nthree');
});

test('Tab on several lines leaves a blank line empty', () => {
  const r = play('a\n\nb', 0, 4, key('Tab'));
  assert.strictEqual(r.text, '  a\n\n  b');
});

test('Shift+Tab takes up to two spaces off the current line, and the cursor follows', () => {
  const r = play('    code', 6, 6, key('Tab', { shiftKey: true }));
  assert.strictEqual(r.text, '  code');
  assert.deepStrictEqual([r.start, r.end], [4, 4]);
});

test('Shift+Tab takes one space when there is one, and a tab character, and nothing when there is no indent', () => {
  assert.strictEqual(play(' x', 2, 2, key('Tab', { shiftKey: true })).text, 'x');
  assert.strictEqual(play('\tx', 2, 2, key('Tab', { shiftKey: true })).text, 'x');
  const none = play('x', 1, 1, key('Tab', { shiftKey: true }));
  assert.strictEqual(none.text, 'x');
  assert.deepStrictEqual([none.start, none.end], [1, 1]);
  assert.deepStrictEqual([none.edit.from, none.edit.to, none.edit.insert], [0, 1, 'x'], 'the key is still handled: the browser does not move focus');
});

test('Shift+Tab never takes more than two spaces and keeps the cursor on its line', () => {
  const r = play('   x', 1, 1, key('Tab', { shiftKey: true }));
  assert.strictEqual(r.text, ' x');
  assert.deepStrictEqual([r.start, r.end], [0, 0], 'a cursor inside the indent goes to the start of the line');
});

test('Shift+Tab on several lines outdents each, and the selection follows', () => {
  const text = '    a\n  b\nc';
  const r = play(text, 4, 9, key('Tab', { shiftKey: true }));
  assert.strictEqual(r.text, '  a\nb\nc');
  assert.strictEqual(r.sel, 'a\nb', 'the same characters stay selected');
});

test('Tab with Ctrl, Alt or Cmd is not the box\'s', () => {
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) assert.strictEqual(t.textEditKey('x', 0, 0, key('Tab', { [mod]: true })), null, mod);
});

test('a key the box does not read is no edit', () => {
  for (const e of [key('a'), key('Enter'), ctrl('s'), ctrl('Enter'), key('b'), key('ArrowDown'), key('Shift'), {}]) assert.strictEqual(t.textEditKey('x', 0, 1, e), null, JSON.stringify(e));
});

// --- Ctrl+B and Ctrl+I -------------------------------------------------------------------------------

test('Ctrl+B wraps the selection in ** and keeps it selected', () => {
  const r = on('a word here', 'word', ctrl('b'));
  assert.strictEqual(r.text, 'a **word** here');
  assert.strictEqual(r.sel, 'word');
});

test('Ctrl+B with no selection inserts the pair and puts the cursor between', () => {
  const r = play('ab', 1, 1, ctrl('b'));
  assert.strictEqual(r.text, 'a****b');
  assert.deepStrictEqual([r.start, r.end], [3, 3]);
});

test('Ctrl+B on a selection already wrapped, markers inside it, unwraps it', () => {
  const r = on('a **word** here', '**word**', ctrl('b'));
  assert.strictEqual(r.text, 'a word here');
  assert.strictEqual(r.sel, 'word');
});

test('Ctrl+B on a word with the markers just outside the selection unwraps it', () => {
  const r = on('a **word** here', 'word', ctrl('b'));
  assert.strictEqual(r.text, 'a word here');
  assert.strictEqual(r.sel, 'word');
});

test('Ctrl+B on the empty pair the cursor sits in takes the pair away', () => {
  const r = play('a****b', 3, 3, ctrl('b'));
  assert.strictEqual(r.text, 'ab');
  assert.deepStrictEqual([r.start, r.end], [1, 1]);
});

test('Ctrl+I wraps in * and unwraps it again', () => {
  const wrapped = on('a word here', 'word', ctrl('i'));
  assert.strictEqual(wrapped.text, 'a *word* here');
  assert.strictEqual(play(wrapped.text, wrapped.start, wrapped.end, ctrl('i')).text, 'a word here');
});

test('italic inside bold and bold inside italic stack and unstack as the stars say', () => {
  const bold = 'x **word** y';
  const both = on(bold, 'word', ctrl('i'));
  assert.strictEqual(both.text, 'x ***word*** y', 'italic on bold adds one star each side, it does not unwrap the bold');
  assert.strictEqual(play(both.text, both.start, both.end, ctrl('i')).text, bold, 'italic off leaves the bold');
  assert.strictEqual(play(both.text, both.start, both.end, ctrl('b')).text, 'x *word* y', 'bold off leaves the italic');
  const italic = on('x *word* y', 'word', ctrl('b'));
  assert.strictEqual(italic.text, 'x ***word*** y');
});

test('Cmd does what Ctrl does', () => {
  assert.strictEqual(on('a word', 'word', key('b', { metaKey: true })).text, 'a **word**');
});

test('a letter is read whatever its case', () => {
  assert.strictEqual(on('a word', 'word', ctrl('B')).text, 'a **word**');
});

// --- Ctrl+U, Alt+S, Ctrl+E ---------------------------------------------------------------------------

test('Ctrl+U wraps in <u> and unwraps it', () => {
  const r = on('a word here', 'word', ctrl('u'));
  assert.strictEqual(r.text, 'a <u>word</u> here');
  assert.strictEqual(r.sel, 'word');
  assert.strictEqual(play(r.text, r.start, r.end, ctrl('u')).text, 'a word here');
  assert.strictEqual(on('a <u>word</u> here', '<u>word</u>', ctrl('u')).text, 'a word here');
});

test('Alt+S wraps in ~~ and unwraps it', () => {
  const r = on('a word here', 'word', key('s', { altKey: true }));
  assert.strictEqual(r.text, 'a ~~word~~ here');
  assert.strictEqual(play(r.text, r.start, r.end, key('s', { altKey: true })).text, 'a word here');
});

test('Alt+S where Alt changes the character is found by its key position', () => {
  assert.strictEqual(on('a word', 'word', { key: 'ß', code: 'KeyS', altKey: true }).text, 'a ~~word~~');
});

test('Ctrl+E wraps in backticks and unwraps them', () => {
  const r = on('run ls now', 'ls', ctrl('e'));
  assert.strictEqual(r.text, 'run `ls` now');
  assert.strictEqual(play(r.text, r.start, r.end, ctrl('e')).text, 'run ls now');
});

test('Alt+S with Ctrl, and Ctrl+S, are not strike: Ctrl+S is the page\'s save', () => {
  assert.strictEqual(t.textEditKey('x', 0, 1, ctrl('s')), null);
  assert.strictEqual(t.textEditKey('x', 0, 1, key('s', { altKey: true, ctrlKey: true })), null);
});

// --- Ctrl+K -------------------------------------------------------------------------------------------------

test('Ctrl+K makes the selection a link and selects url, ready to be typed over', () => {
  const r = on('see the docs now', 'the docs', ctrl('k'));
  assert.strictEqual(r.text, 'see [the docs](url) now');
  assert.strictEqual(r.sel, 'url');
});

test('Ctrl+K with no selection inserts an empty link with the cursor in the brackets', () => {
  const r = play('ab', 1, 1, ctrl('k'));
  assert.strictEqual(r.text, 'a[](url)b');
  assert.deepStrictEqual([r.start, r.end], [2, 2]);
});

// --- the lists and the quote -----------------------------------------------------------------------------

const shift = (k, code) => ctrl(k, { shiftKey: true, code });

test('Ctrl+Shift+8 makes every selected line a bullet, and again takes them off', () => {
  const text = 'one\ntwo\nthree';
  const r = play(text, 0, text.length, shift('*', 'Digit8'));
  assert.strictEqual(r.text, '- one\n- two\n- three');
  assert.strictEqual(r.sel, r.text, 'the lines stay selected');
  assert.strictEqual(play(r.text, r.start, r.end, shift('*', 'Digit8')).text, text);
});

test('Ctrl+Shift+7 numbers the lines in order, and again takes the numbers off', () => {
  const text = 'one\ntwo\nthree';
  const r = play(text, 0, text.length, shift('&', 'Digit7'));
  assert.strictEqual(r.text, '1. one\n2. two\n3. three');
  assert.strictEqual(play(r.text, r.start, r.end, shift('&', 'Digit7')).text, text);
});

test('a numbered list does not number its blank lines, and keeps counting after them', () => {
  const r = play('a\n\nb', 0, 4, shift('&', 'Digit7'));
  assert.strictEqual(r.text, '1. a\n\n2. b');
});

test('Ctrl+Shift+. quotes every selected line, and again takes the quote off', () => {
  const text = 'one\ntwo';
  const r = play(text, 0, text.length, shift('>', 'Period'));
  assert.strictEqual(r.text, '> one\n> two');
  assert.strictEqual(play(r.text, r.start, r.end, shift('>', 'Period')).text, text);
});

test('a list key with no selection acts on the line the cursor is on, and no other', () => {
  const r = play('one\ntwo\nthree', 5, 5, shift('*', 'Digit8'));
  assert.strictEqual(r.text, 'one\n- two\nthree');
});

test('a list key on a selection that ends at the start of a line leaves that line alone', () => {
  const r = play('one\ntwo\nthree', 0, 8, shift('*', 'Digit8'));
  assert.strictEqual(r.text, '- one\n- two\nthree');
});

test('a list key turns a line of the other kind of list into its own', () => {
  assert.strictEqual(play('- one\n- two', 0, 11, shift('&', 'Digit7')).text, '1. one\n2. two');
  assert.strictEqual(play('1. one\n2. two', 0, 13, shift('*', 'Digit8')).text, '- one\n- two');
});

test('when only some of the lines have the marker the key adds it to all of them', () => {
  assert.strictEqual(play('- one\ntwo', 0, 9, shift('*', 'Digit8')).text, '- one\n- two');
});

test('the list keys are found by the key or by the key position', () => {
  assert.strictEqual(play('a', 0, 1, ctrl('7', { shiftKey: true })).text, '1. a');
  assert.strictEqual(play('a', 0, 1, { key: 'ë', code: 'Digit8', ctrlKey: true, shiftKey: true }).text, '- a');
  assert.strictEqual(play('a', 0, 1, { key: '≥', code: 'Period', ctrlKey: true, shiftKey: true }).text, '> a');
});

test('the list keys need Ctrl and Shift together', () => {
  assert.strictEqual(t.textEditKey('a', 0, 1, ctrl('8')), null);
  assert.strictEqual(t.textEditKey('a', 0, 1, key('8', { shiftKey: true })), null);
});

test('every edit is one replacement of the text, so it is one step of undo', () => {
  const text = 'one\ntwo\nthree\nfour';
  for (const e of [key('Tab'), key('Tab', { shiftKey: true }), ctrl('b'), ctrl('k'), shift('*', 'Digit8')]) {
    const edit = t.textEditKey(text, 4, 13, e);
    assert.ok(edit && Number.isInteger(edit.from) && Number.isInteger(edit.to) && typeof edit.insert === 'string' && edit.from <= edit.to, JSON.stringify(e));
  }
});

test('every kind of list has a key, and every list key names a kind', () => {
  const named = new Set(Object.values(t.TEXT_EDIT_MARKDOWN_KEYS).filter((k) => k.list).map((k) => k.list));
  assert.deepStrictEqual([...named].sort(), Object.keys(t.TEXT_EDIT_LISTS).sort());
});

test('a key that is a name on every object is no key', () => {
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.strictEqual(t.textEditKey('x', 0, 1, ctrl(k)), null, k);
});

// --- Ctrl+Shift+D: a collapsible section ---------------------------------------------------------------

const detailsKey = () => ctrl('D', { shiftKey: true, code: 'KeyD' });
const SECTION = (body) => `<details>\n<summary>[...]</summary>\n\n${body}\n\n</details>`;

test('Ctrl+Shift+D wraps the selected lines in a details section and selects the summary text to type over', () => {
  const text = 'before\none\ntwo\nafter';
  const r = play(text, 7, 14, detailsKey());
  assert.strictEqual(r.text, `before\n${SECTION('one\ntwo')}\nafter`);
  assert.strictEqual(r.sel, '[...]');
});

test('the section wraps whole lines, though the selection starts and ends inside them', () => {
  const r = play('one\ntwo\nthree', 1, 6, detailsKey());
  assert.strictEqual(r.text, `${SECTION('one\ntwo')}\nthree`);
});

test('a selection that ends at the start of a line leaves that line out of the section', () => {
  const r = play('one\ntwo\nthree', 0, 8, detailsKey());
  assert.strictEqual(r.text, `${SECTION('one\ntwo')}\nthree`);
});

test('with nothing selected the section goes in with an empty line in the middle, and the summary text selected', () => {
  const r = play('', 0, 0, detailsKey());
  assert.strictEqual(r.text, SECTION(''));
  assert.strictEqual(r.sel, '[...]');
});

test('with nothing selected, in the middle of a line, the section goes on lines of its own', () => {
  const r = play('ab cd', 2, 2, detailsKey());
  assert.strictEqual(r.text, `ab\n${SECTION('')}\n cd`);
  assert.strictEqual(r.sel, '[...]');
});

test('Ctrl+Shift+D with the cursor inside a section the key made takes the wrapper off and keeps the lines', () => {
  const wrapped = `before\n${SECTION('one\ntwo')}\nafter`;
  const inside = wrapped.indexOf('two') + 1;
  const r = play(wrapped, inside, inside, detailsKey());
  assert.strictEqual(r.text, 'before\none\ntwo\nafter');
  assert.strictEqual(r.sel, 'one\ntwo', 'the lines it kept are selected');
});

test('and the same with a selection inside the section, or the cursor on the summary line', () => {
  const wrapped = SECTION('one\ntwo');
  assert.strictEqual(on(wrapped, 'one', detailsKey()).text, 'one\ntwo');
  assert.strictEqual(on(wrapped, '[...]', detailsKey()).text, 'one\ntwo');
});

test('a section the key did not make is left alone: the key makes a new one instead of unwrapping it', () => {
  const text = '<details>\none\n</details>';
  const r = play(text, 10, 10, detailsKey());
  assert.strictEqual(r.text.split('<details>').length - 1, 2, 'the one that was there and the new one');
  assert.strictEqual(r.text.split('<summary>[...]</summary>').length - 1, 1);
  assert.ok(r.text.includes('</details>'), 'the old closing tag is still there');
  const whole = play(text, 0, text.length, detailsKey());
  assert.ok(whole.text.includes('<details>\none\n</details>\n\n</details>'), 'selected, it goes inside the new one');
});

test('a cursor after a section, not inside it, makes a new one', () => {
  const wrapped = `${SECTION('one')}\nafter`;
  const at = wrapped.indexOf('after');
  const r = play(wrapped, at, at + 5, detailsKey());
  assert.strictEqual(r.text, `${SECTION('one')}\n${SECTION('after')}`);
});

test('Ctrl+Shift+D needs Ctrl and Shift together, and Cmd does what Ctrl does', () => {
  assert.strictEqual(t.textEditKey('a', 0, 1, ctrl('d')), null);
  assert.strictEqual(t.textEditKey('a', 0, 1, key('D', { shiftKey: true })), null);
  assert.ok(t.textEditKey('a', 0, 1, key('D', { shiftKey: true, metaKey: true })));
});
