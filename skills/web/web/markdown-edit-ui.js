'use strict';
// The colours of the Markdown boxes on the page: the card form's description and the Scratchpad's and the
// Todos tab's Edit boxes call mdEditAttach(box) once, and the text in them is then drawn in colour (markdown-edit.js has
// the rules, the --md-edit-* tokens in app.css the colours).
//
// A coloured copy of the text sits behind the textarea in a <pre> that takes the textarea's font, padding,
// border, wrapping and size, so each word is where the textarea has it, and the textarea's own text is
// transparent (its caret, selection and spellcheck stay). The textarea is still the one place the text
// lives: typing, Undo, composing, Tab and the editing keys, Ctrl+S and Ctrl+Enter all reach it as they
// did. Only colours (and a line-through or a dotted line under) are ever applied, never weight, style or
// size, so no line can wrap differently from the textarea's.
//
// When the copy is drawn. The text is redrawn at most once a frame: an input, or code setting the value,
// asks for a frame and any number of them before it share it; the frame comes before the page is painted,
// so the textarea's transparent text is never seen without its copy. The textarea's computed style is read
// on attach, on a resize and when the switch is turned on, never on an input. A resize is seen by one
// ResizeObserver for every box (the box grows with its text, a person drags it, the popup goes full screen,
// the phone layout takes over); it is called in the frame, so it draws at once and the frame an input asked
// for has nothing left to do. Per frame the copy reads only the textarea's width, to give up the width of
// a scrollbar that came or went with the text, and its scroll, which it follows.
//
// Colour Markdown while editing is a switch in the preferences sheet (app.js keeps it for the whole
// browser, mdEditSetOn applies it). While it is off the wrapper has no box of its own and the textarea sits
// in the page as it always did. A box the page has dropped (the Scratchpad's and the Todos tab's panels are
// rebuilt each time their tab opens) is let go of the next time a box is attached or the switch is flipped.
//
// mdEditAttach returns the node to put in the page where the textarea went: the wrapper, which holds the
// textarea. Called with the textarea already in the page it takes its place there and the caller keeps
// nothing to do. This script reads markdown-edit.js's markdownEditSpans at the moment it runs, never
// when it loads.

let mdEditOn = true;
let mdEditResizer = null;
const mdEditEntries = new Set();
const mdEditWraps = new WeakMap();
const mdEditByBox = new WeakMap();

// What the copy takes from the textarea, so a line breaks where the textarea's does.
const MD_EDIT_COPY = [
  'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontKerning', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textAlign', 'textTransform', 'textIndent', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak',
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

// The textarea's metrics, copied to the copy: font, padding, border widths and wrapping. What a width needs
// from them each frame (the padding on the right and the borders) is kept.
function mdEditMetrics(entry) {
  const { box, back } = entry;
  const cs = getComputedStyle(box);
  for (const prop of MD_EDIT_COPY) back.style[prop] = cs[prop];
  entry.padRight = parseFloat(cs.paddingRight);
  entry.sides = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  entry.bar = 0;
}

// A scrollbar on the textarea narrows the width its text wraps in, so the copy gives up the same width on its
// right. The bar is what the box's own width has beyond its borders and its inside; measured from the rect,
// which keeps the fraction the rounded widths lose at a fractional zoom, and a difference under a pixel is
// that rounding, not a bar.
function mdEditBar(entry) {
  const { box, back } = entry;
  const left = box.getBoundingClientRect().width - entry.sides - box.clientWidth;
  const bar = left < 1 ? 0 : left;
  if (bar === entry.bar) return;
  entry.bar = bar;
  back.style.paddingRight = `${entry.padRight + bar}px`;
}

// The copy drawn again from the textarea, now.
function mdEditFlush(entry) {
  entry.queued = false;
  if (!mdEditOn) return;
  mdEditBar(entry);
  entry.back.replaceChildren(mdEditNodes(entry.box.value));
  entry.back.scrollTop = entry.box.scrollTop;
}

// Asks for the copy to be drawn in the next frame; a frame already asked for does for this.
function mdEditSchedule(entry) {
  if (entry.queued) return;
  entry.queued = true;
  requestAnimationFrame(() => { if (entry.queued) mdEditFlush(entry); });
}

function mdEditApply(entry) {
  entry.wrap.classList.toggle('on', mdEditOn);
  if (mdEditOn) {
    mdEditMetrics(entry);
    mdEditFlush(entry);
  } else {
    entry.queued = false;
    entry.back.replaceChildren();
  }
}

// One observer for every box: it is called in the frame a box was resized, after layout and before paint.
function mdEditObserver() {
  if (!mdEditResizer) {
    mdEditResizer = new ResizeObserver((seen) => {
      for (const one of seen) {
        const entry = mdEditByBox.get(one.target);
        if (!entry || !mdEditOn) continue;
        mdEditMetrics(entry);
        mdEditFlush(entry);
      }
    });
  }
  return mdEditResizer;
}

function mdEditDrop(entry) {
  mdEditEntries.delete(entry);
  mdEditByBox.delete(entry.box);
  mdEditObserver().unobserve(entry.box);
}

// Code sets a textarea's value (a card opened into the form, a saved page loaded): the copy has to follow
// without an input event. The box's own accessor is wrapped, not the prototype's, so no other textarea is
// touched.
function mdEditWatchValue(box, changed) {
  let desc = null;
  for (let o = box; o && !desc; o = Object.getPrototypeOf(o)) desc = Object.getOwnPropertyDescriptor(o, 'value');
  if (!desc || !desc.get || !desc.set) return;
  Object.defineProperty(box, 'value', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(box); },
    set(v) { desc.set.call(box, v); changed(); },
  });
}

function mdEditAttach(box) {
  if (!box || box.dataset.mdEdit) return mdEditWraps.get(box) || box;
  box.dataset.mdEdit = '1';
  for (const old of [...mdEditEntries]) if (!old.wrap.isConnected) mdEditDrop(old);
  const wrap = document.createElement('div');
  wrap.className = 'md-edit';
  const back = document.createElement('pre');
  back.className = 'md-edit-back';
  back.setAttribute('aria-hidden', 'true');
  if (box.parentNode) box.parentNode.replaceChild(wrap, box);
  wrap.append(box, back);
  const entry = { box, wrap, back, queued: false, padRight: 0, sides: 0, bar: 0 };
  const changed = () => mdEditSchedule(entry);
  mdEditWraps.set(box, wrap);
  mdEditByBox.set(box, entry);
  mdEditEntries.add(entry);
  mdEditWatchValue(box, changed);
  box.addEventListener('input', changed);
  box.addEventListener('scroll', () => { back.scrollTop = box.scrollTop; });
  mdEditObserver().observe(box);
  mdEditApply(entry);
  return wrap;
}

// The switch: every box attached so far takes it, and so does one attached later.
function mdEditSetOn(on) {
  if ((on !== false) === mdEditOn) return;
  mdEditOn = on !== false;
  for (const entry of [...mdEditEntries]) {
    if (!entry.wrap.isConnected) mdEditDrop(entry);
    else mdEditApply(entry);
  }
}
