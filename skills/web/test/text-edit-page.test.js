const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette, note } = require('./helpers/palette-page');

// The multiline boxes' keys in the real page (helpers/palette-page.js): Tab and the Markdown keys in the
// notes palette's note box, a note's edit box, the Scratchpad's box and the card form's description, the
// Ctrl+M switch, and the fields they leave alone. The rules are text-edit.js, tested apart; the browser
// runner drives the same in Chrome (scenarios/notes.js).

const WEB = path.join(__dirname, '..', 'web');
const NOTES = [note('2026-10-15', '7', '09:30', '@human', 'a note to edit')];

async function open(extra = {}) {
  const p = await openPalette({ notes: NOTES, ...extra });
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.box = p.ui().input;
  return p;
}

// Type `text` into a box and select [start, end).
function fill(p, box, text, start = text.length, end = start) {
  box.value = text;
  box.setSelectionRange(start, end);
  box.focus();
}

function press(box, k, over = {}) {
  const e = { key: k, code: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, currentTarget: box, target: box, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
  box.fire('keydown', e);
  return e;
}
const ctrl = (over = {}) => ({ ctrlKey: true, ...over });

test('Tab in the note box indents at the cursor, keeps focus there, and the key goes no further', async () => {
  const p = await open();
  fill(p, p.box, 'ab', 1);
  const e = press(p.box, 'Tab');
  assert.strictEqual(p.box.value, 'a  b');
  assert.deepStrictEqual([p.box.selectionStart, p.box.selectionEnd], [3, 3]);
  assert.strictEqual(e.prevented, true, 'the browser does not move focus');
  assert.strictEqual(e.stopped, true);
  assert.strictEqual(p.doc.activeElement.uid, p.box.uid, 'focus is still in the box');
});

test('an edit goes through the browser\'s editing command, which fires the input event, so the preview line follows', async () => {
  const p = await open();
  let inputs = 0;
  p.box.addEventListener('input', () => { inputs += 1; });
  fill(p, p.box, '', 0);
  press(p.box, 'Tab');
  assert.strictEqual(inputs, 1, 'once, from the command');
  assert.strictEqual(p.box.value, '  ');
});

test('where the editing command is refused the text is replaced directly and the input event fired once', async () => {
  const p = await open();
  p.extras.refuseExecCommand = true;
  let inputs = 0;
  p.box.addEventListener('input', () => { inputs += 1; });
  fill(p, p.box, 'ab', 1);
  press(p.box, 'Tab');
  assert.strictEqual(p.box.value, 'a  b');
  assert.strictEqual(inputs, 1);
  assert.deepStrictEqual([p.box.selectionStart, p.box.selectionEnd], [3, 3]);
});

test('Tab on several lines indents them all and keeps them selected', async () => {
  const p = await open();
  fill(p, p.box, 'one\ntwo\nthree', 0, 13);
  press(p.box, 'Tab');
  assert.strictEqual(p.box.value, '  one\n  two\n  three');
  assert.deepStrictEqual([p.box.selectionStart, p.box.selectionEnd], [2, 19]);
});

test('Shift+Tab outdents the line, and does nothing but hold focus when there is nothing to take off', async () => {
  const p = await open();
  fill(p, p.box, '    code', 6);
  press(p.box, 'Tab', { shiftKey: true });
  assert.strictEqual(p.box.value, '  code');
  fill(p, p.box, 'code', 2);
  const e = press(p.box, 'Tab', { shiftKey: true });
  assert.strictEqual(p.box.value, 'code');
  assert.strictEqual(e.prevented, true);
});

test('Ctrl+B wraps the selected word in the note box and keeps the word selected', async () => {
  const p = await open();
  fill(p, p.box, 'a word here', 2, 6);
  const e = press(p.box, 'b', ctrl());
  assert.strictEqual(p.box.value, 'a **word** here');
  assert.deepStrictEqual([p.box.selectionStart, p.box.selectionEnd], [4, 8]);
  assert.strictEqual(e.prevented, true, 'bold is not the browser\'s');
  press(p.box, 'b', ctrl());
  assert.strictEqual(p.box.value, 'a word here');
});

test('the browser\'s own action is stopped for Ctrl+U, Ctrl+K and Ctrl+E in the box', async () => {
  const p = await open();
  for (const k of ['u', 'k', 'e']) {
    fill(p, p.box, 'word', 0, 4);
    assert.strictEqual(press(p.box, k, ctrl()).prevented, true, k);
  }
});

test('Enter, Shift+Enter, Ctrl+Enter and Ctrl+S are not read here, so each box keeps its own meaning for them', async () => {
  const description = require('./helpers/palette-page').paletteDocument({ document: null }).createElement('textarea');
  await openPalette({ notes: NOTES, elements: { '#f-body': description } });
  description.value = 'text';
  description.setSelectionRange(2, 2);
  for (const [k, over] of [['Enter', {}], ['Enter', { shiftKey: true }], ['Enter', ctrl()], ['s', ctrl()], ['a', {}]]) {
    const e = press(description, k, over);
    assert.strictEqual(e.prevented, undefined, `${over.ctrlKey ? 'Ctrl+' : ''}${over.shiftKey ? 'Shift+' : ''}${k}`);
    assert.strictEqual(e.stopped, undefined);
  }
  assert.strictEqual(description.value, 'text');
});

test('a key while the input method is composing is left alone', async () => {
  const p = await open();
  fill(p, p.box, 'ab', 1);
  assert.strictEqual(press(p.box, 'Tab', { isComposing: true }).prevented, undefined);
});

test('a note\'s edit box takes the keys too, and the box still grows with what is written', async () => {
  const p = await open();
  p.press(p.ui().body, 'e', { target: p.all('.np-note')[0] });
  const box = p.find('.np-edit-text');
  fill(p, box, 'line', 0, 4);
  press(box, 'i', ctrl());
  assert.strictEqual(box.value, '*line*');
  press(box, 'Tab');
  assert.strictEqual(box.value, '*  *', 'the selected word is replaced by the indent, as an editor does');
});

test('the filter, the time field and the other single-line fields are not attached: Tab stays the browser\'s', async () => {
  const p = await open();
  for (const field of [p.ui().filter, p.ui().time]) assert.strictEqual(field.dataset.textEdit, undefined);
  assert.strictEqual(p.box.dataset.textEdit, '1');
});

test('the Scratchpad\'s box takes the keys: scratchPanel attaches it', async () => {
  const p = await open({ scratchpad: { folder: 'scratch', targets: [] } });
  const panel = p.page.run("scratchPanel('7')");
  const box = panel.querySelector('.sp-text');
  assert.strictEqual(box.dataset.textEdit, '1');
});

test('the card form\'s description takes the keys, and its single-line fields do not', async () => {
  const doc = require('./helpers/palette-page').paletteDocument({ document: null });
  const body = doc.createElement('textarea');
  const title = doc.createElement('input');
  const p = await openPalette({ notes: NOTES, elements: { '#f-body': body, '#f-title': title } });
  assert.strictEqual(body.dataset.textEdit, '1');
  assert.strictEqual(title.dataset.textEdit, undefined);
  p.page.ctx.document.activeElement = body;
  body.value = 'x';
  body.setSelectionRange(0, 1);
  body.focus = () => {};
  assert.strictEqual(press(body, 'b', ctrl()).prevented, true);
});

// --- Ctrl+M ---------------------------------------------------------------------------------------

test('Ctrl+M makes Tab move focus, with a hint saying so, and again makes it indent', async () => {
  const p = await open();
  fill(p, p.box, 'ab', 1);
  const m = press(p.box, 'm', ctrl());
  assert.strictEqual(m.prevented, true);
  const hint = p.doc.body.querySelector('.text-edit-hint');
  assert.ok(hint && !hint.hidden, 'the hint shows');
  assert.match(p.text(hint), /Tab moves focus/);
  assert.match(p.text(hint), /Ctrl\+M/);
  const tab = press(p.box, 'Tab');
  assert.strictEqual(tab.prevented, undefined, 'Tab is the browser\'s');
  assert.strictEqual(p.box.value, 'ab');
  press(p.box, 'm', ctrl());
  assert.strictEqual(hint.hidden, true);
  press(p.box, 'Tab');
  assert.strictEqual(p.box.value, 'a  b');
});

test('with Tab moving focus the Markdown keys still work', async () => {
  const p = await open();
  fill(p, p.box, 'word', 0, 4);
  press(p.box, 'm', ctrl());
  press(p.box, 'b', ctrl());
  assert.strictEqual(p.box.value, '**word**');
});

test('the hint shows only while an attached box has focus', async () => {
  const p = await open();
  fill(p, p.box, 'x', 0);
  press(p.box, 'm', ctrl());
  const hint = p.doc.body.querySelector('.text-edit-hint');
  assert.strictEqual(hint.hidden, false);
  p.doc.activeElement = null;
  p.box.fire('blur', {});
  assert.strictEqual(hint.hidden, true);
  p.box.focus();
  p.box.fire('focus', {});
  assert.strictEqual(hint.hidden, false);
});

test('the setting is the page\'s: it is not kept in storage', async () => {
  const p = await open();
  fill(p, p.box, 'x', 0);
  press(p.box, 'm', ctrl());
  assert.deepStrictEqual(Object.keys(p.stored).filter((k) => /tab|focus|text/i.test(k)), []);
  const src = fs.readFileSync(path.join(WEB, 'text-edit-ui.js'), 'utf8');
  assert.ok(!/localStorage|sessionStorage|prefsStorage/.test(src));
});

test('Ctrl+M in another field, or with another modifier, is not the switch', async () => {
  const p = await open();
  fill(p, p.box, 'x', 0);
  press(p.box, 'm', ctrl({ shiftKey: true }));
  press(p.box, 'm', { altKey: true });
  press(p.box, 'm');
  assert.strictEqual(p.doc.body.querySelector('.text-edit-hint'), null);
  assert.strictEqual(press(p.box, 'Tab').prevented, true);
});
