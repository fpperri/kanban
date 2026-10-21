'use strict';
// The multiline text boxes' keys on the page: the notes palette's note box and a note's edit box, the
// Scratchpad tab's box and the card form's description each call textEditAttach(box) once, and Tab then
// indents, Shift+Tab outdents and Ctrl+B, Ctrl+I, Ctrl+U, Alt+S, Ctrl+E, Ctrl+K, Ctrl+Shift+7,
// Ctrl+Shift+8 and Ctrl+Shift+. format Markdown (text-edit.js has the rules; hotkeys.js lists the keys).
// A key the box handles has its browser action stopped, here and only while the box has focus: Ctrl+U
// would view the source and Ctrl+K and Ctrl+E reach the address bar. Enter, Shift+Enter, Ctrl+Enter and
// Ctrl+S are not read here, so each box keeps its own meaning for them. A single-line field is never
// attached, so Tab leaves it as the browser does.
//
// An edit is made with the browser's own editing command, so Undo takes it back in one step; where the
// command is refused the text is replaced directly and the input event fired by hand.
//
// Ctrl+M switches "Tab moves focus" for a person using the keyboard alone, as in VS Code: while it is on
// Tab is left to the browser in every attached box, and a muted hint says so. It lasts until the page
// is reloaded and is no board's.
//
// This script reads text-edit.js's textEditKey at the moment it runs, never when it loads.

let textEditTabMovesFocus = false;
let textEditHint = null;

function textEditAttach(box) {
  if (!box || box.dataset.textEdit) return;
  box.dataset.textEdit = '1';
  box.addEventListener('keydown', onTextEditKey);
  box.addEventListener('focus', textEditPaintHint);
  box.addEventListener('blur', textEditPaintHint);
}

function textEditApply(box, edit) {
  const before = box.value;
  if (before.slice(edit.from, edit.to) !== edit.insert) {
    box.setSelectionRange(edit.from, edit.to);
    let done = false;
    try { done = document.execCommand(edit.insert === '' ? 'delete' : 'insertText', false, edit.insert); }
    catch (e) { done = false; }
    if (!done || box.value === before) {
      box.setRangeText(edit.insert, edit.from, edit.to, 'end');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  box.setSelectionRange(edit.start, edit.end);
}

function onTextEditKey(e) {
  if (e.isComposing || typeof e.key !== 'string') return;
  const box = e.currentTarget || e.target;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    e.stopPropagation();
    textEditTabMovesFocus = !textEditTabMovesFocus;
    textEditPaintHint();
    return;
  }
  if (e.key === 'Tab' && textEditTabMovesFocus) return;
  const edit = textEditKey(box.value, box.selectionStart, box.selectionEnd, e);
  if (!edit) return;
  e.preventDefault();
  e.stopPropagation();
  textEditApply(box, edit);
}

// The hint shows while Tab moves focus and an attached box has focus.
function textEditPaintHint() {
  const at = document.activeElement;
  const show = textEditTabMovesFocus && !!at && !!at.dataset && !!at.dataset.textEdit;
  if (!textEditHint) {
    if (!show) return;
    textEditHint = document.createElement('div');
    textEditHint.id = 'text-edit-hint';
    textEditHint.className = 'text-edit-hint';
    textEditHint.setAttribute('role', 'status');
    textEditHint.textContent = 'Tab moves focus · Ctrl+M to indent with Tab again';
    document.body.append(textEditHint);
  }
  textEditHint.hidden = !show;
}
