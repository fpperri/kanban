'use strict';
// The colours of the Markdown boxes on the page: the card form's description and the Scratchpad's Edit
// box call mdEditAttach(box) once, and the text in them is then drawn in colour (markdown-edit.js has
// the rules, the --md-edit-* tokens in app.css the colours).
//
// A coloured copy of the text sits behind the textarea in a <pre> that takes the textarea's font, padding,
// border, wrapping and size, so each word is where the textarea has it, and the textarea's own text is
// transparent (its caret, selection and spellcheck stay). The textarea is still the one place the text
// lives: typing, Undo, composing, Tab and the editing keys, Ctrl+S and Ctrl+Enter all reach it as they
// did. The copy is redrawn from the textarea's value on every input, whenever code sets the value, when
// the box is resized (it grows with its text, a person drags it, the popup goes full screen, the phone
// layout takes over) and when the switch is flipped, and its scroll follows the textarea's. Only colours
// are ever applied, never weight, style or size, so no line can wrap differently from the textarea's.
//
// Colour Markdown while editing is a switch in the preferences sheet (app.js keeps it, mdEditSetOn
// applies it). While it is off the wrapper has no box of its own and the textarea sits in the page as it
// always did.
//
// mdEditAttach returns the node to put in the page where the textarea went: the wrapper, which holds the
// textarea. Called with the textarea already in the page it takes its place there and the caller keeps
// nothing to do. This script reads markdown-edit.js's markdownEditSpans at the moment it runs, never
// when it loads.

let mdEditOn = true;
const mdEditEntries = new Set();
const mdEditWraps = new WeakMap();

// What the copy takes from the textarea, so a line breaks where the textarea's does.
const MD_EDIT_COPY = [
  'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textTransform', 'textIndent', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
];

// The text as nodes: plain stretches as text, each span in an element of its kind. A text that ends in a
// newline gets a space after it, since an empty last line is otherwise not drawn.
function mdEditNodes(text) {
  const nodes = document.createDocumentFragment();
  let at = 0;
  const plain = (to) => { if (to > at) nodes.append(document.createTextNode(text.slice(at, to))); };
  for (const span of markdownEditSpans(text)) {
    plain(span.from);
    const el = document.createElement('span');
    el.className = `md-edit-${span.kind}`;
    el.textContent = text.slice(span.from, span.to);
    nodes.append(el);
    at = span.to;
  }
  plain(text.length);
  if (text.endsWith('\n')) nodes.append(document.createTextNode(' '));
  return nodes;
}

// Draws the copy again: the textarea's metrics, then its text, then its scroll. A scrollbar on the
// textarea narrows the width its text wraps in, so the copy gives up the same width on its right.
function mdEditPaint(entry) {
  if (!mdEditOn) return;
  const { box, back } = entry;
  const cs = getComputedStyle(box);
  for (const prop of MD_EDIT_COPY) back.style[prop] = cs[prop];
  const bar = Math.max(0, box.offsetWidth - box.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth));
  back.style.paddingRight = `${parseFloat(cs.paddingRight) + bar}px`;
  back.replaceChildren(mdEditNodes(box.value));
  back.scrollTop = box.scrollTop;
}

function mdEditApply(entry) {
  entry.wrap.classList.toggle('on', mdEditOn);
  if (mdEditOn) mdEditPaint(entry);
  else entry.back.replaceChildren();
}

// Code sets a textarea's value (a card opened into the form, a saved page loaded): the copy has to follow
// without an input event. The box's own accessor is wrapped, not the prototype's, so no other textarea is
// touched.
function mdEditWatchValue(box, repaint) {
  let desc = null;
  for (let o = box; o && !desc; o = Object.getPrototypeOf(o)) desc = Object.getOwnPropertyDescriptor(o, 'value');
  if (!desc || !desc.get || !desc.set) return;
  Object.defineProperty(box, 'value', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(box); },
    set(v) { desc.set.call(box, v); repaint(); },
  });
}

function mdEditAttach(box) {
  if (!box || box.dataset.mdEdit) return mdEditWraps.get(box) || box;
  box.dataset.mdEdit = '1';
  for (const old of [...mdEditEntries]) if (!old.wrap.isConnected) mdEditEntries.delete(old);
  const wrap = document.createElement('div');
  wrap.className = 'md-edit';
  const back = document.createElement('pre');
  back.className = 'md-edit-back';
  back.setAttribute('aria-hidden', 'true');
  if (box.parentNode) box.parentNode.replaceChild(wrap, box);
  wrap.append(box, back);
  const entry = { box, wrap, back };
  const repaint = () => mdEditPaint(entry);
  mdEditWraps.set(box, wrap);
  mdEditEntries.add(entry);
  mdEditWatchValue(box, repaint);
  box.addEventListener('input', repaint);
  box.addEventListener('scroll', () => { back.scrollTop = box.scrollTop; });
  new ResizeObserver(repaint).observe(box);
  mdEditApply(entry);
  return wrap;
}

// The switch: every box attached so far takes it, and so does one attached later.
function mdEditSetOn(on) {
  if ((on !== false) === mdEditOn) return;
  mdEditOn = on !== false;
  for (const entry of [...mdEditEntries]) {
    if (!entry.wrap.isConnected) mdEditEntries.delete(entry);
    else mdEditApply(entry);
  }
}
